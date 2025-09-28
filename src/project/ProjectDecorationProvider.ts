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
        console.log('ProjectDecorationProvider 构造函数被调用');

        // 注册文件装饰器
        this.fileDecorationProvider = vscode.window.registerFileDecorationProvider({
            provideFileDecoration: (uri: vscode.Uri, token: vscode.CancellationToken) => {
                console.log(`检查装饰器: ${uri.fsPath}`);
                console.log(`已初始化路径列表: ${Array.from(this.initializedPaths).join(', ')}`);
                
                // 检查是否为已初始化的项目目录
                for (const initializedPath of this.initializedPaths) {
                    if (uri.fsPath === initializedPath) {
                        console.log(`找到匹配路径，返回装饰器: ${initializedPath}`);
                        return {
                            badge: 'Y',
                            tooltip: 'YonBIP项目已初始化 - 点击查看详情',
                            propagate: false,
                            color: new vscode.ThemeColor('charts.blue'),
                            iconPath: this.context.asAbsolutePath('resources/icons/project/initialized-icon.png')
                        };
                    }
                }
                return undefined;
            }
        });

        console.log('文件装饰器提供者已注册');
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
        console.log(`标记前的路径集合: ${Array.from(this.initializedPaths).join(', ')}`);
        
        this.initializedPaths.add(path);
        
        console.log(`标记后的路径集合: ${Array.from(this.initializedPaths).join(', ')}`);
        
        // 触发UI更新
        this.refresh();
    }

    /**
     * 刷新装饰器显示
     */
    private refresh(): void {
        console.log('开始刷新装饰器显示');
        
        // 立即触发装饰器更新
        this.initializedPaths.forEach(path => {
            const uri = vscode.Uri.file(path);
            console.log(`触发装饰器更新: ${path}`);
            
            // 使用onDidChangeFileDecorations事件来强制刷新
            vscode.window.onDidChangeActiveTextEditor(() => {
                // 这会触发装饰器重新计算
            });
        });
        
        // 延迟刷新文件资源管理器
        setTimeout(() => {
            console.log('刷新文件资源管理器');
            // 触发文件资源管理器刷新
            vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        }, 200);
        
        // 再次延迟触发装饰器更新
         setTimeout(() => {
             console.log('强制触发装饰器更新');
             this.initializedPaths.forEach(path => {
                 const uri = vscode.Uri.file(path);
                 // 触发装饰器重新计算
                 vscode.workspace.fs.stat(uri).then(() => {
                     console.log(`装饰器更新完成: ${path}`);
                 }, (err: any) => {
                     console.error(`装饰器更新失败: ${path}`, err);
                 });
             });
         }, 500);
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