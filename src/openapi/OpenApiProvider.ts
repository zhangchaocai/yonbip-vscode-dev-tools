import * as vscode from 'vscode';
import { OpenApiService, ApiRequest, ApiResponse } from './OpenApiService';

/**
 * OpenAPI WebView提供者
 */
export class OpenApiProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip-openapi';
    
    private _view?: vscode.WebviewView;
    private openApiService: OpenApiService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) {
        this.openApiService = new OpenApiService(context);
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
                case 'sendRequest':
                    await this.handleSendRequest(data.request);
                    break;
                case 'saveConfig':
                    await this.handleSaveConfig(data.config);
                    break;
                case 'loadConfig':
                    await this.handleLoadConfig();
                    break;
                case 'testConnection':
                    await this.handleTestConnection();
                    break;
            }
        });

        // 初始加载配置
        this.handleLoadConfig();
    }

    /**
     * 处理发送请求
     */
    private async handleSendRequest(request: ApiRequest) {
        try {
            const response = await this.openApiService.sendRequest(request);
            this._view?.webview.postMessage({
                type: 'requestResponse',
                success: true,
                response
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'requestResponse',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理保存配置
     */
    private async handleSaveConfig(config: any) {
        try {
            await this.openApiService.saveConfig(config);
            vscode.window.showInformationMessage('配置已保存');
        } catch (error: any) {
            vscode.window.showErrorMessage(`保存配置失败: ${error.message}`);
        }
    }

    /**
     * 处理加载配置
     */
    private async handleLoadConfig() {
        const config = this.openApiService.getConfig();
        this._view?.webview.postMessage({
            type: 'configLoaded',
            config
        });
    }

    /**
     * 处理测试连接
     */
    private async handleTestConnection() {
        try {
            const success = await this.openApiService.testConnection();
            this._view?.webview.postMessage({
                type: 'connectionTest',
                success,
                message: success ? '连接成功' : '连接失败'
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionTest',
                success: false,
                message: `连接失败: ${error.message}`
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
    <title>OpenAPI测试工具</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 10px;
            margin: 0;
        }
        
        .section {
            margin-bottom: 20px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 10px;
        }
        
        .section-title {
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-textLink-foreground);
        }
        
        .form-group {
            margin-bottom: 10px;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }
        
        input, select, textarea {
            width: 100%;
            padding: 5px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
            box-sizing: border-box;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
            margin-right: 5px;
            margin-bottom: 5px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .response-area {
            min-height: 200px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            padding: 10px;
            font-family: monospace;
            white-space: pre-wrap;
            overflow: auto;
        }
        
        .status-success {
            color: var(--vscode-terminal-ansiGreen);
        }
        
        .status-error {
            color: var(--vscode-errorForeground);
        }
        
        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-widget-border);
            margin-bottom: 10px;
        }
        
        .tab {
            padding: 8px 16px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--vscode-foreground);
            margin-right: 2px;
        }
        
        .tab.active {
            background-color: var(--vscode-tab-activeBackground);
            border-bottom: 2px solid var(--vscode-textLink-foreground);
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
    </style>
</head>
<body>
    <div id="app">
        <!-- 配置选项卡 -->
        <div class="tabs">
            <button class="tab active" onclick="switchTab('config')">配置</button>
            <button class="tab" onclick="switchTab('request')">请求</button>
            <button class="tab" onclick="switchTab('response')">响应</button>
        </div>

        <!-- 配置面板 -->
        <div id="config-tab" class="tab-content active">
            <div class="section">
                <div class="section-title">API配置</div>
                <div class="form-group">
                    <label for="baseUrl">Base URL:</label>
                    <input type="text" id="baseUrl" placeholder="http://localhost:8080/api">
                </div>
                <div class="form-group">
                    <label for="accessKey">Access Key:</label>
                    <input type="text" id="accessKey" placeholder="访问密钥">
                </div>
                <div class="form-group">
                    <label for="secretKey">Secret Key:</label>
                    <input type="password" id="secretKey" placeholder="秘密密钥">
                </div>
                <div class="form-group">
                    <label for="timeout">超时时间 (ms):</label>
                    <input type="number" id="timeout" value="30000">
                </div>
                <button onclick="saveConfig()">保存配置</button>
                <button onclick="testConnection()">测试连接</button>
            </div>
        </div>

        <!-- 请求面板 -->
        <div id="request-tab" class="tab-content">
            <div class="section">
                <div class="section-title">HTTP请求</div>
                <div class="form-group">
                    <label for="method">请求方法:</label>
                    <select id="method">
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="url">请求URL:</label>
                    <input type="text" id="url" placeholder="/api/users">
                </div>
                <div class="form-group">
                    <label for="headers">请求头 (JSON格式):</label>
                    <textarea id="headers" rows="3" placeholder='{"Content-Type": "application/json"}'></textarea>
                </div>
                <div class="form-group">
                    <label for="params">查询参数 (JSON格式):</label>
                    <textarea id="params" rows="3" placeholder='{"page": 1, "size": 10}'></textarea>
                </div>
                <div class="form-group">
                    <label for="body">请求体 (JSON格式):</label>
                    <textarea id="body" rows="6" placeholder='{"name": "test", "email": "test@example.com"}'></textarea>
                </div>
                <button onclick="sendRequest()">发送请求</button>
                <button onclick="clearRequest()">清空</button>
            </div>
        </div>

        <!-- 响应面板 -->
        <div id="response-tab" class="tab-content">
            <div class="section">
                <div class="section-title">响应结果</div>
                <div id="responseStatus"></div>
                <div class="response-area" id="responseContent">点击"发送请求"按钮查看响应结果</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // 切换选项卡
        function switchTab(tabName) {
            // 隐藏所有选项卡内容
            const tabs = document.querySelectorAll('.tab-content');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            // 移除所有选项卡的active类
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            // 显示选中的选项卡
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }
        
        // 保存配置
        function saveConfig() {
            const config = {
                baseUrl: document.getElementById('baseUrl').value,
                accessKey: document.getElementById('accessKey').value,
                secretKey: document.getElementById('secretKey').value,
                timeout: parseInt(document.getElementById('timeout').value),
                headers: {}
            };
            
            vscode.postMessage({
                type: 'saveConfig',
                config: config
            });
        }
        
        // 测试连接
        function testConnection() {
            vscode.postMessage({
                type: 'testConnection'
            });
        }
        
        // 发送请求
        function sendRequest() {
            try {
                const request = {
                    method: document.getElementById('method').value,
                    url: document.getElementById('url').value,
                    headers: parseJson(document.getElementById('headers').value),
                    params: parseJson(document.getElementById('params').value),
                    body: parseJson(document.getElementById('body').value)
                };
                
                vscode.postMessage({
                    type: 'sendRequest',
                    request: request
                });
                
                // 切换到响应选项卡
                switchTabByName('response');
                document.getElementById('responseContent').textContent = '请求发送中...';
                
            } catch (error) {
                alert('请求参数格式错误: ' + error.message);
            }
        }
        
        // 清空请求
        function clearRequest() {
            document.getElementById('url').value = '';
            document.getElementById('headers').value = '';
            document.getElementById('params').value = '';
            document.getElementById('body').value = '';
        }
        
        // 解析JSON字符串
        function parseJson(text) {
            if (!text || text.trim() === '') {
                return null;
            }
            return JSON.parse(text);
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
        
        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configLoaded':
                    document.getElementById('baseUrl').value = message.config.baseUrl || '';
                    document.getElementById('accessKey').value = message.config.accessKey || '';
                    document.getElementById('secretKey').value = message.config.secretKey || '';
                    document.getElementById('timeout').value = message.config.timeout || 30000;
                    break;
                    
                case 'requestResponse':
                    if (message.success) {
                        const response = message.response;
                        document.getElementById('responseStatus').innerHTML = 
                            \`<span class="status-success">状态: \${response.status} \${response.statusText} (耗时: \${response.duration}ms)</span>\`;
                        document.getElementById('responseContent').textContent = 
                            JSON.stringify(response.data, null, 2);
                    } else {
                        document.getElementById('responseStatus').innerHTML = 
                            \`<span class="status-error">请求失败</span>\`;
                        document.getElementById('responseContent').textContent = message.error;
                    }
                    break;
                    
                case 'connectionTest':
                    const statusEl = document.getElementById('responseStatus');
                    if (message.success) {
                        statusEl.innerHTML = \`<span class="status-success">\${message.message}</span>\`;
                    } else {
                        statusEl.innerHTML = \`<span class="status-error">\${message.message}</span>\`;
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