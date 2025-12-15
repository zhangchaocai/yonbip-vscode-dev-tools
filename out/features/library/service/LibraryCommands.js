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
exports.LibraryCommands = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LibraryService_1 = require("./LibraryService");
class LibraryCommands {
    static registerCommands(context, configService) {
        const libraryService = new LibraryService_1.LibraryService(context, configService);
        const initLibraryCommand = vscode.commands.registerCommand('yonbip.library.init', async () => {
            await this.handleInitLibrary(libraryService, configService);
        });
        const reinitLibraryCommand = vscode.commands.registerCommand('yonbip.library.reinit', async () => {
            await this.handleReinitLibrary(libraryService, configService);
        });
        const checkLibraryCommand = vscode.commands.registerCommand('yonbip.library.check', async () => {
            await this.handleCheckLibrary(libraryService);
        });
        const debugConfigCommand = vscode.commands.registerCommand('yonbip.library.debugConfig', async () => {
            const config = vscode.workspace.getConfiguration('yonbip');
            const homePath = config.get('homePath');
            console.log('=== 配置调试信息 ===');
            console.log('yonbip.homePath:', homePath);
            console.log('所有yonbip配置:', config);
            const inspect = config.inspect('homePath');
            console.log('homePath配置详情:', inspect);
            let message = `当前HOME路径: ${homePath || '未设置'}\n`;
            if (inspect) {
                message += `全局: ${inspect.globalValue || '未设置'}\n`;
                message += `工作区: ${inspect.workspaceValue || '未设置'}\n`;
                message += `工作区文件夹: ${inspect.workspaceFolderValue || '未设置'}`;
            }
            vscode.window.showInformationMessage(message);
        });
        context.subscriptions.push(initLibraryCommand, reinitLibraryCommand, checkLibraryCommand, debugConfigCommand);
    }
    static async handleInitLibrary(libraryService, configService) {
        try {
            configService.reloadConfig();
            const config = configService.getConfig();
            let homePath = config.homePath;
            if (!homePath) {
                const result = await vscode.window.showInformationMessage('未配置HOME路径，是否现在配置？', '是', '否');
                if (result !== '是') {
                    return;
                }
                await vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                return;
            }
            const needDbLibrary = await vscode.window.showQuickPick(['是', '否'], {
                placeHolder: '是否需要包含数据库驱动库？'
            }) === '是';
            let driverLibPath;
            if (needDbLibrary) {
                driverLibPath = await this.selectDriverLibPath();
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                await libraryService.initLibrary(homePath, needDbLibrary, driverLibPath);
            });
            vscode.window.showInformationMessage('Java项目库初始化完成！');
        }
        catch (error) {
            vscode.window.showErrorMessage(`初始化库失败: ${error.message}`);
        }
    }
    static async handleReinitLibrary(libraryService, configService) {
        try {
            configService.reloadConfig();
            const config = configService.getConfig();
            const homePath = config.homePath;
            if (!homePath) {
                vscode.window.showWarningMessage('请先配置HOME路径');
                return;
            }
            const confirm = await vscode.window.showWarningMessage('重新初始化将覆盖现有库配置，是否继续？', '继续', '取消');
            if (confirm !== '继续') {
                return;
            }
            let selectedPath;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                selectedPath = workspaceFolder.uri.fsPath;
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在重新初始化Java项目库...',
                cancellable: false
            }, async () => {
                await libraryService.initLibrary(homePath, false, undefined, selectedPath);
            });
            vscode.window.showInformationMessage('Java项目库重新初始化完成！');
        }
        catch (error) {
            vscode.window.showErrorMessage(`重新初始化库失败: ${error.message}`);
        }
    }
    static async handleCheckLibrary(libraryService) {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showWarningMessage('未找到工作区文件夹');
                return;
            }
            const config = vscode.workspace.getConfiguration('yonbip');
            const homePath = config.get('homePath');
            if (!homePath) {
                vscode.window.showWarningMessage('请先配置NC HOME路径');
                return;
            }
            const libDir = path.join(workspaceFolder.uri.fsPath, '.lib');
            if (!fs.existsSync(libDir)) {
                vscode.window.showInformationMessage('库尚未初始化');
                return;
            }
            const files = fs.readdirSync(libDir).filter(file => file.endsWith('.json'));
            if (files.length === 0) {
                vscode.window.showInformationMessage('库配置为空');
                return;
            }
            const message = `已初始化 ${files.length} 个库配置`;
            vscode.window.showInformationMessage(message);
        }
        catch (error) {
            vscode.window.showErrorMessage(`检查库状态失败: ${error.message}`);
        }
    }
    static async selectDriverLibPath() {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: '选择数据库驱动JAR文件',
            filters: {
                'JAR文件': ['jar']
            }
        });
        if (result && result.length > 0) {
            return result.map(uri => uri.fsPath).join(',');
        }
        return undefined;
    }
}
exports.LibraryCommands = LibraryCommands;
//# sourceMappingURL=LibraryCommands.js.map