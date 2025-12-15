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
exports.UserConfigManager = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class UserConfigManager {
    context;
    userConfigDir;
    userIconThemePath;
    outputChannel;
    constructor(context) {
        this.context = context;
        this.userConfigDir = this.getWorkspaceConfigDir();
        this.userIconThemePath = path.join(this.userConfigDir, 'yonbip-icon-theme.json');
        this.outputChannel = vscode.window.createOutputChannel('YonBIP 用户配置');
        this.ensureUserConfigDirExists();
    }
    getWorkspaceConfigDir() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let workspacePath = 'global';
        if (workspaceFolders && workspaceFolders.length > 0) {
            workspacePath = workspaceFolders[0].uri.fsPath;
            workspacePath = workspacePath.replace(/[^\w\-_]/g, '_').replace(/_+/g, '_');
        }
        return path.join(this.context.globalStoragePath, 'workspace-configs', workspacePath);
    }
    ensureUserConfigDirExists() {
        try {
            if (!fs.existsSync(this.userConfigDir)) {
                fs.mkdirSync(this.userConfigDir, { recursive: true });
                this.outputChannel.appendLine(`创建用户配置目录: ${this.userConfigDir}`);
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`创建用户配置目录失败: ${error}`);
        }
    }
    getUserIconThemePath() {
        return this.userIconThemePath;
    }
    updateWorkspaceContext() {
        const oldConfigDir = this.userConfigDir;
        const oldConfigPath = this.userIconThemePath;
        this.userConfigDir = this.getWorkspaceConfigDir();
        this.userIconThemePath = path.join(this.userConfigDir, 'yonbip-icon-theme.json');
        this.ensureUserConfigDirExists();
        if (!fs.existsSync(this.userIconThemePath) && fs.existsSync(oldConfigPath)) {
            try {
                const oldConfig = fs.readFileSync(oldConfigPath, 'utf-8');
                fs.writeFileSync(this.userIconThemePath, oldConfig, 'utf-8');
                this.outputChannel.appendLine(`已从旧工作空间配置复制设置: ${oldConfigDir} -> ${this.userConfigDir}`);
            }
            catch (error) {
                this.outputChannel.appendLine(`复制工作空间配置失败: ${error}`);
            }
        }
        this.outputChannel.appendLine(`工作空间配置路径已更新: ${oldConfigPath} -> ${this.userIconThemePath}`);
    }
    async saveUserIconTheme(config) {
        try {
            this.ensureUserConfigDirExists();
            fs.writeFileSync(this.userIconThemePath, JSON.stringify(config, null, 2), 'utf-8');
            this.outputChannel.appendLine(`用户自定义图标主题配置已保存: ${this.userIconThemePath}`);
        }
        catch (error) {
            this.outputChannel.appendLine(`保存用户自定义图标主题配置失败: ${error}`);
            throw error;
        }
    }
    readUserIconTheme() {
        try {
            if (fs.existsSync(this.userIconThemePath)) {
                const content = fs.readFileSync(this.userIconThemePath, 'utf-8');
                return JSON.parse(content);
            }
            return null;
        }
        catch (error) {
            this.outputChannel.appendLine(`读取用户自定义图标主题配置失败: ${error}`);
            return null;
        }
    }
    async backupPluginIconTheme(pluginIconThemePath) {
        try {
            if (fs.existsSync(pluginIconThemePath)) {
                this.ensureUserConfigDirExists();
                const content = fs.readFileSync(pluginIconThemePath, 'utf-8');
                const backupPath = path.join(this.userConfigDir, 'yonbip-icon-theme-backup.json');
                fs.writeFileSync(backupPath, content, 'utf-8');
                this.outputChannel.appendLine(`插件内置图标主题配置已备份到: ${backupPath}`);
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`备份插件内置图标主题配置失败: ${error}`);
            throw error;
        }
    }
    async restoreUserIconThemeToPlugin(pluginIconThemePath) {
        try {
            const userConfig = this.readUserIconTheme();
            if (userConfig) {
                const pluginDir = path.dirname(pluginIconThemePath);
                if (!fs.existsSync(pluginDir)) {
                    fs.mkdirSync(pluginDir, { recursive: true });
                }
                fs.writeFileSync(pluginIconThemePath, JSON.stringify(userConfig, null, 2), 'utf-8');
                this.outputChannel.appendLine(`用户自定义图标主题配置已恢复到插件内置位置: ${pluginIconThemePath}`);
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`恢复用户自定义图标主题配置失败: ${error}`);
            throw error;
        }
    }
    async initializeUserConfig(pluginIconThemePath) {
        try {
            if (!fs.existsSync(this.userIconThemePath)) {
                this.outputChannel.appendLine('用户配置文件不存在，正在从插件内置配置复制...');
                if (fs.existsSync(pluginIconThemePath)) {
                    const content = fs.readFileSync(pluginIconThemePath, 'utf-8');
                    const pluginConfig = JSON.parse(content);
                    await this.saveUserIconTheme(pluginConfig);
                    this.outputChannel.appendLine('用户配置文件初始化完成');
                }
                else {
                    this.outputChannel.appendLine('插件内置配置文件不存在，创建默认配置');
                    const defaultConfig = this.createDefaultIconTheme();
                    await this.saveUserIconTheme(defaultConfig);
                }
            }
            else {
                const userConfig = this.readUserIconTheme();
                if (!userConfig || !this.isValidIconThemeConfig(userConfig)) {
                    this.outputChannel.appendLine('用户配置文件格式不正确，重新初始化...');
                    const pluginConfig = fs.existsSync(pluginIconThemePath) ?
                        JSON.parse(fs.readFileSync(pluginIconThemePath, 'utf-8')) :
                        this.createDefaultIconTheme();
                    await this.saveUserIconTheme(pluginConfig);
                }
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`初始化用户配置失败: ${error}`);
            throw error;
        }
    }
    createDefaultIconTheme() {
        return {
            "iconDefinitions": {
                "_yonbip_project": {
                    "iconPath": "./project/nccicon.png"
                },
                "_yonbip_initialized": {
                    "iconPath": "./project/initialized-icon.png"
                },
                "_yonbip_patch": {
                    "iconPath": "./project/patch-icon.png"
                },
                "_yonbip_folder": {
                    "iconPath": "./project/folder-icon.png"
                },
                "_yonbip_open_folder": {
                    "iconPath": "./project/open-folder-icon.png"
                },
                "_yonbip_vscode": {
                    "iconPath": "./project/vscode.png"
                }
            },
            "folder": "_yonbip_folder",
            "folderExpanded": "_yonbip_open_folder",
            "folderNames": {},
            "folderNamesExpanded": {}
        };
    }
    isValidIconThemeConfig(config) {
        return config &&
            config.iconDefinitions &&
            config.folder &&
            typeof config.folderNames === 'object';
    }
    async handlePluginReinstall() {
        try {
            const extensionVersion = this.context.extension.packageJSON.version;
            const storedVersion = this.context.globalState.get('yonbip.plugin.version');
            if (!storedVersion || storedVersion !== extensionVersion) {
                this.outputChannel.appendLine(`检测到插件版本变更: ${storedVersion || '首次安装'} -> ${extensionVersion}`);
                if (!fs.existsSync(this.userIconThemePath)) {
                    this.outputChannel.appendLine('首次安装或重新安装，重新初始化用户配置...');
                    await this.initializeUserConfig(path.join(this.context.extensionPath, 'resources', 'icons', 'yonbip-icon-theme.json'));
                }
                else {
                    const userConfig = this.readUserIconTheme();
                    if (!this.isValidIconThemeConfig(userConfig)) {
                        this.outputChannel.appendLine('用户配置不完整，重新初始化...');
                        await this.initializeUserConfig(path.join(this.context.extensionPath, 'resources', 'icons', 'yonbip-icon-theme.json'));
                    }
                }
                await this.context.globalState.update('yonbip.plugin.version', extensionVersion);
                this.outputChannel.appendLine('插件版本更新完成');
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`处理插件重新安装失败: ${error}`);
        }
    }
}
exports.UserConfigManager = UserConfigManager;
//# sourceMappingURL=UserConfigManager.js.map