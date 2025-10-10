import * as vscode from 'vscode';
import { HomeService } from './HomeService';
import { NCHomeConfigService } from './config/NCHomeConfigService';

/**
 * HOME调试服务类，模拟IDEA插件中的ServerDebugAction逻辑
 */
export class HomeDebugService {
    private homeService: HomeService;
    private configService: NCHomeConfigService;

    constructor(context: vscode.ExtensionContext, configService: NCHomeConfigService, homeService: HomeService) {
        this.configService = configService;
        this.homeService = homeService;
    }

    /**
     * 启动HOME服务（调试模式），模拟IDEA插件中的doAction方法
     */
    public async debugHomeService(selectedPath?: string): Promise<void> {
        try {
            // 检查是否已有运行中的服务
            const isRunning = await this.isHomeServiceRunning();

            if (isRunning) {
                // 如果服务已在运行，重启服务
                await this.restartHomeService(selectedPath);
            } else {
                // 启动新的服务
                await this.startHomeService(selectedPath);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`调试启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 检查HOME服务是否正在运行
     */
    private async isHomeServiceRunning(): Promise<boolean> {
        // 这里应该检查当前是否有正在运行的HOME服务配置
        // 简化实现，直接返回homeService的状态
        const status = this.homeService.getStatus();
        return status === 'running' || status === 'starting';
    }

    /**
     * 重启HOME服务
     */
    private async restartHomeService(selectedPath?: string): Promise<void> {
        // 停止当前服务
        await this.homeService.stopHomeService();

        // 等待服务完全停止
        await this.waitForServiceStop(5000);

        // 启动服务
        await this.startHomeService(selectedPath);
    }

    /**
     * 等待服务停止
     */
    private async waitForServiceStop(timeout: number): Promise<void> {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                const status = this.homeService.getStatus();
                if (status === 'stopped' || Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 500);
        });
    }

    /**
     * 启动HOME服务
     */
    private async startHomeService(selectedPath?: string): Promise<void> {
        await this.homeService.startHomeService(selectedPath);
    }

    /**
     * 获取HOME服务
     */
    public getHomeService(): HomeService {
        return this.homeService;
    }
}