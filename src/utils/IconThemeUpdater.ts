import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CustomDialogUtils } from './CustomDialogUtils';

/**
 * 图标主题更新服务
 * 用于动态更新YonBIP图标主题配置
 * 为每个工作空间提供专属的图标主题配置
 */
export class IconThemeUpdater {
    // 使用context.extensionPath而不是__dirname来获取正确的路径
    private static ICON_THEME_TEMPLATE_PATH = '';
    private static PACKAGE_JSON_PATH = '';
    private static ICON_THEME_PATH = '';
    
    // 防抖计时器，避免短时间内多次刷新
    private static refreshDebounceTimer: NodeJS.Timeout | null = null;
    
    // 标记是否正在刷新中，避免并行刷新
    private static isRefreshing = false;
    
    /**
     * 初始化图标主题路径
     * @param context 扩展上下文
     */
    public static async initialize(context: vscode.ExtensionContext): Promise<void> {
        this.ICON_THEME_TEMPLATE_PATH = path.join(context.extensionPath, 'resources', 'icons', 'yonbip-icon-theme.json');
        this.ICON_THEME_PATH = this.ICON_THEME_TEMPLATE_PATH; // 插件内置的图标主题配置路径
        this.PACKAGE_JSON_PATH = path.join(context.extensionPath, 'package.json');
        
        console.log('图标主题模板路径:', this.ICON_THEME_TEMPLATE_PATH);
        console.log('图标主题路径:', this.ICON_THEME_PATH);
        
        // 确保图标主题被激活
        const themeJustActivated = this.ensureIconThemeActivated();
        
        // 自动加载工作空间的图标配置
        await this.loadWorkspaceIconTheme(themeJustActivated);
        
        // 注册工作空间变化事件 - 使用防抖
        context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                console.log('工作空间文件夹已变化，计划重新加载图标主题配置');
                this.debouncedLoadWorkspaceIconTheme();
            })
        );
        
        // 注册配置文件变化事件 - 使用防抖
        const iconThemeWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/yonbip-icon-theme.json');
        context.subscriptions.push(iconThemeWatcher);
        
        const handleConfigChange = () => {
            console.log('图标主题配置文件已变化，计划重新加载图标主题配置');
            this.debouncedLoadWorkspaceIconTheme();
        };
        
        context.subscriptions.push(iconThemeWatcher.onDidChange(handleConfigChange));
        context.subscriptions.push(iconThemeWatcher.onDidCreate(handleConfigChange));
        context.subscriptions.push(iconThemeWatcher.onDidDelete(handleConfigChange));
    }
    
    /**
     * 防抖加载工作空间图标主题配置
     * 避免短时间内多次加载
     */
    private static debouncedLoadWorkspaceIconTheme(): void {
        // 清除之前的计时器
        if (this.refreshDebounceTimer) {
            clearTimeout(this.refreshDebounceTimer);
        }
        
        // 设置新的计时器，延迟执行加载操作
        this.refreshDebounceTimer = setTimeout(async () => {
            try {
                await this.loadWorkspaceIconTheme();
            } catch (error) {
                console.error('防抖加载工作空间图标主题配置失败:', error);
            } finally {
                this.refreshDebounceTimer = null;
            }
        }, 200); // 200ms防抖延迟
    }
    
    /**
     * 加载工作空间的图标主题配置
     * 将工作空间的配置合并到插件内置的图标主题文件中
     * @param skipThemeSwitch 是否跳过图标主题切换操作（减少闪烁）
     */
    private static async loadWorkspaceIconTheme(skipThemeSwitch: boolean = false): Promise<void> {
        try {
            console.log('开始加载工作空间的图标主题配置');
            
            // 获取当前工作空间的图标主题配置（包含工作空间特定的配置）
            const themeJson = this.getWorkspaceIconThemeConfig();
            console.log('获取到的图标主题配置:', themeJson);
            
            // 更新插件内置的图标主题配置文件
            this.saveIconThemeConfigToPlugin(themeJson);
            
            // 刷新图标主题以立即生效
            await this.refreshIconTheme(skipThemeSwitch);
            
            console.log('已加载工作空间的图标主题配置');
        } catch (error) {
            console.error('加载工作空间的图标主题配置失败:', error);
        }
    }
    
    /**
     * 确保YonBIP图标主题被激活
     * 如果当前未激活，则激活它
     * @returns 是否需要刷新图标主题（因为主题刚刚被激活）
     */
    private static ensureIconThemeActivated(): boolean {
        // 获取当前激活的图标主题
        const currentIconTheme = vscode.workspace.getConfiguration().get('workbench.iconTheme');
        
        // 如果当前图标主题不是我们的，则激活它
        if (currentIconTheme !== 'yonbip-icon-theme') {
            // 设置图标主题
            vscode.workspace.getConfiguration().update(
                'workbench.iconTheme', 
                'yonbip-icon-theme', 
                vscode.ConfigurationTarget.Global
            ).then(() => {
                console.log('已激活YonBIP图标主题');
            }, (error) => {
                console.error('激活YonBIP图标主题失败:', error);
            });
            return true; // 主题刚刚被激活，不需要额外刷新
        }
        return false; // 主题已经是我们的，可能需要刷新
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
     * @param skipThemeSwitch 是否跳过图标主题切换操作（减少闪烁）
     */
    private static async refreshIconTheme(skipThemeSwitch: boolean = false): Promise<void> {
        // 避免并行刷新
        if (this.isRefreshing) {
            console.log('图标主题正在刷新中，跳过本次刷新');
            return;
        }
        
        try {
            this.isRefreshing = true;
            console.log('开始刷新图标主题，skipThemeSwitch:', skipThemeSwitch);
            
            // 只使用文件系统变化事件来触发更新，避免主题切换
            if (fs.existsSync(this.ICON_THEME_PATH)) {
                const content = fs.readFileSync(this.ICON_THEME_PATH, 'utf8');
                // 添加一个空格然后删除，触发文件变化事件
                fs.appendFileSync(this.ICON_THEME_PATH, ' ');
                await new Promise(resolve => setTimeout(resolve, 20)); // 缩短等待时间
                fs.writeFileSync(this.ICON_THEME_PATH, content, 'utf8');
                console.log('已触发图标主题文件变化事件');
            }
            
            // 只在绝对必要时才切换主题（skipThemeSwitch为false且主题不是我们的）
            // 这是最后的手段，尽量避免
            if (!skipThemeSwitch) {
                const currentTheme = vscode.workspace.getConfiguration().get('workbench.iconTheme');
                if (currentTheme && currentTheme !== 'yonbip-icon-theme') {
                    await vscode.workspace.getConfiguration().update('workbench.iconTheme', 'yonbip-icon-theme', vscode.ConfigurationTarget.Global);
                    console.log('已激活YonBIP图标主题');
                }
            }
            
            // 发送命令刷新Explorer
            await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            console.log('已刷新文件资源管理器');
            
            // 等待一段时间让VS Code处理更新
            await new Promise(resolve => setTimeout(resolve, 150)); // 进一步缩短等待时间
            console.log('图标主题刷新完成');
        } catch (error) {
            console.error('刷新图标主题失败:', error);
        } finally {
            this.isRefreshing = false;
        }
    }
    
    /**
     * 获取当前工作空间的图标主题配置
     * 如果不存在，则从模板复制一份
     * @returns 图标主题配置内容
     */
    private static getWorkspaceIconThemeConfig(): any {
        // 读取模板内容
        let themeContent = fs.readFileSync(this.ICON_THEME_TEMPLATE_PATH, 'utf8');
        
        // 移除JSON中的注释
        themeContent = this.removeCommentsFromJson(themeContent);
        
        // 解析模板内容
        const themeJson = JSON.parse(themeContent);
        
        // 检查是否存在工作空间配置文件
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const vscodeDirPath = path.join(workspaceFolder.uri.fsPath, '.vscode');
            const workspaceConfigPath = path.join(vscodeDirPath, 'yonbip-icon-theme.json');
            
            // 如果工作空间配置文件存在，则合并配置
            if (fs.existsSync(workspaceConfigPath)) {
                try {
                    const workspaceContent = fs.readFileSync(workspaceConfigPath, 'utf8');
                    const workspaceJson = JSON.parse(this.removeCommentsFromJson(workspaceContent));
                    
                    // 合并配置，工作空间配置优先
                    Object.assign(themeJson, workspaceJson);
                    
                    // 特别处理folderNames和folderNamesExpanded，确保它们完全合并
                    if (workspaceJson.folderNames) {
                        themeJson.folderNames = { ...themeJson.folderNames, ...workspaceJson.folderNames };
                    }
                    if (workspaceJson.folderNamesExpanded) {
                        themeJson.folderNamesExpanded = { ...themeJson.folderNamesExpanded, ...workspaceJson.folderNamesExpanded };
                    }
                } catch (error) {
                    console.error('读取工作空间图标主题配置失败:', error);
                }
            }
        }
        
        return themeJson;
    }
    
    /**
     * 保存当前工作空间的图标主题配置
     * @param themeJson 图标主题配置内容
     */
    private static saveWorkspaceIconThemeConfig(themeJson: any): void {
        // 获取当前工作空间的根目录
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        
        // 在工作空间的.vscode目录下创建图标主题配置文件
        const vscodeDirPath = path.join(workspaceFolder.uri.fsPath, '.vscode');
        const iconThemePath = path.join(vscodeDirPath, 'yonbip-icon-theme.json');
        
        // 确保.vscode目录存在
        if (!fs.existsSync(vscodeDirPath)) {
            try {
                fs.mkdirSync(vscodeDirPath, { recursive: true });
            } catch (error) {
                console.error('创建.vscode目录失败:', error);
                return;
            }
        }
        
        // 只保存工作空间特定的配置，不保存模板配置
        const workspaceSpecificConfig = {
            folderNames: themeJson.folderNames,
            folderNamesExpanded: themeJson.folderNamesExpanded
        };
        
        // 写回工作空间配置文件
        fs.writeFileSync(iconThemePath, JSON.stringify(workspaceSpecificConfig, null, 2), 'utf8');
        
        // 同时更新插件内置的图标主题配置文件
        this.saveIconThemeConfigToPlugin(themeJson);
    }
    
    /**
     * 将图标主题配置保存到插件内置的资源文件中
     * @param themeJson 图标主题配置内容
     */
    private static saveIconThemeConfigToPlugin(themeJson: any): void {
        try {
            // 验证图标定义是否完整
            if (!themeJson.iconDefinitions) {
                console.error('图标主题配置缺少iconDefinitions');
                // 从模板重新加载图标定义
                const templateContent = fs.readFileSync(this.ICON_THEME_TEMPLATE_PATH, 'utf8');
                const templateJson = JSON.parse(this.removeCommentsFromJson(templateContent));
                themeJson.iconDefinitions = templateJson.iconDefinitions;
                console.log('已从模板重新加载iconDefinitions');
            }
            
            // 验证默认图标是否设置
            if (!themeJson.folder) {
                themeJson.folder = '_yonbip_folder';
                console.log('已设置默认folder图标');
            }
            if (!themeJson.folderExpanded) {
                themeJson.folderExpanded = '_yonbip_open_folder';
                console.log('已设置默认folderExpanded图标');
            }
            
            // 写回插件内置的图标主题配置文件
            fs.writeFileSync(this.ICON_THEME_PATH, JSON.stringify(themeJson, null, 2), 'utf8');
            console.log(`已更新插件内置的图标主题配置文件: ${this.ICON_THEME_PATH}`);
            
            // 验证文件内容
            const savedContent = fs.readFileSync(this.ICON_THEME_PATH, 'utf8');
            const savedJson = JSON.parse(savedContent);
            console.log('保存的图标主题配置:', savedJson);
        } catch (error) {
            console.error('更新插件内置的图标主题配置文件失败:', error);
        }
    }
    
    /**
     * 动态添加模块到当前工作空间的图标主题配置
     * @param moduleName 模块名称
     * @returns 是否需要重启窗口
     */
    public static async addModuleToIconTheme(moduleName: string): Promise<boolean> {
        try {
            // 获取当前工作空间的图标主题配置
            const themeJson = this.getWorkspaceIconThemeConfig();
            
            // 检查模块是否已经存在于配置中
            if (themeJson.folderNames && themeJson.folderNames[moduleName] === '_yonbip_project') {
                console.log(`模块 ${moduleName} 已经存在于当前工作空间的图标主题配置中`);
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
            
            // 保存工作空间专属的图标主题配置
            this.saveWorkspaceIconThemeConfig(themeJson);
            
            console.log(`成功将模块 ${moduleName} 添加到当前工作空间的图标主题配置中`);
            
            // 强制刷新图标主题以使更改立即生效，但跳过主题切换
            await this.refreshIconTheme(true);
            
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