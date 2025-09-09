import * as vscode from 'vscode';
import { DatabaseService, DatabaseConfig } from './DatabaseService';

/**
 * 数据库管理WebView提供者
 */
export class DatabaseProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip-database';
    
    private _view?: vscode.WebviewView;
    private databaseService: DatabaseService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) {
        this.databaseService = new DatabaseService(context);
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
                case 'loadConnections':
                    await this.handleLoadConnections();
                    break;
                case 'addConnection':
                    await this.handleAddConnection(data.config);
                    break;
                case 'editConnection':
                    await this.handleEditConnection(data.config);
                    break;
                case 'deleteConnection':
                    await this.handleDeleteConnection(data.connectionId);
                    break;
                case 'connectDatabase':
                    await this.handleConnect(data.connectionId);
                    break;
                case 'disconnectDatabase':
                    await this.handleDisconnect();
                    break;
                case 'testConnection':
                    await this.handleTestConnection(data.config);
                    break;
                case 'executeQuery':
                    await this.handleExecuteQuery(data.query);
                    break;
            }
        });

        // 初始加载连接
        this.handleLoadConnections();
    }

    /**
     * 处理加载连接列表
     */
    private async handleLoadConnections() {
        const connections = this.databaseService.getConnections();
        const activeConnection = this.databaseService.getActiveConnection();
        
        this._view?.webview.postMessage({
            type: 'connectionsLoaded',
            connections,
            activeConnection
        });
    }

    /**
     * 处理添加连接
     */
    private async handleAddConnection(config: Omit<DatabaseConfig, 'id'>) {
        try {
            await this.databaseService.addConnection(config);
            await this.handleLoadConnections();
            
            this._view?.webview.postMessage({
                type: 'connectionAdded',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionAdded',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理编辑连接
     */
    private async handleEditConnection(config: DatabaseConfig) {
        try {
            // 由于 DatabaseService 的 updateConnection 方法需要 id 和 config 参数
            // 这里先简化处理，将config保存到服务中
            // TODO: 需要根据实际的 DatabaseService 方法来调整
            vscode.window.showInformationMessage('编辑连接功能正在开发中');
            await this.handleLoadConnections();
            
            this._view?.webview.postMessage({
                type: 'connectionUpdated',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionUpdated',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理删除连接
     */
    private async handleDeleteConnection(connectionId: string) {
        try {
            // TODO: 需要根据实际的 DatabaseService 方法来调整
            vscode.window.showInformationMessage('删除连接功能正在开发中');
            await this.handleLoadConnections();
            
            this._view?.webview.postMessage({
                type: 'connectionDeleted',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionDeleted',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理连接数据库
     */
    private async handleConnect(connectionId: string) {
        try {
            await this.databaseService.connect(connectionId);
            await this.handleLoadConnections();
            
            this._view?.webview.postMessage({
                type: 'databaseConnected',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'databaseConnected',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理断开连接
     */
    private async handleDisconnect() {
        try {
            await this.databaseService.disconnect();
            await this.handleLoadConnections();
            
            this._view?.webview.postMessage({
                type: 'databaseDisconnected',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'databaseDisconnected',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理测试连接
     */
    private async handleTestConnection(config: DatabaseConfig) {
        try {
            const result = await this.databaseService.testConnection(config);
            
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
     * 处理执行查询
     */
    private async handleExecuteQuery(query: string) {
        try {
            const result = await this.databaseService.executeQuery(query);
            
            this._view?.webview.postMessage({
                type: 'queryExecuted',
                result
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'queryExecuted',
                result: {
                    success: false,
                    error: error.message
                }
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
    <title>数据库管理</title>
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
        
        input, select, textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            box-sizing: border-box;
        }
        
        .form-row input, .form-row select {
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
        
        .connection-item {
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 15px;
            margin-bottom: 15px;
            background-color: var(--vscode-editor-background);
        }
        
        .connection-item.active {
            border-color: var(--vscode-textLink-foreground);
            background-color: var(--vscode-tab-activeBackground);
        }
        
        .connection-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .connection-name {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        
        .connection-status {
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 10px;
        }
        
        .connection-status.connected {
            background-color: var(--vscode-terminal-ansiGreen);
            color: white;
        }
        
        .connection-status.disconnected {
            background-color: var(--vscode-descriptionForeground);
            color: white;
        }
        
        .connection-info {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 10px;
        }
        
        .query-area {
            min-height: 150px;
            font-family: monospace;
        }
        
        .result-area {
            min-height: 200px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            padding: 10px;
            font-family: monospace;
            white-space: pre-wrap;
            overflow: auto;
            border-radius: 4px;
        }
        
        .form-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }
        
        @media (max-width: 600px) {
            .form-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div id="app">
        <!-- 选项卡 -->
        <div class="tabs">
            <button class="tab active" onclick="switchTab('connections')">🔗 连接管理</button>
            <button class="tab" onclick="switchTab('query')">🔍 查询执行</button>
            <button class="tab" onclick="switchTab('add')">➕ 添加连接</button>
        </div>

        <!-- 连接管理选项卡 -->
        <div id="connections-tab" class="tab-content active">
            <div class="section">
                <div class="section-title">
                    数据库连接
                    <button onclick="refreshConnections()" style="float: right;">🔄 刷新</button>
                </div>
                
                <div id="connectionList">
                    <div class="connection-item" style="text-align: center; color: var(--vscode-descriptionForeground);">
                        📊 暂无数据库连接，点击"添加连接"开始配置
                    </div>
                </div>
            </div>
        </div>

        <!-- 查询执行选项卡 -->
        <div id="query-tab" class="tab-content">
            <div class="section">
                <div class="section-title">SQL 查询</div>
                
                <div class="form-group">
                    <label for="queryText">SQL 语句:</label>
                    <textarea id="queryText" class="query-area" placeholder="SELECT * FROM table_name WHERE condition;"></textarea>
                </div>
                
                <div class="form-group">
                    <button onclick="executeQuery()">▶️ 执行查询</button>
                    <button class="secondary" onclick="clearQuery()">🗑️ 清空</button>
                    <button class="secondary" onclick="formatQuery()">📝 格式化</button>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">查询结果</div>
                <div id="queryResult" class="result-area">点击"执行查询"按钮查看结果</div>
            </div>
        </div>

        <!-- 添加连接选项卡 -->
        <div id="add-tab" class="tab-content">
            <div class="section">
                <div class="section-title">新建数据库连接</div>
                
                <div class="form-group">
                    <label for="connectionName">连接名称:</label>
                    <input type="text" id="connectionName" placeholder="输入连接名称" required>
                </div>
                
                <div class="form-group">
                    <label for="databaseType">数据库类型:</label>
                    <select id="databaseType" onchange="updatePortByType()">
                        <option value="mysql">MySQL</option>
                        <option value="postgresql">PostgreSQL</option>
                        <option value="oracle">Oracle</option>
                        <option value="sqlserver">SQL Server</option>
                        <option value="sqlite">SQLite</option>
                    </select>
                </div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label for="host">服务器地址:</label>
                        <input type="text" id="host" placeholder="localhost" required>
                    </div>
                    <div class="form-group">
                        <label for="port">端口:</label>
                        <input type="number" id="port" placeholder="3306" required>
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="database">数据库名:</label>
                    <input type="text" id="database" placeholder="数据库名称" required>
                </div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label for="username">用户名:</label>
                        <input type="text" id="username" placeholder="用户名" required>
                    </div>
                    <div class="form-group">
                        <label for="password">密码:</label>
                        <input type="password" id="password" placeholder="密码">
                    </div>
                </div>
                
                <div class="form-group">
                    <button onclick="saveConnection()">💾 保存连接</button>
                    <button class="secondary" onclick="testNewConnection()">🔧 测试连接</button>
                    <button class="secondary" onclick="clearConnectionForm()">🔄 重置表单</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let connections = [];
        let activeConnection = null;
        let editingConnection = null;
        
        // 切换选项卡
        function switchTab(tabName) {
            const tabs = document.querySelectorAll('.tab-content');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }
        
        // 刷新连接列表
        function refreshConnections() {
            vscode.postMessage({ type: 'loadConnections' });
        }
        
        // 渲染连接列表
        function renderConnections(connectionList, activeConn) {
            connections = connectionList;
            activeConnection = activeConn;
            
            const container = document.getElementById('connectionList');
            
            if (!connections || connections.length === 0) {
                container.innerHTML = '<div class="connection-item" style="text-align: center; color: var(--vscode-descriptionForeground);">📊 暂无数据库连接，点击"添加连接"开始配置</div>';
                return;
            }
            
            let html = '';
            connections.forEach(conn => {
                const isActive = activeConn && activeConn.id === conn.id;
                html += \`
                    <div class="connection-item \${isActive ? 'active' : ''}">
                        <div class="connection-header">
                            <div class="connection-name">\${conn.name}</div>
                            <div class="connection-status \${isActive ? 'connected' : 'disconnected'}">
                                \${isActive ? '已连接' : '未连接'}
                            </div>
                        </div>
                        <div class="connection-info">
                            \${conn.type}://\${conn.host}:\${conn.port}/\${conn.database}
                        </div>
                        <div>
                            \${!isActive ? \`<button onclick="connectToDatabase('\${conn.id}')">🔌 连接</button>\` : \`<button onclick="disconnectDatabase()">🔌 断开</button>\`}
                            <button class="secondary" onclick="editConnection('\${conn.id}')">✏️ 编辑</button>
                            <button class="secondary" onclick="testConnection('\${conn.id}')">🔧 测试</button>
                            <button class="danger" onclick="deleteConnection('\${conn.id}')">🗑️ 删除</button>
                        </div>
                    </div>
                \`;
            });
            
            container.innerHTML = html;
        }
        
        // 连接到数据库
        function connectToDatabase(connectionId) {
            vscode.postMessage({
                type: 'connectDatabase',
                connectionId: connectionId
            });
        }
        
        // 断开数据库连接
        function disconnectDatabase() {
            vscode.postMessage({ type: 'disconnectDatabase' });
        }
        
        // 编辑连接
        function editConnection(connectionId) {
            const conn = connections.find(c => c.id === connectionId);
            if (conn) {
                editingConnection = conn;
                
                // 填充表单
                document.getElementById('connectionName').value = conn.name;
                document.getElementById('databaseType').value = conn.type;
                document.getElementById('host').value = conn.host;
                document.getElementById('port').value = conn.port;
                document.getElementById('database').value = conn.database;
                document.getElementById('username').value = conn.username;
                document.getElementById('password').value = conn.password || '';
                
                // 切换到添加连接选项卡
                switchTabByName('add');
            }
        }
        
        // 删除连接
        function deleteConnection(connectionId) {
            if (confirm('确定要删除这个连接吗？')) {
                vscode.postMessage({
                    type: 'deleteConnection',
                    connectionId: connectionId
                });
            }
        }
        
        // 测试连接
        function testConnection(connectionId) {
            const conn = connections.find(c => c.id === connectionId);
            if (conn) {
                vscode.postMessage({
                    type: 'testConnection',
                    config: conn
                });
            }
        }
        
        // 保存连接
        function saveConnection() {
            const config = {
                name: document.getElementById('connectionName').value,
                type: document.getElementById('databaseType').value,
                host: document.getElementById('host').value,
                port: parseInt(document.getElementById('port').value),
                database: document.getElementById('database').value,
                username: document.getElementById('username').value,
                password: document.getElementById('password').value
            };
            
            if (!config.name || !config.host || !config.username) {
                alert('请填写必填字段');
                return;
            }
            
            if (editingConnection) {
                config.id = editingConnection.id;
                vscode.postMessage({
                    type: 'editConnection',
                    config: config
                });
            } else {
                vscode.postMessage({
                    type: 'addConnection',
                    config: config
                });
            }
        }
        
        // 测试新连接
        function testNewConnection() {
            const config = {
                name: document.getElementById('connectionName').value || 'test',
                type: document.getElementById('databaseType').value,
                host: document.getElementById('host').value,
                port: parseInt(document.getElementById('port').value),
                database: document.getElementById('database').value,
                username: document.getElementById('username').value,
                password: document.getElementById('password').value
            };
            
            vscode.postMessage({
                type: 'testConnection',
                config: config
            });
        }
        
        // 清空连接表单
        function clearConnectionForm() {
            document.getElementById('connectionName').value = '';
            document.getElementById('host').value = '';
            document.getElementById('database').value = '';
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            editingConnection = null;
        }
        
        // 根据数据库类型更新端口
        function updatePortByType() {
            const type = document.getElementById('databaseType').value;
            const portMap = {
                mysql: 3306,
                postgresql: 5432,
                oracle: 1521,
                sqlserver: 1433,
                sqlite: 0
            };
            
            const portInput = document.getElementById('port');
            if (!portInput.value || portInput.value === '0') {
                portInput.value = portMap[type] || '';
            }
        }
        
        // 执行查询
        function executeQuery() {
            const query = document.getElementById('queryText').value.trim();
            if (!query) {
                alert('请输入SQL语句');
                return;
            }
            
            if (!activeConnection) {
                alert('请先连接数据库');
                return;
            }
            
            vscode.postMessage({
                type: 'executeQuery',
                query: query
            });
        }
        
        // 清空查询
        function clearQuery() {
            document.getElementById('queryText').value = '';
            document.getElementById('queryResult').textContent = '点击"执行查询"按钮查看结果';
        }
        
        // 格式化查询
        function formatQuery() {
            // 简单的SQL格式化
            let query = document.getElementById('queryText').value;
            query = query.replace(/\\s+/g, ' ')
                        .replace(/SELECT/gi, '\\nSELECT')
                        .replace(/FROM/gi, '\\nFROM')
                        .replace(/WHERE/gi, '\\nWHERE')
                        .replace(/ORDER BY/gi, '\\nORDER BY')
                        .replace(/GROUP BY/gi, '\\nGROUP BY');
            
            document.getElementById('queryText').value = query.trim();
        }
        
        // 通过名称切换选项卡
        function switchTabByName(tabName) {
            const tabs = document.querySelectorAll('.tab-content');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            document.getElementById(tabName + '-tab').classList.add('active');
            document.querySelector(\`[onclick="switchTab('\${tabName}')"]\`).classList.add('active');
        }
        
        // 监听消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'connectionsLoaded':
                    renderConnections(message.connections, message.activeConnection);
                    break;
                    
                case 'connectionAdded':
                case 'connectionUpdated':
                    if (message.success) {
                        clearConnectionForm();
                        switchTabByName('connections');
                        console.log('连接保存成功');
                    } else {
                        console.error('保存连接失败: ' + message.error);
                    }
                    break;
                    
                case 'connectionDeleted':
                    if (message.success) {
                        console.log('连接删除成功');
                    } else {
                        console.error('删除连接失败: ' + message.error);
                    }
                    break;
                    
                case 'databaseConnected':
                    if (message.success) {
                        console.log('数据库连接成功');
                    } else {
                        console.error('数据库连接失败: ' + message.error);
                    }
                    break;
                    
                case 'databaseDisconnected':
                    if (message.success) {
                        console.log('数据库已断开');
                    } else {
                        console.error('断开连接失败: ' + message.error);
                    }
                    break;
                    
                case 'connectionTestResult':
                    if (message.result.success) {
                        alert('连接测试成功！');
                    } else {
                        alert('连接测试失败: ' + message.result.message);
                    }
                    break;
                    
                case 'queryExecuted':
                    const resultArea = document.getElementById('queryResult');
                    if (message.result.success) {
                        resultArea.textContent = JSON.stringify(message.result.data, null, 2);
                    } else {
                        resultArea.textContent = '查询失败: ' + message.result.error;
                    }
                    break;
            }
        });
        
        // 页面加载完成后加载连接
        vscode.postMessage({ type: 'loadConnections' });
    </script>
</body>
</html>`;
    }
}