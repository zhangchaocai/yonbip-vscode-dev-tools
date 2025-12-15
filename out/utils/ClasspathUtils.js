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
exports.ClasspathUtils = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ModuleConfigService_1 = require("./ModuleConfigService");
class ClasspathUtils {
    static getClassesPaths(scanPath) {
        const classesPaths = [];
        const mainClassesPath = path.join(scanPath, 'classes');
        if (fs.existsSync(mainClassesPath) && fs.readdirSync(mainClassesPath).length > 0) {
            classesPaths.push(mainClassesPath);
        }
        return classesPaths;
    }
    static getModuleClassesPaths(modulePath) {
        const classesPaths = [];
        const potentialClassesPaths = [
            path.join(modulePath, 'META-INF', 'classes'),
            path.join(modulePath, 'META-INF', 'extension', 'classes'),
            path.join(modulePath, 'META-INF', 'hyext', 'classes'),
            path.join(modulePath, 'classes'),
            path.join(modulePath, 'extension', 'classes'),
            path.join(modulePath, 'hyext', 'classes'),
            path.join(modulePath, 'client', 'classes'),
            path.join(modulePath, 'client', 'extension', 'classes'),
            path.join(modulePath, 'client', 'hyext', 'classes')
        ];
        for (const classesPath of potentialClassesPaths) {
            if (fs.existsSync(classesPath) && fs.readdirSync(classesPath).length > 0) {
                classesPaths.push(classesPath);
            }
        }
        return classesPaths;
    }
    static getModuleLibPaths(modulePath) {
        const libPaths = [];
        const libDir = path.join(modulePath, 'lib');
        const metaInfLibDir = path.join(modulePath, 'META-INF', 'lib');
        if (fs.existsSync(libDir)) {
            try {
                const files = fs.readdirSync(libDir);
                const hasJars = files.some(file => file.endsWith('.jar'));
                if (hasJars) {
                    libPaths.push(path.join(libDir, '*'));
                }
            }
            catch (error) {
            }
        }
        if (fs.existsSync(metaInfLibDir)) {
            try {
                const files = fs.readdirSync(metaInfLibDir);
                const hasJars = files.some(file => file.endsWith('.jar'));
                if (hasJars) {
                    libPaths.push(path.join(metaInfLibDir, '*'));
                }
            }
            catch (error) {
            }
        }
        return libPaths;
    }
    static getAllModuleClassesPaths(homePath, context) {
        const classesPaths = [];
        const modulesPath = path.join(homePath, 'modules');
        if (!fs.existsSync(modulesPath)) {
            return classesPaths;
        }
        try {
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            let enabledModules = moduleDirs;
            if (context) {
                try {
                    const moduleConfigService = new ModuleConfigService_1.ModuleConfigService(context);
                    const enabledModuleCodes = moduleConfigService.getEnabledModuleCodes(homePath);
                    enabledModules = moduleDirs.filter(moduleDir => enabledModuleCodes.includes(moduleDir));
                }
                catch (error) {
                    console.warn('获取模块配置失败，将加载所有模块:', error);
                    enabledModules = moduleDirs;
                }
            }
            const uapbsIndex = enabledModules.indexOf('uapbs');
            if (uapbsIndex !== -1) {
                const uapbsModule = enabledModules.splice(uapbsIndex, 1)[0];
                enabledModules.unshift(uapbsModule);
            }
            for (const moduleName of enabledModules) {
                const modulePath = path.join(modulesPath, moduleName);
                const moduleClassesPaths = this.getModuleClassesPaths(modulePath);
                classesPaths.push(...moduleClassesPaths);
            }
        }
        catch (error) {
        }
        return classesPaths;
    }
    static getAllModuleLibPaths(homePath, context) {
        const libPaths = [];
        const modulesPath = path.join(homePath, 'modules');
        if (!fs.existsSync(modulesPath)) {
            return libPaths;
        }
        try {
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            let enabledModules = moduleDirs;
            if (context) {
                try {
                    const moduleConfigService = new ModuleConfigService_1.ModuleConfigService(context);
                    const enabledModuleCodes = moduleConfigService.getEnabledModuleCodes(homePath);
                    enabledModules = moduleDirs.filter(moduleDir => enabledModuleCodes.includes(moduleDir));
                }
                catch (error) {
                    console.warn('获取模块配置失败，将加载所有模块:', error);
                    enabledModules = moduleDirs;
                }
            }
            const uapbsIndex = enabledModules.indexOf('uapbs');
            if (uapbsIndex !== -1) {
                const uapbsModule = enabledModules.splice(uapbsIndex, 1)[0];
                enabledModules.unshift(uapbsModule);
            }
            for (const moduleName of enabledModules) {
                const modulePath = path.join(modulesPath, moduleName);
                const moduleLibPaths = this.getModuleLibPaths(modulePath);
                libPaths.push(...moduleLibPaths);
            }
        }
        catch (error) {
        }
        return libPaths;
    }
}
exports.ClasspathUtils = ClasspathUtils;
//# sourceMappingURL=ClasspathUtils.js.map