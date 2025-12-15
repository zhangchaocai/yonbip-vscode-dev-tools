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
exports.FunctionTreeProvider = exports.FunctionTreeNode = void 0;
const vscode = __importStar(require("vscode"));
class FunctionTreeNode extends vscode.TreeItem {
    label;
    collapsibleState;
    command;
    children;
    viewType;
    constructor(label, collapsibleState, command, children, viewType, context) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.command = command;
        this.children = children;
        this.viewType = viewType;
        this.tooltip = this.label;
        this.description = '';
        if (context) {
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
                    this.iconPath = {
                        light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'project', 'nccicon.png'),
                        dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'project', 'nccicon.png')
                    };
            }
        }
    }
}
exports.FunctionTreeNode = FunctionTreeNode;
class FunctionTreeDecorationProvider {
    _onDidChangeFileDecorations = new vscode.EventEmitter();
    onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    provideFileDecoration(uri, token) {
        return undefined;
    }
}
class FunctionTreeProvider {
    context;
    mcpProvider;
    ncHomeConfigProvider;
    openApiProvider;
    patchExportProvider;
    precastExportProvider;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    webviewPanels = new Map();
    decorationProvider;
    constructor(context, mcpProvider, ncHomeConfigProvider, openApiProvider, patchExportProvider, precastExportProvider) {
        this.context = context;
        this.mcpProvider = mcpProvider;
        this.ncHomeConfigProvider = ncHomeConfigProvider;
        this.openApiProvider = openApiProvider;
        this.patchExportProvider = patchExportProvider;
        this.precastExportProvider = precastExportProvider;
        this.decorationProvider = new FunctionTreeDecorationProvider();
        context.subscriptions.push(vscode.window.registerFileDecorationProvider(this.decorationProvider));
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        if (element.viewType) {
            switch (element.viewType) {
                case 'yonbip-mcp':
                    element.description = '服务';
                    element.iconPath = {
                        light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'mcp-icon.svg'),
                        dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'mcp-icon.svg')
                    };
                    element.contextValue = 'mcp-service';
                    break;
                case 'yonbip-nchome':
                    element.description = '配置';
                    element.iconPath = {
                        light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'nchome-icon.svg'),
                        dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'nchome-icon.svg')
                    };
                    element.contextValue = 'home-config';
                    break;
                case 'yonbip-openapi':
                    element.description = '测试';
                    element.iconPath = {
                        light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'openapi-icon.svg'),
                        dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'openapi-icon.svg')
                    };
                    element.contextValue = 'openapi-test';
                    break;
                case 'yonbip.patchExportConfig':
                    element.description = '导出';
                    element.iconPath = {
                        light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'patch-icon.svg'),
                        dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'patch-icon.svg')
                    };
                    element.contextValue = 'patch-export';
                    break;
                case 'yonbip.precastExportConfig':
                    element.description = '脚本';
                    element.iconPath = {
                        light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'sql-icon.svg'),
                        dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'views', 'sql-icon.svg')
                    };
                    element.contextValue = 'precast-export';
                    break;
            }
        }
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve(element.children || []);
        }
        else {
            const serviceGroup = new FunctionTreeNode('服务管理', vscode.TreeItemCollapsibleState.Expanded, undefined, [
                new FunctionTreeNode('MCP服务', vscode.TreeItemCollapsibleState.None, {
                    command: 'yonbip.function.showMcp',
                    title: '显示MCP服务',
                    arguments: []
                }, undefined, 'yonbip-mcp', this.context),
                new FunctionTreeNode('HOME配置', vscode.TreeItemCollapsibleState.None, {
                    command: 'yonbip.function.showHomeConfig',
                    title: '显示HOME配置',
                    arguments: []
                }, undefined, 'yonbip-nchome', this.context)
            ], undefined, this.context);
            const developmentGroup = new FunctionTreeNode('开发工具', vscode.TreeItemCollapsibleState.Expanded, undefined, [
                new FunctionTreeNode('OpenAPI测试', vscode.TreeItemCollapsibleState.None, {
                    command: 'yonbip.function.showOpenApi',
                    title: '显示OpenAPI测试',
                    arguments: []
                }, undefined, 'yonbip-openapi', this.context),
                new FunctionTreeNode('补丁导出配置', vscode.TreeItemCollapsibleState.None, {
                    command: 'yonbip.function.showPatchExport',
                    title: '显示补丁导出配置',
                    arguments: []
                }, undefined, 'yonbip.patchExportConfig', this.context),
                new FunctionTreeNode('预置脚本导出', vscode.TreeItemCollapsibleState.None, {
                    command: 'yonbip.function.showPrecastExport',
                    title: '显示预置脚本导出',
                    arguments: []
                }, undefined, 'yonbip.precastExportConfig', this.context)
            ], undefined, this.context);
            return Promise.resolve([serviceGroup, developmentGroup]);
        }
    }
    createOrShowWebview(viewType, title) {
        const panel = this.webviewPanels.get(viewType);
        if (panel) {
            panel.reveal(vscode.ViewColumn.One);
            return;
        }
        const newPanel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [this.context.extensionUri]
        });
        newPanel.onDidDispose(() => {
            this.webviewPanels.delete(viewType);
        });
        this.webviewPanels.set(viewType, newPanel);
        newPanel.webview.html = this.getWebviewContent(viewType);
        this.setupMessageListener(newPanel, viewType);
        setTimeout(() => {
            newPanel.webview.postMessage({ type: 'ready' });
        }, 1000);
    }
    setupMessageListener(panel, viewType) {
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (viewType) {
                case 'yonbip-nchome':
                    if (this.ncHomeConfigProvider) {
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => { } }),
                            onDidChangeVisibility: () => ({ dispose: () => { } }),
                            show: () => { },
                            viewType: 'yonbip-nchome'
                        };
                        this.ncHomeConfigProvider._view = mockWebviewView;
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
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => { } }),
                            onDidChangeVisibility: () => ({ dispose: () => { } }),
                            show: () => { },
                            viewType: 'yonbip.patchExportConfig'
                        };
                        this.patchExportProvider._view = mockWebviewView;
                        switch (message.type) {
                            case 'exportPatch':
                                this.patchExportProvider['_handleExportPatch'](message.data);
                                break;
                            case 'selectOutputPath':
                                this.patchExportProvider['_handleSelectOutputPath']();
                                break;
                            case 'refreshFiles':
                                this.patchExportProvider['_refreshExportableFiles']();
                                break;
                            case 'selectOutputDir':
                                this.patchExportProvider['_handleSelectOutputDir']();
                                break;
                            case 'showMessage':
                                if (message.level === 'error') {
                                    vscode.window.showErrorMessage(message.message);
                                }
                                else if (message.level === 'success') {
                                    vscode.window.showInformationMessage(message.message);
                                }
                                else {
                                    vscode.window.showInformationMessage(message.message);
                                }
                                break;
                        }
                    }
                    break;
                case 'yonbip-mcp':
                    if (this.mcpProvider) {
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => { } }),
                            onDidChangeVisibility: () => ({ dispose: () => { } }),
                            show: () => { },
                            viewType: 'yonbip-mcp'
                        };
                        this.mcpProvider._view = mockWebviewView;
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
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => { } }),
                            onDidChangeVisibility: () => ({ dispose: () => { } }),
                            show: () => { },
                            viewType: 'yonbip-openapi'
                        };
                        this.openApiProvider._view = mockWebviewView;
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
                        const mockWebviewView = {
                            webview: panel.webview,
                            visible: true,
                            onDidDispose: () => ({ dispose: () => { } }),
                            onDidChangeVisibility: () => ({ dispose: () => { } }),
                            show: () => { },
                            viewType: 'yonbip.precastExportConfig'
                        };
                        this.precastExportProvider._view = mockWebviewView;
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
                                }
                                else {
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
            }
        });
    }
    getWebviewContent(viewType) {
        try {
            switch (viewType) {
                case 'yonbip-mcp':
                    if (this.mcpProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        };
                        return this.mcpProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
                case 'yonbip-nchome':
                    if (this.ncHomeConfigProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        };
                        return this.ncHomeConfigProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
                case 'yonbip-openapi':
                    if (this.openApiProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        };
                        return this.openApiProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
                case 'yonbip.patchExportConfig':
                    if (this.patchExportProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        };
                        return this.patchExportProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
                case 'yonbip.precastExportConfig':
                    if (this.precastExportProvider) {
                        const mockWebview = {
                            cspSource: '',
                            options: {}
                        };
                        return this.precastExportProvider.getHtmlForWebview(mockWebview);
                    }
                    break;
            }
        }
        catch (error) {
            console.error('获取Webview内容时出错:', error);
        }
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
exports.FunctionTreeProvider = FunctionTreeProvider;
//# sourceMappingURL=FunctionTreeProvider.js.map