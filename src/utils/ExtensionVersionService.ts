import * as vscode from 'vscode';
import axios from 'axios';

/**
 * 扩展版本服务
 * 用于检查插件版本更新和提醒用户
 */
export class ExtensionVersionService {
    // 扩展ID
    private static readonly EXTENSION_ID = 'zhangchck.yonbip-devtool';
    
    // Marketplace API URL
    private static readonly MARKETPLACE_API_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery/';
    
    // 当前扩展版本
    private static currentVersion: string = '';
    
    /**
     * 初始化服务
     * @param context 扩展上下文
     */
    public static async initialize(context: vscode.ExtensionContext): Promise<void> {
        try {
            // 获取当前扩展版本
            const extension = vscode.extensions.getExtension(this.EXTENSION_ID);
            if (extension) {
                this.currentVersion = extension.packageJSON.version;
                console.log(`[ExtensionVersionService] 当前插件版本: ${this.currentVersion}`);
            } else {
                console.warn(`[ExtensionVersionService] 无法找到扩展: ${this.EXTENSION_ID}`);
            }
        } catch (error) {
            console.error('[ExtensionVersionService] 获取当前插件版本失败:', error);
        }
    }
    
    /**
     * 检查是否有新版本可用
     * @returns 新版本信息，如果没有新版本则返回null
     */
    public static async checkForUpdates(): Promise<{ latestVersion: string; releaseNotes?: string } | null> {
        try {
            console.log('[ExtensionVersionService] 开始检查插件更新');
            
            // 如果当前版本未知，直接返回
            if (!this.currentVersion) {
                console.warn('[ExtensionVersionService] 当前版本未知，跳过更新检查');
                return null;
            }
            
            // 查询Marketplace获取最新版本信息
            const latestVersionInfo = await this.queryLatestVersion();
            
            if (latestVersionInfo && this.isNewerVersion(latestVersionInfo.latestVersion, this.currentVersion)) {
                console.log(`[ExtensionVersionService] 发现新版本: ${latestVersionInfo.latestVersion}, 当前版本: ${this.currentVersion}`);
                return latestVersionInfo;
            } else {
                console.log(`[ExtensionVersionService] 当前已是最新版本: ${this.currentVersion}`);
            }
            
            return null;
        } catch (error) {
            console.error('[ExtensionVersionService] 检查插件更新失败:', error);
            return null;
        }
    }
    
    /**
     * 查询最新的插件版本信息
     * @returns 最新版本信息
     */
    private static async queryLatestVersion(): Promise<{ latestVersion: string; releaseNotes?: string }> {
        try {
            // 使用VS Code Marketplace API查询扩展信息
            const response: any = await axios.post(
                this.MARKETPLACE_API_URL,
                {
                    filters: [{
                        criteria: [{
                            filterType: 7, // ExtensionName filter
                            value: this.EXTENSION_ID
                        }]
                    }],
                    flags: 914 // Include version properties
                },
                {
                    headers: {
                        'Accept': 'application/json;api-version=3.0-preview.1',
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            // 解析响应数据获取最新版本
            if (response.data && response.data.results && response.data.results.length > 0) {
                const extensions = response.data.results[0].extensions;
                if (extensions && extensions.length > 0) {
                    const extension = extensions[0];
                    const versions = extension.versions;
                    
                    if (versions && versions.length > 0) {
                        const latestVersion = versions[0]; // 第一个版本是最新的
                        return {
                            latestVersion: latestVersion.version,
                            releaseNotes: latestVersion.releaseNotes
                        };
                    }
                }
            }
            
            throw new Error('无法从Marketplace获取版本信息');
        } catch (error) {
            console.error('查询最新版本失败:', error);
            throw error;
        }
    }
    
    /**
     * 比较版本号，判断是否有新版本
     * @param latestVersion 最新版本号
     * @param currentVersion 当前版本号
     * @returns 是否有新版本
     */
    private static isNewerVersion(latestVersion: string, currentVersion: string): boolean {
        try {
            // 简单的版本号比较（假设版本号格式为 x.y.z）
            const latestParts = latestVersion.split('.').map(Number);
            const currentParts = currentVersion.split('.').map(Number);
            
            // 比较主要版本号
            for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
                const latestPart = i < latestParts.length ? latestParts[i] : 0;
                const currentPart = i < currentParts.length ? currentParts[i] : 0;
                
                if (latestPart > currentPart) {
                    return true;
                } else if (latestPart < currentPart) {
                    return false;
                }
            }
            
            return false; // 版本号相同
        } catch (error) {
            console.error('版本号比较失败:', error);
            return false;
        }
    }
    
    /**
     * 显示更新提醒
     * @param latestVersion 最新版本号
     * @param releaseNotes 发布说明
     */
    public static async showUpdateNotification(latestVersion: string, releaseNotes?: string): Promise<void> {
        try {
            const message = `发现新版本 ${latestVersion}，当前版本 ${this.currentVersion}。建议更新以获得最新功能和修复。`;
            
            const updateButton = '更新插件';
            const learnMoreButton = '查看详情';
            const dismissButton = '稍后提醒';
            
            const selection = await vscode.window.showInformationMessage(
                message,
                { modal: false },
                updateButton,
                learnMoreButton,
                dismissButton
            );
            
            switch (selection) {
                case updateButton:
                    // 打开扩展市场页面
                    vscode.env.openExternal(
                        vscode.Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${this.EXTENSION_ID}`)
                    );
                    break;
                case learnMoreButton:
                    // 显示发布说明
                    if (releaseNotes) {
                        vscode.window.showInformationMessage(
                            `版本 ${latestVersion} 更新内容:\n\n${releaseNotes}`,
                            { modal: true }
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            `版本 ${latestVersion} 更新内容暂无详细说明。`,
                            { modal: true }
                        );
                    }
                    break;
                case dismissButton:
                    // 用户选择稍后提醒，不执行任何操作
                    break;
            }
        } catch (error) {
            console.error('显示更新提醒失败:', error);
        }
    }
    
    /**
     * 提醒用户卸载旧版本插件
     * 注意：VS Code不允许插件自动卸载其他插件，只能提醒用户手动操作
     */
    public static async suggestUninstallOldVersions(): Promise<void> {
        try {
            // 检查是否安装了多个相似名称的插件
            const allExtensions = vscode.extensions.all;
            const similarExtensions = allExtensions.filter(ext => 
                ext.id.includes('yonbip') && 
                ext.id.includes('devtool') && 
                ext.id !== this.EXTENSION_ID
            );
            
            if (similarExtensions.length > 0) {
                const message = `检测到 ${similarExtensions.length} 个可能的旧版本或重复插件，请手动检查并卸载以避免冲突。`;
                const manageExtensionsButton = '管理扩展';
                
                const selection = await vscode.window.showWarningMessage(
                    message,
                    { modal: false },
                    manageExtensionsButton
                );
                
                if (selection === manageExtensionsButton) {
                    // 打开扩展管理页面
                    vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithDuplicates');
                }
            }
        } catch (error) {
            console.error('提醒卸载旧版本插件失败:', error);
        }
    }
}