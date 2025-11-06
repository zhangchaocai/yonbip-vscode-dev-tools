import * as vscode from 'vscode';
import * as path from 'path';
import { WebviewPanel } from 'vscode';
import { McpProvider } from '../../mcp/McpProvider';
import { NCHomeConfigProvider } from '../../project/nc-home/config/NCHomeConfigProvider';
import { OpenApiProvider } from '../../openapi/OpenApiProvider';
import { PatchExportWebviewProvider } from './PatchExportWebviewProvider';
import { PrecastExportWebviewProvider } from './PrecastExportWebviewProvider';

/**
 * 功能树节点
 */
export class FunctionTreeNode extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly children?: FunctionTreeNode[],
        public readonly viewType?: string,
        context?: vscode.ExtensionContext
    ) {
        super(label, collapsibleState);
        this.tooltip = this.label;
        this.description = '';
        if (context) {
            // 根据不同的viewType设置不同的图标
            switch (viewType) {
                case 'yonbip-mcp':
                    this.iconPath = {
                        light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'mcp-icon.svg'),
                        dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'mcp-icon.svg')
                    };
                    break;
                case 'yonbip-nchome':
                    this.iconPath = {
                        light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'nchome-icon.svg'),
                        dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'nchome-icon.svg')
                    };
                    break;
                case 'yonbip-openapi':
                    this.iconPath = {
                        light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'openapi-icon.svg'),
                        dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'openapi-icon.svg')
                    };
                    break;
                case 'yonbip.patchExportConfig':
                    this.iconPath = {
                        light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'patch-icon.svg'),
                        dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'patch-icon.svg')
                    };
                    break;
                case 'yonbip.precastExportConfig':
                    this.iconPath = {
                        light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'sql-icon.svg'),
                        dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'sql-icon.svg')
                    };
                    break;
                default:
                    // 默认图标
                    this.iconPath = {
                        light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'icon.png'),
                        dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'views', 'icon.png')
                    };
            }
        }
    }
}

/**
 * 功能树数据提供者
 */
