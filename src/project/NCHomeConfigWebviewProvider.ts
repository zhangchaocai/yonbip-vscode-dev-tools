import * as vscode from 'vscode';
import { NCHomeConfigService } from './NCHomeConfigService';
import { NCHomeConfig, DataSourceMeta, DATABASE_TYPES, DRIVER_INFO_MAP } from './NCHomeConfigTypes';

/**
 * NC Home配置Webview提供者
 */
export class NCHomeConfigWebviewProvider implements vscode.Disposable {
    private context: vscode.ExtensionContext;
    private service: NCHomeConfigService;
    private panel: vscode.WebviewPanel | undefined;

    constructor(context: vscode.ExtensionContext, service: NCHomeConfigService) {
        this.context = context;
        this.service = service;
    }

    /**
     * 创建或显示webview
     */
    public async createOrShow(): Promise<void> {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'ncHomeConfig',
            'NC Home 配置',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [this.context.extensionUri],
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = await this.getWebviewContent();
        this.setupMessageHandlers();

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    /**
     * 刷新webview内容
     */
    public refresh(): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'configUpdated',
                config: this.service.getConfig()
            });
        }
    }

    /**
     * 设置消息处理器
     */
    private setupMessageHandlers(): void {
        if (!this.panel) return;

        this.panel.webview.onDidReceiveMessage(async (message) => {
            try {
                switch (message.type) {
                    case 'getConfig':
                        await this.handleGetConfig();
                        break;
                    case 'saveConfig':
                        await this.handleSaveConfig(message.config);
                        break;
                    case 'selectHomeDirectory':
                        await this.handleSelectHomeDirectory();
                        break;
                    case 'openHomeDirectory':
                        await this.service.openHomeDirectory();
                        break;
                    case 'openSysConfig':
                        await this.service.openSysConfig();
                        break;
                    case 'testConnection':
                        await this.handleTestConnection(message.dataSource);
                        break;
                    case 'parseConnectionString':
                        await this.handleParseConnectionString(message.connectionString);
                        break;
                    case 'addDataSource':
                        await this.handleAddDataSource(message.dataSource);
                        break;
                    case 'updateDataSource':
                        await this.handleUpdateDataSource(message.dataSource);
                        break;
                    case 'deleteDataSource':
                        await this.handleDeleteDataSource(message.dataSourceName);
                        break;
                    case 'setDesignDatabase':
                        await this.handleSetDesignDatabase(message.dataSourceName);
                        break;
                    case 'setBaseDatabase':
                        await this.handleSetBaseDatabase(message.dataSourceName);
                        break;
                    case 'getDatabaseTypes':
                        await this.handleGetDatabaseTypes();
                        break;
                    case 'getDrivers':
                        await this.handleGetDrivers(message.databaseType);
                        break;
                }
            } catch (error: any) {
                this.panel?.webview.postMessage({
                    type: 'error',
                    message: error.message
                });
            }
        });
    }

    /**
     * 处理获取配置
     */
    private async handleGetConfig(): Promise<void> {
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'configLoaded',
            config
        });
    }

    /**
     * 处理保存配置
     */
    private async handleSaveConfig(config: NCHomeConfig): Promise<void> {
        await this.service.saveConfig(config);
        this.panel?.webview.postMessage({
            type: 'configSaved'
        });
    }

    /**
     * 处理选择Home目录
     */
    private async handleSelectHomeDirectory(): Promise<void> {
        const homePath = await this.service.selectHomeDirectory();
        this.panel?.webview.postMessage({
            type: 'homeDirectorySelected',
            homePath
        });
    }

    /**
     * 处理测试连接
     */
    private async handleTestConnection(dataSource: DataSourceMeta): Promise<void> {
        const result = await this.service.testConnection(dataSource);
        this.panel?.webview.postMessage({
            type: 'connectionTestResult',
            result
        });
    }

    /**
     * 处理解析连接字符串
     */
    private async handleParseConnectionString(connectionString: string): Promise<void> {
        const result = this.service.parseConnectionString(connectionString);
        this.panel?.webview.postMessage({
            type: 'connectionStringParsed',
            result
        });
    }

    /**
     * 处理添加数据源
     */
    private async handleAddDataSource(dataSource: DataSourceMeta): Promise<void> {
        await this.service.addDataSource(dataSource);
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'dataSourceAdded',
            config
        });
    }

    /**
     * 处理更新数据源
     */
    private async handleUpdateDataSource(dataSource: DataSourceMeta): Promise<void> {
        await this.service.updateDataSource(dataSource);
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'dataSourceUpdated',
            config
        });
    }

    /**
     * 处理删除数据源
     */
    private async handleDeleteDataSource(dataSourceName: string): Promise<void> {
        await this.service.deleteDataSource(dataSourceName);
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'dataSourceDeleted',
            config
        });
    }

    /**
     * 处理设置开发库
     */
    private async handleSetDesignDatabase(dataSourceName: string): Promise<void> {
        await this.service.setAsDesignDatabase(dataSourceName);
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'designDatabaseSet',
            config
        });
    }

    /**
     * 处理设置基准库
     */
    private async handleSetBaseDatabase(dataSourceName: string): Promise<void> {
        await this.service.setBaseDatabase(dataSourceName);
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'baseDatabaseSet',
            config
        });
    }

    /**
     * 处理获取数据库类型
     */
    private async handleGetDatabaseTypes(): Promise<void> {
        const databaseTypes = Object.values(DATABASE_TYPES);
        this.panel?.webview.postMessage({
            type: 'databaseTypesLoaded',
            databaseTypes
        });
    }

    /**
     * 处理获取驱动信息
     */
    private async handleGetDrivers(databaseType: string): Promise<void> {
        const drivers = DRIVER_INFO_MAP[databaseType] || [];
        this.panel?.webview.postMessage({
            type: 'driversLoaded',
            drivers
        });
    }

    /**
     * 获取webview HTML内容
     */
    private async getWebviewContent(): Promise<string> {
        // HTML内容较长，单独创建一个文件
        const fs = require('fs');
        const path = require('path');
        
        const htmlPath = path.join(__dirname, 'nc-home-config.html');
        if (fs.existsSync(htmlPath)) {
            return fs.readFileSync(htmlPath, 'utf-8');
        }
        
        // 如果HTML文件不存在，返回简化版本
        return this.getSimpleWebviewContent();
    }

    /**
     * 获取简化的webview内容
     */
    private getSimpleWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NC Home 配置</title>
    <style>
        body { 
            font-family: var(--vscode-font-family); 
            padding: 20px; 
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
        }
        .section { 
            margin-bottom: 30px; 
            padding: 20px; 
            border: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-input-background);
            border-radius: 4px;
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
            display: flex; 
            align-items: center; 
            gap: 10px; 
        }
        .form-group label { 
            min-width: 120px; 
            font-weight: bold;
        }
        .form-group input, .form-group select { 
            flex: 1; 
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
        }
        .button { 
            padding: 8px 16px; 
            background: var(--vscode-button-background); 
            color: var(--vscode-button-foreground); 
            border: none; 
            cursor: pointer;
            border-radius: 3px;
        }
        .button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .status-message {
            padding: 12px;
            border-radius: 4px;
            margin: 10px 0;
        }
        .status-success {
            background-color: var(--vscode-terminal-ansiGreen);
            color: white;
        }
        .status-error {
            background-color: var(--vscode-errorForeground);
            color: white;
        }
    </style>
