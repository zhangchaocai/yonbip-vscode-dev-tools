import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 项目目录装饰提供者
 * 用于为已初始化的YonBIP项目目录添加图标标识
 */
export class ProjectDecorationProvider implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private initializedPaths: Set<string> = new Set();
    private context: vscode.ExtensionContext;
    private fileDecorationProvider: vscode.Disposable;
    private fileWatcher: vscode.FileSystemWatcher | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;

        // 注册文件装饰器
        this.fileDecorationProvider = vscode.window.registerFileDecorationProvider({
            provideFileDecoration: (uri: vscode.Uri, token: vscode.CancellationToken) => {
                // 检查是否为已初始化的项目目录
                for (const initializedPath of this.initializedPaths) {
                    if (uri.fsPath === initializedPath) {
                        return {
                            badge: '✅',
                            tooltip: 'YonBIP项目已初始化',
                            propagate: true
                        };
                    }
                }
                return undefined;
            }
        });

        this.disposables.push(this.fileDecorationProvider);

        // 初始化时扫描已存在的标记文件
        this.scanForExistingMarkers();

        // 创建文件观察器来监视标记文件的创建
        this.setupFileWatcher();
    }

    /**
     * 扫描已存在的标记文件
     */
    private async scanForExistingMarkers(): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;

        for (const folder of folders) {
            try {
                const markerFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/.yonbip-project'),
                    null,
                    100
                );

                for (const markerFile of markerFiles) {
                    const projectPath = path.dirname(markerFile.fsPath);
                    this.initializedPaths.add(projectPath);
                }
            } catch (error) {
                console.error('扫描标记文件时出错:', error);
            }
        }

        // 刷新UI
        this.refresh();
    }

    /**
     * 设置文件观察器
     */
    private setupFileWatcher(): void {
        // 监视所有工作区中的.yonbip-project文件
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/.yonbip-project');

        this.fileWatcher.onDidCreate((uri) => {
            const projectPath = path.dirname(uri.fsPath);
            this.initializedPaths.add(projectPath);
            this.refresh();
        });

        this.fileWatcher.onDidDelete((uri) => {
            const projectPath = path.dirname(uri.fsPath);
            this.initializedPaths.delete(projectPath);
            this.refresh();
        });

        this.disposables.push(this.fileWatcher);
    }

    /**
     * 标记目录为已初始化的项目目录
     * @param path 已初始化的项目目录路径
     */
    public markAsInitialized(path: string): void {
        console.log(`标记目录为已初始化: ${path}`);
        this.initializedPaths.add(path);
        // 触发UI更新
        this.refresh();
    }

    /**
     * 刷新装饰器显示
     */
    private refresh(): void {
        // 通过触发文件系统事件来强制刷新装饰器
        setTimeout(() => {
            vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        }, 100);
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
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}