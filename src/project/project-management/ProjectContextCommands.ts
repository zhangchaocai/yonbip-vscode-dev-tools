import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LibraryService } from '../library/LibraryService';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';
import { HomeService } from '../nc-home/HomeService';
import { ClasspathService } from '../library/ClasspathService';
import { AutoHotwebsAccessService } from './AutoHotwebsAccessService';
import { CopyResourcesToHomeCommand } from './CopyResourcesToHomeCommand';

// 添加一个静态属性来存储context
let extensionContext: vscode.ExtensionContext | undefined;

// 新增：用于在资源管理器中为已初始化项目目录添加标记（徽章）
class ProjectInitDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    public readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    // 缓存机制：存储已检查过的目录状态
    private decorationCache = new Map<string, vscode.FileDecoration | undefined>();
    private lastCacheUpdate = new Map<string, number>();
    private readonly CACHE_TTL = 5000; // 缓存5秒

    // 允许主动标记的目录（确保即刻刷新）
    private initializedFolders = new Set<string>();
    
    // 文件系统监听器，用于监听.project文件的变化
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    
    // 持久化存储键
    private readonly STORAGE_KEY = 'yonbip.initializedProjects';
    private context: vscode.ExtensionContext | undefined;

    // 强制刷新装饰器的方法
    public forceRefresh(): void {
        // 清除所有缓存
        this.decorationCache.clear();
        this.lastCacheUpdate.clear();
        
        // 触发全局刷新
        this._onDidChangeFileDecorations.fire(undefined);
        
        console.log('强制刷新装饰器');
    }

    // 定期刷新装饰器以确保稳定显示
    private startPeriodicRefresh(): void {
        setInterval(() => {
            // 每30秒强制刷新一次，确保装饰器不会消失
            this.forceRefresh();
        }, 30000);
    }

    constructor(context?: vscode.ExtensionContext) {
        this.context = context;
        this.loadPersistedState();
        this.setupFileWatcher();
        this.startPeriodicRefresh(); // 启动定期刷新
    }

    // 从持久化存储加载状态
    private loadPersistedState(): void {
        if (this.context) {
            try {
                const stored = this.context.globalState.get<string[]>(this.STORAGE_KEY, []);
                stored.forEach(folderPath => {
                    // 验证目录是否仍然存在且已初始化
                    if (fs.existsSync(folderPath) && this.isProjectInitialized(folderPath)) {
                        this.initializedFolders.add(folderPath);
                    }
                });
                console.log(`从持久化存储加载了 ${this.initializedFolders.size} 个已初始化项目`);
            } catch (error) {
                console.error('加载持久化状态失败:', error);
            }
        }
    }

    // 保存状态到持久化存储
    private savePersistedState(): void {
        if (this.context) {
            try {
                const folders = Array.from(this.initializedFolders);
                this.context.globalState.update(this.STORAGE_KEY, folders);
            } catch (error) {
                console.error('保存持久化状态失败:', error);
            }
        }
    }

    // 设置文件监听器
    private setupFileWatcher(): void {
        try {
            // 监听.project文件的创建和删除
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
        } catch (error) {
            console.error('设置文件监听器失败:', error);
        }
    }

    // 检查项目是否已初始化
    private isProjectInitialized(folderPath: string): boolean {
        try {
            const projectPath = path.join(folderPath, '.project');
            const classpathPath = path.join(folderPath, '.classpath');
            const buildPath = path.join(folderPath, 'build');
            const metaInfPath = path.join(folderPath, 'META-INF');
            const projectFolder = path.join(folderPath, '.yonbip-project');
            
            // 检查关键文件/目录是否存在
            // YonBIP项目初始化标准：存在.project和.classpath文件，且存在build和META-INF目录，或者存在yonbip-project文件夹
            return (fs.existsSync(projectPath) && 
                   fs.existsSync(classpathPath) &&
                   fs.existsSync(buildPath) && 
                   fs.existsSync(metaInfPath)) ||
                   fs.existsSync(projectFolder);
        } catch (error) {
            return false;
        }
    }

    // 使缓存失效
    private invalidateCache(folderPath: string): void {
        const absPath = path.resolve(folderPath);
        this.decorationCache.delete(absPath);
        this.lastCacheUpdate.delete(absPath);
    }

    // 主动标记目录为已初始化，并触发刷新
    public markAsInitialized(folderPath: string): void {
        const absPath = path.resolve(folderPath);
        this.initializedFolders.add(absPath);
        this.invalidateCache(absPath);
        this.savePersistedState();
        
        // 创建.project和.classpath标记文件以确保持久性
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
            
            // 创建一个特殊的隐藏文件夹来标识初始化的项目
            const projectFolder = path.join(absPath, '.yonbip-project');
            if (!fs.existsSync(projectFolder)) {
                fs.mkdirSync(projectFolder);
            }
        } catch (error) {
            console.error('创建项目标记文件失败:', error);
        }
        
        // 触发装饰更新
        this._onDidChangeFileDecorations.fire(vscode.Uri.file(absPath));
        // 延迟触发全局刷新，确保装饰显示
        setTimeout(() => {
            this._onDidChangeFileDecorations.fire(undefined);
        }, 100);
        
        // 额外的强制刷新，确保在有强调项的目录中也能显示
        setTimeout(() => {
            this.forceRefresh();
        }, 500);
        
        console.log(`项目目录已标记为初始化: ${absPath}`);
    }

    // 移除初始化标记
    public removeInitialization(folderPath: string): void {
        const absPath = path.resolve(folderPath);
        this.initializedFolders.delete(absPath);
        this.invalidateCache(absPath);
        this.savePersistedState();
        
        // 删除特殊的隐藏项目文件夹
        try {
            const projectFolder = path.join(absPath, '.yonbip-project');
            if (fs.existsSync(projectFolder)) {
                fs.rmdirSync(projectFolder);
            }
        } catch (error) {
            console.error('删除项目标记文件夹失败:', error);
        }
        
        this._onDidChangeFileDecorations.fire(vscode.Uri.file(absPath));
    }

    // 获取所有已初始化的项目
    public getInitializedProjects(): string[] {
        return Array.from(this.initializedFolders);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
        try {
            const fsPath = uri.fsPath;
            const absPath = path.resolve(fsPath);
            
            // 检查缓存
            const now = Date.now();
            const lastUpdate = this.lastCacheUpdate.get(absPath) || 0;
            
            if (now - lastUpdate < this.CACHE_TTL && this.decorationCache.has(absPath)) {
                return this.decorationCache.get(absPath);
            }

            // 只处理目录
            let isDirectory = false;
            try {
                if (!fs.existsSync(fsPath)) {
                    this.decorationCache.set(absPath, undefined);
                    this.lastCacheUpdate.set(absPath, now);
                    return undefined;
                }
                const stat = fs.statSync(fsPath);
                isDirectory = stat.isDirectory();
            } catch (error) {
                this.decorationCache.set(absPath, undefined);
                this.lastCacheUpdate.set(absPath, now);
                return undefined;
            }

            if (!isDirectory) {
                this.decorationCache.set(absPath, undefined);
                this.lastCacheUpdate.set(absPath, now);
                return undefined;
            }

            // 检查是否为已初始化项目
            const isInitialized = this.initializedFolders.has(absPath) || this.isProjectInitialized(fsPath);
            
            let decoration: vscode.FileDecoration | undefined = undefined;
            
            if (isInitialized) {
                // 如果通过文件系统检查发现已初始化，但不在内存集合中，则添加到集合
                if (!this.initializedFolders.has(absPath)) {
                    this.initializedFolders.add(absPath);
                    this.savePersistedState();
                }
                
                decoration = {
                    badge: '⚙️',  // 使用齿轮图标表示已初始化的YonBIP项目
                    tooltip: 'YonBIP 项目已初始化 - 包含 .project 和 .classpath 文件、build 目录和 META-INF 目录',
                    color: new vscode.ThemeColor('charts.green'),
                    propagate: false // 不传播，避免子目录也显示
                };
                
                // 设置更高的优先级以避免与VS Code内置装饰器冲突
                // 使用weight属性来提高优先级
                (decoration as any).priority = 1000;
                (decoration as any).weight = 1000;
            }

            // 更新缓存
            this.decorationCache.set(absPath, decoration);
            this.lastCacheUpdate.set(absPath, now);
            
            return decoration;
            
        } catch (error) {
            console.error('提供文件装饰失败:', error);
            return undefined;
        }
    }

    // 清理资源
    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
        this.decorationCache.clear();
        this.lastCacheUpdate.clear();
    }
}

