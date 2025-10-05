import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NCHomeConfigService } from './NCHomeConfigService';
import { DataSourceMeta, NCHomeConfig } from './NCHomeConfigTypes';
import { MacHomeConversionService } from '../../mac/MacHomeConversionService';

/**
 * NC Home配置WebView提供者
 */
export class NCHomeConfigProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip-nchome';

    private _view?: vscode.WebviewView;
    private configService: NCHomeConfigService;
    private macHomeConversionService: MacHomeConversionService;
    private readonly context: vscode.ExtensionContext;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        macHomeConversionService?: MacHomeConversionService
    ) {
        this.context = context;
        this.configService = new NCHomeConfigService(context);
        // 如果传入了MacHomeConversionService实例，则使用它，否则创建新的实例
        this.macHomeConversionService = macHomeConversionService || new MacHomeConversionService(this.configService);
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
                case 'requestDeleteConfirmation':
                    await this.handleDeleteConfirmationRequest(data.dataSourceName);
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
        // 重新加载配置以确保使用当前工作区的配置
        this.configService = new NCHomeConfigService(this.context);

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

            // 从prop.xml中获取数据源信息
            if (portsAndDataSourcesFromProp.dataSources.length > 0) {
                // 直接使用从prop.xml读取的数据源信息
                config.dataSources = portsAndDataSourcesFromProp.dataSources;
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

                // 如果是Mac系统，自动执行Mac HOME转换
                if (process.platform === 'darwin') {
                    // 检查home/bin目录下是否已存在sysConfig.sh文件
                    const sysConfigPath = path.join(homePath, 'bin', 'sysConfig.sh');
                    if (fs.existsSync(sysConfigPath)) {
                        // 如果sysConfig.sh文件已存在，则不再执行MAC HOME转换
                        this.macHomeConversionService['outputChannel'].appendLine('检测到sysConfig.sh文件已存在，跳过MAC HOME转换');
                        vscode.window.showInformationMessage('检测到sysConfig.sh文件已存在，跳过MAC HOME转换');
                    } else {
                        const convert = await vscode.window.showInformationMessage(
                            '检测到您使用的是Mac系统，是否需要自动执行Mac HOME转换？',
                            '是',
                            '否'
                        );

                        if (convert === '是') {
                            await this.macHomeConversionService.convertToMacHome(homePath);
                        }
                    }
                }

                // 重新加载配置以获取新home目录中的数据源信息
                await this.handleLoadConfig();
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
            // 注意：这里不再重新加载整个配置，只发送成功消息
            this._view?.webview.postMessage({
                type: 'dataSourceAdded',
                success: true
                // 不再传递整个config对象
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
            // 注意：这里不再重新加载整个配置，只发送成功消息
            this._view?.webview.postMessage({
                type: 'dataSourceUpdated',
                success: true
                // 不再传递整个config对象
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
            // 注意：这里不再重新加载整个配置，只发送成功消息
            this._view?.webview.postMessage({
                type: 'dataSourceDeleted',
                success: true
                // 不再传递整个config对象
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
            // 注意：这里不再传递整个config对象，而是重新加载配置以获取最新的数据源信息
            await this.handleLoadConfig();
            this._view?.webview.postMessage({
                type: 'designDatabaseSet',
                success: true
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
            // 注意：这里不再传递整个config对象，而是重新加载配置以获取最新的数据源信息
            await this.handleLoadConfig();
            this._view?.webview.postMessage({
                type: 'baseDatabaseSet',
                success: true
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
        
        /* 密码输入框特殊样式 */
        input[type="password"] {
            font-family: monospace; /* 使用等宽字体 */
            letter-spacing: 5px; /* 增加字符间距以更好地隐藏密码 */
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
                '<input type="text" id="dsName" value="dataSource1" required>';
            
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
                        <label for="dsName">数据源名称<span style="color: red;"> *</span>:</label>
                        \${nameField}
                    </div>
                    <div class="form-group">
                        <label for="dsType">数据库类型<span style="color: red;"> *</span>:</label>
                        <select id="dsType">
                            <option value="oracle">Oracle</option>
                            <option value="mysql">MySQL</option>
                            <option value="sqlserver">SQL Server</option>
                            <option value="postgresql">PostgreSQL</option>
                            <option value="db2">DB2</option>
                            <option value="dm">达梦数据库</option>
                            <option value="kingbase">人大金仓</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="dsHost">主机地址<span style="color: red;"> *</span>:</label>
                        <input type="text" id="dsHost" value="localhost">
                    </div>
                    <div class="form-group">
                        <label for="dsPort">端口号<span style="color: red;"> *</span>:</label>
                        <input type="number" id="dsPort" value="1521">
                    </div>
                    <div class="form-group">
                        <label for="dsDatabase">数据库名<span style="color: red;"> *</span>:</label>
                        <input type="text" id="dsDatabase">
                    </div>
                    <div class="form-group">
                        <label for="dsUsername">用户名<span style="color: red;"> *</span>:</label>
                        <input type="text" id="dsUsername">
                    </div>
                    <div class="form-group">
                        <label for="dsPassword">密码<span style="color: red;"> *</span>:</label>
                        <div style="position: relative;">
                            <input type="password" id="dsPassword" style="padding-right: 30px;">
                            <button type="button" id="togglePassword" style="position: absolute; right: 5px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--vscode-foreground);" title="显示/隐藏密码">👁️</button>
                        </div>
                    </div>
                    <div style="text-align: right; margin-top: 20px;">
                        <button class="secondary" onclick="closeModal()">取消</button>
                        <button onclick="saveDataSource('\${mode}')">\${isEditMode ? '更新' : '保存'}</button>
                    </div>
                </div>
            \`;
            
            document.body.appendChild(modal);
            
            // 添加密码显示/隐藏切换功能
            const togglePasswordButton = document.getElementById('togglePassword');
            const passwordInput = document.getElementById('dsPassword');
            
            if (togglePasswordButton && passwordInput) {
                togglePasswordButton.addEventListener('click', function() {
                    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                    passwordInput.setAttribute('type', type);
                    this.textContent = type === 'password' ? '👁️' : '🔒';
                });
            }
            
            // 如果是编辑模式，填充现有数据
            if (isEditMode) {
                // 数据库类型需要映射到下拉框的值
                const databaseTypeMap = {
                    'ORACLE': 'oracle',
                    'MYSQL': 'mysql',
                    'SQLSERVER': 'sqlserver',
                    'POSTGRESQL': 'postgresql',
                    'DB2': 'db2',
                    'DM': 'dm',
                    'KINGBASE': 'kingbase'
                };
                const selectValue = databaseTypeMap[dataSource.databaseType.toUpperCase()] || dataSource.databaseType.toLowerCase();
                document.getElementById('dsType').value = selectValue;
                document.getElementById('dsHost').value = dataSource.host;
                document.getElementById('dsPort').value = dataSource.port;
                document.getElementById('dsDatabase').value = dataSource.databaseName;
                document.getElementById('dsUsername').value = dataSource.username;
                // 填充密码字段（如果存在）
                if (dataSource.password && dataSource.password !== '[加密密码-需要重新输入]') {
                    document.getElementById('dsPassword').value = dataSource.password;
                }
            } else {
                // 新增模式下，默认选中Oracle并设置默认端口、数据库名和数据源名称
                document.getElementById('dsType').value = 'oracle';
                document.getElementById('dsPort').value = 1521;
                document.getElementById('dsDatabase').value = 'orcl';
                // 数据源名称默认值已设置在HTML中
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
            // 防止重复提交
            const saveButton = event.target;
            if (saveButton.disabled) return;
            
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
            
            // 完整验证 - 检查所有字段是否已填写
            if (!dataSource.name || dataSource.name.trim() === '') {
                showMessage('请填写数据源名称', 'error');
                return;
            }
            
            // 数据源名称格式校验 - 只能包含英文、数字、下划线和短横线
            const nameRegex = /^[a-zA-Z0-9_-]+$/;
            if (!nameRegex.test(dataSource.name)) {
                showMessage('数据源名称只能包含英文、数字、下划线(_)和短横线(-)', 'error');
                return;
            }
            
            if (!dataSource.databaseType || dataSource.databaseType.trim() === '') {
                showMessage('请选择数据库类型', 'error');
                return;
            }
            
            if (!dataSource.host || dataSource.host.trim() === '') {
                showMessage('请填写主机地址', 'error');
                return;
            }
            
            if (!portValue || portValue.trim() === '' || isNaN(parseInt(portValue)) || parseInt(portValue) <= 0 || parseInt(portValue) > 65535) {
                showMessage('请填写有效的端口号(1-65535)', 'error');
                return;
            }
            
            if (!dataSource.databaseName || dataSource.databaseName.trim() === '') {
                showMessage('请填写数据库名', 'error');
                return;
            }
            
            if (!dataSource.username || dataSource.username.trim() === '') {
                showMessage('请填写用户名', 'error');
                return;
            }
            
            // 密码字段必填校验（新增数据源时必须填写，编辑数据源时如果填写了则更新）
            if (!dataSource.password || dataSource.password.trim() === '') {
                if (mode !== 'edit') {
                    // 新增模式下密码必填
                    showMessage('请填写密码', 'error');
                    return;
                }
                // 编辑模式下如果密码为空，表示不修改密码
            }
            
            const messageType = mode === 'edit' ? 'updateDataSource' : 'addDataSource';
            
            // 禁用保存按钮防止重复提交
            saveButton.disabled = true;
            saveButton.textContent = mode === 'edit' ? '更新中...' : '保存中...';
            
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
            
            // 将design数据源放在第一位
            const sortedDataSources = [...dataSources].sort((a, b) => {
                const isADesign = currentConfig.selectedDataSource === a.name;
                const isBDesign = currentConfig.selectedDataSource === b.name;
                if (isADesign && !isBDesign) return -1;
                if (!isADesign && isBDesign) return 1;
                return 0;
            });
            
            // 如果没有任何数据源被标记为design，检查数据源名称是否包含"design"关键字
            if (!currentConfig.selectedDataSource) {
                sortedDataSources.sort((a, b) => {
                    const aHasDesign = a.name.toLowerCase().includes('design');
                    const bHasDesign = b.name.toLowerCase().includes('design');
                    if (aHasDesign && !bHasDesign) return -1;
                    if (!aHasDesign && bHasDesign) return 1;
                    return 0;
                });
            }
            
            let html = '<div style="margin-top: 10px;">';
            sortedDataSources.forEach((ds, index) => {
                // 检查是否为当前选中的design数据源
                const isDesignDatabase = currentConfig.selectedDataSource === ds.name || ds.name.toLowerCase().includes('design');
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
                                \${isDesignDatabase ? '<span style="background: linear-gradient(135deg, var(--vscode-terminal-ansiGreen) 0%, #27ae60 100%); color: white; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.5px;">DESIGN</span>' : ''}
                                \${isBaseDatabase ? '<span style="background-color: var(--vscode-terminal-ansiBlue); color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">BASE</span>' : ''}
                            </div>
                        </div>
                        <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 5px;">
                            <div>类型: \${ds.databaseType}</div>
                            <div>主机: \${ds.host}:\${ds.port}</div>
                            <div>数据库: \${ds.databaseName}</div>
                        </div>
                        <div style="margin-top: 8px; display: flex; gap: 5px; flex-wrap: wrap;">
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="edit" data-ds-name="\${ds.name}">编辑</button>
                            \${!isDesignDatabase ? \`<button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="setDesign" data-ds-name="\${ds.name}">设为Design</button>\` : ''}
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="setBase" data-ds-name="\${ds.name}">设为基准库</button>
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="test" data-ds-name="\${ds.name}">测试连接</button>
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="delete" data-ds-name="\${ds.name}">删除</button>
                        </div>
                    </div>
\`;
            });
            html += '</div>';
            
            dataSourceListElement.innerHTML = html;
            
            // 添加事件监听器
            addDataSourceEventListeners();
        }
        
        // 添加数据源事件监听器
        function addDataSourceEventListeners() {
            // 编辑按钮
            document.querySelectorAll('[data-action="edit"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    const dataSource = currentConfig.dataSources.find(ds => ds.name === dataSourceName);
                    if (dataSource) {
                        showEditDataSourceForm(dataSource);
                    }
                });
            });
            
            // 设为Design按钮
            document.querySelectorAll('[data-action="setDesign"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    setAsDesignDatabase(dataSourceName);
                });
            });
            
            // 设为基准库按钮
            document.querySelectorAll('[data-action="setBase"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    setAsBaseDatabase(dataSourceName);
                });
            });
            
            // 测试连接按钮
            document.querySelectorAll('[data-action="test"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    testDataSourceConnection(dataSourceName);
                });
            });
            
            // 删除按钮
            document.querySelectorAll('[data-action="delete"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    deleteDataSource(dataSourceName);
                });
            });
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
            // 通过向扩展发送消息来处理确认对话框
            vscode.postMessage({
                type: 'requestDeleteConfirmation',
                dataSourceName: dataSourceName
            });
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
                    // 恢复保存按钮状态
                    const saveButtons = document.querySelectorAll('button');
                    saveButtons.forEach(button => {
                        if (button.textContent.includes('保存中') || button.disabled) {
                            button.disabled = false;
                            button.textContent = button.textContent.replace('保存中...', '保存');
                        }
                    });
                    
                    if (message.success) {
                        showMessage('数据源添加成功', 'success');
                        // 注意：这里不再重新加载整个配置，而是刷新数据源列表
                        // 由于我们不再在.nc-home-config.json中保存数据源，需要重新从prop.xml加载
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('数据源添加失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'dataSourceUpdated':
                    // 恢复保存按钮状态
                    const updateButtons = document.querySelectorAll('button');
                    updateButtons.forEach(button => {
                        if (button.textContent.includes('更新中') || button.disabled) {
                            button.disabled = false;
                            button.textContent = button.textContent.replace('更新中...', '更新');
                        }
                    });
                    
                    if (message.success) {
                        showMessage('数据源更新成功', 'success');
                        // 注意：这里不再重新加载整个配置，而是刷新数据源列表
                        // 由于我们不再在.nc-home-config.json中保存数据源，需要重新从prop.xml加载
                        vscode.postMessage({ type: 'loadConfig' });
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
                        // 注意：这里不再重新加载整个配置，而是刷新数据源列表
                        // 由于我们不再在.nc-home-config.json中保存数据源，需要重新从prop.xml加载
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('数据源删除失败: ' + message.error, 'error');
                    }
                    break; // 添加缺失的break语句
                    
                case 'designDatabaseSet':
                    if (message.success) {
                        showMessage('已设置为开发库', 'success');
                        // 重新加载配置以获取最新的数据源信息
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('设置开发库失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'baseDatabaseSet':
                    if (message.success) {
                        showMessage('已设置为基准库', 'success');
                        // 重新加载配置以获取最新的数据源信息
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('设置基准库失败: ' + message.error, 'error');
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
     * 处理删除确认请求
     */
    private async handleDeleteConfirmationRequest(dataSourceName: string) {
        const confirm = await vscode.window.showWarningMessage(
            `确定要删除数据源 "${dataSourceName}" 吗？`,
            { modal: true },
            '确定'
        );

        if (confirm === '确定') {
            // 用户确认删除，执行删除操作
            await this.handleDeleteDataSource(dataSourceName);
        }
        // 如果用户点击取消或关闭对话框，则不执行任何操作
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