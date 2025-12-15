"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpProvider = void 0;
const vscode = __importStar(require("vscode"));
const McpService_1 = require("./McpService");
class McpProvider {
    _extensionUri;
    context;
    static viewType = 'yonbip-mcp';
    _view;
    mcpService;
    outputChannel;
    constructor(_extensionUri, context) {
        this._extensionUri = _extensionUri;
        this.context = context;
        this.mcpService = new McpService_1.McpService(context);
        this.outputChannel = vscode.window.createOutputChannel('MCP Provider');
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
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
                case 'selectJavaPath':
                    await this.handleSelectJavaPath();
                    break;
                case 'showResetConfirm':
                    await this.handleShowResetConfirm();
                    break;
            }
        });
        this.handleLoadConfig();
        this.handleGetStatus();
    }
    async handleLoadConfig() {
        const config = this.mcpService.getConfig();
        this._view?.webview.postMessage({
            type: 'configLoaded',
            config
        });
    }
    async handleResetConfig() {
        try {
            const defaultConfig = this.mcpService.getDefaultConfig();
            await this.mcpService.saveConfig(defaultConfig);
            this._view?.webview.postMessage({
                type: 'configLoaded',
                config: defaultConfig
            });
            vscode.window.showInformationMessage('MCP配置已重置为默认值');
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: true
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`重置MCP配置失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: false,
                error: error.message
            });
        }
    }
    async handleSaveConfig(config) {
        try {
            await this.mcpService.saveConfig(config);
            vscode.window.showInformationMessage('MCP配置已保存');
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: true
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`保存MCP配置失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: false,
                error: error.message
            });
        }
    }
    async handleStart() {
        try {
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: '正在启动服务...'
                }
            });
            await this.mcpService.start();
            await this.handleGetStatus();
            vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
            this._view?.webview.postMessage({
                type: 'mcpStarted',
                success: true
            });
        }
        catch (error) {
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
    async handleStop() {
        try {
            this.outputChannel.appendLine('开始停止MCP服务...');
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: '正在停止服务...'
                }
            });
            await this.mcpService.stop();
            await this.handleGetStatus();
            this._view?.webview.postMessage({
                type: 'mcpStopped',
                success: true
            });
            this.outputChannel.appendLine('MCP服务停止操作完成');
        }
        catch (error) {
            this.outputChannel.appendLine(`MCP服务停止失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'mcpStopped',
                success: false,
                error: error.message
            });
        }
    }
    async handleGetStatus() {
        try {
            const mcpStatus = this.mcpService.getStatus();
            const alive = await this.mcpService.isServiceAlive();
            const status = {
                isRunning: alive,
                hasError: mcpStatus === McpService_1.McpStatus.ERROR,
                message: this.getStatusMessageWithAlive(mcpStatus, alive)
            };
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status
            });
        }
        catch (error) {
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    hasError: false,
                    message: `获取状态失败: ${error.message}`
                }
            });
        }
    }
    getStatusMessageWithAlive(status, alive) {
        if (alive) {
            if (status === McpService_1.McpStatus.ERROR) {
                return '服务运行中（日志出现错误）';
            }
            if (status === McpService_1.McpStatus.STARTING) {
                return '服务正在启动中';
            }
            return '服务正在运行中';
        }
        else {
            switch (status) {
                case McpService_1.McpStatus.STOPPING:
                    return '服务正在停止中';
                case McpService_1.McpStatus.ERROR:
                    return '服务发生错误（可能已不可用）';
                case McpService_1.McpStatus.STOPPED:
                default:
                    return '服务已停止';
            }
        }
    }
    async handleShowResetConfirm() {
        const result = await vscode.window.showWarningMessage('确定要重置所有配置为默认值吗？', '确定', '取消');
        if (result === '确定') {
            await this.handleResetConfig();
        }
    }
    async handleSelectJarFile() {
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
            }
            else {
                this._view?.webview.postMessage({
                    type: 'jarFileSelected',
                    success: false
                });
            }
        }
        catch (error) {
            this._view?.webview.postMessage({
                type: 'jarFileSelected',
                success: false,
                error: error.message
            });
        }
    }
    async handleSelectJavaPath() {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'Executable Files': ['exe', 'bat', 'cmd', 'sh', 'bin'],
                    'All Files': ['*']
                },
                openLabel: '选择Java可执行文件'
            });
            if (result && result[0]) {
                this._view?.webview.postMessage({
                    type: 'javaPathSelected',
                    success: true,
                    javaPath: result[0].fsPath
                });
            }
            else {
                this._view?.webview.postMessage({
                    type: 'javaPathSelected',
                    success: false
                });
            }
        }
        catch (error) {
            this._view?.webview.postMessage({
                type: 'javaPathSelected',
                success: false,
                error: error.message
            });
        }
    }
    _getHtmlForWebview(webview) {
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
            /* 确保body可以滚动 */
            overflow-y: auto;
        }

        /* 页面容器与基础布局 */
        #app {
            max-width: 980px;
            margin: 0 auto;
            /* 确保app容器可以滚动 */
            overflow-y: auto;
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
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 15px;
            gap: 8px;
            border: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-editor-background);
        }
        .status-indicator::before {
            content: '';
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background-color: var(--vscode-descriptionForeground);
        }
        
        .status-running {
            color: var(--vscode-terminal-ansiGreen);
        }
        .status-running::before {
            background-color: var(--vscode-terminal-ansiGreen);
        }
        .status-stopped {
            color: var(--vscode-errorForeground);
        }
        .status-stopped::before {
            background-color: var(--vscode-errorForeground);
        }
        .status-unknown {
            color: var(--vscode-descriptionForeground);
        }
        .status-unknown::before {
            background-color: var(--vscode-descriptionForeground);
        }
        .status-warning {
            color: var(--vscode-terminal-ansiYellow);
        }
        .status-warning::before {
            background-color: var(--vscode-terminal-ansiYellow);
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
            background-color: transparent;
            color: var(--vscode-errorForeground);
            border: 1px solid var(--vscode-errorForeground);
        }
        button.danger:hover {
            background-color: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
        }
        
        .tabs {
            display: flex;
            border-bottom: 2px solid var(--vscode-widget-border);
            margin-bottom: 20px;
            position: sticky;
            top: 0; /* 修改为0，因为已经移除了页头 */
            background-color: var(--vscode-editor-background);
            z-index: 90;
            padding-top: 10px;
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
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
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
            letter-spacing: 0.2px;
        }
        
        .config-value {
            color: var(--vscode-foreground);
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
            word-break: break-all;
            font-size: 13px;
            line-height: 1.4;
        }
        
        /* 配置页底部操作条（滚动时固定） */
        .sticky-actions {
            position: sticky;
            bottom: 0;
            background-color: var(--vscode-input-background);
            padding: 12px 0;
            border-top: 1px solid var(--vscode-widget-border);
            z-index: 95;
            display: flex;
            gap: 10px;
        }

        /* 避免贴底遮挡内容，给页面底部留出空间 */
        #app {
            padding-bottom: 12px;
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
                grid-template-columns: 1fr;
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
            #quickInfo {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }
        
        /* Java路径输入框样式 - 显示文件夹图标 */
        .path-input-container {
            position: relative;
            display: flex;
            align-items: center;
        }
        
        #javaPath {
            flex: 1;
            padding-right: 30px;
        }
        
        .folder-icon {
            position: absolute;
            right: 8px;
            cursor: pointer;
            font-size: 16px;
            color: var(--vscode-foreground);
            user-select: none;
        }
        
        .folder-icon:hover {
            color: var(--vscode-textLink-foreground);
        }
    </style>
</head>
<body>
    <div id="app">
        <!-- 页头 -->
        <!--
        <div class="header">
            <div>
                <div class="header-title">YonBIP MCP 服务</div>
                <div class="header-subtitle">本地开发服务管理与配置</div>
            </div>

        </div>
        -->
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
                    <label for="javaPath">Java可执行文件路径:</label>
                    <div class="form-row">
                        <div class="path-input-container">
                            <input type="text" id="javaPath" placeholder="java" readonly onclick="selectJavaPath()">
                            <span class="folder-icon" onclick="selectJavaPath()">📁</span>
                        </div>
                    </div>
                    <div class="help-text">Java运行时环境路径，留空使用系统默认</div>
                </div>
                
                <div class="form-group">
                    <div id="configActions" class="sticky-actions">
                        <button onclick="saveConfig()">💾 保存配置</button>
                        <button onclick="resetToDefaults()" class="secondary">🔄 重置为默认</button>
                    </div>
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
        
        // 选择Java路径
        function selectJavaPath() {
            vscode.postMessage({ type: 'selectJavaPath' });
        }
        
        // 保存配置
        function saveConfig() {
            const config = {
                port: parseInt(document.getElementById('port').value) || 9000,
                javaPath: document.getElementById('javaPath').value || 'java'
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
            document.getElementById('javaPath').value = config.javaPath || 'java';
            
            // 更新快速信息
            document.getElementById('quickPort').textContent = config.port || 9000;
            document.getElementById('quickJavaPath').textContent = config.javaPath || 'java';

            // 更新页头端口摘要
            const portChip = document.getElementById('headerPortChip');
            if (portChip) {
                portChip.textContent = '端口: ' + (config.port || 9000);
            }
        }
        
        // 更新状态显示
        function updateStatusDisplay(status) {
            currentStatus = status;
            
            const indicator = document.getElementById('statusIndicator');
            const message = document.getElementById('statusMessage');
            const startBtn = document.getElementById('startBtn');
            const stopBtn = document.getElementById('stopBtn');
            
            if (status.isRunning && status.hasError) {
                indicator.className = 'status-indicator status-warning';
                indicator.textContent = '🟡 服务运行中（出现错误日志）';
                
                startBtn.disabled = true;
                stopBtn.disabled = false;
                stopBtn.textContent = '⏹️ 停止服务';
            } else if (status.isRunning) {
                indicator.className = 'status-indicator status-running';
                indicator.textContent = '服务运行中';
                
                startBtn.disabled = true;
                stopBtn.disabled = false;
                stopBtn.textContent = '⏹️ 停止服务';
            } else {
                indicator.className = 'status-indicator status-stopped';
                indicator.textContent = '服务已停止';
                
                startBtn.disabled = false;
                stopBtn.disabled = true;
                stopBtn.textContent = '⏹️ 停止服务';
            }
            
            message.textContent = status.message || '无状态信息';

            // 更新页头状态摘要
            const headerStatusChip = document.getElementById('headerStatusChip');
            if (headerStatusChip) {
                if (status.isRunning && status.hasError) {
                    headerStatusChip.textContent = '状态: 运行中（异常）';
                    headerStatusChip.className = 'chip chip-warning';
                } else if (status.isRunning) {
                    headerStatusChip.textContent = '状态: 运行中';
                    headerStatusChip.className = 'chip chip-running';
                } else {
                    headerStatusChip.textContent = '状态: 已停止';
                    headerStatusChip.className = 'chip chip-stopped';
                }
            }
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
                    
                case 'javaPathSelected':
                    if (message.success && message.javaPath) {
                        document.getElementById('javaPath').value = message.javaPath;
                        console.log('Java路径选择成功: ' + message.javaPath);
                    } else {
                        console.log('取消选择Java路径');
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
exports.McpProvider = McpProvider;
//# sourceMappingURL=McpProvider.js.map