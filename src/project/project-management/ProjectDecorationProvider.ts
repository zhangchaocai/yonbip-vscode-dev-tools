import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 项目目录装饰提供者
 * 用于为已初始化的YonBIP项目目录添加图标标识
 */
export class ProjectDecorationProvider implements vscode.Disposable, vscode.FileDecorationProvider {
    private disposables: vscode.Disposable[] = [];
    private initializedPaths: Set<string> = new Set();
    private context: vscode.ExtensionContext;
    private fileDecorationProvider?: vscode.Disposable;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined> = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> = this._onDidChangeFileDecorations.event;
    private isProviderInitialized: boolean = false;
    private refreshTimeout: NodeJS.Timeout | null = null;
    private decorationCache: Map<string, vscode.FileDecoration | null> = new Map();
    private lastRefreshTime: number = 0;
    private readonly MIN_REFRESH_INTERVAL = 500; // 最小刷新间隔500ms

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        console.log('ProjectDecorationProvider 构造函数被调用');

        // 立即注册装饰器提供者，避免异步导致的时机问题
        this.fileDecorationProvider = vscode.window.registerFileDecorationProvider(this);
        console.log('文件装饰器提供者已注册');

        if (this.fileDecorationProvider) {
            this.disposables.push(this.fileDecorationProvider);
        }

        // 异步初始化扫描和文件观察器
        this.initialize().catch(error => {
            console.error('ProjectDecorationProvider 初始化失败:', error);
        });

