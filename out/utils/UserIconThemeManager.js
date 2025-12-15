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
exports.UserIconThemeManager = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class UserIconThemeManager {
    static CONFIG_SECTION = 'yonbip.iconThemes';
    static WORKSPACE_CONFIG_FILE = '.vscode/settings.json';
    static getWorkspaceSettingsPath() {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return null;
        }
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        return path.join(workspaceRoot, this.WORKSPACE_CONFIG_FILE);
    }
    static readWorkspaceIconThemeConfig() {
        const settingsPath = this.getWorkspaceSettingsPath();
        if (!settingsPath || !fs.existsSync(settingsPath)) {
            return {};
        }
        try {
            const content = fs.readFileSync(settingsPath, 'utf8');
            const settings = JSON.parse(content);
            return settings[this.CONFIG_SECTION] || {};
        }
        catch (error) {
            console.error('读取工作区图标主题配置失败:', error);
            return {};
        }
    }
    static writeWorkspaceIconThemeConfig(config) {
        const settingsPath = this.getWorkspaceSettingsPath();
        if (!settingsPath) {
            return;
        }
        const vscodeDir = path.dirname(settingsPath);
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }
        let settings = {};
        if (fs.existsSync(settingsPath)) {
            try {
                const content = fs.readFileSync(settingsPath, 'utf8');
                settings = JSON.parse(content);
            }
            catch (error) {
                console.error('读取现有工作区设置失败:', error);
            }
        }
        settings[this.CONFIG_SECTION] = config;
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        }
        catch (error) {
            console.error('写入工作区图标主题配置失败:', error);
        }
    }
    static getUserModuleIconMappings() {
        const workspaceConfig = this.readWorkspaceIconThemeConfig();
        if (workspaceConfig.moduleIcons) {
            return workspaceConfig.moduleIcons;
        }
        const config = vscode.workspace.getConfiguration();
        return config.get(this.CONFIG_SECTION + '.moduleIcons', {});
    }
    static setModuleIcon(moduleName, iconDefinition) {
        const currentConfig = this.readWorkspaceIconThemeConfig();
        if (!currentConfig.moduleIcons) {
            currentConfig.moduleIcons = {};
        }
        currentConfig.moduleIcons[moduleName] = iconDefinition;
        this.writeWorkspaceIconThemeConfig(currentConfig);
    }
    static removeModuleIcon(moduleName) {
        const currentConfig = this.readWorkspaceIconThemeConfig();
        if (currentConfig.moduleIcons) {
            delete currentConfig.moduleIcons[moduleName];
            if (currentConfig.moduleIcons && Object.keys(currentConfig.moduleIcons).length === 0) {
                delete currentConfig.moduleIcons;
            }
            this.writeWorkspaceIconThemeConfig(currentConfig);
        }
    }
    static generateMergedIconTheme(baseThemePath) {
        try {
            const baseThemeContent = fs.readFileSync(baseThemePath, 'utf8');
            const baseTheme = JSON.parse(baseThemeContent);
            const userModuleIcons = this.getUserModuleIconMappings();
            if (!baseTheme.folderNames) {
                baseTheme.folderNames = {};
            }
            Object.assign(baseTheme.folderNames, userModuleIcons);
            if (!baseTheme.folderNamesExpanded) {
                baseTheme.folderNamesExpanded = {};
            }
            Object.assign(baseTheme.folderNamesExpanded, userModuleIcons);
            return baseTheme;
        }
        catch (error) {
            console.error('生成合并图标主题配置失败:', error);
            return {};
        }
    }
    static async applyUserIconTheme(extensionPath) {
        try {
            const baseThemePath = path.join(extensionPath, 'resources', 'icons', 'yonbip-icon-theme.json');
            const mergedTheme = this.generateMergedIconTheme(baseThemePath);
            const tempThemePath = path.join(extensionPath, 'resources', 'icons', 'yonbip-icon-theme-user.json');
            fs.writeFileSync(tempThemePath, JSON.stringify(mergedTheme, null, 2), 'utf8');
            const workspaceSettingsPath = this.getWorkspaceSettingsPath();
            if (workspaceSettingsPath) {
                const vscodeDir = path.dirname(workspaceSettingsPath);
                if (!fs.existsSync(vscodeDir)) {
                    fs.mkdirSync(vscodeDir, { recursive: true });
                }
                let settings = {};
                if (fs.existsSync(workspaceSettingsPath)) {
                    try {
                        const content = fs.readFileSync(workspaceSettingsPath, 'utf8');
                        settings = JSON.parse(content);
                    }
                    catch (error) {
                        console.error('读取现有工作区设置失败:', error);
                    }
                }
                if (!settings['iconThemes']) {
                    settings['iconThemes'] = {};
                }
                settings['iconThemes']['yonbip-user-theme'] = {
                    id: 'yonbip-user-theme',
                    label: 'YonBIP User Theme',
                    path: tempThemePath
                };
                settings['workbench.iconTheme'] = 'yonbip-user-theme';
                try {
                    fs.writeFileSync(workspaceSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
                }
                catch (error) {
                    console.error('写入工作区设置失败:', error);
                }
            }
        }
        catch (error) {
            console.error('应用用户图标主题失败:', error);
        }
    }
}
exports.UserIconThemeManager = UserIconThemeManager;
//# sourceMappingURL=UserIconThemeManager.js.map