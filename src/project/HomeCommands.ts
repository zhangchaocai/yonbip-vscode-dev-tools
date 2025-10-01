import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { HomeService } from './HomeService';
import { HomeDebugService } from './HomeDebugService';
import { NCHomeConfigService } from './NCHomeConfigService';

/**
 * HOME服务命令类
 */
export class HomeCommands {
    private homeService: HomeService;
    private homeDebugService: HomeDebugService;
    private configService: NCHomeConfigService;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, configService: NCHomeConfigService) {
        this.context = context;
        this.configService = configService;
        this.homeService = new HomeService(context, configService);
        this.homeDebugService = new HomeDebugService(context, configService, this.homeService);
    }

    /**
     * 注册HOME服务相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext, configService: NCHomeConfigService): void {
        const homeCommands = new HomeCommands(context, configService);

        // 注册启动HOME服务命令
        const startCommand = vscode.commands.registerCommand('yonbip.home.start', (uri: vscode.Uri) => {
            homeCommands.startHomeService(uri?.fsPath);
        });

        // 注册调试启动HOME服务命令
        const debugCommand = vscode.commands.registerCommand('yonbip.home.debug', (uri: vscode.Uri) => {
            homeCommands.debugHomeService(uri?.fsPath);
        });

        // 注册停止HOME服务命令
        const stopCommand = vscode.commands.registerCommand('yonbip.home.stop', () => {
            homeCommands.stopHomeService();
        });

        // 注册查看HOME服务状态命令
        const statusCommand = vscode.commands.registerCommand('yonbip.home.status', () => {
            homeCommands.showStatus();
        });

        // 注册查看HOME服务日志命令
        const logsCommand = vscode.commands.registerCommand('yonbip.home.logs', () => {
            homeCommands.showLogs();
        });

        // 注册从指定目录启动HOME服务命令
        const startFromDirectoryCommand = vscode.commands.registerCommand(
            'yonbip.home.startFromDirectory',
            (uri: vscode.Uri) => {
                homeCommands.startHomeServiceFromDirectory(uri);
            }
        );

        context.subscriptions.push(
            startCommand,
            debugCommand,
            stopCommand,
            statusCommand,
            logsCommand,
            startFromDirectoryCommand
        );
    }

    /**
     * 启动HOME服务
     */
    public async startHomeService(selectedPath?: string): Promise<void> {
        try {
            // 重新加载配置以确保使用当前工作区的配置
            this.configService.reloadConfig();
            await this.homeService.startHomeService(selectedPath);
        } catch (error: any) {
            vscode.window.showErrorMessage(`启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 从指定目录启动HOME服务
     */
    public async startHomeServiceFromDirectory(uri: vscode.Uri): Promise<void> {
        try {
            let selectedPath: string;
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
            } else {
                selectedPath = uri.fsPath;
            }

            // 检查目录是否包含.yonbip-project标记文件
            const markerFilePath = path.join(selectedPath, '.yonbip-project');
            if (!fs.existsSync(markerFilePath)) {
                vscode.window.showErrorMessage('只有已初始化的YonBIP项目目录才能启动中间件服务。请先使用"🚀 YONBIP 工程初始化"命令初始化项目或者创建YonBIP项目进行启动。');
                return;
            }

            // 重新加载配置以确保使用当前工作区的配置
            this.configService.reloadConfig();
            await this.homeService.startHomeService(selectedPath);
        } catch (error: any) {
            vscode.window.showErrorMessage(`从指定目录启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 调试启动HOME服务
     */
    public async debugHomeService(selectedPath?: string): Promise<void> {
        try {
            // 重新加载配置以确保使用当前工作区的配置
            this.configService.reloadConfig();
            await this.homeDebugService.debugHomeService(selectedPath);
        } catch (error: any) {
            vscode.window.showErrorMessage(`调试启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 停止HOME服务
     */
    public async stopHomeService(): Promise<void> {
        try {
            await this.homeService.stopHomeService();
        } catch (error: any) {
            vscode.window.showErrorMessage(`停止HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 显示HOME服务状态
     */
    public showStatus(): void {
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

    /**
     * 显示HOME服务日志
     */
    public showLogs(): void {
        this.homeService.showLogs();
    }
}