        // 监听VS Code问题面板状态变化，增强稳定性
        this.setupProblemPanelListener();
    }

    /**
     * 初始化装饰器提供者
     */
    private async initialize(): Promise<void> {
        try {
            // 初始化时扫描已存在的标记文件
            await this.scanForExistingMarkers();

            // 创建文件观察器来监视标记文件的创建
            this.setupFileWatcher();

            this.isProviderInitialized = true;
            console.log('ProjectDecorationProvider 初始化完成');

            // 初始化完成后触发一次刷新
            this.refresh();
        } catch (error) {
            console.error('ProjectDecorationProvider 初始化过程中出错:', error);
        }
    }

    /**
     * 扫描已存在的标记文件
     */
    private async scanForExistingMarkers(): Promise<void> {
        console.log('开始扫描已存在的标记文件');
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            console.log('没有工作区文件夹');
            return;
        }

        console.log(`找到 ${folders.length} 个工作区文件夹`);
        for (const folder of folders) {
            try {
                console.log(`扫描文件夹: ${folder.uri.fsPath}`);
                const markerFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/.yonbip-project'),
                    null,
                    100
                );

                console.log(`在 ${folder.uri.fsPath} 中找到 ${markerFiles.length} 个标记文件`);
                for (const markerFile of markerFiles) {
                    const projectPath = path.dirname(markerFile.fsPath);
                    console.log(`添加已初始化路径: ${projectPath}`);
                    this.initializedPaths.add(projectPath);
                }
            } catch (error) {
                console.error('扫描标记文件时出错:', error);
            }
        }

        console.log(`扫描完成，共找到 ${this.initializedPaths.size} 个已初始化项目`);
    }

    /**
     * 设置文件观察器
     */
    private setupFileWatcher(): void {
        // 如果已经存在文件观察器，先清理
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = null;
        }

        try {
            // 创建文件观察器来监视标记文件的创建、删除和修改
            this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/.yonbip-project');

            // 监听文件创建事件
            const createDisposable = this.fileWatcher.onDidCreate((uri) => {
                const dirPath = path.dirname(uri.fsPath);
                console.log(`检测到标记文件创建: ${uri.fsPath}, 目录: ${dirPath}`);
                this.initializedPaths.add(dirPath);

                // 触发装饰器变更事件
                this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
                this.debouncedRefresh();
            });

            // 监听文件删除事件
            const deleteDisposable = this.fileWatcher.onDidDelete((uri) => {
                const dirPath = path.dirname(uri.fsPath);
                console.log(`检测到标记文件删除: ${uri.fsPath}, 目录: ${dirPath}`);
                this.initializedPaths.delete(dirPath);

                // 触发装饰器变更事件
                this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
                this.debouncedRefresh();
            });

            // 监听文件修改事件
            const changeDisposable = this.fileWatcher.onDidChange((uri) => {
                const dirPath = path.dirname(uri.fsPath);
                console.log(`检测到标记文件修改: ${uri.fsPath}, 目录: ${dirPath}`);

                // 触发装饰器变更事件
                this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
                this.debouncedRefresh();
            });

            this.disposables.push(this.fileWatcher);
            this.disposables.push(createDisposable);
            this.disposables.push(deleteDisposable);
            this.disposables.push(changeDisposable);
            console.log('文件观察器已设置，监视 .yonbip-project 文件');
        } catch (error) {
            console.error('设置文件观察器时出错:', error);
        }
    }

    /**
     * 标记路径为已初始化
     */
    public markAsInitialized(path: string): void {
        try {
            console.log(`标记路径为已初始化: ${path}`);

            // 检查路径是否已存在
            if (this.initializedPaths.has(path)) {
                console.log(`路径已存在于初始化列表中: ${path}`);
                return;
            }

            this.initializedPaths.add(path);

            // 清除该路径的缓存
            this.decorationCache.delete(path);

            console.log(`已添加到初始化路径列表: ${path}`);
            console.log(`当前初始化路径总数: ${this.initializedPaths.size}`);

            // 使用防抖刷新，避免频繁更新
            this.debouncedRefresh();
        } catch (error) {
            console.error(`标记路径为已初始化时出错: ${path}`, error);
        }
    }

    /**
     * 监听VS Code问题面板状态变化，增强装饰器稳定性
     */
    private setupProblemPanelListener(): void {
        try {
            // 监听诊断变化事件
            const diagnosticListener = vscode.languages.onDidChangeDiagnostics((event) => {
                console.log('诊断信息发生变化，强制刷新装饰器');
                // 延迟刷新，避免频繁更新
                setTimeout(() => {
                    this.forceRefresh();
                }, 200);
            });

            this.disposables.push(diagnosticListener);

            // 监听活动编辑器变化
            const editorListener = vscode.window.onDidChangeActiveTextEditor(() => {
                console.log('活动编辑器变化，刷新装饰器');
                this.debouncedRefresh();
            });

            this.disposables.push(editorListener);

            // 监听可见编辑器变化
            const visibleEditorsListener = vscode.window.onDidChangeVisibleTextEditors(() => {
                console.log('可见编辑器变化，刷新装饰器');
                this.debouncedRefresh();
            });

            this.disposables.push(visibleEditorsListener);

        } catch (error) {
            console.error('设置问题面板监听器时出错:', error);
        }
    }

    /**
     * 强制刷新装饰器，忽略时间间隔限制
     */
    private forceRefresh(): void {
        try {
            console.log('强制刷新装饰器');
            this.decorationCache.clear();
            this._onDidChangeFileDecorations.fire(undefined);
        } catch (error) {
            console.error('强制刷新装饰器时出错:', error);
        }
    }

    /**
     * 防抖刷新方法，避免频繁刷新
     */
    private debouncedRefresh(): void {
        const now = Date.now();

        // 检查是否在最小刷新间隔内
        if (now - this.lastRefreshTime < this.MIN_REFRESH_INTERVAL) {
            if (this.refreshTimeout) {
                clearTimeout(this.refreshTimeout);
            }

            this.refreshTimeout = setTimeout(() => {
                this.refresh();
                this.lastRefreshTime = Date.now();
                this.refreshTimeout = null;
            }, this.MIN_REFRESH_INTERVAL - (now - this.lastRefreshTime));
            return;
        }

        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }

        this.refreshTimeout = setTimeout(() => {
            this.refresh();
            this.lastRefreshTime = Date.now();
            this.refreshTimeout = null;
        }, 100);
    }

    /**
     * 刷新装饰器显示
     */
    private refresh(): void {
        try {
            console.log('开始刷新装饰器显示');
            console.log(`当前已初始化路径: ${Array.from(this.initializedPaths).join(', ')}`);

            // 清除缓存，确保获取最新状态
            this.decorationCache.clear();

            // 触发装饰器变更事件，通知VS Code重新计算装饰器
            this._onDidChangeFileDecorations.fire(undefined);

            // 延迟执行文件资源管理器刷新，避免与装饰器更新冲突
            setTimeout(() => {
                try {
                    vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
                } catch (error) {
                    console.error('刷新文件资源管理器时出错:', error);
                }
            }, 50);
        } catch (error) {
            console.error('刷新装饰器时出错:', error);
        }
    }

    /**
     * 提供文件装饰器
     */
    provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
        try {
            // 如果还未初始化完成，返回undefined
            if (!this.isProviderInitialized) {
                return undefined;
            }

            // 检查取消令牌
            if (token.isCancellationRequested) {
                return undefined;
            }

            const filePath = uri.fsPath;

            // 检查缓存
            if (this.decorationCache.has(filePath)) {
                const cachedDecoration = this.decorationCache.get(filePath);
                console.log(`使用缓存装饰器: ${filePath}`);
                return cachedDecoration;
            }

            console.log(`检查装饰器: ${filePath}`);
            console.log(`已初始化路径列表: ${Array.from(this.initializedPaths).join(', ')}`);

            // 检查是否为已初始化的项目目录
            for (const initializedPath of this.initializedPaths) {
                if (filePath === initializedPath) {
                    console.log(`找到匹配路径，返回装饰器: ${initializedPath}`);

                    // 使用更稳定的装饰器配置，避免与问题检测冲突
                    const decoration: vscode.FileDecoration = {
                        badge: '✅',
                        tooltip: 'YonBIP项目已初始化',
                        propagate: false,
                        color: new vscode.ThemeColor('terminal.ansiGreen')
                    };

                    // 缓存装饰器
                    this.decorationCache.set(filePath, decoration);
                    return decoration;
                }
            }

            // 缓存空结果，避免重复计算
            this.decorationCache.set(filePath, null);
            return undefined;
        } catch (error) {
            console.error('提供文件装饰器时出错:', error);
            return undefined;
        }
    }

    /**
     * 检查目录是否已被标记为初始化
     * @param path 目录路径
     */
    public isInitialized(path: string): boolean {
        return this.initializedPaths.has(path);
    }

    /**
     * 清空所有已标记的路径
     */
    public clear(): void {
        try {
            console.log('清空所有已标记的路径');
            console.log(`清空前路径数量: ${this.initializedPaths.size}`);

            this.initializedPaths.clear();
            this.decorationCache.clear();

            console.log('已清空所有路径和缓存');

            // 使用防抖刷新，避免频繁更新
            this.debouncedRefresh();
        } catch (error) {
            console.error('清空路径时出错:', error);
        }
    }

    /**
     * 实现Disposable接口
     */
    public dispose(): void {
        console.log('正在清理ProjectDecorationProvider资源');

        // 清理防抖定时器
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = null;
        }

        // 清理事件发射器
        this._onDidChangeFileDecorations.dispose();

        // 清理文件观察器
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = null;
        }

        // 清理所有disposables
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];

        // 重置状态
        this.isProviderInitialized = false;
        this.initializedPaths.clear();
    }
}






