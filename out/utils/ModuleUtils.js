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
exports.ModuleUtils = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ModuleUtils {
    static getAllModuleCodes(homePath) {
        const moduleCodes = [];
        const modulesPath = path.join(homePath, 'modules');
        if (!fs.existsSync(modulesPath)) {
            return moduleCodes;
        }
        try {
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            moduleCodes.push(...moduleDirs);
        }
        catch (error) {
            console.error('读取模块目录失败:', error);
        }
        return moduleCodes;
    }
    static readModuleConfig(configFilePath) {
        const moduleConfigs = [];
        if (!fs.existsSync(configFilePath)) {
            return moduleConfigs;
        }
        try {
            const content = fs.readFileSync(configFilePath, 'utf-8');
            const configData = JSON.parse(content);
            if (Array.isArray(configData)) {
                for (const group of configData) {
                    if (group.modules && Array.isArray(group.modules)) {
                        for (const module of group.modules) {
                            moduleConfigs.push({
                                code: module.code,
                                name: module.name || '',
                                must: module.must || false
                            });
                        }
                    }
                }
            }
        }
        catch (error) {
            console.error('读取模块配置文件失败:', error);
        }
        return moduleConfigs;
    }
    static buildModuleInfos(homePath, configFilePath) {
        const moduleInfos = [];
        const moduleCodes = this.getAllModuleCodes(homePath);
        const moduleConfigs = this.readModuleConfig(configFilePath);
        const configMap = new Map();
        moduleConfigs.forEach(config => {
            configMap.set(config.code, config);
        });
        for (const code of moduleCodes) {
            const config = configMap.get(code);
            moduleInfos.push({
                code: code,
                name: config?.name || '',
                must: config?.must || false,
                enabled: true
            });
        }
        return moduleInfos;
    }
    static getEnabledModuleCodes(moduleInfos) {
        return moduleInfos
            .filter(module => module.enabled)
            .map(module => module.code);
    }
    static isRequiredModule(moduleCode, moduleInfos) {
        const module = moduleInfos.find(m => m.code === moduleCode);
        return module?.must || false;
    }
}
exports.ModuleUtils = ModuleUtils;
//# sourceMappingURL=ModuleUtils.js.map