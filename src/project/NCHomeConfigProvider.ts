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
                // case 'startHomeService':
                //     await this.handleStartHomeService();
                //     break;
                case 'stopHomeService':
                    await this.handleStopHomeService();
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
                case 'checkSystemConfig':
                    await this.handleCheckSystemConfig();
                    break;
                case 'debugHomeService':
                    await this.handleDebugHomeService();
                    break;
                case 'selectExportPath':
                    await this.handleSelectExportPath();
                    break;
                case 'showOutput':
                    await this.handleShowOutput();
                    break;
                case 'confirmResetDefaults':
                    await this.handleConfirmResetDefaults();
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

        // 如果homePath已配置，尝试从prop.xml中获取端口信息和数据源信息
        if (config.homePath) {
            const portsAndDataSourcesFromProp = this.configService.getPortFromPropXml();
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

        // 确保所有相关字段正确初始化
        if (!config.dataSources) {
            config.dataSources = [];
        }

        // 确保 selectedDataSource 和 baseDatabase 字段存在
        if (config.selectedDataSource === undefined) {
            config.selectedDataSource = undefined;
        }

        if (config.baseDatabase === undefined) {
            config.baseDatabase = undefined;
        }

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
     * 处理启动HOME服务
     */
    // private async handleStartHomeService() {
    //     try {
    //         // 执行启动HOME服务的命令
    //         await vscode.commands.executeCommand('yonbip.home.start');
    //         this._view?.webview.postMessage({
    //             type: 'homeServiceStarted',
    //             success: true
    //         });
    //     } catch (error: any) {
    //         this._view?.webview.postMessage({
    //             type: 'homeServiceStarted',
    //             success: false,
    //             error: error.message
    //         });
    //     }
    // }

    /**
     * 处理停止HOME服务
     */
    private async handleStopHomeService() {
        try {
            // 执行停止HOME服务的命令
            const result = await vscode.commands.executeCommand('yonbip.home.stop');
            this._view?.webview.postMessage({
                type: 'homeServiceStopped',
                success: true,
                result: result
            });
        } catch (error: any) {
            const errorMessage = error.message || error.toString() || '未知错误';
            this._view?.webview.postMessage({
                type: 'homeServiceStopped',
                success: false,
                error: errorMessage
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
                config: config
            });
        } catch (error: any) {
            // 发送错误消息
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
     * 处理调试启动HOME服务
     */
    private async handleDebugHomeService() {
        try {
            // 执行调试启动HOME服务的命令
            await vscode.commands.executeCommand('yonbip.home.debug');
            this._view?.webview.postMessage({
                type: 'homeServiceDebugged',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'homeServiceDebugged',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理选择补丁输出目录
     */
    private async handleSelectExportPath() {
        try {
            const options: vscode.OpenDialogOptions = {
                canSelectMany: false,
                canSelectFiles: false,
                canSelectFolders: true,
                openLabel: '选择补丁输出目录'
            };

            const folderUri = await vscode.window.showOpenDialog(options);
            if (folderUri && folderUri.length > 0) {
                const exportPath = folderUri[0].fsPath;
                const config = this.configService.getConfig();
                config.exportPatchPath = exportPath;
                await this.configService.saveConfig(config);

                this._view?.webview.postMessage({
                    type: 'exportPathSelected',
                    exportPath,
                    success: true
                });
            }
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'exportPathSelected',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理显示输出日志
     */
    private async handleShowOutput() {
        try {
            // 显示输出面板
            await vscode.commands.executeCommand('yonbip.home.showOutput');
            this._view?.webview.postMessage({
                type: 'outputShown',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'outputShown',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 生成WebView HTML内容
     */
    private _getHtmlForWebview(webview: vscode.Webview) {
        // 直接返回内嵌的HTML，避免使用fs和path模块
        // 在生产环境中，Webview中不能使用Node.js内置模块
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
            padding: 10px;
            margin: 0;
        }
        
        /* 滚动条样式优化 */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        
        ::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-hoverBackground);
            border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-activeBackground);
        }
        
        .section {
            margin-bottom: 16px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            padding: 16px;
            background-color: var(--vscode-input-background);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            transition: all 0.2s ease;
        }
        
        .section:hover {
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        
        .section-title {
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--vscode-textLink-foreground);
            font-size: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 8px;
            display: flex;
            align-items: center;
        }
        
        .section-title::before {
            content: '';
            display: inline-block;
            width: 4px;
            height: 16px;
            background-color: var(--vscode-textLink-foreground);
            margin-right: 8px;
            border-radius: 2px;
        }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        .form-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            margin-bottom: 12px;
            gap: 8px;
        }
        
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            min-width: 100px;
            color: var(--vscode-editor-foreground);
        }
        
        .form-row label {
            margin-bottom: 0;
            margin-right: 10px;
        }
        
        .form-row .input-container {
            display: flex;
            flex: 1;
            min-width: 0; /* 允许输入框在空间不足时收缩 */
            gap: 8px;
        }
        
        .form-row .input-container input {
            text-overflow: ellipsis;
            white-space: nowrap;
            overflow: hidden;
        }
        
        @media (max-width: 500px) {
            .form-row {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .form-row .input-container {
                width: 100%;
                margin-bottom: 8px;
            }
            
            .form-row .browse-button {
                width: 100%;
            }
        }
        
        input, select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 6px;
            box-sizing: border-box;
            transition: border-color 0.2s ease;
        }
        
        input:focus, select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
        }
        
        .form-row input {
            flex: 1;
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            margin-right: 8px;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            min-height: 32px;
        }
        
        .browse-button {
            height: 28px;
            padding: 4px 12px;
            margin-bottom: 0;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        
        .tabs {
            display: flex;
            border-bottom: 2px solid var(--vscode-widget-border);
            margin-bottom: 20px;
            overflow-x: auto;
            scrollbar-width: thin;
            padding-bottom: 1px;
        }
        
        .tab {
            padding: 10px 16px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--vscode-foreground);
            margin-right: 4px;
            border-radius: 6px 6px 0 0;
            font-weight: 500;
            position: relative;
            white-space: nowrap;
            transition: all 0.2s ease;
        }
        
        .tab:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-textLink-foreground);
        }
        
        .tab.active::after {
            content: '';
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 100%;
            height: 3px;
            background-color: var(--vscode-textLink-foreground);
            border-radius: 3px 3px 0 0;
        }
        
        .tab-content {
            display: none;
            animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .tab-content.active {
            display: block;
        }
        
        .status-message {
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
            text-align: center;
            animation: fadeIn 0.3s ease;
        }
        
        .status-success {
            background-color: rgba(35, 134, 54, 0.2);
            color: var(--vscode-terminal-ansiGreen);
            border: 1px solid var(--vscode-terminal-ansiGreen);
        }
        
        .status-error {
            background-color: rgba(203, 36, 49, 0.2);
            color: var(--vscode-errorForeground);
            border: 1px solid var(--vscode-errorForeground);
        }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
            cursor: pointer;
            padding: 6px;
            border-radius: 4px;
            transition: background-color 0.2s ease;
        }
        
        .checkbox-group:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .checkbox-group input[type="checkbox"] {
            width: 16px;
            height: 16px;
            margin-right: 10px;
            cursor: pointer;
        }
        
        .help-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
            line-height: 1.4;
            padding-left: 2px;
        }
        
        /* 卡片样式 */
        .card {
            border: 1px solid var(--vscode-widget-border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
            background-color: var(--vscode-editor-background);
            transition: all 0.2s ease;
        }
        
        .card:hover {
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            border-color: var(--vscode-focusBorder);
        }
        
        /* 徽章样式 */
        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
            margin-right: 6px;
        }
        
        .badge-primary {
            background-color: var(--vscode-textLink-foreground);
            color: white;
        }
        
        .badge-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
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
                        <div class="input-container">
                            <input type="text" id="homePath" readonly placeholder="请选择NC Home安装目录">
                            <button class="browse-button" onclick="selectHomeDirectory()" style="max-width: 100px; min-width: 80px;">
                                <span style="margin-right: 4px;">📁</span> 浏览...
                            </button>
                        </div>
                    </div>
                    <div class="help-text">选择YonBIP NC的安装目录，通常包含bin、lib、modules等文件夹</div>
                </div>
                
                <div class="form-group">
                    <div class="button-group">
                        <button onclick="openHomeDirectory()">
                            <span style="margin-right: 6px;">📂</span> 打开Home目录
                        </button>
                        <button class="secondary" onclick="openSysConfig()">
                            <span style="margin-right: 6px;">🔧</span> 启动SysConfig
                        </button>
                        <button class="secondary" onclick="showOutput()">
                            <span style="margin-right: 6px;">📝</span> 查看日志
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 数据源选项卡 -->
        <div id="datasources-tab" class="tab-content">
            <div class="section">
                <div class="section-title" style="display: flex; align-items: center;">
                    <span style="flex: 1;">数据源管理</span>
                    <button onclick="showAddDataSourceForm()" style="margin: 0; height: 28px; padding: 4px 12px;">
                        <span style="margin-right: 4px;">➕</span> 添加数据源
                    </button>
                </div>
                
                <div id="datasourceList">
                    <div class="status-message" style="color: var(--vscode-descriptionForeground); display: flex; align-items: center; justify-content: center; padding: 20px;">
                        <span style="font-size: 24px; margin-right: 10px;">🗂️</span>
                        <span>暂无数据源配置，点击"添加数据源"开始配置</span>
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
                
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="debugMode">
                        <label for="debugMode">调试模式</label>
                    </div>
                    <div class="help-text">启用调试模式以支持远程调试</div>
                </div>
                
                <div class="form-group">
                    <label for="debugPort">调试端口:</label>
                    <div class="form-row">
                        <div class="input-container">
                            <input type="number" id="debugPort" placeholder="8888" min="1024" max="65535">
                        </div>
                    </div>
                    <div class="help-text">设置调试模式使用的端口号 (1024-65535)</div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">输出配置</div>
                
                <div class="form-group">
                    <label for="exportPatchPath">补丁输出目录:</label>
                    <div class="form-row">
                        <div class="input-container">
                            <input type="text" id="exportPatchPath" placeholder="./patches">
                            <button class="browse-button" onclick="selectExportPath()" style="max-width: 100px; min-width: 80px;">
                                <span style="margin-right: 4px;">📁</span> 浏览...
                            </button>
                        </div>
                    </div>
                    <div class="help-text">设置补丁包和导出文件的保存目录</div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">操作</div>
                <div class="button-group">
                    <button onclick="saveAdvancedConfig()">
                        <span style="margin-right: 6px;">💾</span> 保存设置
                    </button>
                    <button class="secondary" onclick="resetToDefaults()">
                        <span style="margin-right: 6px;">🔄</span> 重置为默认
                    </button>
                </div>
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
        
        // 启动HOME服务
        // function startHomeService() {
        //     vscode.postMessage({ type: 'startHomeService' });
        // }
        
        // 调试启动HOME服务
        function debugHomeService() {
            vscode.postMessage({ type: 'debugHomeService' });
        }

        // 停止HOME服务
        function stopHomeService() {
            vscode.postMessage({ type: 'stopHomeService' });
        }

        // 显示输出
        function showOutput() {
            vscode.postMessage({ type: 'showOutput' });
        }
        
        // 选择补丁输出目录
        function selectExportPath() {
            vscode.postMessage({ type: 'selectExportPath' });
        }
        
        // 显示添加数据源表单
        function showAddDataSourceForm() {
            showDataSourceForm('add', null);
        }
        
        // 显示编辑数据源表单
        function showEditDataSourceForm(dataSource) {
            showDataSourceForm('edit', dataSource);
        }
        
        // 显示数据源表单（添加或编辑）
        function showDataSourceForm(mode, dataSource) {
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
            
            const isEditMode = mode === 'edit';
            const title = isEditMode ? '编辑数据源' : '添加数据源';
            const nameField = isEditMode ? 
                '<input type="text" id="dsName" value="' + dataSource.name + '" required readonly>' :
                '<input type="text" id="dsName" required>';
            
            modal.innerHTML = \`
                <div style="
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 6px;
                    padding: 20px;
                    width: 500px;
                    max-width: 90%;
                ">
                    <h3 style="margin-top: 0; color: var(--vscode-foreground);">\${title}</h3>
                    <div class="form-group">
                        <label for="dsName">数据源名称:</label>
                        \${nameField}
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
                        <button onclick="saveDataSource('\${mode}')">\${isEditMode ? '更新' : '保存'}</button>
                    </div>
                </div>
            \`;
            
            document.body.appendChild(modal);
            
            // 如果是编辑模式，填充现有数据
            if (isEditMode) {
                document.getElementById('dsType').value = dataSource.databaseType;
                document.getElementById('dsHost').value = dataSource.host;
                document.getElementById('dsPort').value = dataSource.port;
                document.getElementById('dsDatabase').value = dataSource.databaseName;
                document.getElementById('dsUsername').value = dataSource.username;
                // 密码字段不填充，保持为空
            }
        }
        
        // 关闭模态框
        function closeModal() {
            const modal = document.getElementById('dataSourceModal');
            if (modal) {
                modal.remove();
            }
        }
        
        // 保存数据源
        function saveDataSource(mode) {
            const portValue = document.getElementById('dsPort').value;
            const dataSource = {
                name: document.getElementById('dsName').value,
                databaseType: document.getElementById('dsType').value,
                host: document.getElementById('dsHost').value,
                port: portValue ? parseInt(portValue) : 3306,
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
            
            // 如果是编辑模式且密码字段为空，则不发送密码
            if (mode === 'edit' && !dataSource.password) {
                delete dataSource.password;
            }
            
            const messageType = mode === 'edit' ? 'updateDataSource' : 'addDataSource';
            
            vscode.postMessage({
                type: messageType,
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
            document.getElementById('debugMode').checked = config.debugMode !== false;
            document.getElementById('debugPort').value = config.debugPort || 8888;
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
                // 检查是否为当前选中的design数据源
                const isDesignDatabase = currentConfig.selectedDataSource === ds.name;
                const isBaseDatabase = currentConfig.baseDatabase === ds.name;
                
                // 转义特殊字符以避免HTML注入
                const dsJson = JSON.stringify(ds)
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '\\\'');
                
                html += \`
                    <div style="
                        padding: 10px; 
                        border: 1px solid var(--vscode-widget-border); 
                        border-radius: 4px; 
                        margin-bottom: 10px;
                        background-color: var(--vscode-input-background);
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="font-weight: bold; color: var(--vscode-textLink-foreground);">\${ds.name}</div>
                            <div>
                                \${isDesignDatabase ? '<span style="background-color: var(--vscode-terminal-ansiGreen); color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">DESIGN</span>' : ''}
                                \${isBaseDatabase ? '<span style="background-color: var(--vscode-terminal-ansiBlue); color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">BASE</span>' : ''}
                            </div>
                        </div>
                        <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 5px;">
                            <div>类型: \${ds.databaseType}</div>
                            <div>主机: \${ds.host}:\${ds.port}</div>
                            <div>数据库: \${ds.databaseName}</div>
                        </div>
                        <div style="margin-top: 8px; display: flex; gap: 5px; flex-wrap: wrap;">
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" onclick="showEditDataSourceForm(\${dsJson})">编辑</button>
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" onclick="setAsDesignDatabase('\${ds.name}')">设为Design</button>
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" onclick="setAsBaseDatabase('\${ds.name}')">设为基准库</button>
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" onclick="testDataSourceConnection('\${ds.name}')">测试连接</button>
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" onclick="deleteDataSource('\${ds.name}')">删除</button>
                        </div>
                    </div>
                \`;
            });
            html += '</div>';
            
            dataSourceListElement.innerHTML = html;
        }
        
        // 设置为Design数据源
        function setAsDesignDatabase(dataSourceName) {
            vscode.postMessage({
                type: 'setDesignDatabase',
                dataSourceName: dataSourceName
            });
        }
        
        // 设置为基准库
        function setAsBaseDatabase(dataSourceName) {
            vscode.postMessage({
                type: 'setBaseDatabase',
                dataSourceName: dataSourceName
            });
        }
        
        // 测试数据源连接
        function testDataSourceConnection(dataSourceName) {
            // 从当前配置中获取数据源信息
            const dataSource = currentConfig.dataSources.find(ds => ds.name === dataSourceName);
            if (dataSource) {
                vscode.postMessage({
                    type: 'testConnection',
                    dataSource: dataSource
                });
            } else {
                showMessage('未找到数据源: ' + dataSourceName, 'error');
            }
        }
        
        // 删除数据源
        function deleteDataSource(dataSourceName) {
            if (confirm(\`确定要删除数据源 "\${dataSourceName}" 吗？\`)) {
                vscode.postMessage({
                    type: 'deleteDataSource',
                    dataSourceName: dataSourceName
                });
            }
        }
        
        // 保存高级配置
        function saveAdvancedConfig() {
            const config = {
                ...currentConfig,
                standardMode: document.getElementById('standardMode').checked,
                asyncTask: document.getElementById('asyncTask').checked,
                autoClient: document.getElementById('autoClient').checked,
                debugMode: document.getElementById('debugMode').checked,
                debugPort: parseInt(document.getElementById('debugPort').value) || 8888,
                exportPatchPath: document.getElementById('exportPatchPath').value
            };
            
            // 确保 debugPort 字段存在且为数字类型
            if (typeof config.debugPort !== 'number' || isNaN(config.debugPort)) {
                config.debugPort = 8888;
            }
            
            vscode.postMessage({
                type: 'saveConfig',
                config: config
            });
        }
        
        // 重置为默认配置
        function resetToDefaults() {
            // 请求扩展处理确认对话框
            vscode.postMessage({
                type: 'confirmResetDefaults'
            });
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
                    
                case 'homeServiceStarted':
                    if (message.success) {
                        showMessage('HOME服务启动成功', 'success');
                    } else {
                        showMessage('启动HOME服务失败: ' + message.error, 'error');
                    }
                    break;
                case 'homeServiceStopped':
                    if (message.success) {
                        showMessage('HOME服务停止成功', 'success');
                    } else {
                        showMessage('停止HOME服务失败: ' + message.error, 'error');
                    }
                    break;
                case 'homeServiceDebugged':
                    if (message.success) {
                        showMessage('HOME服务调试启动成功', 'success');
                    } else {
                        showMessage('调试启动HOME服务失败: ' + message.error, 'error');
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
                    
                case 'dataSourceUpdated':
                    if (message.success) {
                        showMessage('数据源更新成功', 'success');
                        // 更新配置显示
                        if (message.config) {
                            updateConfigDisplay(message.config);
                        }
                    } else {
                        showMessage('数据源更新失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'connectionTestResult':
                    if (message.result.success) {
                        showMessage('数据源连接测试成功: ' + message.result.message, 'success');
                    } else {
                        showMessage('数据源连接测试失败: ' + message.result.message, 'error');
                    }
                    break;
                    
                case 'dataSourceDeleted':
                    if (message.success) {
                        showMessage('数据源删除成功', 'success');
                        // 更新配置显示
                        if (message.config) {
                            updateConfigDisplay(message.config);
                        }
                    } else {
                        showMessage('数据源删除失败: ' + message.error, 'error');
                    }
                    break;
                case 'defaultsReset':
                    if (message.success) {
                        // 更新配置显示
                        if (message.config) {
                            updateConfigDisplay(message.config);
                        }
                        showMessage('已重置为默认配置', 'success');
                    } else {
                        showMessage('重置默认配置失败: ' + message.error, 'error');
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

    /**
     * 处理系统配置检查
     */
    private async handleCheckSystemConfig() {
        try {
            const result = this.configService.checkSystemConfig();
            this._view?.webview.postMessage({
                type: 'systemConfigCheckResult',
                result
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'systemConfigCheckResult',
                result: {
                    valid: false,
                    message: `检查系统配置失败: ${error.message}`
                }
            });
        }
    }

    /**
     * 处理确认重置默认值
     */
    private async handleConfirmResetDefaults() {
        const confirm = await vscode.window.showWarningMessage(
            '确定要重置所有配置为默认值吗？',
            { modal: true },
            '确定',
            '取消'
        );

        if (confirm === '确定') {
            try {
                // 获取当前配置
                const config = this.configService.getConfig();

                // 设置默认值
                const defaultConfig = {
                    standardMode: true,
                    asyncTask: false,
                    autoClient: true,
                    debugMode: true,
                    debugPort: 8888,
                    exportPatchPath: './patches'
                };

                // 更新配置
                const updatedConfig = {
                    ...config,
                    ...defaultConfig
                };

                // 保存配置
                await this.configService.saveConfig(updatedConfig);

                // 发送成功消息
                this._view?.webview.postMessage({
                    type: 'defaultsReset',
                    success: true,
                    config: updatedConfig
                });
            } catch (error: any) {
                // 发送错误消息
                this._view?.webview.postMessage({
                    type: 'defaultsReset',
                    success: false,
                    error: error.message
                });
            }
        }
    }
}