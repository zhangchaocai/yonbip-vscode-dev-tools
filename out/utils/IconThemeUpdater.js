"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.IconThemeUpdater = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CustomDialogUtils_1 = require("./CustomDialogUtils");
class IconThemeUpdater {
    static ICON_THEME_TEMPLATE_PATH = '';
    static PACKAGE_JSON_PATH = '';
    static ICON_THEME_PATH = '';
    static refreshDebounceTimer = null;
    static isRefreshing = false;
    static async initialize(context) {
        this.ICON_THEME_TEMPLATE_PATH = path.join(context.extensionPath, 'resources', 'icons', 'yonbip-icon-theme.json');
        this.ICON_THEME_PATH = this.ICON_THEME_TEMPLATE_PATH;
        this.PACKAGE_JSON_PATH = path.join(context.extensionPath, 'package.json');
        console.log('图标主题模板路径:', this.ICON_THEME_TEMPLATE_PATH);
        console.log('图标主题路径:', this.ICON_THEME_PATH);
        const themeJustActivated = this.ensureIconThemeActivated();
        await this.loadWorkspaceIconTheme(themeJustActivated);
        context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            console.log('工作空间文件夹已变化，计划重新加载图标主题配置');
            this.debouncedLoadWorkspaceIconTheme();
        }));
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
    static debouncedLoadWorkspaceIconTheme() {
        if (this.refreshDebounceTimer) {
            clearTimeout(this.refreshDebounceTimer);
        }
        this.refreshDebounceTimer = setTimeout(async () => {
            try {
                await this.loadWorkspaceIconTheme();
            }
            catch (error) {
                console.error('防抖加载工作空间图标主题配置失败:', error);
            }
            finally {
                this.refreshDebounceTimer = null;
            }
        }, 200);
    }
    static async loadWorkspaceIconTheme(skipThemeSwitch = false) {
        try {
            console.log('开始加载工作空间的图标主题配置');
            const themeJson = this.getWorkspaceIconThemeConfig();
            console.log('获取到的图标主题配置:', themeJson);
            this.saveIconThemeConfigToPlugin(themeJson);
            await this.refreshIconTheme(skipThemeSwitch);
            console.log('已加载工作空间的图标主题配置');
        }
        catch (error) {
            console.error('加载工作空间的图标主题配置失败:', error);
        }
    }
    static ensureIconThemeActivated() {
        const currentIconTheme = vscode.workspace.getConfiguration().get('workbench.iconTheme');
        if (currentIconTheme !== 'yonbip-icon-theme') {
            vscode.workspace.getConfiguration().update('workbench.iconTheme', 'yonbip-icon-theme', vscode.ConfigurationTarget.Global).then(() => {
                console.log('已激活YonBIP图标主题');
            }, (error) => {
                console.error('激活YonBIP图标主题失败:', error);
            });
            return true;
        }
        return false;
    }
    static removeCommentsFromJson(jsonString) {
        let lines = jsonString.split('\n');
        lines = lines.map(line => {
            const commentIndex = line.indexOf('//');
            if (commentIndex !== -1) {
                let inString = false;
                let escaped = false;
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    if (char === '"' && !escaped) {
                        inString = !inString;
                    }
                    else if (char === '\\' && !escaped) {
                        escaped = true;
                        continue;
                    }
                    else {
                        escaped = false;
                    }
                    if (char === '/' && line[i + 1] === '/' && !inString) {
                        return line.substring(0, i);
                    }
                }
            }
            return line;
        });
        lines = lines.filter(line => !line.trim().startsWith('//'));
        return lines.join('\n');
    }
    static async refreshIconTheme(skipThemeSwitch = false) {
        if (this.isRefreshing) {
            console.log('图标主题正在刷新中，跳过本次刷新');
            return;
        }
        try {
            this.isRefreshing = true;
            console.log('开始刷新图标主题，skipThemeSwitch:', skipThemeSwitch);
            if (fs.existsSync(this.ICON_THEME_PATH)) {
                const content = fs.readFileSync(this.ICON_THEME_PATH, 'utf8');
                fs.appendFileSync(this.ICON_THEME_PATH, ' ');
                await new Promise(resolve => setTimeout(resolve, 20));
                fs.writeFileSync(this.ICON_THEME_PATH, content, 'utf8');
                console.log('已触发图标主题文件变化事件');
            }
            if (!skipThemeSwitch) {
                const currentTheme = vscode.workspace.getConfiguration().get('workbench.iconTheme');
                if (currentTheme && currentTheme !== 'yonbip-icon-theme') {
                    await vscode.workspace.getConfiguration().update('workbench.iconTheme', 'yonbip-icon-theme', vscode.ConfigurationTarget.Global);
                    console.log('已激活YonBIP图标主题');
                }
            }
            await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            console.log('已刷新文件资源管理器');
            await new Promise(resolve => setTimeout(resolve, 150));
            console.log('图标主题刷新完成');
        }
        catch (error) {
            console.error('刷新图标主题失败:', error);
        }
        finally {
            this.isRefreshing = false;
        }
    }
    static getWorkspaceIconThemeConfig() {
        let themeContent = fs.readFileSync(this.ICON_THEME_TEMPLATE_PATH, 'utf8');
        themeContent = this.removeCommentsFromJson(themeContent);
        const themeJson = JSON.parse(themeContent);
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const vscodeDirPath = path.join(workspaceFolder.uri.fsPath, '.vscode');
            const workspaceConfigPath = path.join(vscodeDirPath, 'yonbip-icon-theme.json');
            if (fs.existsSync(workspaceConfigPath)) {
                try {
                    const workspaceContent = fs.readFileSync(workspaceConfigPath, 'utf8');
                    const workspaceJson = JSON.parse(this.removeCommentsFromJson(workspaceContent));
                    Object.assign(themeJson, workspaceJson);
                    if (workspaceJson.folderNames) {
                        themeJson.folderNames = { ...themeJson.folderNames, ...workspaceJson.folderNames };
                    }
                    if (workspaceJson.folderNamesExpanded) {
                        themeJson.folderNamesExpanded = { ...themeJson.folderNamesExpanded, ...workspaceJson.folderNamesExpanded };
                    }
                }
                catch (error) {
                    console.error('读取工作空间图标主题配置失败:', error);
                }
            }
        }
        return themeJson;
    }
    static saveWorkspaceIconThemeConfig(themeJson) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        const vscodeDirPath = path.join(workspaceFolder.uri.fsPath, '.vscode');
        const iconThemePath = path.join(vscodeDirPath, 'yonbip-icon-theme.json');
        if (!fs.existsSync(vscodeDirPath)) {
            try {
                fs.mkdirSync(vscodeDirPath, { recursive: true });
            }
            catch (error) {
                console.error('创建.vscode目录失败:', error);
                return;
            }
        }
        const workspaceSpecificConfig = {
            folderNames: themeJson.folderNames,
            folderNamesExpanded: themeJson.folderNamesExpanded
        };
        fs.writeFileSync(iconThemePath, JSON.stringify(workspaceSpecificConfig, null, 2), 'utf8');
        this.saveIconThemeConfigToPlugin(themeJson);
    }
    static saveIconThemeConfigToPlugin(themeJson) {
        try {
            if (!themeJson.iconDefinitions) {
                console.error('图标主题配置缺少iconDefinitions');
                const templateContent = fs.readFileSync(this.ICON_THEME_TEMPLATE_PATH, 'utf8');
                const templateJson = JSON.parse(this.removeCommentsFromJson(templateContent));
                themeJson.iconDefinitions = templateJson.iconDefinitions;
                console.log('已从模板重新加载iconDefinitions');
            }
            if (!themeJson.folder) {
                themeJson.folder = '_yonbip_folder';
                console.log('已设置默认folder图标');
            }
            if (!themeJson.folderExpanded) {
                themeJson.folderExpanded = '_yonbip_open_folder';
                console.log('已设置默认folderExpanded图标');
            }
            fs.writeFileSync(this.ICON_THEME_PATH, JSON.stringify(themeJson, null, 2), 'utf8');
            console.log(`已更新插件内置的图标主题配置文件: ${this.ICON_THEME_PATH}`);
            const savedContent = fs.readFileSync(this.ICON_THEME_PATH, 'utf8');
            const savedJson = JSON.parse(savedContent);
            console.log('保存的图标主题配置:', savedJson);
        }
        catch (error) {
            console.error('更新插件内置的图标主题配置文件失败:', error);
        }
    }
    static async addModuleToIconTheme(moduleName) {
        try {
            const themeJson = this.getWorkspaceIconThemeConfig();
            if (themeJson.folderNames && themeJson.folderNames[moduleName] === '_yonbip_project') {
                console.log(`模块 ${moduleName} 已经存在于当前工作空间的图标主题配置中`);
                return false;
            }
            if (!themeJson.folderNames) {
                themeJson.folderNames = {};
            }
            if (!themeJson.folderNamesExpanded) {
                themeJson.folderNamesExpanded = {};
            }
            themeJson.folderNames[moduleName] = '_yonbip_project';
            themeJson.folderNamesExpanded[moduleName] = '_yonbip_project';
            this.saveWorkspaceIconThemeConfig(themeJson);
            console.log(`成功将模块 ${moduleName} 添加到当前工作空间的图标主题配置中`);
            await this.refreshIconTheme(true);
            return true;
        }
        catch (error) {
            console.error('更新图标主题配置失败:', error);
            vscode.window.showErrorMessage(`更新图标主题配置失败: ${error}`);
            return false;
        }
    }
    static async requestWindowReload() {
        const confirmed = await CustomDialogUtils_1.CustomDialogUtils.showCustomConfirmationDialog('图标主题更新完成', '图标主题已更新完成，为使更改立即生效，建议重新加载窗口。\n\n是否现在重新加载？');
        if (confirmed) {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
}
exports.IconThemeUpdater = IconThemeUpdater;
//# sourceMappingURL=IconThemeUpdater.js.map