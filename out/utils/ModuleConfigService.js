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
exports.ModuleConfigService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ModuleUtils_1 = require("./ModuleUtils");
class ModuleConfigService {
    context;
    configFilePath;
    constructor(context) {
        this.context = context;
        this.configFilePath = this.getConfigFilePath();
    }
    getConfigFilePath() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return path.join(workspaceFolders[0].uri.fsPath, '.nc-module-config.json');
        }
        else {
            return path.join(this.context.extensionPath, '.nc-module-config.json');
        }
    }
    getModuleInfos(homePath) {
        const resourceConfigPath = path.join(this.context.extensionPath, 'resources', 'configuration', 'module-config.json');
        const moduleInfos = ModuleUtils_1.ModuleUtils.buildModuleInfos(homePath, resourceConfigPath);
        const savedConfig = this.loadModuleConfig();
        if (savedConfig) {
            for (const moduleInfo of moduleInfos) {
                const savedModule = savedConfig.find(m => m.code === moduleInfo.code);
                if (savedModule) {
                    moduleInfo.enabled = moduleInfo.must ? true : savedModule.enabled;
                }
            }
        }
        return moduleInfos;
    }
    async saveModuleConfig(moduleInfos) {
        try {
            const configData = moduleInfos.map(module => ({
                code: module.code,
                name: module.name,
                must: module.must,
                enabled: module.enabled
            }));
            const content = JSON.stringify(configData, null, 2);
            fs.writeFileSync(this.configFilePath, content, 'utf-8');
        }
        catch (error) {
            console.error('保存模块配置失败:', error);
            throw error;
        }
    }
    loadModuleConfig() {
        try {
            if (fs.existsSync(this.configFilePath)) {
                const content = fs.readFileSync(this.configFilePath, 'utf-8');
                return JSON.parse(content);
            }
        }
        catch (error) {
            console.error('加载模块配置失败:', error);
        }
        return null;
    }
    getEnabledModuleCodes(homePath) {
        const moduleInfos = this.getModuleInfos(homePath);
        return ModuleUtils_1.ModuleUtils.getEnabledModuleCodes(moduleInfos);
    }
    async resetToDefault(homePath) {
        try {
            if (fs.existsSync(this.configFilePath)) {
                fs.unlinkSync(this.configFilePath);
            }
        }
        catch (error) {
            console.error('重置模块配置失败:', error);
            throw error;
        }
    }
    isModuleEnabled(moduleCode, homePath) {
        const moduleInfos = this.getModuleInfos(homePath);
        const module = moduleInfos.find(m => m.code === moduleCode);
        return module?.enabled || false;
    }
}
exports.ModuleConfigService = ModuleConfigService;
//# sourceMappingURL=ModuleConfigService.js.map