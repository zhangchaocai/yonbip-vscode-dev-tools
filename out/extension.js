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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const McpCommands_1 = require("./mcp/McpCommands");
const McpProvider_1 = require("./mcp/McpProvider");
const ProjectProvider_1 = require("./project/project-management/ProjectProvider");
const NCHomeConfigProvider_1 = require("./project/nc-home/config/NCHomeConfigProvider");
const PatchExportWebviewProvider_1 = require("./project/ui/PatchExportWebviewProvider");
const PrecastExportWebviewProvider_1 = require("./project/ui/PrecastExportWebviewProvider");
const OpenApiProvider_1 = require("./openapi/OpenApiProvider");
const NCHomeConfigService_1 = require("./project/nc-home/config/NCHomeConfigService");
const HomeCommands_1 = require("./project/nc-home/HomeCommands");
const NCHomeConfigCommands_1 = require("./project/nc-home/config/NCHomeConfigCommands");
const LibraryCommands_1 = require("./project/library/LibraryCommands");
const ProjectContextCommands_1 = require("./project/project-management/ProjectContextCommands");
const ProjectCommands_1 = require("./project/project-management/ProjectCommands");
const ProjectService_1 = require("./project/project-management/ProjectService");
const McpService_1 = require("./mcp/McpService");
const MacHomeConversionService_1 = require("./project/mac/MacHomeConversionService");
const PasswordEncryptor_1 = require("./utils/PasswordEncryptor");
const FunctionTreeProvider_1 = require("./project/ui/FunctionTreeProvider");
const ServiceDirectoryScanner_1 = require("./utils/ServiceDirectoryScanner");
const ServiceStateManager_1 = require("./utils/ServiceStateManager");
const ExtensionVersionService_1 = require("./utils/ExtensionVersionService");
const IconThemeUpdater_1 = require("./utils/IconThemeUpdater");
let ncHomeConfigService;
let projectService;
let mcpService;
let libraryService;
let homeService;
let macHomeConversionService;
async function activate(context) {
    await IconThemeUpdater_1.IconThemeUpdater.initialize(context);
    vscode.window.showInformationMessage('🚀 YonBIP高级版开发者工具加载成功', '了解更多')
        .then(selection => {
        if (selection === '了解更多') {
            vscode.env.openExternal(vscode.Uri.parse('https://community.yonyou.com/article/detail/10786'));
        }
    });
    ExtensionVersionService_1.ExtensionVersionService.initialize(context);
    setTimeout(async () => {
        try {
            const updateInfo = await ExtensionVersionService_1.ExtensionVersionService.checkForUpdates();
            if (updateInfo) {
                await ExtensionVersionService_1.ExtensionVersionService.showUpdateNotification(updateInfo.latestVersion, updateInfo.releaseNotes);
            }
            await ExtensionVersionService_1.ExtensionVersionService.suggestUninstallOldVersions();
        }
        catch (error) {
            console.error('检查更新失败:', error);
        }
    }, 5000);
    PasswordEncryptor_1.PasswordEncryptor.setExtensionPath(context.extensionPath);
    ProjectContextCommands_1.ProjectContextCommands.setExtensionContext(context);
    mcpService = new McpService_1.McpService(context);
    const mcpCommands = McpCommands_1.McpCommands.registerCommands(context, mcpService);
    const mcpProvider = new McpProvider_1.McpProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(McpProvider_1.McpProvider.viewType, mcpProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    }));
    const projectProvider = new ProjectProvider_1.ProjectProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(ProjectProvider_1.ProjectProvider.viewType, projectProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    }));
    ncHomeConfigService = new NCHomeConfigService_1.NCHomeConfigService(context);
    macHomeConversionService = new MacHomeConversionService_1.MacHomeConversionService(ncHomeConfigService);
    const ncHomeConfigCommands = new NCHomeConfigCommands_1.NCHomeConfigCommands(context, macHomeConversionService);
    HomeCommands_1.HomeCommands.registerCommands(context, ncHomeConfigService);
    vscode.commands.executeCommand('setContext', 'yonbip.home.stop.enabled', false);
    LibraryCommands_1.LibraryCommands.registerCommands(context, ncHomeConfigService);
    ProjectContextCommands_1.ProjectContextCommands.registerCommands(context, ncHomeConfigService);
    projectService = new ProjectService_1.ProjectService(context);
    ProjectCommands_1.ProjectCommands.registerCommands(context, projectService, ncHomeConfigService);
    const ncHomeConfigProvider = new NCHomeConfigProvider_1.NCHomeConfigProvider(context.extensionUri, context, macHomeConversionService);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(NCHomeConfigProvider_1.NCHomeConfigProvider.viewType, ncHomeConfigProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    }));
    const openApiProvider = new OpenApiProvider_1.OpenApiProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(OpenApiProvider_1.OpenApiProvider.viewType, openApiProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    }));
    const patchExportProvider = new PatchExportWebviewProvider_1.PatchExportWebviewProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(PatchExportWebviewProvider_1.PatchExportWebviewProvider.viewType, patchExportProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    }));
    const precastExportProvider = new PrecastExportWebviewProvider_1.PrecastExportWebviewProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(PrecastExportWebviewProvider_1.PrecastExportWebviewProvider.viewType, precastExportProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    }));
    const functionTreeProvider = new FunctionTreeProvider_1.FunctionTreeProvider(context, mcpProvider, ncHomeConfigProvider, openApiProvider, patchExportProvider, precastExportProvider);
    context.subscriptions.push(vscode.window.registerTreeDataProvider('yonbip-function-tree', functionTreeProvider));
    context.subscriptions.push(vscode.commands.registerCommand('yonbip.function.showMcp', () => {
        functionTreeProvider.createOrShowWebview('yonbip-mcp', 'MCP服务');
    }), vscode.commands.registerCommand('yonbip.function.showHomeConfig', () => {
        functionTreeProvider.createOrShowWebview('yonbip-nchome', 'HOME配置');
    }), vscode.commands.registerCommand('yonbip.function.showOpenApi', () => {
        functionTreeProvider.createOrShowWebview('yonbip-openapi', 'OpenAPI测试');
    }), vscode.commands.registerCommand('yonbip.function.showPatchExport', () => {
        functionTreeProvider.createOrShowWebview('yonbip.patchExportConfig', '补丁导出配置');
    }), vscode.commands.registerCommand('yonbip.function.showPrecastExport', () => {
        functionTreeProvider.createOrShowWebview('yonbip.precastExportConfig', '预置脚本导出');
    }), vscode.commands.registerCommand('yonbip.patchExportConfig.focus', () => {
        functionTreeProvider.createOrShowWebview('yonbip.patchExportConfig', '补丁导出配置');
    }), vscode.commands.registerCommand('yonbip.precastExportConfig.focus', () => {
        functionTreeProvider.createOrShowWebview('yonbip.precastExportConfig', '预置脚本导出');
    }), vscode.commands.registerCommand('yonbip.terminal.menu', () => {
    }), vscode.commands.registerCommand('yonbip.terminal.selectServiceDirectory', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '🔍 扫描YonBIP服务目录',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 0, message: '开始扫描工作区...' });
                await new Promise(resolve => setTimeout(resolve, 200));
                const serviceDirectories = await ServiceDirectoryScanner_1.ServiceDirectoryScanner.scanServiceDirectories((scanProgress) => {
                    progress.report(scanProgress);
                });
                if (serviceDirectories.length === 0) {
                    progress.report({ increment: 100, message: '扫描完成，未找到服务目录' });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    vscode.window.showInformationMessage('未找到可启动的服务目录。请确保工作区中包含带有.project和.classpath文件的YonBIP项目目录。');
                    return;
                }
                progress.report({ increment: 90, message: `找到 ${serviceDirectories.length} 个服务目录` });
                await new Promise(resolve => setTimeout(resolve, 200));
                const quickPickItems = serviceDirectories.map(dir => ({
                    label: ServiceDirectoryScanner_1.ServiceDirectoryScanner.getDirectoryDisplayName(dir),
                    description: dir,
                    detail: '包含.project和.classpath文件的服务目录',
                    dirPath: dir
                }));
                progress.report({ increment: 100, message: '准备选择界面...' });
                await new Promise(resolve => setTimeout(resolve, 200));
                const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: '选择要启动的服务目录',
                    canPickMany: false
                });
                if (selectedItem) {
                    await ServiceStateManager_1.ServiceStateManager.saveSelectedServiceDirectory(selectedItem.dirPath);
                    vscode.window.showInformationMessage(`✅ 已选择服务目录: ${selectedItem.label}`);
                }
            }
            catch (error) {
                console.error('选择服务目录时出错:', error);
                vscode.window.showErrorMessage(`选择服务目录时出错: ${error.message || '未知错误'}`);
            }
        });
    }));
    setTimeout(() => {
        vscode.commands.executeCommand('yonbip.function.showHomeConfig');
    }, 1000);
}
function deactivate() {
    console.log('YonBIP高级版开发者工具已停用');
    if (ncHomeConfigService) {
        ncHomeConfigService.dispose();
    }
    if (projectService) {
        projectService.dispose();
    }
    if (mcpService) {
        mcpService.dispose();
    }
    if (libraryService) {
        libraryService.dispose();
    }
    if (homeService) {
        homeService.dispose();
    }
    if (macHomeConversionService) {
        macHomeConversionService.dispose();
    }
}
//# sourceMappingURL=extension.js.map