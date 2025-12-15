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
exports.NCHomeConfigCommands = void 0;
const vscode = __importStar(require("vscode"));
const NCHomeConfigService_1 = require("./NCHomeConfigService");
const NCHomeConfigProvider_1 = require("./NCHomeConfigProvider");
const MacHomeConversionService_1 = require("../../mac/MacHomeConversionService");
class NCHomeConfigCommands {
    service;
    webviewProvider;
    macHomeConversionService;
    constructor(context, macHomeConversionService) {
        this.service = new NCHomeConfigService_1.NCHomeConfigService(context);
        this.webviewProvider = new NCHomeConfigProvider_1.NCHomeConfigProvider(context.extensionUri, context);
        this.macHomeConversionService = macHomeConversionService || new MacHomeConversionService_1.MacHomeConversionService(this.service);
        this.registerCommands(context);
    }
    registerCommands(context) {
        const configCommand = vscode.commands.registerCommand('yonbip.nchome.config', async () => {
            await this.openConfigWebview();
        });
        const selectHomeCommand = vscode.commands.registerCommand('yonbip.nchome.selectHome', async () => {
            await this.selectHomeDirectory();
        });
        const openHomeCommand = vscode.commands.registerCommand('yonbip.nchome.openHome', async () => {
            const config = this.service.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            await this.service.openHomeDirectory();
        });
        const openSysConfigCommand = vscode.commands.registerCommand('yonbip.nchome.openSysConfig', async () => {
            const config = this.service.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            await this.service.openSysConfig();
        });
        const showOutputCommand = vscode.commands.registerCommand('yonbip.nchome.showOutput', () => {
            this.service.showOutput();
        });
        const testConnectionCommand = vscode.commands.registerCommand('yonbip.nchome.testConnection', async () => {
            await this.testCurrentConnection();
        });
        context.subscriptions.push(configCommand, selectHomeCommand, openHomeCommand, openSysConfigCommand, showOutputCommand, testConnectionCommand, this.service);
    }
    async openConfigWebview() {
        try {
            await vscode.commands.executeCommand('workbench.view.extension.yonbip-tools');
        }
        catch (error) {
            vscode.window.showErrorMessage(`打开NC Home配置失败: ${error.message}`);
        }
    }
    async selectHomeDirectory() {
        try {
            const homePath = await this.service.selectHomeDirectory();
            if (homePath) {
                const config = this.service.getConfig();
                config.homePath = homePath;
                await this.service.saveConfig(config);
                vscode.window.showInformationMessage(`NC Home路径已设置: ${homePath}`);
                if (process.platform === 'darwin') {
                    const convert = await vscode.window.showInformationMessage('检测到您使用的是Mac系统，是否需要自动执行Mac HOME转换？', '是', '否');
                    if (convert === '是') {
                        await this.macHomeConversionService.convertToMacHome(homePath);
                    }
                }
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`选择Home目录失败: ${error.message}`);
        }
    }
    async showSimpleConfigDialog() {
        const config = this.service.getConfig();
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = 'NC Home 配置';
        quickPick.items = [
            {
                label: '$(home) 设置 Home 目录',
                description: config.homePath || '未设置',
                detail: '选择YonBIP NC Home安装目录'
            },
            {
                label: '$(folder-opened) 打开Home目录',
                description: '在文件管理器中打开',
                detail: '打开当前配置的Home目录'
            },
            {
                label: '$(tools) 打开SysConfig',
                description: '启动系统配置工具',
                detail: '运行 NC 系统配置程序'
            },
            {
                label: '$(database) 数据源配置',
                description: '配置数据库连接',
                detail: '管理数据库连接和配置'
            },
            {
                label: '$(gear) 高级设置',
                description: '更多配置选项',
                detail: '插件配置、补丁设置等'
            }
        ];
        quickPick.onDidChangeSelection(async (selection) => {
            if (selection.length > 0) {
                const selected = selection[0];
                quickPick.hide();
                try {
                    switch (selected.label) {
                        case '$(home) 设置 Home 目录':
                            await this.selectHomeDirectory();
                            break;
                        case '$(folder-opened) 打开Home目录':
                            await this.service.openHomeDirectory();
                            break;
                        case '$(tools) 打开SysConfig':
                            await this.service.openSysConfig();
                            break;
                        case '$(database) 数据源配置':
                            await this.showDataSourceConfig();
                            break;
                            break;
                    }
                }
                catch (error) {
                    vscode.window.showErrorMessage(`操作失败: ${error.message}`);
                }
            }
        });
        quickPick.show();
    }
    async showDataSourceConfig() {
        vscode.window.showInformationMessage('数据源配置功能正在开发中，敬请期待！');
    }
    async testCurrentConnection() {
        try {
            const config = this.service.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            if (!config.dataSources || config.dataSources.length === 0) {
                vscode.window.showWarningMessage('请先配置数据源');
                return;
            }
            let dataSource = config.dataSources[0];
            if (config.selectedDataSource) {
                const selected = config.dataSources.find(ds => ds.name === config.selectedDataSource);
                if (selected) {
                    dataSource = selected;
                }
            }
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `测试数据库连接: ${dataSource.name}`,
                cancellable: false
            }, async () => {
                const result = await this.service.testConnection(dataSource);
                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                }
                else {
                    vscode.window.showErrorMessage(result.message);
                }
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`测试连接失败: ${error.message}`);
        }
    }
    getService() {
        return this.service;
    }
    getWebviewProvider() {
        return this.webviewProvider;
    }
}
exports.NCHomeConfigCommands = NCHomeConfigCommands;
//# sourceMappingURL=NCHomeConfigCommands.js.map