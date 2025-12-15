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
exports.LibraryService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const NCHomeConfigService_1 = require("../../home/config/NCHomeConfigService");
const JavaVersionUtils_1 = require("../../../shared/utils/JavaVersionUtils");
const ClasspathUtils_1 = require("../../../shared/utils/ClasspathUtils");
class LibraryService {
    static LIBRARY_NAMES = {
        DB_DRIVER_LIBRARY: 'DB_Drive_Library',
        ANT_LIBRARY: 'Ant_Library',
        PRODUCT_COMMON_LIBRARY: 'Product_Common_Library',
        MIDDLEWARE_LIBRARY: 'Middleware_Library',
        FRAMEWORK_LIBRARY: 'Framework_Library',
        EXTENSION_PUBLIC_LIBRARY: 'Extension_Public_Library',
        HYEXT_PUBLIC_LIBRARY: 'Hyext_Public_Library',
        MODULE_PUBLIC_LIBRARY: 'Module_Public_Library',
        EXTENSION_CLIENT_LIBRARY: 'Extension_Client_Library',
        HYEXT_CLIENT_LIBRARY: 'Hyext_Client_Library',
        MODULE_CLIENT_LIBRARY: 'Module_Client_Library',
        EXTENSION_PRIVATE_LIBRARY: 'Extension_Private_Library',
        HYEXT_PRIVATE_LIBRARY: 'Hyext_Private_Library',
        MODULE_PRIVATE_LIBRARY: 'Module_Private_Library',
        MODULE_LANG_LIBRARY: 'Module_Lang_Library',
        GENERATED_EJB: 'Generated_EJB',
        NCCLOUD_LIBRARY: 'NCCloud_Library',
        NCCHR_LIBRARY: 'NCCHr_Library',
        RESOURCES_LIBRARY: 'resources'
    };
    static outputChannelInstance = null;
    outputChannel;
    context;
    configService;
    constructor(context, configService) {
        if (!LibraryService.outputChannelInstance) {
            LibraryService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP Library Service');
        }
        this.outputChannel = LibraryService.outputChannelInstance;
        this.context = context;
        this.configService = configService || new NCHomeConfigService_1.NCHomeConfigService(context);
    }
    getLibraryNameList(needDbLibrary) {
        const list = [];
        if (needDbLibrary) {
            list.push(LibraryService.LIBRARY_NAMES.DB_DRIVER_LIBRARY);
        }
        list.push(LibraryService.LIBRARY_NAMES.ANT_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.PRODUCT_COMMON_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MIDDLEWARE_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.FRAMEWORK_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MODULE_LANG_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.GENERATED_EJB);
        list.push(LibraryService.LIBRARY_NAMES.NCCLOUD_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.NCCHR_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.RESOURCES_LIBRARY);
        return list;
    }
    async copyScaffold(scaffoldPath, targetPath) {
        return new Promise((resolve, reject) => {
            try {
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                this.copyDirectoryRecursive(scaffoldPath, targetPath);
                this.outputChannel.appendLine(`脚手架复制完成: ${scaffoldPath} -> ${targetPath}`);
                resolve();
            }
            catch (error) {
                this.outputChannel.appendLine(`复制脚手架失败: ${error}`);
                reject(error);
            }
        });
    }
    copyDirectoryRecursive(source, target) {
        if (!fs.existsSync(source)) {
            return;
        }
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }
        const files = fs.readdirSync(source);
        for (const file of files) {
            const sourcePath = path.join(source, file);
            const targetPath = path.join(target, file);
            const stat = fs.statSync(sourcePath);
            if (stat.isDirectory()) {
                this.copyDirectoryRecursive(sourcePath, targetPath);
            }
            else {
                fs.copyFileSync(sourcePath, targetPath);
            }
        }
    }
    async initLibrary(homePath, needDbLibrary = false, driverLibPath, selectedPath) {
        this.outputChannel.appendLine(`开始初始化库，HOME路径: ${homePath}`);
        try {
            if (!this.validateHomePath(homePath)) {
                throw new Error('无效的HOME路径');
            }
            let targetPath;
            if (selectedPath) {
                targetPath = selectedPath;
            }
            else {
                const workspaceFolder = this.getWorkspaceFolder();
                if (!workspaceFolder) {
                    throw new Error('未找到工作区文件夹');
                }
                targetPath = workspaceFolder.uri.fsPath;
            }
            const libDir = path.join(targetPath, '.lib');
            if (!fs.existsSync(libDir)) {
                fs.mkdirSync(libDir, { recursive: true });
            }
            const libraryNameList = this.getLibraryNameList(needDbLibrary);
            const moduleJarMap = this.getModuleJarMap(homePath);
            const allJarNameList = [];
            for (const libraryName of libraryNameList) {
                await this.generateLibraryConfig(libraryName, homePath, libDir, moduleJarMap, driverLibPath, allJarNameList);
            }
            await this.generateWorkspaceSettings(homePath);
            await this.generateLaunchConfiguration(targetPath, libDir);
            await this.generateEclipseProjectFiles(homePath, targetPath);
            this.outputChannel.appendLine('库初始化完成');
            vscode.window.showInformationMessage('Java项目库初始化完成');
        }
        catch (error) {
            this.outputChannel.appendLine(`初始化库失败: ${error.message}`);
            vscode.window.showErrorMessage(`初始化库失败: ${error.message}`);
            throw error;
        }
    }
    validateHomePath(homePath) {
        const requiredPaths = ['bin', 'lib', 'modules', 'hotwebs', 'resources'];
        for (const requiredPath of requiredPaths) {
            const fullPath = path.join(homePath, requiredPath);
            if (!fs.existsSync(fullPath)) {
                this.outputChannel.appendLine(`缺少必需的目录: ${requiredPath}`);
                return false;
            }
        }
        return true;
    }
    getWorkspaceFolder() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return workspaceFolders ? workspaceFolders[0] : undefined;
    }
    getModuleJarMap(homePath) {
        const moduleJarMap = new Map();
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY, []);
        const modulesPath = path.join(homePath, 'modules');
        if (fs.existsSync(modulesPath)) {
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => path.join(modulesPath, dirent.name));
            for (const modulePath of moduleDirs) {
                this.loadModuleJarMap(moduleJarMap, modulePath);
            }
        }
        return moduleJarMap;
    }
    loadModuleJarMap(moduleJarMap, modulePath) {
        const extensionPublicPaths = this.getJarAndClasses(path.join(modulePath, 'extension'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY)?.push(...extensionPublicPaths);
        const hyextPublicPaths = this.getJarAndClasses(path.join(modulePath, 'hyext'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY)?.push(...hyextPublicPaths);
        const publicPaths = this.getJarAndClasses(modulePath, true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY)?.push(...publicPaths);
        const extensionClientPaths = this.getJarAndClasses(path.join(modulePath, 'client', 'extension'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY)?.push(...extensionClientPaths);
        const hyextClientPaths = this.getJarAndClasses(path.join(modulePath, 'client', 'hyext'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY)?.push(...hyextClientPaths);
        const clientPaths = this.getJarAndClasses(path.join(modulePath, 'client'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY)?.push(...clientPaths);
        const extensionPrivatePaths = this.getJarAndClasses(path.join(modulePath, 'META-INF', 'extension'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY)?.push(...extensionPrivatePaths);
        const hyextPrivatePaths = this.getJarAndClasses(path.join(modulePath, 'META-INF', 'hyext'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY)?.push(...hyextPrivatePaths);
        const privatePaths = this.getJarAndClasses(path.join(modulePath, 'META-INF'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY)?.push(...privatePaths);
        const privateExtraPaths = this.getJarAndClasses(path.join(modulePath, 'META-INF', 'extra'), false);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY)?.push(...privateExtraPaths);
    }
    getJarAndClasses(scanPath, hasLibPath) {
        const pathList = [];
        const jarPath = hasLibPath ? path.join(scanPath, 'lib') : scanPath;
        const jarDir = path.join(jarPath);
        if (fs.existsSync(jarDir)) {
            const files = fs.readdirSync(jarDir);
            for (const file of files) {
                if (file.endsWith('.jar')) {
                    pathList.push(path.join(jarDir, file));
                }
            }
        }
        return pathList;
    }
    async generateLibraryConfig(libraryName, homePath, libDir, moduleJarMap, driverLibPath, allJarNameList) {
        let jarPathList = [];
        switch (libraryName) {
            case LibraryService.LIBRARY_NAMES.DB_DRIVER_LIBRARY:
                if (driverLibPath && fs.existsSync(driverLibPath)) {
                    const driverPaths = driverLibPath.split(',');
                    for (const path of driverPaths) {
                        if (fs.existsSync(path.trim())) {
                            jarPathList.push(path.trim());
                        }
                    }
                }
                break;
            case LibraryService.LIBRARY_NAMES.ANT_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'ant'), true);
                break;
            case LibraryService.LIBRARY_NAMES.PRODUCT_COMMON_LIBRARY:
                const externalPaths = this.getJarAndClasses(path.join(homePath, 'external'), true);
                const libPaths = this.getJarAndClasses(path.join(homePath, 'lib'), false);
                jarPathList = [...externalPaths, ...libPaths];
                break;
            case LibraryService.LIBRARY_NAMES.MIDDLEWARE_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'middleware'), false);
                break;
            case LibraryService.LIBRARY_NAMES.FRAMEWORK_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'framework'), false);
                break;
            case LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY:
            case LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY:
            case LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY:
            case LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY:
            case LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY:
            case LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY:
            case LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY:
            case LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY:
            case LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY:
                jarPathList = moduleJarMap.get(libraryName) || [];
                break;
            case LibraryService.LIBRARY_NAMES.MODULE_LANG_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'langlib'), false);
                break;
            case LibraryService.LIBRARY_NAMES.GENERATED_EJB:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'ejb'), false);
                break;
            case LibraryService.LIBRARY_NAMES.NCCLOUD_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF'), true);
                break;
            case LibraryService.LIBRARY_NAMES.NCCHR_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'hotwebs', 'ncchr', 'WEB-INF'), true);
                break;
            case LibraryService.LIBRARY_NAMES.RESOURCES_LIBRARY:
                jarPathList = [path.join(homePath, 'resources')];
                break;
        }
        const distinctJarPaths = this.getDistinctJarPaths(jarPathList, allJarNameList);
        const libraryConfig = {
            name: libraryName,
            paths: distinctJarPaths,
            type: this.getLibraryType(libraryName)
        };
        const configPath = path.join(libDir, `${libraryName}.json`);
        fs.writeFileSync(configPath, JSON.stringify(libraryConfig, null, 2), 'utf-8');
        this.outputChannel.appendLine(`库配置已生成: ${libraryName} (${distinctJarPaths.length}个路径)`);
    }
    getLibraryType(libraryName) {
        if (libraryName === LibraryService.LIBRARY_NAMES.RESOURCES_LIBRARY) {
            return 'resources';
        }
        return 'jar';
    }
    getDistinctJarPaths(jarPathList, allJarNameList) {
        const resultList = [];
        const jarInfoList = jarPathList.map(jarPath => {
            if (!jarPath.toLowerCase().endsWith('.jar') || jarPath.toLowerCase().endsWith('_src.jar')) {
                resultList.push(jarPath);
                return null;
            }
            const jarInfo = this.parseJarInfo(jarPath);
            if (!allJarNameList.includes(jarInfo.jarName)) {
                return jarInfo;
            }
            return null;
        }).filter(info => info !== null);
        jarInfoList.forEach(jarInfo => {
            const first = jarInfoList.find(info => this.getJarFirstName(info.jarName) === this.getJarFirstName(jarInfo.jarName) &&
                this.compareVersions(info.jarVersion, jarInfo.jarVersion) > 0);
            if (!first) {
                resultList.push(jarInfo.jarPath);
                allJarNameList.push(jarInfo.jarName);
            }
        });
        return resultList;
    }
    parseJarInfo(jarPath) {
        const jarName = path.basename(jarPath);
        const match = jarName.match(/^(.+?)-(\d+(?:\.\d+)*).*\.jar$/);
        if (match) {
            return {
                jarPath,
                jarName,
                jarFirstName: match[1],
                jarVersion: match[2]
            };
        }
        return {
            jarPath,
            jarName,
            jarFirstName: jarName.replace('.jar', ''),
            jarVersion: '0.0.0'
        };
    }
    getJarFirstName(jarName) {
        return jarName.replace(/-\d.*\.jar$/, '');
    }
    compareVersions(version1, version2) {
        const v1 = version1.split('.');
        const v2 = version2.split('.');
        const length = Math.max(v1.length, v2.length);
        for (let i = 0; i < length; i++) {
            try {
                const num1 = i < v1.length ? parseInt(v1[i]) : 0;
                const num2 = i < v2.length ? parseInt(v2[i]) : 0;
                if (num1 < num2)
                    return -1;
                if (num1 > num2)
                    return 1;
            }
            catch (error) {
                return 0;
            }
        }
        return 0;
    }
    async updateVSCodeSettings(libDir, targetPath) {
        const libraryConfigs = fs.readdirSync(libDir)
            .filter(file => file.endsWith('.json'))
            .map(file => {
            const configPath = path.join(libDir, file);
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        });
        const workspaceRoot = this.getWorkspaceFolder()?.uri.fsPath || '';
        let relativePath = '.';
        if (targetPath && workspaceRoot) {
            relativePath = path.relative(workspaceRoot, targetPath) || '.';
        }
        const normalizedRelativePath = relativePath.split(path.sep).join('/');
        const sourcePaths = normalizedRelativePath === '.'
            ? ['src/private', 'src/public']
            : [`${normalizedRelativePath}/src/private`, `${normalizedRelativePath}/src/public`];
        const outputPath = normalizedRelativePath === '.'
            ? 'build/classes'
            : `${normalizedRelativePath}/build/classes`;
        const javaConfig = {
            'java.project.sourcePaths': sourcePaths,
            'java.project.outputPath': outputPath,
            'java.project.referencedLibraries': libraryConfigs.flatMap((config) => config.paths)
        };
        if (targetPath) {
            const vscodeDir = path.join(targetPath, '.vscode');
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }
            const settingsPath = path.join(vscodeDir, 'settings.json');
            let existingSettings = {};
            if (fs.existsSync(settingsPath)) {
                try {
                    const content = fs.readFileSync(settingsPath, 'utf-8');
                    existingSettings = JSON.parse(content);
                }
                catch (error) {
                    this.outputChannel.appendLine(`读取现有settings.json失败: ${error}`);
                }
            }
            const mergedSettings = { ...existingSettings, ...javaConfig };
            fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
            this.outputChannel.appendLine(`VSCode Java配置已保存到: ${settingsPath}`);
        }
        else {
            const workspaceConfig = vscode.workspace.getConfiguration();
            for (const [key, value] of Object.entries(javaConfig)) {
                await workspaceConfig.update(key, value, vscode.ConfigurationTarget.Workspace);
            }
            this.outputChannel.appendLine('VSCode Java配置已更新');
        }
    }
    async generateLaunchConfiguration(workspacePath, libDir) {
        try {
            const workspaceRoot = this.getWorkspaceFolder()?.uri.fsPath || '';
            const targetWorkspacePath = workspaceRoot || workspacePath;
            let relativePath = '.';
            if (workspaceRoot) {
                relativePath = path.relative(workspaceRoot, workspacePath) || '.';
            }
            const normalizedRelativePath = relativePath.split(path.sep).join('/');
            const sourcePath = normalizedRelativePath === '.'
                ? '${workspaceFolder}/src'
                : `\${workspaceFolder}/src`;
            const vscodeDir = path.join(targetWorkspacePath, '.vscode');
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }
            let existingLaunchConfig = {
                version: "0.2.0",
                configurations: []
            };
            const launchJsonPath = path.join(vscodeDir, 'launch.json');
            if (fs.existsSync(launchJsonPath)) {
                try {
                    const existingContent = fs.readFileSync(launchJsonPath, 'utf-8');
                    existingLaunchConfig = JSON.parse(existingContent);
                }
                catch (error) {
                    this.outputChannel.appendLine(`读取现有launch.json失败，将创建新的配置: ${error}`);
                }
            }
            const config = this.configService.getConfig();
            const javaDebugConfigurations = [
                {
                    type: "java",
                    name: "调试Java代码 (含JDK/第三方库)",
                    request: "attach",
                    hostName: "localhost",
                    port: config.debugPort || 8888,
                    projectName: "${workspaceFolderBasename}"
                }
            ];
            const nonJavaConfigurations = existingLaunchConfig.configurations.filter((config) => config.type !== "java");
            const newConfigurations = [
                ...nonJavaConfigurations,
                ...javaDebugConfigurations
            ];
            const launchConfig = {
                version: "0.2.0",
                configurations: newConfigurations
            };
            fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 4), 'utf-8');
            this.outputChannel.appendLine('launch.json调试配置已生成');
        }
        catch (error) {
            this.outputChannel.appendLine(`生成launch.json配置失败: ${error.message}`);
            throw error;
        }
    }
    async generateEclipseProjectFiles(homePath, selectedPath) {
        this.outputChannel.appendLine(`开始生成Eclipse项目文件，HOME路径: ${homePath}`);
        try {
            let targetPath;
            if (selectedPath) {
                targetPath = selectedPath;
            }
            else {
                const workspaceFolder = this.getWorkspaceFolder();
                if (!workspaceFolder) {
                    throw new Error('未找到工作区文件夹');
                }
                targetPath = workspaceFolder.uri.fsPath;
            }
            await this.generateProjectFile(targetPath);
            await this.generateClasspathFile(homePath, targetPath);
            this.outputChannel.appendLine('Eclipse项目文件生成完成');
            vscode.window.showInformationMessage('Eclipse项目文件生成完成');
        }
        catch (error) {
            this.outputChannel.appendLine(`生成Eclipse项目文件失败: ${error.message}`);
            vscode.window.showErrorMessage(`生成Eclipse项目文件失败: ${error.message}`);
            throw error;
        }
    }
    async generateProjectFile(workspacePath) {
        const projectFilePath = path.join(workspacePath, '.project');
        const projectName = path.basename(workspacePath);
        const projectFileContent = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
    <name>${projectName}</name>
    <comment></comment>
    <projects>
    </projects>
    <buildSpec>
        <buildCommand>
            <name>org.eclipse.jdt.core.javabuilder</name>
            <arguments>
            </arguments>
        </buildCommand>
    </buildSpec>
    <natures>
        <nature>org.eclipse.jdt.core.javanature</nature>
    </natures>
</projectDescription>`;
        fs.writeFileSync(projectFilePath, projectFileContent, 'utf-8');
        this.outputChannel.appendLine('.project 文件已生成');
    }
    async generateClasspathFile(homePath, workspacePath) {
        const classpathFilePath = path.join(workspacePath, '.classpath');
        const moduleClassesPaths = this.getModuleClassesPaths(homePath);
        const jarPaths = this.getAllJarPaths(homePath);
        const workspaceRoot = this.getWorkspaceFolder()?.uri.fsPath || '';
        let relativePath = '.';
        if (workspaceRoot) {
            relativePath = path.relative(workspaceRoot, workspacePath) || '.';
        }
        let classpathContent = `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
    <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>
    <classpathentry kind="output" path="build/classes"/>`;
        for (const classesPath of moduleClassesPaths) {
            const relativePath = path.relative(workspacePath, classesPath);
            const usePath = relativePath.startsWith('..') ? classesPath : relativePath;
            classpathContent += `\n    <classpathentry kind="lib" path="${usePath}"/>`;
        }
        for (const jarPath of jarPaths) {
            const relativePath = path.relative(workspacePath, jarPath);
            const usePath = relativePath.startsWith('..') ? jarPath : relativePath;
            classpathContent += `\n    <classpathentry kind="lib" path="${usePath}"/>`;
        }
        classpathContent += '\n</classpath>';
        fs.writeFileSync(classpathFilePath, classpathContent, 'utf-8');
        this.outputChannel.appendLine('.classpath 文件已生成，包含 ' + jarPaths.length + ' 个jar文件和 ' + moduleClassesPaths.length + ' 个classes路径');
    }
    getModuleClassesPaths(homePath) {
        this.outputChannel.appendLine(`开始扫描模块classes路径: ${homePath}`);
        const classesPaths = ClasspathUtils_1.ClasspathUtils.getAllModuleClassesPaths(homePath, this.context);
        for (const classesPath of classesPaths) {
            this.outputChannel.appendLine(`找到模块classes路径: ${classesPath}`);
        }
        return classesPaths;
    }
    getAllJarPaths(homePath) {
        const jarPaths = [];
        const moduleJarMap = this.getModuleJarMap(homePath);
        const libraryNameList = this.getLibraryNameList(true);
        for (const libraryName of libraryNameList) {
            let paths = [];
            switch (libraryName) {
                case LibraryService.LIBRARY_NAMES.DB_DRIVER_LIBRARY:
                    break;
                case LibraryService.LIBRARY_NAMES.ANT_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'ant'), true);
                    break;
                case LibraryService.LIBRARY_NAMES.PRODUCT_COMMON_LIBRARY:
                    const externalPaths = this.getJarAndClasses(path.join(homePath, 'external'), true);
                    const libPaths = this.getJarAndClasses(path.join(homePath, 'lib'), false);
                    paths = [...externalPaths, ...libPaths];
                    break;
                case LibraryService.LIBRARY_NAMES.MIDDLEWARE_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'middleware'), false);
                    break;
                case LibraryService.LIBRARY_NAMES.FRAMEWORK_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'framework'), false);
                    break;
                case LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY:
                case LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY:
                case LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY:
                case LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY:
                case LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY:
                case LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY:
                case LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY:
                case LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY:
                case LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY:
                    paths = moduleJarMap.get(libraryName) || [];
                    break;
                case LibraryService.LIBRARY_NAMES.MODULE_LANG_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'langlib'), false);
                    break;
                case LibraryService.LIBRARY_NAMES.GENERATED_EJB:
                    paths = this.getJarAndClasses(path.join(homePath, 'ejb'), false);
                    break;
                case LibraryService.LIBRARY_NAMES.NCCLOUD_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF'), true);
                    break;
                case LibraryService.LIBRARY_NAMES.NCCHR_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'hotwebs', 'ncchr', 'WEB-INF'), true);
                    break;
                case LibraryService.LIBRARY_NAMES.RESOURCES_LIBRARY:
                    break;
            }
            const jarFiles = paths.filter(p => p.toLowerCase().endsWith('.jar') && !p.toLowerCase().endsWith('_src.jar'));
            jarPaths.push(...jarFiles);
        }
        return [...new Set(jarPaths)];
    }
    getHomePathFromConfigFile() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceConfigPath = path.join(workspaceFolders[0].uri.fsPath, '.nc-home-config.json');
                if (fs.existsSync(workspaceConfigPath)) {
                    const config = JSON.parse(fs.readFileSync(workspaceConfigPath, 'utf-8'));
                    this.outputChannel.appendLine(`从工作区配置文件获取HOME路径: ${config.homePath || '未找到'}`);
                    return config.homePath;
                }
                else {
                    this.outputChannel.appendLine(`工作区配置文件不存在: ${workspaceConfigPath}`);
                }
            }
            return undefined;
        }
        catch (error) {
            this.outputChannel.appendLine(`读取配置文件失败: ${error}`);
            return undefined;
        }
    }
    async autoInitLibrary() {
        this.outputChannel.appendLine('=== 开始检查HOME路径配置 ===');
        const config = vscode.workspace.getConfiguration('yonbip');
        const homePath = config.get('homePath');
        this.outputChannel.appendLine(`从yonbip配置获取的homePath: ${homePath || '未找到'}`);
        const inspect = config.inspect('homePath');
        if (inspect) {
            this.outputChannel.appendLine(`工作区配置: ${inspect.workspaceValue || '未设置'}`);
            this.outputChannel.appendLine(`工作区文件夹配置: ${inspect.workspaceFolderValue || '未设置'}`);
        }
        const configFileHomePath = this.getHomePathFromConfigFile();
        let actualHomePath = homePath ||
            configFileHomePath ||
            inspect?.workspaceValue ||
            inspect?.workspaceFolderValue;
        if (!actualHomePath) {
            this.outputChannel.appendLine('未找到任何HOME路径配置，跳过库初始化');
            this.outputChannel.appendLine('解决方案:');
            this.outputChannel.appendLine('1. 通过命令面板运行: YonBIP/库管理: 调试配置信息');
            this.outputChannel.appendLine('2. 检查.vscode/settings.json中的yonbip.homePath配置');
            this.outputChannel.appendLine('3. 使用NC Home配置界面重新设置路径');
            return;
        }
        if (!fs.existsSync(actualHomePath)) {
            this.outputChannel.appendLine(`HOME路径不存在: ${actualHomePath}`);
            return;
        }
        this.outputChannel.appendLine(`使用HOME路径: ${actualHomePath}`);
        try {
            await this.initLibrary(actualHomePath);
            this.outputChannel.appendLine('库自动初始化完成');
        }
        catch (error) {
            this.outputChannel.appendLine(`自动初始化库失败: ${error.message}`);
        }
    }
    dispose() {
        if (LibraryService.outputChannelInstance) {
            LibraryService.outputChannelInstance.dispose();
            LibraryService.outputChannelInstance = null;
        }
    }
    getVSCodeUserSettingsPath() {
        const platform = process.platform;
        const homeDir = os.homedir();
        switch (platform) {
            case 'win32':
                return path.join(process.env.APPDATA || '', 'Code', 'User');
            case 'darwin':
                return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User');
            case 'linux':
                return path.join(homeDir, '.config', 'Code', 'User');
            default:
                return path.join(homeDir, '.config', 'Code', 'User');
        }
    }
    async generateWorkspaceSettings(homePath) {
        try {
            if (vscode.workspace.workspaceFile) {
                this.outputChannel.appendLine(`检测到多根工作区: ${vscode.workspace.workspaceFile.fsPath}`);
                if (vscode.workspace.workspaceFile.scheme !== 'file') {
                    this.outputChannel.appendLine('工作区未保存，无法直接更新工作区配置文件');
                    const errorMessage = '多根工作区需要先保存后才可以初始化项目。请先保存工作区文件（Ctrl+Shift+P 或 Cmd+Shift+P），搜索 save workplace 保存工作空间 然后重新执行初始化操作。';
                    vscode.window.showErrorMessage(errorMessage);
                    throw new Error(errorMessage);
                }
                const workspaceFilePath = vscode.workspace.workspaceFile.fsPath;
                if (!fs.existsSync(workspaceFilePath)) {
                    this.outputChannel.appendLine(`工作区配置文件不存在: ${workspaceFilePath}`);
                    const errorMessage = '多根工作区需要先保存后才可以初始化项目。请先保存工作区文件（Ctrl+Shift+P 或 Cmd+Shift+P），搜索 save workplace 保存工作空间，然后重新执行初始化操作。';
                    vscode.window.showErrorMessage(errorMessage);
                    throw new Error(errorMessage);
                }
                let workspaceConfig = {};
                try {
                    const content = fs.readFileSync(workspaceFilePath, 'utf-8');
                    workspaceConfig = JSON.parse(content);
                }
                catch (error) {
                    this.outputChannel.appendLine(`读取现有工作区配置失败: ${error}`);
                }
                const javaRuntimeConfig = await this.getJavaRuntimeConfig(homePath);
                const newSettings = {
                    "java.saveActions.organizeImports": true,
                    "java.compile.nullAnalysis.mode": "automatic",
                    "java.configuration.runtimes": javaRuntimeConfig,
                    "[java]": {
                        "files.encoding": "gbk"
                    },
                    "[javascript]": {
                        "files.encoding": "utf8"
                    },
                    "[typescript]": {
                        "files.encoding": "utf8"
                    }
                };
                if (!workspaceConfig.hasOwnProperty('settings')) {
                    workspaceConfig['settings'] = {};
                }
                workspaceConfig['settings'] = { ...workspaceConfig['settings'], ...newSettings };
                fs.writeFileSync(workspaceFilePath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
                this.outputChannel.appendLine(`多根工作区配置已更新: ${workspaceFilePath}`);
                vscode.window.showInformationMessage('多根工作区配置已更新，文件编码已设置为GBK，JDK运行时已配置');
            }
            else {
                this.outputChannel.appendLine('检测到单根工作区或未保存的多根工作区，使用用户设置');
                const editorConfigPath = this.getVSCodeUserSettingsPath();
                if (!fs.existsSync(editorConfigPath)) {
                    fs.mkdirSync(editorConfigPath, { recursive: true });
                }
                const settingsPath = path.join(editorConfigPath, 'settings.json');
                let existingSettings = {};
                if (fs.existsSync(settingsPath)) {
                    try {
                        const content = fs.readFileSync(settingsPath, 'utf-8');
                        existingSettings = JSON.parse(content);
                    }
                    catch (error) {
                        this.outputChannel.appendLine(`读取现有settings.json失败: ${error}`);
                    }
                }
                const javaRuntimeConfig = await this.getJavaRuntimeConfig(homePath);
                const newSettings = {
                    "java.saveActions.organizeImports": true,
                    "java.compile.nullAnalysis.mode": "automatic",
                    "java.configuration.runtimes": javaRuntimeConfig,
                    "[java]": {
                        "files.encoding": "gbk"
                    },
                    "[javascript]": {
                        "files.encoding": "utf8"
                    },
                    "[typescript]": {
                        "files.encoding": "utf8"
                    }
                };
                const mergedSettings = { ...existingSettings, ...newSettings };
                fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
                this.outputChannel.appendLine(`编辑器settings.json文件已更新: ${settingsPath}`);
                vscode.window.showInformationMessage('编辑器settings.json文件已更新，文件编码已设置为GBK，JDK运行时已配置');
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`更新编辑器配置失败: ${error.message}`);
            vscode.window.showErrorMessage(`更新编辑器配置失败: ${error.message}`);
            throw error;
        }
    }
    async fallbackToUserSettings(homePath) {
        this.outputChannel.appendLine('回退到用户级settings.json进行配置写入');
        const editorConfigPath = this.getVSCodeUserSettingsPath();
        if (!fs.existsSync(editorConfigPath)) {
            fs.mkdirSync(editorConfigPath, { recursive: true });
        }
        const settingsPath = path.join(editorConfigPath, 'settings.json');
        let existingSettings = {};
        if (fs.existsSync(settingsPath)) {
            try {
                const content = fs.readFileSync(settingsPath, 'utf-8');
                existingSettings = JSON.parse(content);
            }
            catch (error) {
                this.outputChannel.appendLine(`读取现有settings.json失败: ${error}`);
            }
        }
        const javaRuntimeConfig = await this.getJavaRuntimeConfig(homePath);
        const newSettings = {
            "java.saveActions.organizeImports": true,
            "java.compile.nullAnalysis.mode": "automatic",
            "java.configuration.runtimes": javaRuntimeConfig,
            "[java]": {
                "files.encoding": "gbk"
            },
            "[javascript]": {
                "files.encoding": "utf8"
            },
            "[typescript]": {
                "files.encoding": "utf8"
            }
        };
        const mergedSettings = { ...existingSettings, ...newSettings };
        fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
        this.outputChannel.appendLine(`编辑器settings.json文件已更新: ${settingsPath}`);
        vscode.window.showInformationMessage('编辑器settings.json文件已更新，文件编码已设置为GBK，JDK运行时已配置');
    }
    async getJavaRuntimeConfig(homePath) {
        try {
            if (process.platform === 'darwin') {
                return await this.getMacJavaRuntimeConfig(homePath);
            }
            else if (process.platform === 'win32') {
                return await this.getWindowsJavaRuntimeConfig(homePath);
            }
            else {
                return await this.getMacJavaRuntimeConfig(homePath);
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`获取Java运行时配置失败: ${error}`);
            return [];
        }
    }
    async getMacJavaRuntimeConfig(homePath) {
        try {
            const javaRuntimes = [];
            const versionStr = this.configService.getConfig().homeVersion;
            const version = versionStr ? parseInt(versionStr, 10) : 0;
            let requiredJavaVersion = "JavaSE-1.8";
            let requiredJavaVersionNumber = "1.8";
            if (version >= 2312) {
                requiredJavaVersion = "JavaSE-17";
                requiredJavaVersionNumber = "17";
            }
            else if (version < 1903) {
                requiredJavaVersion = "JavaSE-1.7";
                requiredJavaVersionNumber = "1.7";
            }
            try {
                const { execSync } = require('child_process');
                let jdkPath = "";
                try {
                    jdkPath = execSync(`/usr/libexec/java_home -F -v ${requiredJavaVersionNumber}`, { encoding: 'utf-8' }).trim();
                }
                catch (versionError) {
                    this.outputChannel.appendLine(`无法找到JDK ${requiredJavaVersionNumber}: ${versionError}`);
                }
                if (jdkPath && fs.existsSync(jdkPath)) {
                    const javaExecutable = path.join(jdkPath, 'bin', 'java');
                    if (fs.existsSync(javaExecutable)) {
                        const runtimeName = JavaVersionUtils_1.JavaVersionUtils.getJavaVersionName(javaExecutable, this.outputChannel);
                        if (runtimeName === requiredJavaVersion) {
                            javaRuntimes.push({
                                "name": runtimeName,
                                "path": jdkPath,
                                "default": true
                            });
                        }
                        else {
                            javaRuntimes.push({
                                "name": runtimeName,
                                "path": jdkPath
                            });
                        }
                    }
                }
            }
            catch (error) {
                this.outputChannel.appendLine(`使用/usr/libexec/java_home命令获取JDK路径失败: ${error}`);
            }
            if (javaRuntimes.length === 0) {
                let jdkPath = process.env.JAVA_HOME || process.env.JDK_HOME;
                if (!jdkPath) {
                    try {
                        const { execSync } = require('child_process');
                        jdkPath = execSync('/usr/libexec/java_home', { encoding: 'utf-8' }).trim();
                    }
                    catch (error) {
                        this.outputChannel.appendLine(`使用/usr/libexec/java_home命令获取JDK路径失败: ${error}`);
                    }
                }
                if (!jdkPath) {
                    const commonJdkPaths = [
                        '/Library/Java/JavaVirtualMachines/default/Contents/Home',
                        '/Library/Java/JavaVirtualMachines/jdk1.8.0_281.jdk/Contents/Home',
                        '/Library/Java/JavaVirtualMachines/jdk-11.jdk/Contents/Home',
                        '/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home',
                        '/System/Library/Java/JavaVirtualMachines/1.6.0.jdk/Contents/Home'
                    ];
                    for (const path of commonJdkPaths) {
                        if (fs.existsSync(path)) {
                            jdkPath = path;
                            break;
                        }
                    }
                }
                if (jdkPath && fs.existsSync(jdkPath)) {
                    const javaExecutable = path.join(jdkPath, 'bin', 'java');
                    if (fs.existsSync(javaExecutable)) {
                        const runtimeName = JavaVersionUtils_1.JavaVersionUtils.getJavaVersionName(javaExecutable, this.outputChannel);
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": jdkPath,
                            "default": true
                        });
                    }
                }
            }
            if (javaRuntimes.length === 0) {
                this.outputChannel.appendLine(`无法自动检测到有效的JDK路径，需要的JDK版本: ${requiredJavaVersion}`);
            }
            return javaRuntimes;
        }
        catch (error) {
            this.outputChannel.appendLine(`获取macOS Java运行时配置失败: ${error}`);
            return [];
        }
    }
    async getWindowsJavaRuntimeConfig(homePath) {
        try {
            const javaRuntimes = [];
            const versionStr = this.configService.getConfig().homeVersion;
            const version = versionStr ? parseInt(versionStr, 10) : 0;
            let requiredJavaVersion = "JavaSE-1.8";
            if (version >= 2312) {
                requiredJavaVersion = "JavaSE-17";
            }
            else if (version < 1903) {
                requiredJavaVersion = "JavaSE-1.7";
            }
            const defaultJdkPath = path.join(homePath, 'ufjdk');
            if (fs.existsSync(defaultJdkPath)) {
                const javaExecutable = path.join(defaultJdkPath, 'bin', 'java.exe');
                if (fs.existsSync(javaExecutable)) {
                    const runtimeName = JavaVersionUtils_1.JavaVersionUtils.getJavaVersionName(javaExecutable, this.outputChannel);
                    if (runtimeName === requiredJavaVersion) {
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": defaultJdkPath,
                            "default": true
                        });
                    }
                    else {
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": defaultJdkPath
                        });
                    }
                }
            }
            let jdkPath = process.env.JAVA_HOME || process.env.JDK_HOME;
            if (jdkPath && fs.existsSync(jdkPath)) {
                const javaExecutable = path.join(jdkPath, 'bin', 'java.exe');
                if (fs.existsSync(javaExecutable)) {
                    const runtimeName = JavaVersionUtils_1.JavaVersionUtils.getJavaVersionName(javaExecutable, this.outputChannel);
                    const hasDefault = javaRuntimes.some(runtime => runtime.default === true);
                    if (runtimeName === requiredJavaVersion && !hasDefault) {
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": jdkPath,
                            "default": true
                        });
                    }
                    else if (!javaRuntimes.some(runtime => runtime.path === jdkPath)) {
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": jdkPath,
                            "default": !hasDefault
                        });
                    }
                }
            }
            if (javaRuntimes.length === 0) {
                this.outputChannel.appendLine('无法找到有效的JDK路径');
            }
            return javaRuntimes;
        }
        catch (error) {
            this.outputChannel.appendLine(`获取Windows Java运行时配置失败: ${error}`);
            return [];
        }
    }
}
exports.LibraryService = LibraryService;
//# sourceMappingURL=LibraryService.js.map