import * as vscode from 'vscode';
import { HomeService } from './HomeService';
import { NCHomeConfigService } from './NCHomeConfigService';
import { HomeDebugService } from './HomeDebugService';

/**
 * HOME服务命令类
 */
export class HomeCommands {
    private homeService: HomeService;
    private homeDebugService: HomeDebugService;

    constructor(context: vscode.ExtensionContext, configService: NCHomeConfigService) {
        this.homeService = new HomeService(context, configService);
        this.homeDebugService = new HomeDebugService(context, configService);
    }

    /**
     * 注册HOME服务相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext, configService: NCHomeConfigService): void {
        const homeCommands = new HomeCommands(context, configService);

        // 注册启动HOME服务命令
        const startCommand = vscode.commands.registerCommand('yonbip.home.start', () => {
            homeCommands.startHomeService();
        });

        // 注册调试启动HOME服务命令
        const debugCommand = vscode.commands.registerCommand('yonbip.home.debug', () => {
            homeCommands.debugHomeService();
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

        context.subscriptions.push(
            startCommand,
            debugCommand,
            stopCommand,
            statusCommand,
            logsCommand
        );
    }

    /**
     * 启动HOME服务
     */
    public async startHomeService(): Promise<void> {
        try {
            await this.homeService.startHomeService();
        } catch (error: any) {
            vscode.window.showErrorMessage(`启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 调试启动HOME服务
     */
    public async debugHomeService(): Promise<void> {
        try {
            await this.homeDebugService.debugHomeService();
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