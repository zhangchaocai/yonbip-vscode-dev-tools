import * as vscode from 'vscode';
import { OpenApiService, ApiRequest, ApiResponse, OpenApiConfig } from './OpenApiService';

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
                    await this.handleSendRequest(data.request, data.configId);
                    break;
                case 'saveConfigs':
                    await this.handleSaveConfigs(data.configs, data.currentConfigId);
                    break;
                case 'loadConfigs':
                    await this.handleLoadConfigs();
                    break;
                case 'testConnection':
                    await this.handleTestConnection(data.configId);
                    break;
                case 'addConfig':
                    await this.handleAddConfig(data.config);
                    break;
                case 'updateConfig':
                    await this.handleUpdateConfig(data.config);
                    break;
                case 'deleteConfig':
                    await this.handleDeleteConfig(data.configId);
                    break;
                case 'setCurrentConfig':
                    await this.handleSetCurrentConfig(data.configId);
                    break;
                case 'showError':
                    vscode.window.showErrorMessage(data.message);
                    break;
            }
        });

        // 初始加载配置
        this.handleLoadConfigs();
    }

    /**
     * 处理发送请求
     */
    private async handleSendRequest(request: ApiRequest, configId?: string) {
        try {
            const response = await this.openApiService.sendRequest(request, configId);
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
     * 处理保存所有配置
     */
    private async handleSaveConfigs(configs: OpenApiConfig[], currentConfigId: string) {
        try {
            await this.openApiService.saveConfigs(configs, currentConfigId);
            vscode.window.showInformationMessage('配置已保存');
        } catch (error: any) {
            vscode.window.showErrorMessage(`保存配置失败: ${error.message}`);
        }
    }

    /**
     * 处理加载所有配置
     */
    private async handleLoadConfigs() {
        const configs = this.openApiService.getConfigs();
        const currentConfig = this.openApiService.getCurrentConfig();
        this._view?.webview.postMessage({
            type: 'configsLoaded',
            configs,
            currentConfig
        });
    }

    /**
     * 处理测试连接
     */
    private async handleTestConnection(configId?: string) {
        try {
            const result = await this.openApiService.testConnection(configId);
            this._view?.webview.postMessage({
                type: 'connectionTest',
                success: result.success,
                message: result.message
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
     * 处理添加配置
     */
    private async handleAddConfig(config: OpenApiConfig) {
        try {
            await this.openApiService.addConfig(config);
            vscode.window.showInformationMessage('配置已添加');
            // 重新加载配置
            await this.handleLoadConfigs();
        } catch (error: any) {
            vscode.window.showErrorMessage(`添加配置失败: ${error.message}`);
        }
    }

    /**
     * 处理更新配置
     */
    private async handleUpdateConfig(config: OpenApiConfig) {
        try {
            await this.openApiService.updateConfig(config);
            vscode.window.showInformationMessage('配置已更新');
            // 重新加载配置
            await this.handleLoadConfigs();
        } catch (error: any) {
            vscode.window.showErrorMessage(`更新配置失败: ${error.message}`);
        }
    }

    /**
     * 处理删除配置
     */
    private async handleDeleteConfig(configId: string) {
        try {
            await this.openApiService.deleteConfig(configId);
            vscode.window.showInformationMessage('配置已删除');
            // 重新加载配置
            await this.handleLoadConfigs();
        } catch (error: any) {
            vscode.window.showErrorMessage(`删除配置失败: ${error.message}`);
        }
    }

    /**
     * 处理设置当前配置
     */
    private async handleSetCurrentConfig(configId: string) {
        try {
            await this.openApiService.setCurrentConfig(configId);
            // 重新加载配置
            await this.handleLoadConfigs();
        } catch (error: any) {
            vscode.window.showErrorMessage(`设置当前配置失败: ${error.message}`);
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
        /* 全局样式优化 */
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-sideBar-background) 100%);
            padding: 0;
            margin: 0;
            line-height: 1.5;
        }
        .form-container {
            max-width: 100%;
            padding: 24px;
            background-color: var(--vscode-editor-background);
            border-radius: 12px;
            margin: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            border: 1px solid var(--vscode-widget-border);
        }
        /* 表单组样式优化 */
        .form-group {
            margin-bottom: 24px;
            position: relative;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--vscode-input-foreground);
            font-size: 13px;
            letter-spacing: 0.3px;
        }
        /* 分段选择控件（Home版本） */
        .segmented {
            display: inline-flex;
            gap: 0;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            overflow: hidden;
            background: var(--vscode-input-background);
        }
        .segment {
            display: inline-flex;
            align-items: center;
            position: relative;
            cursor: pointer;
        }
        .segment input {
            position: absolute;
            opacity: 0;
            pointer-events: none;
        }
        .segment span {
            padding: 10px 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
            transition: all .15s ease-in-out;
            border-right: 1px solid var(--vscode-widget-border);
            user-select: none;
        }
        .segment:last-child span {
            border-right: 0;
        }
        .segment input:checked + span {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .segment:hover span {
            background: var(--vscode-inputOption-hoverBackground, rgba(255,255,255,0.06));
        }
        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 8px;
            font-size: 14px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            outline: none;
        }
        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
            transform: translateY(-1px);
        }
        .form-group input:hover,
        .form-group select:hover,
        .form-group textarea:hover {
            border-color: var(--vscode-inputOption-hoverBackground);
        }
        .form-group textarea {
            min-height: 80px;
            resize: vertical;
            font-family: var(--vscode-font-family);
        }
        /* 按钮样式优化 */
        button {
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            min-width: 100px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        button::before {
            content: "";
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
        }
        button:hover::before {
            left: 100%;
        }
        .button-primary {
            background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            color: var(--vscode-button-foreground);
            box-shadow: 0 4px 16px rgba(0, 122, 255, 0.3);
        }
        .button-primary:hover {
            background: linear-gradient(135deg, var(--vscode-button-hoverBackground) 0%, var(--vscode-button-background) 100%);
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0, 122, 255, 0.4);
        }
        .button-secondary {
            background: linear-gradient(135deg, var(--vscode-button-secondaryBackground) 0%, var(--vscode-input-background) 100%);
            color: var(--vscode-button-secondaryForeground);
            border: 2px solid var(--vscode-input-border);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .button-secondary:hover {
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, var(--vscode-button-secondaryBackground) 100%);
            border-color: var(--vscode-focusBorder);
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        }
        .button-small {
            padding: 6px 12px;
            font-size: 12px;
            min-width: auto;
        }
        .response-area {
            min-height: 200px;
            background-color: var(--vscode-input-background);
            border: 2px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 16px;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
            overflow: auto;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        .status-success {
            color: #4caf50;
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(76, 175, 80, 0.05) 100%);
            font-size: 13px;
            padding: 12px 16px;
            border-radius: 8px;
            border-left: 4px solid #4caf50;
            margin-bottom: 16px;
        }
        .status-error {
            color: var(--vscode-errorForeground);
            background: linear-gradient(135deg, var(--vscode-inputValidation-errorBackground) 0%, rgba(255, 0, 0, 0.05) 100%);
            font-size: 13px;
            padding: 12px 16px;
            border-radius: 8px;
            border-left: 4px solid var(--vscode-inputValidation-errorBorder);
            margin-bottom: 16px;
        }
        .tabs {
            display: flex;
            border-bottom: 2px solid var(--vscode-widget-border);
            margin-bottom: 24px;
            background-color: var(--vscode-editor-background);
            border-radius: 8px 8px 0 0;
            padding: 0;
        }
        .tab {
            padding: 14px 24px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--vscode-foreground);
            font-weight: 600;
            font-size: 14px;
            border-radius: 8px 8px 0 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }
        .tab:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-textLink-foreground);
        }
        .tab.active::after {
            content: "";
            position: absolute;
            bottom: -2px;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--vscode-button-background), transparent);
        }
        .tab-content {
            display: none;
            animation: fadeIn 0.3s ease-out;
        }
        .tab-content.active {
            display: block;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .config-list {
            max-height: 300px;
            overflow-y: auto;
            border: 2px solid var(--vscode-input-border);
            border-radius: 12px;
            margin-bottom: 24px;
            background-color: var(--vscode-input-background);
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        .config-item {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s ease;
        }
        .config-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            transform: translateX(4px);
        }
        .config-item.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
            border-left: 4px solid var(--vscode-textLink-foreground);
        }
        .config-item-info strong {
            display: block;
            font-size: 14px;
            margin-bottom: 4px;
        }
        .config-item-info small {
            font-size: 12px;
            opacity: 0.8;
        }
        .config-item-actions {
            display: flex;
            gap: 8px;
        }
        .form-actions {
            display: flex;
            gap: 12px;
            margin-top: 16px;
            flex-wrap: wrap;
        }
        .hidden {
            display: none;
        }
        /* 章节标题优化 */
        .section-title {
            font-size: 16px;
            font-weight: 700;
            margin: 24px 0 16px 0;
            color: var(--vscode-foreground);
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            padding-bottom: 8px;
            position: relative;
            display: flex;
            align-items: center;
        }
        .section-title::before {
            content: "";
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 60px;
            height: 2px;
            background: linear-gradient(90deg, var(--vscode-button-background), transparent);
        }
        /* 无数据状态优化 */
        .no-data {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, var(--vscode-editor-background) 100%);
            border-radius: 12px;
            margin: 20px 0;
        }
        .no-data-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.6;
        }
        .no-data-text {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }
        /* 加载状态优化 */
        .loading {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
        }
        .loading::before {
            content: "\\231B";
            font-size: 32px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        /* 响应式设计 */
        @media (max-width: 768px) {
            .form-container {
                padding: 16px;
                margin: 12px;
            }
            .tab {
                padding: 12px 16px;
                font-size: 13px;
            }
            .config-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
            }
            .config-item-actions {
                align-self: flex-end;
            }
        }
    </style>
