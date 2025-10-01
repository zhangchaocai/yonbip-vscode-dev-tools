import * as vscode from 'vscode';
import { McpService, McpConfig, McpStatus } from './McpService';

/**
 * MCP服务WebView提供者
 */
export class McpProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip-mcp';

    private _view?: vscode.WebviewView;
    private mcpService: McpService;
    private outputChannel: vscode.OutputChannel;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) {
        this.mcpService = new McpService(context);
        this.outputChannel = vscode.window.createOutputChannel('MCP Provider');
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 处理来自WebView的消息
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'loadConfig':
                    await this.handleLoadConfig();
                    break;
                case 'saveConfig':
                    await this.handleSaveConfig(data.config);
                    break;
                case 'resetConfig':
                    await this.handleResetConfig();
                    break;
                case 'startMcp':
                    await this.handleStart();
                    break;
                case 'stopMcp':
                    await this.handleStop();
                    break;
                case 'getStatus':
                    await this.handleGetStatus();
                    break;
                case 'selectJarFile':
                    await this.handleSelectJarFile();
                    break;
                case 'showResetConfirm':
                    await this.handleShowResetConfirm();
                    break;
            }
        });

        // 初始加载配置和状态
        this.handleLoadConfig();
        this.handleGetStatus();
    }

    /**
     * 处理加载配置
     */
    private async handleLoadConfig() {
        const config = this.mcpService.getConfig();

        this._view?.webview.postMessage({
            type: 'configLoaded',
            config
        });
    }

    /**
     * 处理重置配置
     */
    private async handleResetConfig() {
        try {
            // 获取默认配置
            const defaultConfig = this.mcpService.getDefaultConfig();

            // 保存默认配置
            await this.mcpService.saveConfig(defaultConfig);

            // 发送配置加载消息，更新前端显示
            this._view?.webview.postMessage({
                type: 'configLoaded',
                config: defaultConfig
            });

            // 显示重置成功的提示
            vscode.window.showInformationMessage('MCP配置已重置为默认值');

            this._view?.webview.postMessage({
                type: 'configSaved',
                success: true
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`重置MCP配置失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理保存配置
     */
    private async handleSaveConfig(config: McpConfig) {
        try {
            await this.mcpService.saveConfig(config);

            // 添加保存成功的提示
            vscode.window.showInformationMessage('MCP配置已保存');

            this._view?.webview.postMessage({
                type: 'configSaved',
                success: true
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`保存MCP配置失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理启动MCP服务
     */
    private async handleStart() {
        try {
            // 显示启动中状态
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: '正在启动服务...'
                }
            });

            await this.mcpService.start();
            await this.handleGetStatus();

            // 启动成功后自动切换到MCP服务面板
            vscode.commands.executeCommand('workbench.view.extension.yonbip-view');

            this._view?.webview.postMessage({
                type: 'mcpStarted',
                success: true
            });
        } catch (error: any) {
            // 更新状态为错误
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: `启动失败: ${error.message}`
                }
            });

            this._view?.webview.postMessage({
                type: 'mcpStarted',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理停止MCP服务
     */
    private async handleStop() {
        try {
            this.outputChannel.appendLine('开始停止MCP服务...');

            // 先更新状态为停止中
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: '正在停止服务...'
                }
            });

            await this.mcpService.stop();

            // 停止完成后更新状态
            await this.handleGetStatus();

            this._view?.webview.postMessage({
                type: 'mcpStopped',
                success: true
            });

            this.outputChannel.appendLine('MCP服务停止操作完成');
        } catch (error: any) {
            this.outputChannel.appendLine(`MCP服务停止失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'mcpStopped',
                success: false,
                error: error.message
            });
        }
    }



    /**
     * 处理获取状态
     */
    private async handleGetStatus() {
        try {
            const mcpStatus = this.mcpService.getStatus();
            const status = {
                isRunning: mcpStatus === McpStatus.RUNNING,
                message: this.getStatusMessage(mcpStatus)
            };

            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: `获取状态失败: ${error.message}`
                }
            });
        }
    }

    /**
     * 获取状态消息
     */
    private getStatusMessage(status: McpStatus): string {
        switch (status) {
            case McpStatus.RUNNING:
                return '服务正在运行中';
            case McpStatus.STARTING:
                return '服务正在启动中';
            case McpStatus.STOPPING:
                return '服务正在停止中';
            case McpStatus.ERROR:
                return '服务发生错误';
            case McpStatus.STOPPED:
            default:
                return '服务已停止';
        }
    }



    /**
     * 处理显示重置确认对话框
     */
    private async handleShowResetConfirm() {
        const result = await vscode.window.showWarningMessage(
            '确定要重置所有配置为默认值吗？',
            '确定',
            '取消'
        );

        if (result === '确定') {
            await this.handleResetConfig();
        }
    }

    /**
     * 处理选择JAR文件
     */
    private async handleSelectJarFile() {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'JAR文件': ['jar']
                },
                openLabel: '选择MCP JAR文件'
            });

            if (result && result[0]) {
                this._view?.webview.postMessage({
                    type: 'jarFileSelected',
                    success: true,
                    jarPath: result[0].fsPath
                });
            } else {
                this._view?.webview.postMessage({
                    type: 'jarFileSelected',
                    success: false
                });
            }
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'jarFileSelected',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 生成WebView HTML内容
     */
    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP服务管理</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 15px;
            margin: 0;
        }
        
        .section {
            margin-bottom: 20px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 20px;
            background-color: var(--vscode-input-background);
        }
        
        .section-title {
            font-weight: bold;
            margin-bottom: 15px;
            color: var(--vscode-textLink-foreground);
            font-size: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 8px;
        }
        
        .status-indicator {
            display: inline-flex;
            align-items: center;
            padding: 8px 12px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 14px;
            margin-bottom: 15px;
        }
        
        .status-running {
            background-color: var(--vscode-terminal-ansiGreen);
            color: white;
        }
        
        .status-stopped {
            background-color: var(--vscode-errorForeground);
            color: white;
        }
        
        .status-unknown {
            background-color: var(--vscode-descriptionForeground);
            color: white;
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        .form-row {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            gap: 8px; /* 使用gap替代margin */
        }
        
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600; /* 使用600代替bold */
            min-width: 120px;
            color: var(--vscode-foreground);
        }
        
        .form-row label {
            margin-bottom: 0;
            margin-right: 0; /* 使用gap替代margin */
            flex-shrink: 0;
        }
        
        input, select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            box-sizing: border-box;
            height: 38px; /* 统一输入框高度 */
            line-height: 1.4;
        }
        
        .form-row input, .form-row select {
            flex: 1;
            margin-right: 8px; /* 添加右边距 */
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
            height: 38px; /* 统一按钮高度 */
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 80px; /* 最小宽度 */
            box-sizing: border-box;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        button.danger {
            background-color: var(--vscode-errorForeground);
            color: white;
        }
        
        .tabs {
            display: flex;
            border-bottom: 2px solid var(--vscode-widget-border);
            margin-bottom: 20px;
        }
        
        .tab {
            padding: 12px 20px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--vscode-foreground);
            margin-right: 4px;
            border-radius: 6px 6px 0 0;
            font-weight: 500;
        }
        
        .tab.active {
            background-color: var(--vscode-tab-activeBackground);
            border-bottom: 3px solid var(--vscode-textLink-foreground);
            color: var(--vscode-textLink-foreground);
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .checkbox-group input[type="checkbox"] {
            width: auto;
            margin-right: 8px;
        }
        
        .help-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }
        
        .service-controls {
            display: flex;
            gap: 12px;
            margin-top: 16px;
            flex-wrap: wrap; /* 允许按钮换行 */
        }

        .service-controls button {
            flex: 1;
            min-width: 120px;
            max-width: 200px;
            transition: all 0.2s ease;
        }
        
        .service-controls button:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }

        #quickInfo {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .config-item {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 12px;
            flex: 1 0 auto;
            max-width: 100%;
            transition: all 0.2s ease;
        }
        
        .config-item:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .config-label {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 6px;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .config-value {
            color: var(--vscode-foreground);
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
            word-break: break-all;
            font-size: 13px;
            line-height: 1.4;
        }
        
        /* 响应式布局 - 窄屏优化 */
        @media (max-width: 600px) {
            .tabs {
                flex-wrap: wrap;
                gap: 4px;
            }
            
            .tab {
                padding: 8px 12px;
                font-size: 13px;
                margin-right: 2px;
                flex: 1;
                min-width: 0;
                text-align: center;
            }
            
            .form-row {
                flex-direction: column;
                align-items: stretch;
                gap: 8px;
            }
            
            .form-row label {
                margin-right: 0;
                margin-bottom: 4px;
                min-width: auto;
            }
            
            .form-row input {
                margin-right: 0;
                width: 100%;
            }
            
            .form-row button {
                width: 100%;
                margin-left: 0;
            }
            
            .service-controls {
                flex-direction: column;
            }
            
            .service-controls button {
                max-width: 100%;
                width: 100%;
            }
            
            #quickInfo {
                flex-direction: column;
            }
            
            .config-item {
                max-width: 100%;
            }
            
            .section {
                padding: 15px;
            }
            
            .section-title {
                font-size: 15px;
            }
        }
        
        /* 中等屏幕优化 */
        @media (max-width: 800px) and (min-width: 601px) {
            .form-row {
                flex-wrap: wrap;
            }
            
            .form-row label {
                min-width: 80px;
            }
            
            .service-controls button {
                max-width: calc(33.333% - 10px);
            }
        }
    </style>
</head>
<body>
    <div id="app">
        <!-- 选项卡 -->
        <div class="tabs">
            <button class="tab active" onclick="switchTab('status')">📊 服务状态</button>
            <button class="tab" onclick="switchTab('config')">⚙️ 配置管理</button>
        </div>

        <!-- 服务状态选项卡 -->
        <div id="status-tab" class="tab-content active">
            <div class="section">
                <div class="section-title">MCP 服务状态</div>
                
                <div id="statusIndicator" class="status-indicator status-unknown">
                    🔍 检查服务状态中...
                </div>
                
                <div id="statusMessage" style="margin-bottom: 15px; color: var(--vscode-descriptionForeground);">
                    正在获取服务状态信息...
                </div>
                
                <div class="service-controls">
                    <button id="startBtn" onclick="startMcp()">▶️ 启动服务</button>
                    <button id="stopBtn" onclick="stopMcp()" class="danger">⏹️ 停止服务</button>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">快速信息</div>
                <div id="quickInfo">
                    <div class="config-item">
                        <div class="config-label">服务端口</div>
                        <div class="config-value" id="quickPort">-</div>
                    </div>
                    <div class="config-item">
                        <div class="config-label">JAR文件路径</div>
                        <div class="config-value" id="quickJarPath">-</div>
                    </div>
                    <div class="config-item">
                        <div class="config-label">Java路径</div>
                        <div class="config-value" id="quickJavaPath">-</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 配置管理选项卡 -->
        <div id="config-tab" class="tab-content">
            <div class="section">
                <div class="section-title">服务配置</div>
                
                <div class="form-group">
                    <label for="port">服务端口:</label>
                    <input type="number" id="port" placeholder="9000" min="1024" max="65535">
                    <div class="help-text">MCP服务监听的端口号 (1024-65535)</div>
                </div>
                
                <div class="form-group">
                    <div class="form-row">
                        <label for="jarPath">JAR文件路径:</label>
                        <input type="text" id="jarPath" readonly placeholder="选择MCP JAR文件">
                        <button onclick="selectJarFile()" style="margin-left: 10px; min-width: 80px;">浏览...</button>
                    </div>
                    <div class="help-text">MCP服务的JAR包文件路径</div>
                </div>
                
                <div class="form-group">
                    <label for="javaPath">Java可执行文件路径:</label>
                    <input type="text" id="javaPath" placeholder="java">
                    <div class="help-text">Java运行时环境路径，留空使用系统默认</div>
                </div>
                
                <div class="form-group">
                    <label for="maxMemory">最大内存:</label>
                    <input type="text" id="maxMemory" placeholder="512m">
                    <div class="help-text">JVM最大内存设置，如：512m, 1g, 2048m</div>
                </div>
                
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="enableDebug">
                        <label for="enableDebug">启用调试模式</label>
                    </div>
                    <div class="help-text">启用后将输出详细的调试信息</div>
                </div>
                
                <div class="form-group">
                    <button onclick="saveConfig()">💾 保存配置</button>
                    <button onclick="resetToDefaults()" class="secondary">🔄 重置为默认</button>
                </div>
            </div>
        </div>


    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentConfig = {};
        let currentStatus = {};
        
        // 切换选项卡
        function switchTab(tabName) {
            const tabs = document.querySelectorAll('.tab-content');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }
        
        // 启动MCP服务
        function startMcp() {
            vscode.postMessage({ type: 'startMcp' });
        }
        
        // 停止MCP服务
        function stopMcp() {
            console.log('点击了停止服务按钮，直接执行停止操作');
            
            // 立即禁用按钮，显示停止中状态
            const stopBtn = document.getElementById('stopBtn');
            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '⏹️ 停止中...';
            }
            
            const indicator = document.getElementById('statusIndicator');
            if (indicator) {
                indicator.className = 'status-indicator status-stopped';
                indicator.textContent = '🟡 正在停止...';
            }
            
            console.log('发送停止消息到后端');
            vscode.postMessage({ type: 'stopMcp' });
        }
        

        
        // 选择JAR文件
        function selectJarFile() {
            vscode.postMessage({ type: 'selectJarFile' });
        }
        
        // 保存配置
        function saveConfig() {
            const config = {
                port: parseInt(document.getElementById('port').value) || 9000,
                jarPath: document.getElementById('jarPath').value,
                javaPath: document.getElementById('javaPath').value || 'java',
                maxMemory: document.getElementById('maxMemory').value || '512m',
                enableDebug: document.getElementById('enableDebug').checked
            };
            
            vscode.postMessage({
                type: 'saveConfig',
                config: config
            });
        }
        
        // 重置为默认配置
        function resetToDefaults() {
                vscode.postMessage({
                    type: 'resetConfig'
                });
        }
        

        
        // 更新配置显示
        function updateConfigDisplay(config) {
            currentConfig = config;
            
            document.getElementById('port').value = config.port || 9000;
            document.getElementById('jarPath').value = config.jarPath || '';
            document.getElementById('javaPath').value = config.javaPath || 'java';
            document.getElementById('maxMemory').value = config.maxMemory || '512m';
            document.getElementById('enableDebug').checked = config.enableDebug || false;
            
            // 更新快速信息
            document.getElementById('quickPort').textContent = config.port || 9000;
            document.getElementById('quickJarPath').textContent = config.jarPath || '使用内置JAR';
            document.getElementById('quickJavaPath').textContent = config.javaPath || 'java';
        }
        
        // 更新状态显示
        function updateStatusDisplay(status) {
            currentStatus = status;
            
            const indicator = document.getElementById('statusIndicator');
            const message = document.getElementById('statusMessage');
            const startBtn = document.getElementById('startBtn');
            const stopBtn = document.getElementById('stopBtn');
            
            if (status.isRunning) {
                indicator.className = 'status-indicator status-running';
                indicator.textContent = '🟢 服务运行中';
                
                startBtn.disabled = true;
                stopBtn.disabled = false;
                stopBtn.textContent = '⏹️ 停止服务'; // 确保按钮文本正确
            } else {
                indicator.className = 'status-indicator status-stopped';
                indicator.textContent = '🔴 服务已停止';
                
                startBtn.disabled = false;
                stopBtn.disabled = true;
                stopBtn.textContent = '⏹️ 停止服务'; // 确保按钮文本正确
            }
            
            message.textContent = status.message || '无状态信息';
        }
        
        // 监听消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configLoaded':
                    updateConfigDisplay(message.config);
                    break;
                    
                case 'statusLoaded':
                    updateStatusDisplay(message.status);
                    break;
                    
                case 'configSaved':
                    if (message.success) {
                        console.log('配置保存成功');
                    } else {
                        console.error('配置保存失败: ' + message.error);
                    }
                    break;
                    
                case 'mcpStarted':
                    if (message.success) {
                        console.log('MCP服务启动成功');
                    } else {
                        console.error('MCP服务启动失败: ' + message.error);
                    }
                    break;
                    
                case 'mcpStopped':
                    if (message.success) {
                        console.log('MCP服务已停止');
                    } else {
                        console.error('MCP服务停止失败: ' + message.error);
                    }
                    break;
                    

                    
                case 'jarFileSelected':
                    if (message.success && message.jarPath) {
                        document.getElementById('jarPath').value = message.jarPath;
                        console.log('JAR文件选择成功: ' + message.jarPath);
                    } else {
                        console.log('取消选择JAR文件');
                    }
                    break;
            }
        });
        
        // 页面加载完成后加载配置
        vscode.postMessage({ type: 'loadConfig' });
        
        // 定期刷新状态 - 使用变量控制，避免停止后继续刷新
        let statusInterval = setInterval(() => {
            vscode.postMessage({ type: 'getStatus' });
        }, 5000);
        
        // 监听停止事件，清理定时器
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.type === 'mcpStopped' && message.success) {
                clearInterval(statusInterval);
                console.log('服务已停止，清理状态刷新定时器');
                
                // 延迟重新启动定时器（服务完全停止后）
                setTimeout(() => {
                    statusInterval = setInterval(() => {
                        vscode.postMessage({ type: 'getStatus' });
                    }, 5000);
                }, 3000);
            }
        });
    </script>
</body>
</html>`;
    }
}