export class FunctionTreeProvider implements vscode.TreeDataProvider<FunctionTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<FunctionTreeNode | undefined | void> = new vscode.EventEmitter<FunctionTreeNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<FunctionTreeNode | undefined | void> = this._onDidChangeTreeData.event;
    private webviewPanels: Map<string, WebviewPanel> = new Map();

    constructor(
        private context: vscode.ExtensionContext,
        private mcpProvider?: McpProvider,
        private ncHomeConfigProvider?: NCHomeConfigProvider,
        private openApiProvider?: OpenApiProvider,
        private patchExportProvider?: PatchExportWebviewProvider,
        private precastExportProvider?: PrecastExportWebviewProvider
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: FunctionTreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FunctionTreeNode): Thenable<FunctionTreeNode[]> {
        if (element) {
            return Promise.resolve(element.children || []);
        } else {
            // 根节点 - 功能分组
            const serviceGroup = new FunctionTreeNode(
                '服务管理',
                vscode.TreeItemCollapsibleState.Expanded,
                undefined,
                [
                    new FunctionTreeNode(
                        'MCP服务',
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: 'yonbip.function.showMcp',
                            title: '显示MCP服务',
                            arguments: []
                        },
                        undefined,
                        'yonbip-mcp',  // 添加viewType参数
                        this.context
                    ),
                    new FunctionTreeNode(
                        'HOME配置',
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: 'yonbip.function.showHomeConfig',
                            title: '显示HOME配置',
                            arguments: []
                        },
                        undefined,
                        'yonbip-nchome',  // 添加viewType参数
                        this.context
                    )
                ],
                undefined,
                this.context
            );

            const developmentGroup = new FunctionTreeNode(
                '开发工具',
                vscode.TreeItemCollapsibleState.Expanded,
                undefined,
                [
                    new FunctionTreeNode(
                        'OpenAPI测试',
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: 'yonbip.function.showOpenApi',
                            title: '显示OpenAPI测试',
                            arguments: []
                        },
                        undefined,
                        'yonbip-openapi',  // 添加viewType参数
                        this.context
                    ),
                    new FunctionTreeNode(
                        '补丁导出配置',
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: 'yonbip.function.showPatchExport',
                            title: '显示补丁导出配置',
                            arguments: []
                        },
                        undefined,
                        'yonbip.patchExportConfig',  // 添加viewType参数
                        this.context
                    ),
                    new FunctionTreeNode(
                        '预置脚本导出',
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: 'yonbip.function.showPrecastExport',
                            title: '显示预置脚本导出',
                            arguments: []
                        },
                        undefined,
                        'yonbip.precastExportConfig',  // 添加viewType参数
                        this.context
                    )
                ],
                undefined,
                this.context
            );

            return Promise.resolve([serviceGroup, developmentGroup]);
        }
    }

    /**
     * 创建或显示Webview面板
     * @param viewType Webview类型
     * @param title 面板标题
     */
    public createOrShowWebview(viewType: string, title: string): void {
        // 如果面板已经存在，则显示它
        const panel = this.webviewPanels.get(viewType);
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            return;
        }

        // 创建新的Webview面板
        const newPanel = vscode.window.createWebviewPanel(
            viewType,
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.context.extensionUri]
            }
        );

        // 设置面板关闭时的清理逻辑
        newPanel.onDidDispose(() => {
            this.webviewPanels.delete(viewType);
        });

        // 将面板存储到Map中
        this.webviewPanels.set(viewType, newPanel);

        // 设置消息监听器
        this.setupMessageListener(newPanel, viewType);

        // 设置Webview内容（这里需要根据具体功能设置相应的内容）
        newPanel.webview.html = this.getWebviewContent(viewType);
    }

    /**
     * 设置消息监听器
     * @param panel Webview面板
     * @param viewType Webview类型
     */
    private setupMessageListener(panel: vscode.WebviewPanel, viewType: string): void {
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (viewType) {
                case 'yonbip-nchome':
                    if (this.ncHomeConfigProvider) {
                        // 创建一个模拟的WebviewView对象来处理消息
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => {} }),
                            onDidChangeVisibility: () => ({ dispose: () => {} }),
                            show: () => {},
                            viewType: 'yonbip-nchome'
                        } as unknown as vscode.WebviewView;
                        
                        // 临时设置_provider的_view属性来处理消息
                        (this.ncHomeConfigProvider as any)._view = mockWebviewView;
                        
                        // 处理消息
                        switch (message.type) {
                            case 'selectHomeDirectory':
                                await this.ncHomeConfigProvider['handleSelectHomeDirectory']();
                                break;
                            case 'openHomeDirectory':
                                await this.ncHomeConfigProvider['handleOpenHomeDirectory']();
                                break;
                            case 'openSysConfig':
                                await this.ncHomeConfigProvider['handleOpenSysConfig']();
                                break;
                            case 'viewLogs':
                                await this.ncHomeConfigProvider['handleViewLogs']();
                                break;
                            case 'openLogsDirectory':
                                await this.ncHomeConfigProvider['handleOpenLogsDirectory']();
                                break;
                            case 'debugHomeService':
                                await this.ncHomeConfigProvider['handleDebugHomeService']();
                                break;
                            case 'stopHomeService':
                                await this.ncHomeConfigProvider['handleStopHomeService']();
                                break;
                            case 'convertToMacHome':
                                await this.ncHomeConfigProvider['handleConvertToMacHome']();
                                break;
                            case 'testConnection':
                                await this.ncHomeConfigProvider['handleTestConnection'](message.dataSource);
                                break;
                            case 'addDataSource':
                                await this.ncHomeConfigProvider['handleAddDataSource'](message.dataSource);
                                break;
                            case 'updateDataSource':
                                await this.ncHomeConfigProvider['handleUpdateDataSource'](message.dataSource);
                                break;
                            case 'deleteDataSource':
                                await this.ncHomeConfigProvider['handleDeleteDataSource'](message.dataSourceName);
                                break;
                            case 'requestDeleteConfirmation':
                                await this.ncHomeConfigProvider['handleDeleteConfirmationRequest'](message.dataSourceName);
                                break;
                            case 'setDesignDatabase':
                                await this.ncHomeConfigProvider['handleSetDesignDatabase'](message.dataSourceName);
                                break;
                            case 'setBaseDatabase':
                                await this.ncHomeConfigProvider['handleSetBaseDatabase'](message.dataSourceName);
                                break;
                            case 'checkSystemConfig':
                                await this.ncHomeConfigProvider['handleCheckSystemConfig']();
                                break;
                            case 'confirmResetDefaults':
                                await this.ncHomeConfigProvider['handleConfirmResetDefaults']();
                                break;
                            case 'saveModuleConfig':
                                await this.ncHomeConfigProvider['handleSaveModuleConfig'](message.modules);
                                break;
                            case 'loadConfig':
                                await this.ncHomeConfigProvider['handleLoadConfig']();
                                break;
                            case 'saveConfig':
                                await this.ncHomeConfigProvider['handleSaveConfig'](message.config);
                                break;
                        }
                    }
                    break;
                case 'yonbip.patchExportConfig':
                    if (this.patchExportProvider) {
                        // 创建一个模拟的WebviewView对象来处理消息
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => {} }),
                            onDidChangeVisibility: () => ({ dispose: () => {} }),
                            show: () => {},
                            viewType: 'yonbip.patchExportConfig'
                        } as unknown as vscode.WebviewView;
                        
                        // 临时设置_provider的_view属性来处理消息
                        (this.patchExportProvider as any)._view = mockWebviewView;
                        
                        // 处理消息
                        switch (message.type) {
                            case 'exportPatch':
                                this.patchExportProvider['_handleExportPatch'](message.data);
                                break;
                            case 'selectOutputPath':
                                this.patchExportProvider['_handleSelectOutputPath']();
                                break;
                            case 'cancel':
                                this.patchExportProvider['_handleCancel']();
                                break;
                            case 'refreshFiles':
                                this.patchExportProvider['_refreshExportableFiles']();
                                break;
                            case 'selectOutputDir':
                                this.patchExportProvider['_handleSelectOutputDir']();
                                break;
                            case 'showMessage':
                                // 同时显示系统通知
                                if (message.level === 'error') {
                                    vscode.window.showErrorMessage(message.message);
                                } else if (message.level === 'success') {
                                    vscode.window.showInformationMessage(message.message);
                                } else {
                                    vscode.window.showInformationMessage(message.message);
                                }
                                break;
                        }
                    }
                    break;
                case 'yonbip-mcp':
                    if (this.mcpProvider) {
                        // 创建一个模拟的WebviewView对象来处理消息
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => {} }),
                            onDidChangeVisibility: () => ({ dispose: () => {} }),
                            show: () => {},
                            viewType: 'yonbip-mcp'
                        } as unknown as vscode.WebviewView;
                        
                        // 临时设置_provider的_view属性来处理消息
                        (this.mcpProvider as any)._view = mockWebviewView;
                        
                        // 处理消息
                        switch (message.type) {
                            case 'loadConfig':
                                await this.mcpProvider['handleLoadConfig']();
                                break;
                            case 'saveConfig':
                                await this.mcpProvider['handleSaveConfig'](message.config);
                                break;
                            case 'resetConfig':
                                await this.mcpProvider['handleResetConfig']();
                                break;
                            case 'startMcp':
                                await this.mcpProvider['handleStart']();
                                break;
                            case 'stopMcp':
                                await this.mcpProvider['handleStop']();
                                break;
                            case 'getStatus':
                                await this.mcpProvider['handleGetStatus']();
                                break;
                            case 'selectJarFile':
                                await this.mcpProvider['handleSelectJarFile']();
                                break;
                            case 'selectJavaPath':
                                await this.mcpProvider['handleSelectJavaPath']();
                                break;
                            case 'showResetConfirm':
                                await this.mcpProvider['handleShowResetConfirm']();
                                break;
                        }
                    }
                    break;
                case 'yonbip-openapi':
                    if (this.openApiProvider) {
                        // 创建一个模拟的WebviewView对象来处理消息
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => {} }),
                            onDidChangeVisibility: () => ({ dispose: () => {} }),
                            show: () => {},
                            viewType: 'yonbip-openapi'
                        } as unknown as vscode.WebviewView;
                        
                        // 临时设置_provider的_view属性来处理消息
                        (this.openApiProvider as any)._view = mockWebviewView;
                        
                        // 处理消息
                        switch (message.type) {
                            case 'sendRequest':
                                await this.openApiProvider['handleSendRequest'](message.request, message.configId);
                                break;
                            case 'saveConfigs':
                                await this.openApiProvider['handleSaveConfigs'](message.configs, message.currentConfigId);
                                break;
                            case 'loadConfigs':
                                await this.openApiProvider['handleLoadConfigs']();
                                break;
                            case 'testConnection':
                                await this.openApiProvider['handleTestConnection'](message.configId);
                                break;
                            case 'addConfig':
                                await this.openApiProvider['handleAddConfig'](message.config);
                                break;
                            case 'updateConfig':
                                await this.openApiProvider['handleUpdateConfig'](message.config);
                                break;
                            case 'deleteConfig':
                                await this.openApiProvider['handleDeleteConfig'](message.configId);
                                break;
                            case 'setCurrentConfig':
                                await this.openApiProvider['handleSetCurrentConfig'](message.configId);
                                break;
                            case 'showError':
                                vscode.window.showErrorMessage(message.message);
                                break;
                            case 'confirmDelete':
                                const deleteConfirmation = await vscode.window.showWarningMessage(message.message, '是', '否');
                                if (deleteConfirmation === '是') {
                                    await this.openApiProvider['handleDeleteConfig'](message.configId);
                                }
                                break;
                        }
                    }
                    break;
                case 'yonbip.precastExportConfig':
                    if (this.precastExportProvider) {
                        // 创建一个模拟的WebviewView对象来处理消息
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => {} }),
                            onDidChangeVisibility: () => ({ dispose: () => {} }),
                            show: () => {},
                            viewType: 'yonbip.precastExportConfig'
                        } as unknown as vscode.WebviewView;
                        
                        // 临时设置_provider的_view属性来处理消息
                        (this.precastExportProvider as any)._view = mockWebviewView;
                        
                        // 处理消息
                        switch (message.type) {
                            case 'selectOutputDir':
                                this.precastExportProvider['_handleSelectOutputDir']();
                                break;
                            case 'exportPrecast':
                                this.precastExportProvider['_handleExportPrecast'](message.data);
                                break;
                            case 'refreshDataSources':
                                this.precastExportProvider['_refreshDataSources']();
                                break;
                            case 'showMessage':
                                if (message.level === 'error') {
                                    vscode.window.showErrorMessage(message.message);
                                } else {
                                    vscode.window.showInformationMessage(message.message);
                                }
                                break;
                            case 'ready':
                                this.precastExportProvider['_refreshDataSources']();
                                this.precastExportProvider['_prefillDefaultOutputDir']();
                                this.precastExportProvider['_checkXmlSelection']();
                                break;
                            case 'checkXmlSelection':
                                this.precastExportProvider['_checkXmlSelection']();
                                break;
                        }
                    }
                    break;
                // 可以为其他viewType添加相应的消息处理逻辑
            }
        });
    }

    /**
     * 获取Webview内容
     * @param viewType Webview类型
     * @returns HTML内容
     */
    private getWebviewContent(viewType: string): string {
        // 根据viewType返回相应的Webview内容
        try {
            switch (viewType) {
                case 'yonbip-mcp':
                    if (this.mcpProvider) {
                        // 创建一个模拟的webview对象来获取HTML内容
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        } as vscode.Webview;
                        return this.mcpProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
                case 'yonbip-nchome':
                    if (this.ncHomeConfigProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        } as vscode.Webview;
                        return this.ncHomeConfigProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
                case 'yonbip-openapi':
                    if (this.openApiProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        } as vscode.Webview;
                        return this.openApiProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
                case 'yonbip.patchExportConfig':
                    if (this.patchExportProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        } as vscode.Webview;
                        return this.patchExportProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
                case 'yonbip.precastExportConfig':
                    if (this.precastExportProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        } as vscode.Webview;
                        return this.precastExportProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
            }
        } catch (error) {
            console.error('获取Webview内容时出错:', error);
        }
        
        // 默认返回简单的HTML
        return `
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${viewType}</title>
            </head>
            <body>
                <h1>${viewType} 功能正在开发中...</h1>
                <p>该功能的完整实现需要集成原有的WebviewProvider逻辑。</p>
            </body>
            </html>
        `;
    }
}