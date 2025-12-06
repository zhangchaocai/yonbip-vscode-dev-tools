import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CustomDialogUtils } from './CustomDialogUtils';

/**
 * 图标主题更新服务
 * 用于动态更新YonBIP图标主题配置
 */
export class IconThemeUpdater {
    // 使用context.extensionPath而不是__dirname来获取正确的路径
    private static ICON_THEME_PATH = '';
    private static PACKAGE_JSON_PATH = '';
    
    /**
     * 初始化图标主题路径
     * @param context 扩展上下文
     */
    public static initialize(context: vscode.ExtensionContext): void {
        this.ICON_THEME_PATH = path.join(context.extensionPath, 'resources', 'icons', 'yonbip-icon-theme.json');
        this.PACKAGE_JSON_PATH = path.join(context.extensionPath, 'package.json');
    }
    
    /**
     * 移除JSON字符串中的注释
     * @param jsonString 包含注释的JSON字符串
     * @returns 移除注释后的JSON字符串
     */
    private static removeCommentsFromJson(jsonString: string): string {
        // 移除行尾注释 (// 注释)
        let lines = jsonString.split('\n');
        lines = lines.map(line => {
            // 查找 // 注释的位置
            const commentIndex = line.indexOf('//');
            if (commentIndex !== -1) {
                // 检查 // 是否在字符串内部
                let inString = false;
                let escaped = false;
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"' && !escaped) {
                        inString = !inString;
                    } else if (char === '\\' && !escaped) {
                        escaped = true;
                        continue;
                    } else {
                        escaped = false;
                    }
                    
                    if (char === '/' && line[i+1] === '/' && !inString) {
                        // 找到了行尾注释，移除它
                        return line.substring(0, i);
                    }
                }
            }
            return line;
        });
        
        // 移除整行注释
        lines = lines.filter(line => !line.trim().startsWith('//'));
        
        return lines.join('\n');
    }
    
    /**
     * 刷新图标主题
     * 通过多种方式强制VS Code重新加载图标主题配置
     */
    private static async refreshIconTheme(): Promise<void> {
        try {
            // 方法1: 触发文件系统变化事件
            // 通过轻微修改图标主题文件来触发更新
            if (fs.existsSync(this.ICON_THEME_PATH)) {
                const content = fs.readFileSync(this.ICON_THEME_PATH, 'utf8');
                // 添加一个空格然后删除，触发文件变化事件
                fs.appendFileSync(this.ICON_THEME_PATH, ' ');
                await new Promise(resolve => setTimeout(resolve, 50));
                fs.writeFileSync(this.ICON_THEME_PATH, content, 'utf8');
            }
            
            // 方法2: 发送命令刷新Explorer
            await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            
            // 方法3: 等待一段时间让VS Code处理更新
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
            console.error('刷新图标主题失败:', error);
        }
    }
    
    /**
     * 动态添加模块到图标主题配置
     * @param moduleName 模块名称
     * @returns 是否需要重启窗口
     */
    public static async addModuleToIconTheme(moduleName: string): Promise<boolean> {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(this.ICON_THEME_PATH)) {
                console.warn(`图标主题文件不存在: ${this.ICON_THEME_PATH}`);
                return false;
            }
            
            // 读取现有的图标主题配置
            let themeContent = fs.readFileSync(this.ICON_THEME_PATH, 'utf8');
            
            // 移除JSON中的注释
            themeContent = this.removeCommentsFromJson(themeContent);
            
            const themeJson = JSON.parse(themeContent);
            
            // 检查模块是否已经存在于配置中
            if (themeJson.folderNames && themeJson.folderNames[moduleName] === '_yonbip_project') {
                console.log(`模块 ${moduleName} 已经存在于图标主题配置中`);
                return false;
            }
            
            // 添加模块到folderNames和folderNamesExpanded
            if (!themeJson.folderNames) {
                themeJson.folderNames = {};
            }
            if (!themeJson.folderNamesExpanded) {
                themeJson.folderNamesExpanded = {};
            }
            
            themeJson.folderNames[moduleName] = '_yonbip_project';
            themeJson.folderNamesExpanded[moduleName] = '_yonbip_project';
            
            // 写回文件
            fs.writeFileSync(this.ICON_THEME_PATH, JSON.stringify(themeJson, null, 2), 'utf8');
            
            console.log(`成功将模块 ${moduleName} 添加到图标主题配置中`);
            
            // 强制刷新图标主题以使更改立即生效
            await this.refreshIconTheme();
            
            return true;
        } catch (error) {
            console.error('更新图标主题配置失败:', error);
            vscode.window.showErrorMessage(`更新图标主题配置失败: ${error}`);
            return false;
        }
    }
    
    /**
     * 请求用户确认重启窗口以应用图标更改
     */
    public static async requestWindowReload(): Promise<void> {
        const confirmed = await CustomDialogUtils.showCustomConfirmationDialog(
            '图标主题更新完成',
            '图标主题已更新完成，为使更改立即生效，建议重新加载窗口。\n\n是否现在重新加载？'
        );
        
        if (confirmed) {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
    
}