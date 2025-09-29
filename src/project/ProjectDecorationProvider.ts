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

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        console.log('ProjectDecorationProvider 构造函数被调用');

        // 先初始化扫描，再注册装饰器
        this.initialize().then(() => {
            // 注册文件装饰器，实现FileDecorationProvider接口
            this.fileDecorationProvider = vscode.window.registerFileDecorationProvider(this);

            console.log('文件装饰器提供者已注册');
            if (this.fileDecorationProvider) {
                this.disposables.push(this.fileDecorationProvider);
            }

            // 创建文件观察器来监视标记文件的创建
            this.setupFileWatcher();
        });
    }

    /**
     * 初始化装饰器提供者
     */
    private async initialize(): Promise<void> {
        // 初始化时扫描已存在的标记文件
        await this.scanForExistingMarkers();
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
        // 创建文件观察器来监视标记文件的创建、删除和修改
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/.yonbip-project');

        // 监听文件创建事件
        const createDisposable = this.fileWatcher.onDidCreate((uri) => {
            const dirPath = path.dirname(uri.fsPath);
            console.log(`检测到标记文件创建: ${uri.fsPath}, 目录: ${dirPath}`);
            this.initializedPaths.add(dirPath);

            // 触发装饰器变更事件
            this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
            this.refresh();
        });

        // 监听文件删除事件
        const deleteDisposable = this.fileWatcher.onDidDelete((uri) => {
            const dirPath = path.dirname(uri.fsPath);
            console.log(`检测到标记文件删除: ${uri.fsPath}, 目录: ${dirPath}`);
            this.initializedPaths.delete(dirPath);

            // 触发装饰器变更事件
            this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
            this.refresh();
        });

        // 监听文件修改事件
        const changeDisposable = this.fileWatcher.onDidChange((uri) => {
            const dirPath = path.dirname(uri.fsPath);
            console.log(`检测到标记文件修改: ${uri.fsPath}, 目录: ${dirPath}`);

            // 触发装饰器变更事件
            this._onDidChangeFileDecorations.fire(vscode.Uri.file(dirPath));
            this.refresh();
        });

        this.disposables.push(this.fileWatcher);
        this.disposables.push(createDisposable);
        this.disposables.push(deleteDisposable);
        this.disposables.push(changeDisposable);
        console.log('文件观察器已设置，监视 .yonbip-project 文件');
    }

    /**
     * 标记目录为已初始化的项目目录
     * @param path 已初始化的项目目录路径
     */
    public markAsInitialized(path: string): void {
        console.log(`标记目录为已初始化: ${path}`);
        console.log(`标记前的路径集合: ${Array.from(this.initializedPaths).join(', ')}`);

        this.initializedPaths.add(path);

        console.log(`标记后的路径集合: ${Array.from(this.initializedPaths).join(', ')}`);

        // 触发装饰器变更事件，通知VS Code重新计算装饰器
        this._onDidChangeFileDecorations.fire(vscode.Uri.file(path));

        // 触发UI更新
        this.refresh();
    }

    /**
     * 刷新装饰器显示
     */
    private refresh(): void {
        console.log('开始刷新装饰器显示');
        console.log(`当前已初始化路径: ${Array.from(this.initializedPaths).join(', ')}`);

        // 触发装饰器变更事件，通知VS Code重新计算装饰器
        this._onDidChangeFileDecorations.fire(undefined);

        // 使用VS Code的内置刷新机制
        vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
    }

    /**
     * 提供文件装饰器
     */
    provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
        console.log(`检查装饰器: ${uri.fsPath}`);
        console.log(`已初始化路径列表: ${Array.from(this.initializedPaths).join(', ')}`);

        // 检查是否为已初始化的项目目录
        for (const initializedPath of this.initializedPaths) {
            if (uri.fsPath === initializedPath) {
                console.log(`找到匹配路径，返回装饰器: ${initializedPath}`);
                return {
                    badge: '📁',
                    tooltip: 'YonBIP项目已初始化 - 点击查看详情',
                    propagate: false,
                    color: new vscode.ThemeColor('charts.blue')
                };
            }
        }
        return undefined;
    }

    /**
     * 检查目录是否已被标记为初始化
     * @param path 目录路径
     */
    public isInitialized(path: string): boolean {
        return this.initializedPaths.has(path);
    }

    /**
     * 清除所有标记
     */
    public clear(): void {
        this.initializedPaths.clear();
        this.refresh();
    }

    /**
     * 实现Disposable接口
     */
    public dispose(): void {
        console.log('正在清理ProjectDecorationProvider资源');

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
    }
}






