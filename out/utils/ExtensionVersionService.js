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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtensionVersionService = void 0;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
class ExtensionVersionService {
    static EXTENSION_ID = 'zhangchck.yonbip-devtool';
    static MARKETPLACE_API_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery/';
    static currentVersion = '';
    static async initialize(context) {
        try {
            const extension = vscode.extensions.getExtension(this.EXTENSION_ID);
            if (extension) {
                this.currentVersion = extension.packageJSON.version;
                console.log(`[ExtensionVersionService] 当前插件版本: ${this.currentVersion}`);
            }
            else {
                console.warn(`[ExtensionVersionService] 无法找到扩展: ${this.EXTENSION_ID}`);
            }
        }
        catch (error) {
            console.error('[ExtensionVersionService] 获取当前插件版本失败:', error);
        }
    }
    static async checkForUpdates() {
        try {
            console.log('[ExtensionVersionService] 开始检查插件更新');
            if (!this.currentVersion) {
                console.warn('[ExtensionVersionService] 当前版本未知，跳过更新检查');
                return null;
            }
            const latestVersionInfo = await this.queryLatestVersion();
            if (latestVersionInfo && this.isNewerVersion(latestVersionInfo.latestVersion, this.currentVersion)) {
                console.log(`[ExtensionVersionService] 发现新版本: ${latestVersionInfo.latestVersion}, 当前版本: ${this.currentVersion}`);
                return latestVersionInfo;
            }
            else {
                console.log(`[ExtensionVersionService] 当前已是最新版本: ${this.currentVersion}`);
            }
            return null;
        }
        catch (error) {
            console.error('[ExtensionVersionService] 检查插件更新失败:', error);
            return null;
        }
    }
    static async queryLatestVersion() {
        try {
            const response = await axios_1.default.post(this.MARKETPLACE_API_URL, {
                filters: [{
                        criteria: [{
                                filterType: 7,
                                value: this.EXTENSION_ID
                            }]
                    }],
                flags: 914
            }, {
                headers: {
                    'Accept': 'application/json;api-version=3.0-preview.1',
                    'Content-Type': 'application/json'
                }
            });
            if (response.data && response.data.results && response.data.results.length > 0) {
                const extensions = response.data.results[0].extensions;
                if (extensions && extensions.length > 0) {
                    const extension = extensions[0];
                    const versions = extension.versions;
                    if (versions && versions.length > 0) {
                        const latestVersion = versions[0];
                        return {
                            latestVersion: latestVersion.version,
                            releaseNotes: latestVersion.releaseNotes
                        };
                    }
                }
            }
            throw new Error('无法从Marketplace获取版本信息');
        }
        catch (error) {
            console.error('查询最新版本失败:', error);
            throw error;
        }
    }
    static isNewerVersion(latestVersion, currentVersion) {
        try {
            const latestParts = latestVersion.split('.').map(Number);
            const currentParts = currentVersion.split('.').map(Number);
            for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
                const latestPart = i < latestParts.length ? latestParts[i] : 0;
                const currentPart = i < currentParts.length ? currentParts[i] : 0;
                if (latestPart > currentPart) {
                    return true;
                }
                else if (latestPart < currentPart) {
                    return false;
                }
            }
            return false;
        }
        catch (error) {
            console.error('版本号比较失败:', error);
            return false;
        }
    }
    static async showUpdateNotification(latestVersion, releaseNotes) {
        try {
            const message = `发现新版本 ${latestVersion}，当前版本 ${this.currentVersion}。建议更新以获得最新功能和修复。`;
            const updateButton = '更新插件';
            const learnMoreButton = '查看详情';
            const dismissButton = '稍后提醒';
            const selection = await vscode.window.showInformationMessage(message, { modal: false }, updateButton, learnMoreButton, dismissButton);
            switch (selection) {
                case updateButton:
                    vscode.env.openExternal(vscode.Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${this.EXTENSION_ID}`));
                    break;
                case learnMoreButton:
                    if (releaseNotes) {
                        vscode.window.showInformationMessage(`版本 ${latestVersion} 更新内容:\n\n${releaseNotes}`, { modal: true });
                    }
                    else {
                        vscode.window.showInformationMessage(`版本 ${latestVersion} 更新内容暂无详细说明。`, { modal: true });
                    }
                    break;
                case dismissButton:
                    break;
            }
        }
        catch (error) {
            console.error('显示更新提醒失败:', error);
        }
    }
    static async suggestUninstallOldVersions() {
        try {
            const allExtensions = vscode.extensions.all;
            const similarExtensions = allExtensions.filter(ext => ext.id.includes('yonbip') &&
                ext.id.includes('devtool') &&
                ext.id !== this.EXTENSION_ID);
            if (similarExtensions.length > 0) {
                const message = `检测到 ${similarExtensions.length} 个可能的旧版本或重复插件，请手动检查并卸载以避免冲突。`;
                const manageExtensionsButton = '管理扩展';
                const selection = await vscode.window.showWarningMessage(message, { modal: false }, manageExtensionsButton);
                if (selection === manageExtensionsButton) {
                    vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithDuplicates');
                }
            }
        }
        catch (error) {
            console.error('提醒卸载旧版本插件失败:', error);
        }
    }
}
exports.ExtensionVersionService = ExtensionVersionService;
//# sourceMappingURL=ExtensionVersionService.js.map