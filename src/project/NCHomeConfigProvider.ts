import * as vscode from 'vscode';
import { NCHomeConfigService } from './NCHomeConfigService';
import { DataSourceMeta, NCHomeConfig } from './NCHomeConfigTypes';

/**
 * NC Home配置WebView提供者
 */
export class NCHomeConfigProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip-nchome';
    
    private _view?: vscode.WebviewView;
    private configService: NCHomeConfigService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) {
        this.configService = new NCHomeConfigService(context);
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
                case 'selectHomeDirectory':
                    await this.handleSelectHomeDirectory();
                    break;
                case 'openHomeDirectory':
                    await this.handleOpenHomeDirectory();
                    break;
                case 'openSysConfig':
                    await this.handleOpenSysConfig();
                    break;
                case 'testConnection':
                    await this.handleTestConnection(data.dataSource);
                    break;
                case 'addDataSource':
                    await this.handleAddDataSource(data.dataSource);
                    break;
                case 'updateDataSource':
                    await this.handleUpdateDataSource(data.dataSource);
                    break;
                case 'deleteDataSource':
                    await this.handleDeleteDataSource(data.dataSourceName);
                    break;
                case 'setDesignDatabase':
                    await this.handleSetDesignDatabase(data.dataSourceName);
                    break;
                case 'setBaseDatabase':
                    await this.handleSetBaseDatabase(data.dataSourceName);
                    break;
                case 'parseConnectionString':
                    await this.handleParseConnectionString(data.connectionString);
                    break;
            }
        });

        // 初始加载配置
        this.handleLoadConfig();
    }

    /**
     * 处理加载配置
     */
    private async handleLoadConfig() {
        const config = this.configService.getConfig();
        this._view?.webview.postMessage({
            type: 'configLoaded',
            config
        });
    }

    /**
     * 处理保存配置
     */
    private async handleSaveConfig(config: NCHomeConfig) {
        try {
            await this.configService.saveConfig(config);
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理选择Home目录
     */
    private async handleSelectHomeDirectory() {
        try {
            const homePath = await this.configService.selectHomeDirectory();
            if (homePath) {
                const config = this.configService.getConfig();
                config.homePath = homePath;
                await this.configService.saveConfig(config);
            }
            this._view?.webview.postMessage({
                type: 'homeDirectorySelected',
                homePath,
                success: !!homePath
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'homeDirectorySelected',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理打开Home目录
     */
    private async handleOpenHomeDirectory() {
        try {
            await this.configService.openHomeDirectory();
            this._view?.webview.postMessage({
                type: 'homeDirectoryOpened',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'homeDirectoryOpened',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理打开SysConfig
     */
    private async handleOpenSysConfig() {
        try {
            await this.configService.openSysConfig();
            this._view?.webview.postMessage({
                type: 'sysConfigOpened',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'sysConfigOpened',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理测试连接
     */
    private async handleTestConnection(dataSource: DataSourceMeta) {
        try {
            const result = await this.configService.testConnection(dataSource);
            this._view?.webview.postMessage({
                type: 'connectionTestResult',
                result
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionTestResult',
                result: {
                    success: false,
                    message: `测试连接失败: ${error.message}`
                }
            });
        }
    }

    /**
     * 处理添加数据源
     */
    private async handleAddDataSource(dataSource: DataSourceMeta) {
        try {
            await this.configService.addDataSource(dataSource);
            const config = this.configService.getConfig();
            this._view?.webview.postMessage({
                type: 'dataSourceAdded',
                success: true,
                config
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'dataSourceAdded',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理更新数据源
     */
    private async handleUpdateDataSource(dataSource: DataSourceMeta) {
        try {
            await this.configService.updateDataSource(dataSource);
            const config = this.configService.getConfig();
            this._view?.webview.postMessage({
                type: 'dataSourceUpdated',
                success: true,
                config
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'dataSourceUpdated',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理删除数据源
     */
    private async handleDeleteDataSource(dataSourceName: string) {
        try {
            await this.configService.deleteDataSource(dataSourceName);
            const config = this.configService.getConfig();
            this._view?.webview.postMessage({
                type: 'dataSourceDeleted',
                success: true,
                config
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'dataSourceDeleted',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理设置开发库
     */
    private async handleSetDesignDatabase(dataSourceName: string) {
        try {
            await this.configService.setAsDesignDatabase(dataSourceName);
            const config = this.configService.getConfig();
            this._view?.webview.postMessage({
                type: 'designDatabaseSet',
                success: true,
                config
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'designDatabaseSet',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理设置基准库
     */
    private async handleSetBaseDatabase(dataSourceName: string) {
        try {
            await this.configService.setBaseDatabase(dataSourceName);
            const config = this.configService.getConfig();
            this._view?.webview.postMessage({
                type: 'baseDatabaseSet',
                success: true,
                config
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'baseDatabaseSet',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理解析连接字符串
     */
    private async handleParseConnectionString(connectionString: string) {
        try {
            const result = this.configService.parseConnectionString(connectionString);
            this._view?.webview.postMessage({
                type: 'connectionStringParsed',
                result
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionStringParsed',
                result: {
                    valid: false,
                    error: error.message
                }
            });
        }
    }

    /**
     * 生成WebView HTML内容
     */
    private _getHtmlForWebview(webview: vscode.Webview) {
        // 尝试加载外部HTML文件
        const fs = require('fs');
        const path = require('path');
        
        const htmlPath = path.join(__dirname, 'nc-home-config.html');
        if (fs.existsSync(htmlPath)) {
            return fs.readFileSync(htmlPath, 'utf-8');
        }
        
        // 如果外部文件不存在，使用内嵌的HTML
        return this.getNCHomeConfigHTML();
    }

    /**
     * 获取NC Home配置的HTML内容
     */
    private getNCHomeConfigHTML(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NC Home配置</title>
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
        
        .form-group {
            margin-bottom: 15px;
        }
        
        .form-row {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            min-width: 100px;
        }
        
        .form-row label {
            margin-bottom: 0;
            margin-right: 10px;
        }
        
        input, select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            box-sizing: border-box;
        }
        
        .form-row input {
            flex: 1;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 18px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
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
        
        .status-message {
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 15px;
            text-align: center;
        }
        
        .status-success {
            background-color: var(--vscode-terminal-ansiGreen);
            color: white;
        }
        
        .status-error {
            background-color: var(--vscode-errorForeground);
            color: white;
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
    </style>
</head>
<body>
    <div id="app">
        <!-- 选项卡 -->
        <div class="tabs">
            <button class="tab active" onclick="switchTab('home')">🏠 Home配置</button>
            <button class="tab" onclick="switchTab('datasources')">🗄️ 数据源</button>
            <button class="tab" onclick="switchTab('advanced')">⚙️ 高级设置</button>
        </div>

        <!-- Home配置选项卡 -->
        <div id="home-tab" class="tab-content active">
            <div class="section">
                <div class="section-title">NC Home 路径设置</div>
                
                <div class="form-group">
                    <div class="form-row">
                        <label for="homePath">Home目录:</label>
                        <input type="text" id="homePath" readonly placeholder="请选择NC Home安装目录">
                        <button onclick="selectHomeDirectory()" style="margin-left: 10px; min-width: 80px;">浏览...</button>
                    </div>
                    <div class="help-text">选择YonBIP NC的安装目录，通常包含bin、lib、modules等文件夹</div>
                </div>
                
                <div class="form-group">
                    <button onclick="openHomeDirectory()">📂 打开Home目录</button>
                    <button class="secondary" onclick="openSysConfig()">🔧 启动SysConfig</button>
                    <button class="secondary" onclick="showOutput()">📝 查看日志</button>
                </div>
            </div>
        </div>

        <!-- 数据源选项卡 -->
        <div id="datasources-tab" class="tab-content">
            <div class="section">
                <div class="section-title">
                    数据源管理
                    <button onclick="showAddDataSourceForm()" style="float: right;">➕ 添加数据源</button>
                </div>
                
                <div id="datasourceList">
                    <div class="status-message" style="color: var(--vscode-descriptionForeground);">
                        🗂️ 暂无数据源配置，点击"添加数据源"开始配置
                    </div>
                </div>
            </div>
        </div>

        <!-- 高级设置选项卡 -->
        <div id="advanced-tab" class="tab-content">
            <div class="section">
                <div class="section-title">系统运行配置</div>
                
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="standardMode">
                        <label for="standardMode">标准模式</label>
                    </div>
                    <div class="help-text">启用标准模式以获得更稳定的运行环境</div>
                </div>
                
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="asyncTask">
                        <label for="asyncTask">异步任务处理</label>
                    </div>
                    <div class="help-text">启用异步任务处理以提升系统性能</div>
                </div>
                
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="autoClient">
                        <label for="autoClient">自动客户端</label>
                    </div>
                    <div class="help-text">自动管理客户端连接</div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">输出配置</div>
                
                <div class="form-group">
                    <label for="exportPatchPath">补丁输出目录:</label>
                    <input type="text" id="exportPatchPath" placeholder="./patches">
                    <div class="help-text">设置补丁包和导出文件的保存目录</div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">操作</div>
                <button onclick="saveAdvancedConfig()">💾 保存设置</button>
                <button class="secondary" onclick="resetToDefaults()">🔄 重置为默认</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentConfig = {};
        
        // 切换选项卡
        function switchTab(tabName) {
            const tabs = document.querySelectorAll('.tab-content');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            document.getElementById(tabName + '-tab').classList.add('active');
            
            // 通过事件对象找到触发的按钮
            const event = window.event;
            if (event && event.target) {
                event.target.classList.add('active');
            }
        }
        
        // 选择Home目录
        function selectHomeDirectory() {
            vscode.postMessage({ type: 'selectHomeDirectory' });
        }
        
        // 打开Home目录
        function openHomeDirectory() {
            vscode.postMessage({ type: 'openHomeDirectory' });
        }
        
        // 打开SysConfig
        function openSysConfig() {
            vscode.postMessage({ type: 'openSysConfig' });
        }
        
        // 显示输出
        function showOutput() {
            console.log('显示输出日志');
        }
        
        // 显示添加数据源表单
        function showAddDataSourceForm() {
            // 创建模态框
            const modal = document.createElement('div');
            modal.id = 'dataSourceModal';
            modal.style.cssText = \`
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0,0,0,0.5);
                z-index: 1000;
                display: flex;
                justify-content: center;
                align-items: center;
            \`;
            
            modal.innerHTML = \`
                <div style="
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 6px;
                    padding: 20px;
                    width: 500px;
                    max-width: 90%;
                ">
                    <h3 style="margin-top: 0; color: var(--vscode-foreground);">添加数据源</h3>
                    <div class="form-group">
                        <label for="dsName">数据源名称:</label>
                        <input type="text" id="dsName" required>
                    </div>
                    <div class="form-group">
                        <label for="dsType">数据库类型:</label>
                        <select id="dsType">
                            <option value="mysql">MySQL</option>
                            <option value="oracle">Oracle</option>
                            <option value="sqlserver">SQL Server</option>
                            <option value="postgresql">PostgreSQL</option>
                            <option value="db2">DB2</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="dsHost">主机地址:</label>
                        <input type="text" id="dsHost" value="localhost">
                    </div>
                    <div class="form-group">
                        <label for="dsPort">端口号:</label>
                        <input type="number" id="dsPort" value="3306">
                    </div>
                    <div class="form-group">
                        <label for="dsDatabase">数据库名:</label>
                        <input type="text" id="dsDatabase">
                    </div>
                    <div class="form-group">
                        <label for="dsUsername">用户名:</label>
                        <input type="text" id="dsUsername">
                    </div>
                    <div class="form-group">
                        <label for="dsPassword">密码:</label>
                        <input type="password" id="dsPassword">
                    </div>
                    <div style="text-align: right; margin-top: 20px;">
                        <button class="secondary" onclick="closeModal()">取消</button>
                        <button onclick="saveDataSource()">保存</button>
                    </div>
                </div>
            \`;
            
            document.body.appendChild(modal);
        }
        
        // 关闭模态框
        function closeModal() {
            const modal = document.getElementById('dataSourceModal');
            if (modal) {
                modal.remove();
            }
        }
        
        // 保存数据源
        function saveDataSource() {
            const dataSource = {
                name: document.getElementById('dsName').value,
                databaseType: document.getElementById('dsType').value,
                host: document.getElementById('dsHost').value,
                port: parseInt(document.getElementById('dsPort').value),
                databaseName: document.getElementById('dsDatabase').value,
                username: document.getElementById('dsUsername').value,
                password: document.getElementById('dsPassword').value,
                driverClassName: '' // 这将在后端处理
            };
            
            // 简单验证
            if (!dataSource.name || !dataSource.host || !dataSource.databaseName || !dataSource.username) {
                showMessage('请填写必填字段', 'error');
                return;
            }
            
            vscode.postMessage({
                type: 'addDataSource',
                dataSource: dataSource
            });
            
            closeModal();
        }
        
        // 显示消息
        function showMessage(message, type = 'info') {
            // 移除现有的消息元素
            const existingMessage = document.getElementById('messageToast');
            if (existingMessage) {
                existingMessage.remove();
            }
            
            const messageEl = document.createElement('div');
            messageEl.id = 'messageToast';
            messageEl.textContent = message;
            messageEl.className = 'status-message';
            
            if (type === 'error') {
                messageEl.classList.add('status-error');
            } else if (type === 'success') {
                messageEl.classList.add('status-success');
            } else {
                messageEl.style.backgroundColor = 'var(--vscode-notificationsInfoIcon-foreground)';
                messageEl.style.color = 'white';
            }
            
            // 添加样式
            messageEl.style.position = 'fixed';
            messageEl.style.bottom = '20px';
            messageEl.style.right = '20px';
            messageEl.style.zIndex = '1001';
            messageEl.style.maxWidth = '400px';
            messageEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
            
            document.body.appendChild(messageEl);
            
            // 3秒后自动移除
            setTimeout(() => {
                if (messageEl.parentNode) {
                    messageEl.parentNode.removeChild(messageEl);
                }
            }, 3000);
            
            console.log(\`[\${type.toUpperCase()}] \${message}\`);
        }
        
        // 更新配置显示
        function updateConfigDisplay(config) {
            currentConfig = config;
            
            // 更新Home路径
            if (config.homePath) {
                document.getElementById('homePath').value = config.homePath;
            }
            
            // 更新高级设置
            document.getElementById('standardMode').checked = config.standardMode !== false;
            document.getElementById('asyncTask').checked = config.asyncTask || false;
            document.getElementById('autoClient').checked = config.autoClient !== false;
            document.getElementById('exportPatchPath').value = config.exportPatchPath || './patches';
            
            // 更新数据源列表
            updateDataSourceList(config.dataSources || []);
        }
        
        // 更新数据源列表显示
        function updateDataSourceList(dataSources) {
            const dataSourceListElement = document.getElementById('datasourceList');
            
            if (!dataSources || dataSources.length === 0) {
                dataSourceListElement.innerHTML = '<div class="status-message" style="text-align: center; color: var(--vscode-descriptionForeground);">暂无数据源配置</div>';
                return;
            }
            
            let html = '<div style="margin-top: 10px;">';
            dataSources.forEach((ds, index) => {
                html += \`
                    <div style="
                        padding: 10px; 
                        border: 1px solid var(--vscode-widget-border); 
                        border-radius: 4px; 
                        margin-bottom: 10px;
                        background-color: var(--vscode-input-background);
                    ">
                        <div style="font-weight: bold; color: var(--vscode-textLink-foreground);">\${ds.name}</div>
                        <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 5px;">
                            <div>类型: \${ds.databaseType}</div>
                            <div>主机: \${ds.host}:\${ds.port}</div>
                            <div>数据库: \${ds.databaseName}</div>
                        </div>
                    </div>
                \`;
            });
            html += '</div>';
            
            dataSourceListElement.innerHTML = html;
        }
        
        // 监听消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configLoaded':
                    updateConfigDisplay(message.config);
                    break;
                    
                case 'homeDirectorySelected':
                    if (message.success && message.homePath) {
                        document.getElementById('homePath').value = message.homePath;
                        showMessage('Home目录选择成功', 'success');
                    } else {
                        showMessage('Home目录选择失败', 'error');
                    }
                    break;
                    
                case 'configSaved':
                    if (message.success) {
                        showMessage('配置保存成功', 'success');
                    } else {
                        showMessage('配置保存失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'homeDirectoryOpened':
                    if (message.success) {
                        showMessage('Home目录已打开', 'success');
                    } else {
                        showMessage('打开Home目录失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'sysConfigOpened':
                    if (message.success) {
                        showMessage('SysConfig已启动', 'success');
                    } else {
                        showMessage('启动SysConfig失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'dataSourceAdded':
                    if (message.success) {
                        showMessage('数据源添加成功', 'success');
                        // 更新配置显示
                        if (message.config) {
                            updateConfigDisplay(message.config);
                        }
                    } else {
                        showMessage('数据源添加失败: ' + message.error, 'error');
                    }
                    break;
            }
        });
        
        // 页面加载完成后加载配置
        vscode.postMessage({ type: 'loadConfig' });
    </script>
</body>
</html>`;
    }
}