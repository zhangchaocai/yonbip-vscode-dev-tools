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
exports.HomeCommands = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const HomeService_1 = require("./HomeService");
const HomeDebugService_1 = require("./HomeDebugService");
class HomeCommands {
    homeService;
    homeDebugService;
    configService;
    context;
    constructor(context, configService) {
        this.context = context;
        this.configService = configService;
        this.homeService = new HomeService_1.HomeService(context, configService);
        this.homeDebugService = new HomeDebugService_1.HomeDebugService(context, configService, this.homeService);
    }
    static registerCommands(context, configService) {
        const homeCommands = new HomeCommands(context, configService);
        const startCommand = vscode.commands.registerCommand('yonbip.home.start', (uri) => {
            homeCommands.startHomeService(uri?.fsPath);
        });
        const debugCommand = vscode.commands.registerCommand('yonbip.home.debug', (uri) => {
            homeCommands.debugHomeService(uri?.fsPath);
        });
        const stopCommand = vscode.commands.registerCommand('yonbip.home.stop', () => {
            homeCommands.stopHomeService();
        });
        const statusCommand = vscode.commands.registerCommand('yonbip.home.status', () => {
            homeCommands.showStatus();
        });
        const logsCommand = vscode.commands.registerCommand('yonbip.home.logs', () => {
            homeCommands.showLogs();
        });
        const startFromDirectoryCommand = vscode.commands.registerCommand('yonbip.home.startFromDirectory', (uri) => {
            homeCommands.startHomeServiceFromDirectory(uri);
        });
        const startFromToolbarCommand = vscode.commands.registerCommand('yonbip.home.startFromToolbar', (uri) => {
            homeCommands.startHomeServiceFromToolbar(uri);
        });
        const stopFromToolbarCommand = vscode.commands.registerCommand('yonbip.home.stopFromToolbar', () => {
            homeCommands.stopHomeService();
        });
        context.subscriptions.push(startCommand, debugCommand, stopCommand, statusCommand, logsCommand, startFromDirectoryCommand, startFromToolbarCommand, stopFromToolbarCommand);
    }
    async startHomeService(selectedPath) {
        try {
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            await this.homeService.startHomeService(selectedPath);
        }
        catch (error) {
            vscode.window.showErrorMessage(`启动HOME服务失败: ${error.message}`);
        }
    }
    async startHomeServiceFromDirectory(uri) {
        try {
            let selectedPath;
            if (!uri) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择项目目录'
                });
                if (!result || result.length === 0) {
                    return;
                }
                selectedPath = result[0].fsPath;
            }
            else {
                selectedPath = uri.fsPath;
            }
            const markerFilePath = path.join(selectedPath, '.project');
            if (!fs.existsSync(markerFilePath)) {
                vscode.window.showErrorMessage('只有已初始化的YonBIP项目目录才能启动中间件服务。请先使用"🚀 YONBIP 工程初始化"命令初始化项目或者创建YonBIP项目进行启动。');
                return;
            }
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            await this.homeService.startHomeService(selectedPath);
        }
        catch (error) {
            vscode.window.showErrorMessage(`从指定目录启动HOME服务失败: ${error.message}`);
        }
    }
    async startHomeServiceFromToolbar(uri) {
        try {
            let projectDir;
            if (uri) {
                if (path.basename(uri.fsPath) === '.project') {
                    projectDir = path.dirname(uri.fsPath);
                }
                else {
                    projectDir = uri.fsPath;
                }
            }
            else {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    vscode.window.showWarningMessage('请先打开一个工作区文件夹');
                    return;
                }
                const foundProjectDir = this.findFirstProjectDirectory(workspaceFolders[0].uri.fsPath);
                if (!foundProjectDir) {
                    vscode.window.showErrorMessage('未找到.project文件，请先初始化YonBIP项目');
                    return;
                }
                projectDir = foundProjectDir;
            }
            const markerFilePath = path.join(projectDir, '.project');
            if (!fs.existsSync(markerFilePath)) {
                vscode.window.showErrorMessage('只有已初始化的YonBIP项目目录才能启动中间件服务。请先使用"🚀 YONBIP 工程初始化"命令初始化项目或者创建YonBIP项目进行启动。');
                return;
            }
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            await this.homeService.startHomeService(projectDir);
        }
        catch (error) {
            vscode.window.showErrorMessage(`从工具栏启动HOME服务失败: ${error.message}`);
        }
    }
    findFirstProjectDirectory(rootPath) {
        const findProjectFile = (dir) => {
            try {
                const items = fs.readdirSync(dir);
                if (items.includes('.project')) {
                    return dir;
                }
                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stat = fs.statSync(itemPath);
                    if (stat.isDirectory() && !item.startsWith('.')) {
                        const result = findProjectFile(itemPath);
                        if (result) {
                            return result;
                        }
                    }
                }
                return null;
            }
            catch (error) {
                return null;
            }
        };
        return findProjectFile(rootPath);
    }
    async debugHomeService(selectedPath) {
        try {
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            await this.homeDebugService.debugHomeService(selectedPath);
        }
        catch (error) {
            vscode.window.showErrorMessage(`调试启动HOME服务失败: ${error.message}`);
        }
    }
    async stopHomeService() {
        try {
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            await this.homeService.stopHomeService();
        }
        catch (error) {
            vscode.window.showErrorMessage(`停止HOME服务失败: ${error.message}`);
        }
    }
    showStatus() {
        const status = this.homeService.getStatus();
        let statusText = '';
        switch (status) {
            case 'stopped':
                statusText = '已停止';
                break;
            case 'starting':
                statusText = '启动中';
                break;
            case 'running':
                statusText = '运行中';
                break;
            case 'stopping':
                statusText = '停止中';
                break;
            case 'error':
                statusText = '错误';
                break;
            default:
                statusText = '未知';
        }
        vscode.window.showInformationMessage(`NC HOME服务状态: ${statusText}`);
    }
    showLogs() {
        this.homeService.showLogs();
    }
}
exports.HomeCommands = HomeCommands;
//# sourceMappingURL=HomeCommands.js.map