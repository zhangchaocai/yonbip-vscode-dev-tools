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
exports.ClasspathContainerResolver = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ClasspathContainerResolver {
    outputChannel;
    homePath;
    static CONTAINER_NAMES = {
        ANT_LIBRARY: 'Ant_Library',
        PRODUCT_COMMON_LIBRARY: 'Product_Common_Library',
        MIDDLEWARE_LIBRARY: 'Middleware_Library',
        FRAMEWORK_LIBRARY: 'Framework_Library',
        MODULE_PUBLIC_LIBRARY: 'Module_Public_Library',
        MODULE_CLIENT_LIBRARY: 'Module_Client_Library',
        MODULE_PRIVATE_LIBRARY: 'Module_Private_Library',
        MODULE_LANG_LIBRARY: 'Module_Lang_Library',
        GENERATED_EJB: 'Generated_EJB',
        NCLOUD_LIBRARY: 'NCCloud_Library'
    };
    constructor(homePath) {
        this.homePath = homePath;
        this.outputChannel = vscode.window.createOutputChannel('YonBIP Classpath Container');
    }
    resolveContainerPath(containerPath) {
        try {
            const pathParts = containerPath.split('/');
            if (pathParts.length < 2) {
                this.outputChannel.appendLine(`❌ 无效的容器路径格式: ${containerPath}`);
                return [];
            }
            const containerId = pathParts[0];
            const libraryName = pathParts[1];
            if (containerId !== 'com.yonyou.studio.udt.core.container') {
                this.outputChannel.appendLine(`❌ 不支持的容器ID: ${containerId}`);
                return [];
            }
            return this.resolveLibraryPaths(libraryName);
        }
        catch (error) {
            this.outputChannel.appendLine(`❌ 解析容器路径时出错: ${error.message}`);
            return [];
        }
    }
    resolveLibraryPaths(libraryName) {
        const paths = [];
        switch (libraryName) {
            case ClasspathContainerResolver.CONTAINER_NAMES.ANT_LIBRARY:
                paths.push(...this.getAntLibraryPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.PRODUCT_COMMON_LIBRARY:
                paths.push(...this.getProductCommonLibraryPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.MIDDLEWARE_LIBRARY:
                paths.push(...this.getMiddlewareLibraryPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.FRAMEWORK_LIBRARY:
                paths.push(...this.getFrameworkLibraryPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.MODULE_PUBLIC_LIBRARY:
                paths.push(...this.getModulePublicLibraryPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.MODULE_CLIENT_LIBRARY:
                paths.push(...this.getModuleClientLibraryPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.MODULE_PRIVATE_LIBRARY:
                paths.push(...this.getModulePrivateLibraryPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.MODULE_LANG_LIBRARY:
                paths.push(...this.getModuleLangLibraryPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.GENERATED_EJB:
                paths.push(...this.getGeneratedEjbPaths());
                break;
            case ClasspathContainerResolver.CONTAINER_NAMES.NCLOUD_LIBRARY:
                paths.push(...this.getNcCloudLibraryPaths());
                break;
            default:
                this.outputChannel.appendLine(`⚠️  未知的库名称: ${libraryName}`);
                break;
        }
        this.outputChannel.appendLine(`🔍 解析库 "${libraryName}" 找到 ${paths.length} 个路径`);
        return paths;
    }
    getAntLibraryPaths() {
        const paths = [];
        const antPath = path.join(this.homePath, 'ant');
        if (fs.existsSync(antPath)) {
            const libPath = path.join(antPath, 'lib');
            if (fs.existsSync(libPath)) {
                try {
                    const files = fs.readdirSync(libPath);
                    files.forEach(file => {
                        if (file.endsWith('.jar')) {
                            paths.push(path.join(libPath, file));
                        }
                    });
                }
                catch (error) {
                    this.outputChannel.appendLine(`⚠️  读取Ant库目录失败: ${error}`);
                }
            }
        }
        return paths;
    }
    getProductCommonLibraryPaths() {
        const paths = [];
        const externalPath = path.join(this.homePath, 'external');
        if (fs.existsSync(externalPath)) {
            try {
                const files = fs.readdirSync(externalPath);
                files.forEach(file => {
                    if (file.endsWith('.jar')) {
                        paths.push(path.join(externalPath, file));
                    }
                });
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️  读取external目录失败: ${error}`);
            }
        }
        const libPath = path.join(this.homePath, 'lib');
        if (fs.existsSync(libPath)) {
            try {
                const files = fs.readdirSync(libPath);
                files.forEach(file => {
                    if (file.endsWith('.jar')) {
                        paths.push(path.join(libPath, file));
                    }
                });
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️  读取lib目录失败: ${error}`);
            }
        }
        return paths;
    }
    getMiddlewareLibraryPaths() {
        const paths = [];
        const middlewarePath = path.join(this.homePath, 'middleware');
        if (fs.existsSync(middlewarePath)) {
            try {
                const files = fs.readdirSync(middlewarePath);
                files.forEach(file => {
                    if (file.endsWith('.jar')) {
                        paths.push(path.join(middlewarePath, file));
                    }
                });
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️  读取middleware目录失败: ${error}`);
            }
        }
        return paths;
    }
    getFrameworkLibraryPaths() {
        const paths = [];
        const frameworkPath = path.join(this.homePath, 'framework');
        if (fs.existsSync(frameworkPath)) {
            try {
                const files = fs.readdirSync(frameworkPath);
                files.forEach(file => {
                    if (file.endsWith('.jar')) {
                        paths.push(path.join(frameworkPath, file));
                    }
                });
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️  读取framework目录失败: ${error}`);
            }
        }
        return paths;
    }
    getModulePublicLibraryPaths() {
        return this.getModuleLibraryPaths('public');
    }
    getModuleClientLibraryPaths() {
        return this.getModuleLibraryPaths('client');
    }
    getModulePrivateLibraryPaths() {
        return this.getModuleLibraryPaths('private');
    }
    getModuleLibraryPaths(libType) {
        const paths = [];
        const modulesPath = path.join(this.homePath, 'modules');
        if (!fs.existsSync(modulesPath)) {
            return paths;
        }
        try {
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            moduleDirs.forEach(moduleName => {
                const modulePath = path.join(modulesPath, moduleName);
                let libPath = '';
                switch (libType) {
                    case 'public':
                        libPath = path.join(modulePath, 'lib');
                        break;
                    case 'client':
                        libPath = path.join(modulePath, 'client', 'lib');
                        break;
                    case 'private':
                        libPath = path.join(modulePath, 'META-INF', 'lib');
                        break;
                }
                if (fs.existsSync(libPath)) {
                    try {
                        const files = fs.readdirSync(libPath);
                        files.forEach(file => {
                            if (file.endsWith('.jar')) {
                                paths.push(path.join(libPath, file));
                            }
                        });
                    }
                    catch (error) {
                        this.outputChannel.appendLine(`⚠️  读取模块库目录失败 ${libPath}: ${error}`);
                    }
                }
            });
        }
        catch (error) {
            this.outputChannel.appendLine(`⚠️  读取modules目录失败: ${error}`);
        }
        return paths;
    }
    getModuleLangLibraryPaths() {
        const paths = [];
        const langlibPath = path.join(this.homePath, 'langlib');
        if (fs.existsSync(langlibPath)) {
            try {
                const files = fs.readdirSync(langlibPath);
                files.forEach(file => {
                    if (file.endsWith('.jar')) {
                        paths.push(path.join(langlibPath, file));
                    }
                });
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️  读取langlib目录失败: ${error}`);
            }
        }
        return paths;
    }
    getGeneratedEjbPaths() {
        const paths = [];
        const ejbPath = path.join(this.homePath, 'ejb');
        if (fs.existsSync(ejbPath)) {
            try {
                const files = fs.readdirSync(ejbPath);
                files.forEach(file => {
                    if (file.endsWith('.jar')) {
                        paths.push(path.join(ejbPath, file));
                    }
                });
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️  读取ejb目录失败: ${error}`);
            }
        }
        return paths;
    }
    getNcCloudLibraryPaths() {
        const paths = [];
        const nccloudPath = path.join(this.homePath, 'hotwebs', 'nccloud', 'WEB-INF', 'lib');
        if (fs.existsSync(nccloudPath)) {
            try {
                const files = fs.readdirSync(nccloudPath);
                files.forEach(file => {
                    if (file.endsWith('.jar')) {
                        paths.push(path.join(nccloudPath, file));
                    }
                });
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️  读取nccloud库目录失败: ${error}`);
            }
        }
        return paths;
    }
    dispose() {
        if (this.outputChannel) {
            this.outputChannel.dispose();
        }
    }
}
exports.ClasspathContainerResolver = ClasspathContainerResolver;
//# sourceMappingURL=ClasspathContainerResolver.js.map