</head>
<body>
    <div class="form-container">
        <div id="app">
            <!-- 配置选项卡 -->
            <div class="tabs">
                <button class="tab active" id="config-tab-btn">配置管理</button>
                <button class="tab" id="request-tab-btn">请求测试</button>
                <button class="tab" id="response-tab-btn">响应结果</button>
            </div>

            <!-- 配置管理面板 -->
            <div id="config-tab" class="tab-content active">
                <div class="section">
                    <h3 class="section-title">配置列表</h3>
                    <div class="config-list" id="configList">
                        <div class="no-data">
                            <div class="no-data-icon">⚙️</div>
                            <div class="no-data-text">暂无配置</div>
                            <div class="no-data-subtext">点击下方按钮添加第一个OpenAPI配置</div>
                        </div>
                    </div>
                    <button class="button-primary" id="add-config-btn">添加配置</button>
                </div>
                
                <div class="section">
                    <h3 class="section-title">配置详情</h3>
                    <div id="configForm" class="hidden">
                        <input type="hidden" id="configId">
                        <div class="form-group">
                            <label>Home版本 *</label>
                            <div class="segmented" role="radiogroup" aria-label="Home版本">
                                <label class="segment">
                                    <input type="radio" name="homeVersion" value="2105及之后版本" checked>
                                    <span>2105及之后版本</span>
                                </label>
                                <label class="segment">
                                    <input type="radio" name="homeVersion" value="2105之前版本">
                                    <span>2105之前版本</span>
                                </label>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="configName">名称 *</label>
                            <input type="text" id="configName" placeholder="请输入名称">
                        </div>
                        <div class="form-group">
                            <label for="ip">IP *</label>
                            <input type="text" id="ip" placeholder="例如 127.0.0.1">
                        </div>
                        <div class="form-group">
                            <label for="port">端口 *</label>
                            <input type="number" id="port" placeholder="例如 8080">
                        </div>
                        <div class="form-group">
                            <label for="accountCode">帐套编码 *</label>
                            <input type="text" id="accountCode" placeholder="请输入帐套编码">
                        </div>
                        <div class="form-group">
                            <label for="appId">APP ID *</label>
                            <input type="text" id="appId" placeholder="请输入APP ID">
                        </div>
                        <div class="form-group">
                            <label for="appSecret">APP Secret *</label>
                            <input type="password" id="appSecret" placeholder="请输入APP Secret">
                        </div>
                        <div class="form-group">
                            <label for="userCode">用户编码 *</label>
                            <input type="text" id="userCode" placeholder="请输入用户编码">
                        </div>
                        <div class="form-group">
                            <label for="publicKey">公钥</label>
                            <textarea id="publicKey" rows="6" placeholder="请输入公钥（可选）"></textarea>
                        </div>
                        <div class="form-actions">
                            <button class="button-primary" id="save-config-btn">保存配置</button>
                            <button class="button-secondary" id="cancel-config-btn">取消</button>
                            <button class="button-secondary" id="delete-config-btn" class="hidden">删除配置</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 请求测试面板 -->
            <div id="request-tab" class="tab-content">
                <div class="section">
                    <h3 class="section-title">HTTP请求</h3>
                    <div class="form-group">
                        <label for="selectedConfig">选择配置 *</label>
                        <select id="selectedConfig">
                            <option value="">请选择配置</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="method">请求方法</label>
                        <select id="method">
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                            <option value="PATCH">PATCH</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="url">请求URL *</label>
                        <input type="text" id="url" placeholder="/api/users">
                    </div>
                    <div class="form-group">
                        <label for="headers">请求头 (JSON格式)</label>
                        <textarea id="headers" rows="3" placeholder='{"Content-Type": "application/json"}'></textarea>
                    </div>
                    <div class="form-group">
                        <label for="params">查询参数 (JSON格式)</label>
                        <textarea id="params" rows="3" placeholder='{"page": 1, "size": 10}'></textarea>
                    </div>
                    <div class="form-group">
                        <label for="body">请求体 (JSON格式)</label>
                        <textarea id="body" rows="6" placeholder='{"name": "test", "email": "test@example.com"}'></textarea>
                    </div>
                    <div class="form-actions">
                        <button class="button-primary" id="send-request-btn">发送请求</button>
                        <button class="button-secondary" id="clear-request-btn">清空</button>
                        <button class="button-secondary" id="test-connection-btn">测试连接</button>
                    </div>
                </div>
            </div>

            <!-- 响应结果面板 -->
            <div id="response-tab" class="tab-content">
                <div class="section">
                    <h3 class="section-title">响应结果</h3>
                    <div id="responseStatus"></div>
                    <div class="response-area" id="responseContent">点击"发送请求"按钮查看响应结果</div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let configs = [];
        let currentConfig = null;
        
        // 初始化按钮事件
        function initEventListeners() {
            // 选项卡切换事件
            document.getElementById('config-tab-btn').addEventListener('click', function() {
                switchTab('config');
            });
            
            document.getElementById('request-tab-btn').addEventListener('click', function() {
                switchTab('request');
            });
            
            document.getElementById('response-tab-btn').addEventListener('click', function() {
                switchTab('response');
            });
            
            // 主要按钮事件
            document.getElementById('add-config-btn').addEventListener('click', showAddConfigForm);
            document.getElementById('save-config-btn').addEventListener('click', saveConfig);
            document.getElementById('cancel-config-btn').addEventListener('click', cancelEditConfig);
            document.getElementById('delete-config-btn').addEventListener('click', deleteConfig);
            document.getElementById('send-request-btn').addEventListener('click', sendRequest);
            document.getElementById('clear-request-btn').addEventListener('click', clearRequest);
            document.getElementById('test-connection-btn').addEventListener('click', testConnection);
        }
        
        // 页面加载完成后初始化事件监听器
        document.addEventListener('DOMContentLoaded', function() {
            initEventListeners();
            // 页面加载完成后加载配置
            vscode.postMessage({ type: 'loadConfigs' });
        });
        
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
            document.getElementById(tabName + '-tab-btn').classList.add('active');
        }
        
        // 显示添加配置表单
        function showAddConfigForm() {
            document.getElementById('configForm').classList.remove('hidden');
            document.getElementById('configId').value = '';
            document.getElementById('configName').value = '';
            document.querySelector('input[name="homeVersion"][value="2105及之后版本"]').checked = true;
            document.querySelector('input[name="homeVersion"][value="2105之前版本"]').checked = false;
            document.getElementById('ip').value = '';
            document.getElementById('port').value = '';
            document.getElementById('accountCode').value = '';
            document.getElementById('appId').value = '';
            document.getElementById('appSecret').value = '';
            document.getElementById('userCode').value = '';
            document.getElementById('publicKey').value = '';
            document.getElementById('delete-config-btn').classList.add('hidden');
            
            // 切换到配置选项卡
            switchTab('config');
        }
        
        // 取消编辑配置
        function cancelEditConfig() {
            document.getElementById('configForm').classList.add('hidden');
        }
        
        // 保存配置
        function saveConfig() {
            const selectedVersion = document.querySelector('input[name="homeVersion"]:checked');
            const config = {
                id: (document.getElementById('configId').value || generateId()),
                name: document.getElementById('configName').value,
                homeVersion: selectedVersion ? selectedVersion.value : '2105及之后版本',
                ip: document.getElementById('ip').value,
                port: parseInt(document.getElementById('port').value, 10),
                accountCode: document.getElementById('accountCode').value,
                appId: document.getElementById('appId').value,
                appSecret: document.getElementById('appSecret').value,
                userCode: document.getElementById('userCode').value,
                publicKey: document.getElementById('publicKey').value
            };
            
            if (!config.name) { vscode.postMessage({ type: 'showError', message: '请输入名称' }); return; }
            if (!config.ip) { vscode.postMessage({ type: 'showError', message: '请输入IP' }); return; }
            if (!config.port || isNaN(config.port)) { vscode.postMessage({ type: 'showError', message: '请输入有效端口' }); return; }
            if (!config.accountCode) { vscode.postMessage({ type: 'showError', message: '请输入帐套编码' }); return; }
            if (!config.appId) { vscode.postMessage({ type: 'showError', message: '请输入APP ID' }); return; }
            if (!config.appSecret) { vscode.postMessage({ type: 'showError', message: '请输入APP Secret' }); return; }
            if (!config.userCode) { vscode.postMessage({ type: 'showError', message: '请输入用户编码' }); return; }
            
            if (document.getElementById('configId').value) {
                vscode.postMessage({
                    type: 'updateConfig',
                    config: config
                });
            } else {
                vscode.postMessage({
                    type: 'addConfig',
                    config: config
                });
            }
            
            document.getElementById('configForm').classList.add('hidden');
        }
        
        // 删除配置
        function deleteConfig() {
            const configId = document.getElementById('configId').value;
            if (configId && confirm('确定要删除此配置吗？')) {
                vscode.postMessage({
                    type: 'deleteConfig',
                    configId: configId
                });
                document.getElementById('configForm').classList.add('hidden');
            }
        }
        
        // 设置当前配置
        function setCurrentConfig(configId) {
            vscode.postMessage({
                type: 'setCurrentConfig',
                configId: configId
            });
        }
        
        // 编辑配置
        function editConfig(config) {
            document.getElementById('configForm').classList.remove('hidden');
            document.getElementById('configId').value = config.id;
            document.getElementById('configName').value = config.name;
            document.querySelector('input[name="homeVersion"][value="2105及之后版本"]').checked = (config.homeVersion === '2105及之后版本');
            document.querySelector('input[name="homeVersion"][value="2105之前版本"]').checked = (config.homeVersion === '2105之前版本');
            document.getElementById('ip').value = config.ip || '';
            document.getElementById('port').value = (config.port != null ? String(config.port) : '');
            document.getElementById('accountCode').value = config.accountCode || '';
            document.getElementById('appId').value = config.appId || '';
            document.getElementById('appSecret').value = config.appSecret || '';
            document.getElementById('userCode').value = config.userCode || '';
            document.getElementById('publicKey').value = config.publicKey || '';
            document.getElementById('delete-config-btn').classList.remove('hidden');
        }
        
        // 测试连接
        function testConnection() {
            const selectedConfigId = document.getElementById('selectedConfig').value;
            if (!selectedConfigId) {
                vscode.postMessage({ type: 'showError', message: '请选择一个配置' });
                return;
            }
            
            vscode.postMessage({
                type: 'testConnection',
                configId: selectedConfigId
            });
        }
        
        // 发送请求
        function sendRequest() {
            const selectedConfigId = document.getElementById('selectedConfig').value;
            if (!selectedConfigId) {
                vscode.postMessage({ type: 'showError', message: '请选择一个配置' });
                return;
            }
            
            const url = document.getElementById('url').value;
            if (!url) {
                vscode.postMessage({ type: 'showError', message: '请输入请求URL' });
                return;
            }
            
            try {
                const request = {
                    method: document.getElementById('method').value,
                    url: url,
                    headers: parseJson(document.getElementById('headers').value),
                    params: parseJson(document.getElementById('params').value),
                    body: parseJson(document.getElementById('body').value)
                };
                
                vscode.postMessage({
                    type: 'sendRequest',
                    request: request,
                    configId: selectedConfigId
                });
                
                // 切换到响应选项卡
                switchTab('response');
                document.getElementById('responseContent').textContent = '请求发送中...';
                
            } catch (error) {
                vscode.postMessage({ type: 'showError', message: '请求参数格式错误: ' + error.message });
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
        
        // 生成唯一ID
        function generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        }
        
        // 渲染配置列表
        function renderConfigList() {
            const configListEl = document.getElementById('configList');
            
            if (configs.length === 0) {
                configListEl.innerHTML = [
                    '<div class="no-data">',
                    '<div class="no-data-icon">⚙️</div>',
                    '<div class="no-data-text">暂无配置</div>',
                    '<div class="no-data-subtext">点击上方按钮添加第一个OpenAPI配置</div>',
                    '</div>'
                ].join('');
                return;
            }
            
            configListEl.innerHTML = '';
            
            configs.forEach(config => {
                const configItem = document.createElement('div');
                configItem.className = 'config-item';
                if (currentConfig && currentConfig.id === config.id) {
                    configItem.classList.add('active');
                }
                
                // 为每个配置项创建唯一的ID
                const editBtnId = 'edit-config-' + config.id;
                const setCurrBtnId = 'set-current-' + config.id;
                
                // 使用字符串拼接而不是模板字符串中的表达式
                configItem.innerHTML = [
                    '<div class="config-item-info">',
                    '<strong>' + config.name + '</strong>',
                    '<small>' + (config.ip + ':' + config.port) + '</small>',
                    '</div>',
                    '<div class="config-item-actions">',
                    '<button class="button-secondary button-small" id="' + editBtnId + '">编辑</button>',
                    '<button class="button-secondary button-small" id="' + setCurrBtnId + '">' + (currentConfig && currentConfig.id === config.id ? '当前' : '设为当前') + '</button>',
                    '</div>'
                ].join('');
                
                configListEl.appendChild(configItem);
                
                // 使用setTimeout确保元素已添加到DOM后再绑定事件
                setTimeout(function() {
                    const editBtn = document.getElementById(editBtnId);
                    const setCurrBtn = document.getElementById(setCurrBtnId);
                    
                    if (editBtn) {
                        editBtn.addEventListener('click', function() {
                            editConfig(config);
                        });
                    }
                    
                    if (setCurrBtn) {
                        setCurrBtn.addEventListener('click', function() {
                            setCurrentConfig(config.id);
                        });
                    }
                }, 0);
            });
        }
        
        // 渲染配置选择下拉框
        function renderConfigSelect() {
            const selectEl = document.getElementById('selectedConfig');
            selectEl.innerHTML = '';
            
            configs.forEach(config => {
                const option = document.createElement('option');
                option.value = config.id;
                option.textContent = config.name;
                if (currentConfig && currentConfig.id === config.id) {
                    option.selected = true;
                }
                selectEl.appendChild(option);
            });
        }
        
        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configsLoaded':
                    configs = message.configs;
                    currentConfig = message.currentConfig;
                    renderConfigList();
                    renderConfigSelect();
                    break;
                    
                case 'requestResponse':
                    if (message.success) {
                        const response = message.response;
                        document.getElementById('responseStatus').innerHTML = 
                            '<div class="status-success">状态: ' + response.status + ' ' + response.statusText + ' (耗时: ' + response.duration + 'ms)</div>';
                        document.getElementById('responseContent').textContent = 
                            JSON.stringify(response.data, null, 2);
                    } else {
                        document.getElementById('responseStatus').innerHTML = 
                            '<div class="status-error">请求失败: ' + message.error + '</div>';
                        document.getElementById('responseContent').textContent = message.error;
                    }
                    break;
                    
                case 'connectionTest':
                    if (message.success) {
                        document.getElementById('responseStatus').innerHTML = 
                            '<div class="status-success">' + message.message + '</div>';
                    } else {
                        document.getElementById('responseStatus').innerHTML = 
                            '<div class="status-error">' + message.message + '</div>';
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}