/**
 * 项目上下文菜单命令
 */
export class ProjectContextCommands {

    // 添加静态属性来存储装饰器实例
    private static decorationProvider: any = null;

    /**
     * 设置扩展上下文
     * @param context 扩展上下文
     */
    public static setExtensionContext(context: vscode.ExtensionContext): void {
        extensionContext = context;
    }


    /**
     * 注册所有项目上下文菜单相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext, configService: NCHomeConfigService): void {
        // 设置扩展上下文
        this.setExtensionContext(context);

        const libraryService = new LibraryService(context, configService);
        const classpathService = new ClasspathService();

        // 新增：注册文件装饰器提供者
        if (!this.decorationProvider) {
            const provider = new ProjectInitDecorationProvider(context);
            const disposable = vscode.window.registerFileDecorationProvider(provider);
            context.subscriptions.push(disposable);
            context.subscriptions.push(provider); // 确保provider也被正确清理
            this.decorationProvider = provider;
        }

        // 初始化项目目录命令（右键菜单）
        const initProjectContextCommand = vscode.commands.registerCommand(
            'yonbip.project.initContext',
            async (uri: vscode.Uri) => {
                await this.handleInitProjectContext(uri, libraryService, configService);
            }
        );

        // 添加所有源码路径到.classpath命令（右键菜单）
        const addAllSourcePathsCommand = vscode.commands.registerCommand(
            'yonbip.project.addAllSourcePaths',
            async (uri: vscode.Uri) => {
                await this.handleAddAllSourcePaths(uri, classpathService);
            }
        );

        // 自动访问HOTWEBS资源命令（右键菜单）
        const autoAccessHotwebsCommand = vscode.commands.registerCommand(
            'yonbip.project.autoAccessHotwebs',
            async (uri: vscode.Uri) => {
                await this.handleAutoAccessHotwebs(uri, configService);
            }
        );

        context.subscriptions.push(initProjectContextCommand);
        context.subscriptions.push(addAllSourcePathsCommand);
        context.subscriptions.push(autoAccessHotwebsCommand);
    }

    /**
     * 处理自动访问HOTWEBS资源
     */
    private static async handleAutoAccessHotwebs(
        uri: vscode.Uri | undefined,
        configService: NCHomeConfigService
    ): Promise<void> {
        try {
            // 如果没有提供URI，则提示用户选择目录
            let selectedPath: string;
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
            } else {
                selectedPath = uri.fsPath;
            }

            console.log(`用户选择的脚手架目录: ${selectedPath}`);

            // 创建自动访问HOTWEBS资源服务
            const autoHotwebsService = new AutoHotwebsAccessService(configService);
            
            // 执行自动访问HOTWEBS资源
            await autoHotwebsService.autoAccessHotwebsResources(selectedPath);

        } catch (error: any) {
            console.error('自动访问HOTWEBS资源失败:', error);
            vscode.window.showErrorMessage(`自动访问HOTWEBS资源失败: ${error.message}`);
        }
    }

    /**
     * 处理初始化项目上下文菜单
     */
    private static async handleInitProjectContext(
        uri: vscode.Uri | undefined,
        libraryService: LibraryService,
        configService: NCHomeConfigService
    ): Promise<void> {
        try {
            // 如果没有提供URI，则提示用户选择目录
            let selectedPath: string;
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
            } else {
                selectedPath = uri.fsPath;
            }

            console.log(`用户选择的初始化目录: ${selectedPath}`);

            // 确认操作
            const confirm = await vscode.window.showWarningMessage(
                `将在以下目录初始化项目：${selectedPath}\n\n这将创建build/classes目录并初始化Java项目库。是否继续？`,
                '继续',
                '取消'
            );

            if (confirm !== '继续') {
                return;
            }

            // 创建build/classes目录
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在创建项目目录...',
                cancellable: false
            }, async () => {
                await this.createProjectStructure(selectedPath);
            });

            // 强制重新加载配置以确保获取最新配置
            configService.reloadConfig();
            // 获取HOME路径配置 - 使用NCHomeConfigService获取工作区特定的配置
            const config = configService.getConfig();
            let homePath = config.homePath;

            // 如果未配置HOME路径，提示用户选择
            if (!homePath) {
                const result = await vscode.window.showInformationMessage(
                    '未配置HOME路径，是否现在配置？',
                    '是',
                    '否'
                );

                if (result === '是') {
                    // 打开NC Home配置界面
                    await vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                    return;
                } else {
                    vscode.window.showWarningMessage('请先配置NC HOME路径');
                    return;
                }
            }

            // 初始化库（移除了数据库驱动选择功能）
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                // 移除了needDbLibrary和driverLibPath参数
                await libraryService.initLibrary(homePath!, false, undefined, selectedPath);
            });

            // 添加项目目录标识
            console.log(`准备标记目录为已初始化: ${selectedPath}`);
            if (this.decorationProvider) {
                console.log('装饰器提供者存在，开始标记');
                this.decorationProvider.markAsInitialized(selectedPath);
                console.log('目录标记完成');
            } else {
                console.log('装饰器提供者不存在');
            }

            // 询问用户是否立即启动HOME服务
            const startService = await vscode.window.showInformationMessage(
                `项目初始化完成！是否立即在目录 ${selectedPath} 中启动HOME服务？`,
                '启动',
                '取消'
            );

            if (startService === '启动') {
                // 启动HOME服务
                if (extensionContext) {
                    const homeService = new HomeService(extensionContext, configService);
                    await homeService.startHomeService(selectedPath);
                } else {
                    vscode.window.showErrorMessage('无法启动HOME服务：扩展上下文未初始化');
                }
            }

            vscode.window.showInformationMessage('项目初始化完成！');
        } catch (error: any) {
            console.error('项目初始化失败:', error);
            vscode.window.showErrorMessage(`项目初始化失败: ${error.message}`);
        }
    }

    /**
     * 在指定目录下创建符合项目结构的目录
     */
    private static async createProjectStructure(basePath: string): Promise<void> {
        try {
            // 修复：确保正确创建相对于选定目录的build/classes路径
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');

            // 检查并创建build目录
            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }

            // 检查并创建classes目录
            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }

            // 创建META-INF目录和module.xml文件
            const metaInfPath = path.join(basePath, 'META-INF');
            if (!fs.existsSync(metaInfPath)) {
                fs.mkdirSync(metaInfPath, { recursive: true });
            }

            // 获取目录名称作为模块名称
            const dirName = path.basename(basePath);
            const moduleXmlPath = path.join(metaInfPath, 'module.xml');

            // 只有当module.xml文件不存在时才创建
            if (!fs.existsSync(moduleXmlPath)) {
                const moduleXmlContent = `<?xml version="1.0" encoding="gb2312"?>
<module name="${dirName}">
    <public></public>
    <private></private>
</module>`;
                fs.writeFileSync(moduleXmlPath, moduleXmlContent, 'utf-8');
            }
        } catch (error) {
            console.error('Failed to create project directories:', error);
            throw new Error(`创建目录失败: ${error}`);
        }
    }


    /**
     * 处理添加所有源码路径到.classpath
     */
    private static async handleAddAllSourcePaths(
        uri: vscode.Uri | undefined,
        classpathService: ClasspathService
    ): Promise<void> {
        try {
            // 如果没有提供URI，则提示用户选择目录
            let selectedPath: string;
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
            } else {
                selectedPath = uri.fsPath;
            }

            console.log(`用户选择的扫描目录: ${selectedPath}`);

            // 调用ClasspathService处理添加源码路径
            await classpathService.addAllSourcePaths(selectedPath);

        } catch (error: any) {
            console.error('添加源码路径失败:', error);
            vscode.window.showErrorMessage(`添加源码路径失败: ${error.message}`);
        }
    }
}