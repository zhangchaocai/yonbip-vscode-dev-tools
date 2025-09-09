import * as vscode from 'vscode';
import { NCHomeConfigService } from './NCHomeConfigService';
import { NCHomeConfigProvider } from './NCHomeConfigProvider';

/**
 * NC Home配置命令处理器
 */
export class NCHomeConfigCommands {
    private service: NCHomeConfigService;
    private webviewProvider: NCHomeConfigProvider;

    constructor(context: vscode.ExtensionContext) {
        this.service = new NCHomeConfigService(context);
        this.webviewProvider = new NCHomeConfigProvider(context.extensionUri, context);
        
        this.registerCommands(context);
    }

    /**
     * 注册命令
     */
    private registerCommands(context: vscode.ExtensionContext): void {
        // 主要的NC Home配置命令
        const configCommand = vscode.commands.registerCommand('yonbip.nchome.config', async () => {
            await this.openConfigWebview();
        });

        // 快捷命令
        const selectHomeCommand = vscode.commands.registerCommand('yonbip.nchome.selectHome', async () => {
            await this.selectHomeDirectory();
        });

        const openHomeCommand = vscode.commands.registerCommand('yonbip.nchome.openHome', async () => {
            await this.service.openHomeDirectory();
        });

        const openSysConfigCommand = vscode.commands.registerCommand('yonbip.nchome.openSysConfig', async () => {
            await this.service.openSysConfig();
        });

        const showOutputCommand = vscode.commands.registerCommand('yonbip.nchome.showOutput', () => {
            this.service.showOutput();
        });

        // 数据源相关命令
        const testConnectionCommand = vscode.commands.registerCommand('yonbip.nchome.testConnection', async () => {
            await this.testCurrentConnection();
        });

        context.subscriptions.push(
            configCommand,
            selectHomeCommand,
            openHomeCommand,
            openSysConfigCommand,
            showOutputCommand,
            testConnectionCommand,
            this.service
        );
    }

    /**
     * 打开配置界面
     */
    public async openConfigWebview(): Promise<void> {
        try {
            // 显示NC Home配置面板
            await vscode.commands.executeCommand('workbench.view.extension.yonbip-tools');
        } catch (error: any) {
            vscode.window.showErrorMessage(`打开NC Home配置失败: ${error.message}`);
        }
    }

    /**
     * 选择Home目录
     */
    private async selectHomeDirectory(): Promise<void> {
        try {
            const homePath = await this.service.selectHomeDirectory();
            if (homePath) {
                const config = this.service.getConfig();
                config.homePath = homePath;
                await this.service.saveConfig(config);
                
                vscode.window.showInformationMessage(`NC Home路径已设置: ${homePath}`);
                
                // 如果配置界面已打开，刷新显示
                // this.webviewProvider.refresh();
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`选择Home目录失败: ${error.message}`);
        }
    }

    /**
     * 显示简单的配置对话框
     */
    private async showSimpleConfigDialog(): Promise<void> {
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
                        case '$(gear) 高级设置':
                            await this.showAdvancedSettings();
                            break;
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`操作失败: ${error.message}`);
                }
            }
        });

        quickPick.show();
    }

    /**
     * 显示数据源配置
     */
    private async showDataSourceConfig(): Promise<void> {
        vscode.window.showInformationMessage('数据源配置功能正在开发中，敬请期待！');
    }

    /**
     * 显示高级设置
     */
    private async showAdvancedSettings(): Promise<void> {
        const config = this.service.getConfig();
        
        const setting = await vscode.window.showQuickPick([
            {
                label: '$(folder) 补丁输出目录',
                description: config.exportPatchPath || './patches',
                detail: '设置补丁包的输出目录'
            },
            {
                label: '$(check) 标准模式',
                description: config.standardMode ? '已启用' : '已禁用',
                detail: '是否使用标准模式'
            },
            {
                label: '$(sync) 异步任务',
                description: config.asyncTask ? '已启用' : '已禁用',
                detail: '是否使用异步任务处理'
            }
        ], {
            placeHolder: '选择要配置的项目'
        });

        if (setting) {
            switch (setting.label) {
                case '$(folder) 补丁输出目录':
                    await this.configurePatchOutputDir();
                    break;
                case '$(check) 标准模式':
                    await this.toggleStandardMode();
                    break;
                case '$(sync) 异步任务':
                    await this.toggleAsyncTask();
                    break;
            }
        }
    }

    /**
     * 配置补丁输出目录
     */
    private async configurePatchOutputDir(): Promise<void> {
        const config = this.service.getConfig();
        const newPath = await vscode.window.showInputBox({
            prompt: '请输入补丁输出目录',
            value: config.exportPatchPath || './patches',
            validateInput: (value) => {
                if (!value.trim()) {
                    return '路径不能为空';
                }
                return null;
            }
        });

        if (newPath) {
            config.exportPatchPath = newPath;
            await this.service.saveConfig(config);
            vscode.window.showInformationMessage(`补丁输出目录已设置为: ${newPath}`);
        }
    }

    /**
     * 切换标准模式
     */
    private async toggleStandardMode(): Promise<void> {
        const config = this.service.getConfig();
        config.standardMode = !config.standardMode;
        await this.service.saveConfig(config);
        vscode.window.showInformationMessage(`标准模式已${config.standardMode ? '启用' : '禁用'}`);
    }

    /**
     * 切换异步任务
     */
    private async toggleAsyncTask(): Promise<void> {
        const config = this.service.getConfig();
        config.asyncTask = !config.asyncTask;
        await this.service.saveConfig(config);
        vscode.window.showInformationMessage(`异步任务已${config.asyncTask ? '启用' : '禁用'}`);
    }

    /**
     * 测试当前数据源连接
     */
    private async testCurrentConnection(): Promise<void> {
        try {
            const config = this.service.getConfig();
            
            if (!config.dataSources || config.dataSources.length === 0) {
                vscode.window.showWarningMessage('请先配置数据源');
                return;
            }

            let dataSource = config.dataSources[0];
            
            // 如果有选中的数据源，使用选中的
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
                } else {
                    vscode.window.showErrorMessage(result.message);
                }
            });

        } catch (error: any) {
            vscode.window.showErrorMessage(`测试连接失败: ${error.message}`);
        }
    }

    /**
     * 获取服务实例
     */
    public getService(): NCHomeConfigService {
        return this.service;
    }

    /**
     * 获取Webview提供者
     */
    public getWebviewProvider(): NCHomeConfigProvider {
        return this.webviewProvider;
    }
}