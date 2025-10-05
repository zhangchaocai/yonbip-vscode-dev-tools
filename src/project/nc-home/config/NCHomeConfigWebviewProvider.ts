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
            // 如果面板已存在，直接刷新数据
            this.refresh();
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

        this.setupMessageHandlers();

        // 设置HTML内容
        this.panel.webview.html = this._getHtmlForWebview();

        // 初始化时加载配置数据
        this.handleGetConfig();

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
                // 处理消息
                switch (message.type) {
                    case 'getConfig':
                        this.handleGetConfig();
                        break;
                    case 'saveConfig':
                        this.handleSaveConfig(message.config);
                        break;
                    case 'selectHomeDirectory':
                        this.handleSelectHomeDirectory();
                        break;
                    case 'openHomeDirectory':
                        this.handleOpenHomeDirectory();
                        break;
                    case 'openSysConfig':
                        this.handleOpenSysConfig();
                        break;
                    case 'testConnection':
                        this.handleTestConnection(message.dataSource);
                        break;
                    case 'parseConnectionString':
                        this.handleParseConnectionString(message.connectionString);
                        break;
                    case 'addDataSource':
                        this.handleAddDataSource(message.dataSource);
                        break;
                    case 'updateDataSource':
                        this.handleUpdateDataSource(message.dataSource);
                        break;
                    case 'deleteDataSource':
                        this.handleDeleteDataSource(message.dataSourceName);
                        break;
                    case 'editDataSource':
                        this.handleEditDataSource(message.dataSourceName);
                        break;
                    case 'setDesignDatabase':
                        this.handleSetDesignDatabase(message.dataSourceName);
                        break;
                    case 'setBaseDatabase':
                        this.handleSetBaseDatabase(message.dataSourceName);
                        break;
                    case 'checkSystemConfig':
                        this.handleCheckSystemConfig();
                        break;
                    case 'test':
                        // 处理测试消息
                        this.panel?.webview.postMessage({
                            type: 'testResponse',
                            message: '收到测试消息: ' + message.message
                        });
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

        // 如果homePath已配置，尝试从prop.xml中获取端口信息和数据源信息
        if (config.homePath) {
            const portsAndDataSourcesFromProp = this.service.getPortFromPropXml();
            if (portsAndDataSourcesFromProp.port !== null) {
                config.port = portsAndDataSourcesFromProp.port;
            }
            if (portsAndDataSourcesFromProp.wsPort !== null) {
                config.wsPort = portsAndDataSourcesFromProp.wsPort;
            }

            // 如果prop.xml中有数据源信息，更新到配置中
            if (portsAndDataSourcesFromProp.dataSources.length > 0) {
                // 合并数据源信息，避免重复
                const existingDataSources = config.dataSources || [];
                const newDataSources = portsAndDataSourcesFromProp.dataSources;

                // 创建一个映射来跟踪已存在的数据源
                const existingDataSourceNames = new Set(existingDataSources.map(ds => ds.name));

                // 添加新的数据源（不覆盖已存在的）
                for (const newDataSource of newDataSources) {
                    if (!existingDataSourceNames.has(newDataSource.name)) {
                        existingDataSources.push(newDataSource);
                        existingDataSourceNames.add(newDataSource.name);
                    }
                }

                config.dataSources = existingDataSources;
            }
        }

        this.panel?.webview.postMessage({
            type: 'configLoaded',
            config: config
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
     * 处理打开Home目录
     */
    private async handleOpenHomeDirectory(): Promise<void> {
        await this.service.openHomeDirectory();
    }

    /**
     * 处理打开SysConfig
     */
    private async handleOpenSysConfig(): Promise<void> {
        await this.service.openSysConfig();
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
     * 处理编辑数据源
     */
    private async handleEditDataSource(dataSourceName: string): Promise<void> {
        const dataSource = this.service.getDataSource(dataSourceName);

        if (dataSource) {
            this.panel?.webview.postMessage({
                type: 'dataSourceForEdit',
                dataSource: dataSource
            });
        }
    }

    /**
     * 处理设置为开发库
     */
    private async handleSetDesignDatabase(dataSourceName: string): Promise<void> {
        try {
            await this.service.setAsDesignDatabase(dataSourceName);
            const config = this.service.getConfig();
            this.panel?.webview.postMessage({
                type: 'designDatabaseSet',
                config
            });
        } catch (error: any) {
            this.panel?.webview.postMessage({
                type: 'error',
                message: error.message
            });
        }
    }

    /**
     * 处理设置为基准库
     */
    private async handleSetBaseDatabase(dataSourceName: string): Promise<void> {
        try {
            await this.service.setBaseDatabase(dataSourceName);
            const config = this.service.getConfig();
            this.panel?.webview.postMessage({
                type: 'baseDatabaseSet',
                config
            });
        } catch (error: any) {
            this.panel?.webview.postMessage({
                type: 'error',
                message: error.message
            });
        }
    }

    /**
     * 处理系统配置检查
     */
    private async handleCheckSystemConfig(): Promise<void> {
        try {
            const result = this.service.checkSystemConfig();
            this.panel?.webview.postMessage({
                type: 'systemConfigCheckResult',
                result
            });
        } catch (error: any) {
            this.panel?.webview.postMessage({
                type: 'systemConfigCheckResult',
                result: {
                    valid: false,
                    message: `检查系统配置失败: ${error.message}`
                }
            });
        }
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
    }

    /**
     * 生成简单的HTML内容用于测试
     */
    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NC Home配置</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-font-family);
            --vscode-font-size: var(--vscode-font-size);
            --vscode-foreground: var(--vscode-foreground);
            --vscode-editor-background: var(--vscode-editor-background);
            --vscode-input-background: var(--vscode-input-background);
            --vscode-input-foreground: var(--vscode-input-foreground);
            --vscode-input-border: var(--vscode-input-border);
            --vscode-focusBorder: var(--vscode-focusBorder);
            --vscode-button-background: var(--vscode-button-background);
            --vscode-button-foreground: var(--vscode-button-foreground);
            --vscode-button-hoverBackground: var(--vscode-button-hoverBackground);
            --vscode-list-hoverBackground: var(--vscode-list-hoverBackground);
            --vscode-sideBarSectionHeader-background: var(--vscode-sideBarSectionHeader-background);
            --vscode-sideBarSectionHeader-border: var(--vscode-sideBarSectionHeader-border);
            --vscode-panel-border: var(--vscode-panel-border);
            --vscode-textLink-foreground: var(--vscode-textLink-foreground);
            --vscode-textLink-activeForeground: var(--vscode-textLink-activeForeground);
            --vscode-errorForeground: var(--vscode-errorForeground);
            --vscode-inputValidation-errorBorder: var(--vscode-inputValidation-errorBorder);
            --vscode-inputValidation-infoBorder: var(--vscode-inputValidation-infoBorder);
            --success-color: #4caf50;
            --warning-color: #ff9800;
            --error-color: #f44336;
            --info-color: #2196f3;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
            line-height: 1.5;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
            background: linear-gradient(90deg, var(--vscode-textLink-foreground), #00c853);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            margin-bottom: 24px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
        }

        .card-header {
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-sideBarSectionHeader-background);
            font-weight: 600;
            font-size: 16px;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
        }

        .card-header::before {
            content: "";
            display: inline-block;
            width: 4px;
            height: 16px;
            background: linear-gradient(to bottom, var(--vscode-textLink-foreground), #00c853);
            margin-right: 12px;
            border-radius: 2px;
        }

        .card-body {
            padding: 20px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-row {
            display: flex;
            flex-wrap: wrap;
            margin: 0 -10px;
        }

        .form-col {
            flex: 1;
            min-width: 250px;
            padding: 0 10px;
            margin-bottom: 20px;
        }

        .form-label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            display: flex;
            align-items: center;
        }

        .form-label.required::after {
            content: " *";
            color: var(--error-color);
            margin-left: 4px;
        }

        .form-control {
            width: 100%;
            padding: 10px 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            box-sizing: border-box;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .form-control:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
        }

        .form-control:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }

        .form-select {
            width: 100%;
            padding: 10px 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            box-sizing: border-box;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            appearance: none;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 12px center;
            background-size: 16px;
            padding-right: 40px;
        }

        .form-select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
        }

        .btn {
            padding: 10px 16px;
            border-radius: 6px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            cursor: pointer;
            border: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            font-weight: 500;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .btn-primary {
            background: linear-gradient(135deg, var(--vscode-button-background), #0066cc);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: linear-gradient(135deg, var(--vscode-button-hoverBackground), #0052a3);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }

        .btn-secondary {
            background-color: var(--vscode-list-hoverBackground);
            color: var(--vscode-foreground);
        }

        .btn-secondary:hover {
            background-color: var(--vscode-list-hoverBackground);
            opacity: 0.9;
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }

        .btn-success {
            background: linear-gradient(135deg, var(--success-color), #3d8b40);
            color: white;
        }

        .btn-success:hover {
            background: linear-gradient(135deg, #43a047, #2e7d32);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }

        .btn-danger {
            background: linear-gradient(135deg, var(--error-color), #d32f2f);
            color: white;
        }

        .btn-danger:hover {
            background: linear-gradient(135deg, #f53636, #c62828);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }

        .btn-sm {
            padding: 6px 10px;
            font-size: 12px;
        }

        .btn-block {
            width: 100%;
        }

        .btn-group {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .alert {
            padding: 14px 18px;
            border-radius: 6px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        }

        .alert::before {
            font-size: 18px;
            margin-right: 12px;
            font-weight: bold;
        }

        .alert-info {
            background-color: rgba(33, 150, 243, 0.15);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-foreground);
        }

        .alert-info::before {
            content: "ℹ";
            color: var(--info-color);
        }

        .alert-success {
            background-color: rgba(76, 175, 80, 0.15);
            border: 1px solid var(--success-color);
            color: var(--vscode-foreground);
        }

        .alert-success::before {
            content: "✓";
            color: var(--success-color);
        }

        .alert-error {
            background-color: rgba(244, 67, 54, 0.15);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-foreground);
        }

        .alert-error::before {
            content: "✕";
            color: var(--error-color);
        }

        .alert-warning {
            background-color: rgba(255, 152, 0, 0.15);
            border: 1px solid var(--warning-color);
            color: var(--vscode-foreground);
        }

        .alert-warning::before {
            content: "⚠";
            color: var(--warning-color);
        }

        .data-source-list {
            margin-top: 20px;
        }

        .data-source-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 12px;
            background-color: var(--vscode-input-background);
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }

        .data-source-item:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }

        .data-source-info {
            flex: 1;
        }

        .data-source-name {
            font-weight: 600;
            margin-bottom: 4px;
            font-size: 15px;
            color: var(--vscode-textLink-foreground);
        }

        .data-source-details {
            font-size: 13px;
            color: var(--vscode-foreground);
            opacity: 0.8;
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
        }

        .data-source-detail-item {
            display: flex;
            align-items: center;
        }

        .data-source-detail-item::before {
            content: "•";
            margin-right: 6px;
            color: var(--vscode-textLink-foreground);
        }

        .data-source-actions {
            display: flex;
            gap: 8px;
        }

        .connection-status {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 16px;
            font-size: 12px;
            font-weight: 500;
            margin-left: 10px;
        }

        .status-success {
            background-color: rgba(76, 175, 80, 0.2);
            color: var(--success-color);
        }

        .status-error {
            background-color: rgba(244, 67, 54, 0.2);
            color: var(--error-color);
        }

        .status-default {
            background-color: rgba(0, 123, 255, 0.2);
            color: var(--vscode-textLink-foreground);
        }

        .hidden {
            display: none;
        }

        .form-footer {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .connection-string-input {
            position: relative;
        }

        .parse-btn {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            font-size: 12px;
            padding: 6px 10px;
            border-radius: 4px;
            transition: background-color 0.2s;
        }

        .parse-btn:hover {
            background-color: var(--vscode-list-hoverBackground);
            color: var(--vscode-textLink-activeForeground);
        }

        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
            margin-right: 8px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .help-text {
            font-size: 12px;
            color: var(--vscode-foreground);
            opacity: 0.7;
            margin-top: 6px;
            display: flex;
            align-items: center;
        }

        .help-text::before {
            content: "ⓘ";
            margin-right: 6px;
            font-size: 12px;
        }

        .tabs {
            display: flex;
            border-bottom: 2px solid var(--vscode-panel-border);
            margin-bottom: 24px;
            position: relative;
        }

        .tab {
            padding: 12px 20px;
            cursor: pointer;
            border-bottom: 3px solid transparent;
            font-weight: 500;
            transition: all 0.2s ease;
            position: relative;
        }

        .tab:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .tab.active {
            border-bottom-color: var(--vscode-textLink-foreground);
            color: var(--vscode-textLink-foreground);
        }

        .tab.active::after {
            content: "";
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 100%;
            height: 3px;
            background: linear-gradient(90deg, var(--vscode-textLink-foreground), #00c853);
            border-radius: 3px;
        }

        .tab-content {
            display: none;
            animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .tab-content.active {
            display: block;
        }

        @media (max-width: 768px) {
            .form-row {
                flex-direction: column;
            }
            
            .form-col {
                min-width: 100%;
            }
            
            .btn-group {
                flex-direction: column;
            }
            
            .data-source-item {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .data-source-actions {
                margin-top: 12px;
                width: 100%;
                justify-content: flex-end;
            }
        }
        
        /* 添加图标字体支持 */
        .icon {
            margin-right: 6px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>NC Home 配置管理</h1>
        </div>

        <div class="tabs">
            <div class="tab active" data-tab="data-source">🗄️ 数据源配置</div>
            <div class="tab" data-tab="home-config">🏠 Home配置</div>
        </div>

        <div class="tab-content active" id="data-source-tab">
            <div class="card">
                <div class="card-header">
                    ➕ 添加数据源
                </div>
                <div class="card-body">
                    <form id="dataSourceForm">
                        <div class="form-row">
                            <div class="form-col">
                                <div class="form-group">
                                    <label class="form-label required" for="dataSourceName">
                                        <span class="icon">🏷️</span> 数据源名称
                                    </label>
                                    <input type="text" id="dataSourceName" class="form-control" placeholder="请输入数据源名称" value="dataSource1">
                                    <div class="help-text">只能包含英文、数字、下划线(_)和短横线(-)</div>
                                </div>
                            </div>
                            <div class="form-col">
                                <div class="form-group">
                                    <label class="form-label required" for="databaseType">
                                        <span class="icon">🗄️</span> 数据库类型
                                    </label>
                                    <select id="databaseType" class="form-select">
                                        <option value="">请选择数据库类型</option>
                                        <option value="Oracle" selected>Oracle</option>
                                        <option value="MySQL">MySQL</option>
                                        <option value="SQL Server">SQL Server</option>
                                        <option value="PostgreSQL">PostgreSQL</option>
                                        <option value="DM">DM</option>
                                        <option value="KingBase">KingBase</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="connectionString">
                                <span class="icon">🔗</span> 连接字符串（可选）
                            </label>
                            <div class="connection-string-input">
                                <input type="text" id="connectionString" class="form-control" placeholder="用户名/密码@IP:port/数据库名称">
                                <button type="button" class="parse-btn" id="parseConnectionString">解析</button>
                            </div>
                            <div class="help-text">格式：用户名/密码@IP:port/数据库名称</div>
                        </div>

                        <div class="form-row">
                            <div class="form-col">
                                <div class="form-group">
                                    <label class="form-label required" for="host">
                                        <span class="icon">🌐</span> 主机地址
                                    </label>
                                    <input type="text" id="host" class="form-control" placeholder="请输入主机地址" value="localhost">
                                </div>
                            </div>
                            <div class="form-col">
                                <div class="form-group">
                                    <label class="form-label required" for="port">
                                        <span class="icon">🔌</span> 端口号
                                    </label>
                                    <input type="number" id="port" class="form-control" placeholder="请输入端口号" value="1521">
                                </div>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-col">
                                <div class="form-group">
                                    <label class="form-label required" for="databaseName">
                                        <span class="icon">📚</span> 数据库名
                                    </label>
                                    <input type="text" id="databaseName" class="form-control" placeholder="请输入数据库名" value="orcl">
                                </div>
                            </div>
                            <div class="form-col">
                                <div class="form-group">
                                    <label class="form-label" for="oidFlag">
                                        <span class="icon">🔢</span> OID标识
                                    </label>
                                    <input type="text" id="oidFlag" class="form-control" placeholder="请输入OID标识" value="ZZ">
                                </div>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-col">
                                <div class="form-group">
                                    <label class="form-label required" for="username">
                                        <span class="icon">👤</span> 用户名
                                    </label>
                                    <input type="text" id="username" class="form-control" placeholder="请输入用户名">
                                </div>
                            </div>
                            <div class="form-col">
                                <div class="form-group">
                                    <label class="form-label required" for="password">
                                        <span class="icon">🔒</span> 密码
                                    </label>
                                    <input type="password" id="password" class="form-control" placeholder="请输入密码">
                                </div>
                            </div>
                        </div>

                        <div class="form-footer">
                            <button type="button" class="btn btn-secondary" id="testConnectionBtn">
                                <span class="icon">🧪</span>
                                <span id="testConnectionText">测试连接</span>
                            </button>
                            <button type="button" class="btn btn-secondary" id="resetFormBtn">
                                <span class="icon">🔄</span>
                                重置表单
                            </button>
                            <button type="button" class="btn btn-primary" id="saveDataSourceBtn">
                                <span class="icon">💾</span>
                                <span id="saveDataSourceText">保存数据源</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <div id="connectionTestResult" class="alert hidden"></div>

            <div class="card">
                <div class="card-header">
                    📋 数据源列表
                </div>
                <div class="card-body">
                    <div id="dataSourceList" class="data-source-list">
                        <!-- 数据源列表将通过JavaScript动态生成 -->
                        <div class="alert alert-info">暂无数据源配置</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="tab-content" id="home-config-tab">
            <div class="card">
                <div class="card-header">
                    ⚙️ NC Home 配置
                </div>
                <div class="card-body">
                    <div class="form-group">
                        <label class="form-label required" for="homePath">
                            <span class="icon">📂</span> NC Home 路径
                        </label>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <input type="text" id="homePath" class="form-control" placeholder="请选择NC Home目录" readonly style="flex: 1; min-width: 200px;">
                            <button class="btn btn-secondary" id="selectHomeDirBtn">
                                <span class="icon">📁</span>
                                选择目录
                            </button>
                            <button class="btn btn-secondary" id="openHomeDirBtn">
                                <span class="icon">📂</span>
                                打开目录
                            </button>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-col">
                            <div class="form-group">
                                <label class="form-label" for="port">
                                    <span class="icon">🌐</span> HTTP端口
                                </label>
                                <input type="number" id="port" class="form-control" placeholder="请输入HTTP端口" value="9999">
                            </div>
                        </div>
                        <div class="form-col">
                            <div class="form-group">
                                <label class="form-label" for="wsPort">
                                    <span class="icon">📡</span> WebSocket端口
                                </label>
                                <input type="number" id="wsPort" class="form-control" placeholder="请输入WebSocket端口" value="8080">
                            </div>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-col">
                            <div class="form-group">
                                <label class="form-label" for="debugPort">
                                    <span class="icon">🐛</span> 调试端口
                                </label>
                                <input type="number" id="debugPort" class="form-control" placeholder="请输入调试端口" value="8888">
                            </div>
                        </div>
                        <div class="form-col">
                            <div class="form-group">
                                <label class="form-label" for="mcpPort">
                                    <span class="icon">🔗</span> MCP端口
                                </label>
                                <input type="text" id="mcpPort" class="form-control" placeholder="请输入MCP端口">
                            </div>
                        </div>
                    </div>

                    <div class="form-row">
                        <div class="form-col">
                            <div class="form-group">
                                <label class="form-label" for="devuser">
                                    <span class="icon">👨‍💻</span> 开发用户
                                </label>
                                <input type="text" id="devuser" class="form-control" placeholder="请输入开发用户名">
                            </div>
                        </div>
                        <div class="form-col">
                            <div class="form-group">
                                <label class="form-label" for="devpwd">
                                    <span class="icon">🔒</span> 开发密码
                                </label>
                                <input type="password" id="devpwd" class="form-control" placeholder="请输入开发密码">
                            </div>
                        </div>
                    </div>

                    <div class="form-footer">
                        <button class="btn btn-primary" id="saveConfigBtn">
                            <span class="icon">💾</span>
                            保存配置
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // 数据库类型默认端口映射
        const defaultPorts = {
            'Oracle': 1521,
            'MySQL': 3306,
            'SQL Server': 1433,
            'PostgreSQL': 5432,
            'DM': 5236,
            'KingBase': 54321
        };

        // 页面加载完成后设置默认值
        window.addEventListener('load', () => {
            // 设置默认数据库类型为Oracle
            databaseType.value = 'Oracle';
            // 设置默认端口
            port.value = defaultPorts['Oracle'];
            // 设置默认数据源名称
            dataSourceName.value = 'dataSource1';
            // 设置默认数据库名
            databaseName.value = 'orcl';
            
            // 初始化时加载配置
            vscode.postMessage({ type: 'getConfig' });
        });

        // 数据库类型变化时更新默认端口
        databaseType.addEventListener('change', () => {
            const selectedType = databaseType.value;
            if (selectedType && defaultPorts[selectedType]) {
                port.value = defaultPorts[selectedType];
            }
            
            // 根据数据库类型设置默认数据库名
            switch(selectedType) {
                case 'Oracle':
                    databaseName.value = 'orcl';
                    break;
                case 'MySQL':
                    databaseName.value = 'mysql';
                    break;
                case 'SQL Server':
                    databaseName.value = 'master';
                    break;
                case 'PostgreSQL':
                    databaseName.value = 'postgres';
                    break;
                case 'DM':
                    databaseName.value = 'dm';
                    break;
                case 'KingBase':
                    databaseName.value = 'kingbase';
                    break;
                default:
                    databaseName.value = '';
            }
        });

        // Tab切换功能
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // 移除所有活动状态
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                // 添加当前活动状态
                tab.classList.add('active');
                const tabId = tab.getAttribute('data-tab');
                document.getElementById(\`\${tabId}-tab\`).classList.add('active');
            });
        });

        // 表单元素引用
        const dataSourceForm = document.getElementById('dataSourceForm');
        const dataSourceName = document.getElementById('dataSourceName');
        const databaseType = document.getElementById('databaseType');
        const connectionString = document.getElementById('connectionString');
        const host = document.getElementById('host');
        const port = document.getElementById('port');
        const databaseName = document.getElementById('databaseName');
        const oidFlag = document.getElementById('oidFlag');
        const username = document.getElementById('username');
        const password = document.getElementById('password');
        const testConnectionBtn = document.getElementById('testConnectionBtn');
        const saveDataSourceBtn = document.getElementById('saveDataSourceBtn');
        const parseConnectionStringBtn = document.getElementById('parseConnectionString');
        const resetFormBtn = document.getElementById('resetFormBtn');
        const connectionTestResult = document.getElementById('connectionTestResult');
        const dataSourceList = document.getElementById('dataSourceList');
        const homePath = document.getElementById('homePath');
        const selectHomeDirBtn = document.getElementById('selectHomeDirBtn');
        const openHomeDirBtn = document.getElementById('openHomeDirBtn');
        const saveConfigBtn = document.getElementById('saveConfigBtn');

        // 解析连接字符串
        parseConnectionStringBtn.addEventListener('click', () => {
            const connStr = connectionString.value.trim();
            if (connStr) {
                vscode.postMessage({
                    type: 'parseConnectionString',
                    connectionString: connStr
                });
            } else {
                showConnectionTestResult('请输入连接字符串', 'error');
            }
        });

        // 重置表单
        resetFormBtn.addEventListener('click', () => {
            resetFormToAddMode();
        });

        // 测试连接
        testConnectionBtn.addEventListener('click', () => {
            // 验证必填字段
            if (!validateDataSourceForm()) {
                return;
            }

            // 显示加载状态
            const testConnectionText = document.getElementById('testConnectionText');
            testConnectionText.innerHTML = '<span class="spinner"></span>测试中...';
            testConnectionBtn.disabled = true;

            // 发送测试连接请求
            vscode.postMessage({
                type: 'testConnection',
                dataSource: getDataSourceFormData()
            });
        });

        // 保存数据源
        saveDataSourceBtn.addEventListener('click', () => {
            // 验证必填字段
            if (!validateDataSourceForm()) {
                return;
            }

            // 显示加载状态
            const saveDataSourceText = document.getElementById('saveDataSourceText');
            saveDataSourceText.innerHTML = '<span class="spinner"></span>保存中...';
            saveDataSourceBtn.disabled = true;

            // 发送保存数据源请求
            vscode.postMessage({
                type: 'addDataSource',
                dataSource: getDataSourceFormData()
            });
        }
        
        // 更新数据源函数
        function updateDataSource() {
            // 验证必填字段
            if (!validateDataSourceForm()) {
                return;
            }

            // 显示加载状态
            const saveDataSourceText = document.getElementById('saveDataSourceText');
            saveDataSourceText.innerHTML = '<span class="spinner"></span>更新中...';
            saveDataSourceBtn.disabled = true;

            // 发送更新数据源请求
            vscode.postMessage({
                type: 'updateDataSource',
                dataSource: getDataSourceFormData()
            });
        }
        
        // 重置表单为添加模式
        function resetFormToAddMode() {
            dataSourceName.disabled = false;
            saveDataSourceBtn.textContent = '保存数据源';
            saveDataSourceBtn.onclick = saveDataSource;
            dataSourceForm.reset();
        }
        
        // 绑定保存按钮事件
        saveDataSourceBtn.onclick = saveDataSource;

        // 选择Home目录
        selectHomeDirBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'selectHomeDirectory' });
        });

        // 打开Home目录
        openHomeDirBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'openHomeDirectory' });
        });

        // 保存配置
        saveConfigBtn.addEventListener('click', () => {
            const config = {
                homePath: homePath.value,
                port: parseInt(document.getElementById('port').value) || 9999,
                wsPort: parseInt(document.getElementById('wsPort').value) || 8080,
                debugPort: parseInt(document.getElementById('debugPort').value) || 8888,
                mcpPort: document.getElementById('mcpPort').value,
                devuser: document.getElementById('devuser').value,
                devpwd: document.getElementById('devpwd').value
            };

            vscode.postMessage({
                type: 'saveConfig',
                config: config
            });
        });

        // 验证数据源表单
        function validateDataSourceForm() {
            // 清除之前的错误状态
            clearFormErrors();
            
            let isValid = true;
            const errors = [];

            // 验证数据源名称
            if (!dataSourceName.value.trim()) {
                showError(dataSourceName, '数据源名称不能为空');
                isValid = false;
            } else {
                // 验证数据源名称格式
                const nameRegex = /^[a-zA-Z0-9_-]+$/;
                if (!nameRegex.test(dataSourceName.value)) {
                    showError(dataSourceName, '数据源名称只能包含英文、数字、下划线(_)和短横线(-)');
                    isValid = false;
                }
            }

            // 验证数据库类型
            if (!databaseType.value) {
                showError(databaseType, '请选择数据库类型');
                isValid = false;
            }

            // 验证主机地址
            if (!host.value.trim()) {
                showError(host, '主机地址不能为空');
                isValid = false;
            }

            // 验证端口号
            const portValue = parseInt(port.value);
            if (!portValue || portValue <= 0 || portValue > 65535) {
                showError(port, '端口号必须在1-65535之间');
                isValid = false;
            }

            // 验证数据库名
            if (!databaseName.value.trim()) {
                showError(databaseName, '数据库名不能为空');
                isValid = false;
            }

            // 验证用户名
            if (!username.value.trim()) {
                showError(username, '用户名不能为空');
                isValid = false;
            }

            // 验证密码
            if (!password.value.trim()) {
                showError(password, '密码不能为空');
                isValid = false;
            }

            if (!isValid) {
                showConnectionTestResult('请修正表单中的错误', 'error');
            }

            return isValid;
        }

        // 显示错误信息
        function showError(element, message) {
            element.style.borderColor = 'var(--error-color)';
            const errorDiv = document.createElement('div');
            errorDiv.className = 'help-text';
            errorDiv.style.color = 'var(--error-color)';
            errorDiv.textContent = message;
            element.parentNode.appendChild(errorDiv);
        }

        // 清除表单错误状态
        function clearFormErrors() {
            // 清除边框颜色
            const inputs = dataSourceForm.querySelectorAll('.form-control, .form-select');
            inputs.forEach(input => {
                input.style.borderColor = '';
            });

            // 清除错误信息
            const errorMessages = dataSourceForm.querySelectorAll('.help-text[style*="color: var(--error-color)"]');
            errorMessages.forEach(error => error.remove());
        }

        // 获取数据源表单数据
        function getDataSourceFormData() {
            return {
                name: dataSourceName.value.trim(),
                databaseType: databaseType.value,
                host: host.value.trim(),
                port: parseInt(port.value),
                databaseName: databaseName.value.trim(),
                oidFlag: oidFlag.value.trim() || 'ZZ',
                username: username.value.trim(),
                password: password.value
            };
        }

        // 显示连接测试结果
        function showConnectionTestResult(message, type = 'info') {
            connectionTestResult.className = \`alert alert-\${type} hidden\`;
            connectionTestResult.textContent = message;
            connectionTestResult.classList.remove('hidden');
            
            // 3秒后自动隐藏
            setTimeout(() => {
                connectionTestResult.classList.add('hidden');
            }, 3000);
        }

        // 渲染数据源列表
        function renderDataSourceList(dataSources) {
            if (!dataSources || dataSources.length === 0) {
                dataSourceList.innerHTML = '<div class="alert alert-info">暂无数据源配置</div>';
                return;
            }

            let html = '';
            dataSources.forEach(dataSource => {
                html += \`
                    <div class="data-source-item">
                        <div class="data-source-info">
                            <div class="data-source-name">\${dataSource.name}</div>
                            <div class="data-source-details">
                                \${dataSource.databaseType} | \${dataSource.host}:\${dataSource.port}/\${dataSource.databaseName}
                            </div>
                        </div>
                        <div class="data-source-actions">
                            <button class="btn btn-sm btn-secondary" onclick="editDataSource('\${dataSource.name}')">编辑</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteDataSource('\${dataSource.name}')">删除</button>
                        </div>
                    </div>
                \`;
            });

            dataSourceList.innerHTML = html;
        }

        // 编辑数据源
        function editDataSource(name) {
            vscode.postMessage({
                type: 'editDataSource',
                dataSourceName: name
            });
        }

        // 删除数据源
        function deleteDataSource(name) {
            if (confirm(\`确定要删除数据源 "\${name}" 吗？\`)) {
                vscode.postMessage({
                    type: 'deleteDataSource',
                    dataSourceName: name
                });
            }
        }

        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configLoaded':
                    // 填充表单数据
                    const config = message.config;
                    if (config.homePath) {
                        homePath.value = config.homePath;
                    }
                    if (config.port) {
                        document.getElementById('port').value = config.port;
                    }
                    if (config.wsPort) {
                        document.getElementById('wsPort').value = config.wsPort;
                    }
                    if (config.debugPort) {
                        document.getElementById('debugPort').value = config.debugPort;
                    }
                    if (config.mcpPort) {
                        document.getElementById('mcpPort').value = config.mcpPort;
                    }
                    if (config.devuser) {
                        document.getElementById('devuser').value = config.devuser;
                    }
                    if (config.devpwd) {
                        document.getElementById('devpwd').value = config.devpwd;
                    }
                    
                    // 渲染数据源列表
                    if (config.dataSources) {
                        renderDataSourceList(config.dataSources);
                    }
                    break;
                    
                case 'dataSourceForEdit':
                    // 填充表单用于编辑
                    const dataSource = message.dataSource;
                    dataSourceName.value = dataSource.name;
                    databaseType.value = dataSource.databaseType;
                    host.value = dataSource.host;
                    port.value = dataSource.port;
                    databaseName.value = dataSource.databaseName;
                    oidFlag.value = dataSource.oidFlag || 'ZZ';
                    username.value = dataSource.username;
                    // 注意：出于安全考虑，不填充密码字段
                    password.value = '';
                    
                    // 禁用数据源名称字段（编辑时不能修改名称）
                    dataSourceName.disabled = true;
                    
                    // 更改保存按钮文本
                    saveDataSourceBtn.textContent = '更新数据源';
                    saveDataSourceBtn.onclick = updateDataSource;
                    break;
                    
                case 'connectionTestResult':
                    // 恢复按钮状态
                    const testConnectionText = document.getElementById('testConnectionText');
                    testConnectionText.textContent = '测试连接';
                    testConnectionBtn.disabled = false;
                    
                    // 显示测试结果
                    if (message.result.success) {
                        showConnectionTestResult(message.result.message, 'success');
                    } else {
                        showConnectionTestResult(message.result.message, 'error');
                    }
                    break;
                    
                case 'connectionStringParsed':
                    if (message.result.valid) {
                        // 填充解析结果到表单
                        username.value = message.result.username;
                        password.value = message.result.password;
                        host.value = message.result.host;
                        port.value = message.result.port;
                        databaseName.value = message.result.database;
                        showConnectionTestResult('连接字符串解析成功', 'success');
                    } else {
                        showConnectionTestResult(message.result.error, 'error');
                    }
                    break;
                    
                case 'dataSourceAdded':
                    // 恢复按钮状态
                    const saveDataSourceText = document.getElementById('saveDataSourceText');
                    saveDataSourceText.textContent = '保存数据源';
                    saveDataSourceBtn.disabled = false;
                    
                    // 显示成功消息
                    showConnectionTestResult('数据源添加成功', 'success');
                    
                    // 清空表单
                    dataSourceForm.reset();
                    
                    // 重新加载配置以更新数据源列表
                    vscode.postMessage({ type: 'getConfig' });
                    break;
                    
                case 'dataSourceUpdated':
                    // 恢复按钮状态
                    const saveDataSourceTextUpdate = document.getElementById('saveDataSourceText');
                    saveDataSourceTextUpdate.textContent = '更新数据源';
                    saveDataSourceBtn.disabled = false;
                    
                    // 显示成功消息
                    showConnectionTestResult('数据源更新成功', 'success');
                    
                    // 启用数据源名称字段
                    dataSourceName.disabled = false;
                    
                    // 恢复保存按钮功能
                    saveDataSourceBtn.onclick = saveDataSource;
                    
                    // 清空表单
                    dataSourceForm.reset();
                    
                    // 重新加载配置以更新数据源列表
                    vscode.postMessage({ type: 'getConfig' });
                    break;
                    
                case 'dataSourceDeleted':
                    // 显示成功消息
                    showConnectionTestResult('数据源删除成功', 'success');
                    
                    // 重新加载配置以更新数据源列表
                    vscode.postMessage({ type: 'getConfig' });
                    break;
                    
                case 'homeDirectorySelected':
                    if (message.homePath) {
                        homePath.value = message.homePath;
                    }
                    break;
                    
                case 'configSaved':
                    showConnectionTestResult('配置保存成功', 'success');
                    break;
                    
                case 'error':
                    // 恢复按钮状态
                    const testConnectionTextError = document.getElementById('testConnectionText');
                    testConnectionTextError.textContent = '测试连接';
                    testConnectionBtn.disabled = false;
                    
                    const saveDataSourceTextError = document.getElementById('saveDataSourceText');
                    saveDataSourceTextError.textContent = '保存数据源';
                    saveDataSourceBtn.disabled = false;
                    
                    // 显示错误消息
                    showConnectionTestResult(message.message, 'error');
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}