import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 图标主题更新服务
 * 用于动态更新YonBIP图标主题配置
 */
export class IconThemeUpdater {
    private static readonly ICON_THEME_PATH = path.join(__dirname, '..', '..', 'resources', 'icons', 'yonbip-icon-theme.json');
    
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
     * 动态添加模块到图标主题配置
     * @param moduleName 模块名称
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
            return true;
        } catch (error) {
            console.error('更新图标主题配置失败:', error);
            vscode.window.showErrorMessage(`更新图标主题配置失败: ${error}`);
            return false;
        }
    }
    
}