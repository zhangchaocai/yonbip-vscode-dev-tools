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
exports.ProjectContextCommands = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LibraryService_1 = require("../library/LibraryService");
const ClasspathService_1 = require("../library/ClasspathService");
const AutoHotwebsAccessService_1 = require("./AutoHotwebsAccessService");
const IconThemeUpdater_1 = require("../../utils/IconThemeUpdater");
const CustomDialogUtils_1 = require("../../utils/CustomDialogUtils");
let extensionContext;
class ProjectInitDecorationProvider {
    _onDidChangeFileDecorations = new vscode.EventEmitter();
    onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    decorationCache = new Map();
    lastCacheUpdate = new Map();
    CACHE_TTL = 5000;
    initializedFolders = new Set();
    fileWatcher;
    STORAGE_KEY = 'yonbip.initializedProjects';
    context;
    forceRefresh() {
        this.decorationCache.clear();
        this.lastCacheUpdate.clear();
        this._onDidChangeFileDecorations.fire(undefined);
        console.log('强制刷新装饰器');
    }
    startPeriodicRefresh() {
        setInterval(() => {
            this.forceRefresh();
        }, 30000);
    }
    constructor(context) {
        this.context = context;
        this.loadPersistedState();
        this.setupFileWatcher();
        this.startPeriodicRefresh();
    }
    loadPersistedState() {
        if (this.context) {
            try {
                const stored = this.context.globalState.get(this.STORAGE_KEY, []);
                stored.forEach(folderPath => {
                    if (fs.existsSync(folderPath) && this.isProjectInitialized(folderPath)) {
                        this.initializedFolders.add(folderPath);
                    }
                });
                console.log(`从持久化存储加载了 ${this.initializedFolders.size} 个已初始化项目`);
            }
            catch (error) {
                console.error('加载持久化状态失败:', error);
            }
        }
    }
    savePersistedState() {
        if (this.context) {
            try {
                const folders = Array.from(this.initializedFolders);
                this.context.globalState.update(this.STORAGE_KEY, folders);
            }
            catch (error) {
                console.error('保存持久化状态失败:', error);
            }
        }
    }
    setupFileWatcher() {
        try {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/.project');
            this.fileWatcher.onDidCreate((uri) => {
                const dirPath = path.dirname(uri.fsPath);
                this.invalidateCache(dirPath);
                this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
            });
            this.fileWatcher.onDidDelete((uri) => {
                const dirPath = path.dirname(uri.fsPath);
                this.invalidateCache(dirPath);
                this.initializedFolders.delete(path.resolve(dirPath));
                this.savePersistedState();
                this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
            });
        }
        catch (error) {
            console.error('设置文件监听器失败:', error);
        }
    }
    isProjectInitialized(folderPath) {
        try {
            const projectPath = path.join(folderPath, '.project');
            const classpathPath = path.join(folderPath, '.classpath');
            const buildPath = path.join(folderPath, 'build');
            const metaInfPath = path.join(folderPath, 'META-INF');
            return (fs.existsSync(projectPath) &&
                fs.existsSync(classpathPath) &&
                fs.existsSync(buildPath) &&
                fs.existsSync(metaInfPath));
        }
        catch (error) {
            return false;
        }
    }
    invalidateCache(folderPath) {
        const absPath = path.resolve(folderPath);
        this.decorationCache.delete(absPath);
        this.lastCacheUpdate.delete(absPath);
    }
    markAsInitialized(folderPath) {
        const absPath = path.resolve(folderPath);
        this.initializedFolders.add(absPath);
        this.invalidateCache(absPath);
        this.savePersistedState();
        try {
            const projectFile = path.join(absPath, '.project');
            if (!fs.existsSync(projectFile)) {
                const projectName = path.basename(absPath);
                const projectContent = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
    <name>${projectName}</name>
    <comment>YonBIP Project</comment>
    <projects>
    </projects>
    <buildSpec>
    </buildSpec>
    <natures>
    </natures>
</projectDescription>`;
                fs.writeFileSync(projectFile, projectContent, 'utf-8');
            }
            const classpathFile = path.join(absPath, '.classpath');
            if (!fs.existsSync(classpathFile)) {
                const classpathContent = `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
    <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-1.8"/>
    <classpathentry kind="src" path="src"/>
    <classpathentry kind="output" path="build/classes"/>
</classpath>`;
                fs.writeFileSync(classpathFile, classpathContent, 'utf-8');
            }
        }
        catch (error) {
            console.error('创建项目标记文件失败:', error);
        }
        this._onDidChangeFileDecorations.fire(vscode.Uri.file(absPath));
        setTimeout(() => {
            this._onDidChangeFileDecorations.fire(undefined);
        }, 100);
        setTimeout(() => {
            this.forceRefresh();
        }, 500);
        console.log(`项目目录已标记为初始化: ${absPath}`);
    }
    removeInitialization(folderPath) {
        const absPath = path.resolve(folderPath);
        this.initializedFolders.delete(absPath);
        this.invalidateCache(absPath);
        this.savePersistedState();
        this._onDidChangeFileDecorations.fire(vscode.Uri.file(absPath));
    }
    getInitializedProjects() {
        return Array.from(this.initializedFolders);
    }
    provideFileDecoration(uri) {
        try {
            const fsPath = uri.fsPath;
            const absPath = path.resolve(fsPath);
            const now = Date.now();
            const lastUpdate = this.lastCacheUpdate.get(absPath) || 0;
            if (now - lastUpdate < this.CACHE_TTL && this.decorationCache.has(absPath)) {
                return this.decorationCache.get(absPath);
            }
            let isDirectory = false;
            try {
                if (!fs.existsSync(fsPath)) {
                    this.decorationCache.set(absPath, undefined);
                    this.lastCacheUpdate.set(absPath, now);
                    return undefined;
                }
                const stat = fs.statSync(fsPath);
                isDirectory = stat.isDirectory();
            }
            catch (error) {
                this.decorationCache.set(absPath, undefined);
                this.lastCacheUpdate.set(absPath, now);
                return undefined;
            }
            if (!isDirectory) {
                this.decorationCache.set(absPath, undefined);
                this.lastCacheUpdate.set(absPath, now);
                return undefined;
            }
            const isInitialized = this.initializedFolders.has(absPath) || this.isProjectInitialized(fsPath);
            let decoration = undefined;
            if (isInitialized) {
                if (!this.initializedFolders.has(absPath)) {
                    this.initializedFolders.add(absPath);
                    this.savePersistedState();
                }
                decoration = {
                    tooltip: 'YonBIP 项目已初始化',
                    color: new vscode.ThemeColor('charts.green'),
                    propagate: false
                };
                decoration.priority = 1000;
                decoration.weight = 1000;
            }
            this.decorationCache.set(absPath, decoration);
            this.lastCacheUpdate.set(absPath, now);
            return decoration;
        }
        catch (error) {
            console.error('提供文件装饰失败:', error);
            return undefined;
        }
    }
    dispose() {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
        this.decorationCache.clear();
        this.lastCacheUpdate.clear();
    }
}
class ProjectContextCommands {
    static decorationProvider = null;
    static setExtensionContext(context) {
        extensionContext = context;
        IconThemeUpdater_1.IconThemeUpdater.initialize(context);
    }
    static registerCommands(context, configService) {
        this.setExtensionContext(context);
        const libraryService = new LibraryService_1.LibraryService(context, configService);
        const classpathService = new ClasspathService_1.ClasspathService();
        if (!this.decorationProvider) {
            const provider = new ProjectInitDecorationProvider(context);
            const disposable = vscode.window.registerFileDecorationProvider(provider);
            context.subscriptions.push(disposable);
            context.subscriptions.push(provider);
            this.decorationProvider = provider;
        }
        const initProjectContextCommand = vscode.commands.registerCommand('yonbip.project.initContext', async (uri) => {
            await this.handleInitProjectContext(uri, libraryService, configService);
        });
        const addAllSourcePathsCommand = vscode.commands.registerCommand('yonbip.project.addAllSourcePaths', async (uri) => {
            await this.handleAddAllSourcePaths(uri, classpathService);
        });
        const autoAccessHotwebsCommand = vscode.commands.registerCommand('yonbip.project.autoAccessHotwebs', async (uri) => {
            await this.handleAutoAccessHotwebs(uri, configService);
        });
        context.subscriptions.push(initProjectContextCommand);
        context.subscriptions.push(addAllSourcePathsCommand);
        context.subscriptions.push(autoAccessHotwebsCommand);
    }
    static async handleAutoAccessHotwebs(uri, configService) {
        try {
            let selectedPath;
            if (!uri) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择脚手架目录'
                });
                if (!result || result.length === 0) {
                    return;
                }
                selectedPath = result[0].fsPath;
            }
            else {
                selectedPath = uri.fsPath;
            }
            console.log(`用户选择的脚手架目录: ${selectedPath}`);
            const autoHotwebsService = new AutoHotwebsAccessService_1.AutoHotwebsAccessService(configService);
            await autoHotwebsService.autoAccessHotwebsResources(selectedPath);
        }
        catch (error) {
            console.error('自动访问HOTWEBS资源失败:', error);
            vscode.window.showErrorMessage(`自动访问HOTWEBS资源失败: ${error.message}`);
        }
    }
    static async handleInitProjectContext(uri, libraryService, configService) {
        try {
            let selectedPath;
            if (!uri) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择项目目录'
                });
                if (!result || result.length === 0) {
                    return;
                }
                selectedPath = result[0].fsPath;
            }
            else {
                selectedPath = uri.fsPath;
            }
            console.log(`用户选择的初始化目录: ${selectedPath}`);
            const confirm = await this.showCustomConfirmationDialog('初始化项目', `将在以下目录初始化项目：${selectedPath}\n\n这将创建build/classes目录并初始化Java项目库。是否继续？`);
            if (!confirm) {
                return;
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在创建项目目录...',
                cancellable: false
            }, async () => {
                await this.createProjectStructure(selectedPath);
            });
            configService.reloadConfig();
            const config = configService.getConfig();
            let homePath = config.homePath;
            if (!homePath) {
                const result = await vscode.window.showInformationMessage('未配置HOME路径，是否现在配置？', '是', '否');
                if (result === '是') {
                    await vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                    return;
                }
                else {
                    vscode.window.showWarningMessage('请先配置NC HOME路径');
                    return;
                }
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                await libraryService.initLibrary(homePath, false, undefined, selectedPath);
            });
            console.log(`准备标记目录为已初始化: ${selectedPath}`);
            if (this.decorationProvider) {
                console.log('装饰器提供者存在，开始标记');
                this.decorationProvider.markAsInitialized(selectedPath);
                console.log('目录标记完成');
            }
            else {
                console.log('装饰器提供者不存在');
            }
            const moduleName = path.basename(selectedPath);
            console.log(`准备将模块 ${moduleName} 添加到图标主题配置中`);
            const iconUpdated = await IconThemeUpdater_1.IconThemeUpdater.addModuleToIconTheme(moduleName);
            if (iconUpdated) {
                vscode.window.showInformationMessage('项目初始化完成！图标主题已更新。');
                await IconThemeUpdater_1.IconThemeUpdater.requestWindowReload();
            }
            else {
                vscode.window.showInformationMessage('项目初始化完成！');
            }
            vscode.window.showInformationMessage('项目初始化完成！');
        }
        catch (error) {
            console.error('项目初始化失败:', error);
            vscode.window.showErrorMessage(`项目初始化失败: ${error.message}`);
        }
    }
    static async createProjectStructure(basePath) {
        try {
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');
            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }
            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }
            const metaInfPath = path.join(basePath, 'META-INF');
            if (!fs.existsSync(metaInfPath)) {
                fs.mkdirSync(metaInfPath, { recursive: true });
            }
            const dirName = path.basename(basePath);
            const moduleXmlPath = path.join(metaInfPath, 'module.xml');
            if (!fs.existsSync(moduleXmlPath)) {
                const moduleXmlContent = `<?xml version="1.0" encoding="gb2312"?>
<module name="${dirName}">
    <public></public>
    <private></private>
</module>`;
                fs.writeFileSync(moduleXmlPath, moduleXmlContent, 'utf-8');
            }
        }
        catch (error) {
            console.error('Failed to create project directories:', error);
            throw new Error(`创建目录失败: ${error}`);
        }
    }
    static async handleAddAllSourcePaths(uri, classpathService) {
        try {
            let selectedPath;
            if (!uri) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择要扫描的目录'
                });
                if (!result || result.length === 0) {
                    return;
                }
                selectedPath = result[0].fsPath;
            }
            else {
                selectedPath = uri.fsPath;
            }
            console.log(`用户选择的扫描目录: ${selectedPath}`);
            await classpathService.addAllSourcePaths(selectedPath);
        }
        catch (error) {
            console.error('添加源码路径失败:', error);
            vscode.window.showErrorMessage(`添加源码路径失败: ${error.message}`);
        }
    }
    static async showCustomConfirmationDialog(title, message) {
        return await CustomDialogUtils_1.CustomDialogUtils.showCustomConfirmationDialog(title, message);
    }
    static getConfirmationDialogHtml(title, message) {
        return '';
    }
}
exports.ProjectContextCommands = ProjectContextCommands;
//# sourceMappingURL=ProjectContextCommands.js.map