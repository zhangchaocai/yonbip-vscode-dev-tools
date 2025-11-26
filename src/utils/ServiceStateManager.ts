import * as vscode from 'vscode';

/**
 * 服务状态管理类，用于保存和管理服务相关的状态
 */
export class ServiceStateManager {
    private static readonly CONFIG_SECTION = 'yonbip';
    private static readonly SELECTED_SERVICE_DIRECTORY_KEY = 'selectedServiceDirectory';
    
    /**
     * 保存用户选择的服务目录
     * @param dirPath 服务目录路径
     */
    public static async saveSelectedServiceDirectory(dirPath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        await config.update(this.SELECTED_SERVICE_DIRECTORY_KEY, dirPath, vscode.ConfigurationTarget.Global);
    }
    
    /**
     * 获取用户选择的服务目录
     * @returns string | undefined 用户选择的服务目录路径，如果没有选择则返回undefined
     */
    public static getSelectedServiceDirectory(): string | undefined {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        return config.get<string>(this.SELECTED_SERVICE_DIRECTORY_KEY);
    }
    
    /**
     * 清除用户选择的服务目录
     */
    public static async clearSelectedServiceDirectory(): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        await config.update(this.SELECTED_SERVICE_DIRECTORY_KEY, undefined, vscode.ConfigurationTarget.Global);
    }
}