</head>
<body>
    <div class="section">
        <h3 class="section-title">NC Home 设置</h3>
        <div class="form-group">
            <label>UAP HOME:</label>
            <input type="text" id="homePath" readonly>
            <button class="button" onclick="selectHome()">浏览...</button>
        </div>
        <div class="form-group">
            <button class="button" onclick="openHomeDirectory()">打开Home目录</button>
            <button class="button secondary" onclick="openSysConfig()">启动SysConfig</button>
        </div>
    </div>
    
    <div class="section">
        <h3 class="section-title">数据源配置</h3>
        <div class="form-group">
            <button class="button" onclick="showAddDataSourceForm()">添加数据源</button>
        </div>
        <div id="datasourceList">
            <div class="status-message" style="text-align: center; color: var(--vscode-descriptionForeground);">
                暂无数据源配置
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function selectHome() {
            vscode.postMessage({ type: 'selectHomeDirectory' });
        }
        
        function openHomeDirectory() {
            vscode.postMessage({ type: 'openHomeDirectory' });
        }
        
        function openSysConfig() {
            vscode.postMessage({ type: 'openSysConfig' });
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
                        <button class="button secondary" onclick="closeModal()">取消</button>
                        <button class="button" onclick="saveDataSource()">保存</button>
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
        
        // 更新配置显示
        function updateConfigDisplay(config) {
            // 更新Home路径
            if (config.homePath) {
                document.getElementById('homePath').value = config.homePath;
            }
            
            // 更新数据源列表
            updateDataSourceList(config.dataSources || []);
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'homeDirectorySelected' && message.homePath) {
                document.getElementById('homePath').value = message.homePath;
            }
            
            switch (message.type) {
                case 'homeDirectorySelected':
                    if (message.homePath) {
                        document.getElementById('homePath').value = message.homePath;
                        showMessage('Home目录选择成功', 'success');
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
    </script>
</body>
</html>`;
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
    }
}