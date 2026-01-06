import * as vscode from 'vscode';

/**
 * 扩展版本服务
 * 已禁用版本检查和更新提醒功能
 */
export class ExtensionVersionService {
    
    /**
     * 初始化服务
     * @param context 扩展上下文
     */
    public static async initialize(context: vscode.ExtensionContext): Promise<void> {
        // 版本检查功能已禁用
        console.log('[ExtensionVersionService] 版本检查功能已禁用');
    }
    
    /**
     * 检查是否有新版本可用
     * @returns 新版本信息，如果没有新版本则返回null
     */
    public static async checkForUpdates(): Promise<{ latestVersion: string; releaseNotes?: string } | null> {
        // 版本检查功能已禁用
        return null;
    }
    
    /**
     * 显示更新提醒
     * @param latestVersion 最新版本号
     * @param releaseNotes 发布说明
     */
    public static async showUpdateNotification(latestVersion: string, releaseNotes?: string): Promise<void> {
        // 版本检查功能已禁用
    }
    
    /**
     * 提醒用户卸载旧版本插件
     */
    public static async suggestUninstallOldVersions(): Promise<void> {
        // 版本检查功能已禁用
    }
}