import * as vscode from 'vscode';
import * as path from 'path';
import { PatchInfo } from '../../project/project-management/ProjectService';
import { NCHomeConfigService } from '../../project/nc-home/config/NCHomeConfigService';
import { StatisticsService } from '../../utils/StatisticsService';

/**
 * 补丁导出配置Webview提供者
 */
export class PatchExportWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip.patchExportConfig';

    private _view?: vscode.WebviewView;
    private _resolvePromise?: (value: PatchInfo | null) => void;
    private configService: NCHomeConfigService;
    private _classpathSrcRootsCache = new Map<string, string[]>();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this.configService = new NCHomeConfigService(_context);

        // 注册刷新命令
        this._context.subscriptions.push(
            vscode.commands.registerCommand('yonbip.patchExportConfig.refresh', () => {
                this._refreshExportableFiles();
            })
        );
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'exportPatch':
                        this._handleExportPatch(message.data);
                        break;
                    case 'selectOutputPath':
                        this._handleSelectOutputPath();
                        break;
                    // 取消功能已移除
                    // case 'cancel':
                    //     this._handleCancel();
                    //     break;
                    case 'refreshFiles':
                        this._refreshExportableFiles();
                        break;

                    case 'selectOutputDir':
                        this._handleSelectOutputDir();
                        break;
                    case 'showMessage':
                        console.log('收到Webview消息:', message);
                        // 同时显示系统通知
                        if (message.level === 'error') {
                            vscode.window.showErrorMessage(message.message);
                        } else if (message.level === 'success') {
                            vscode.window.showInformationMessage(message.message);
                        } else {
                            vscode.window.showInformationMessage(message.message);
                        }
                        break;
                }
            },
            undefined,
            this._context.subscriptions
        );

        // 初始化时清空可导出文件列表
        this._clearExportableFiles();
    }

    private async _handleSelectOutputPath(): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择输出目录'
        });

        if (result && result[0]) {
            this._view?.webview.postMessage({
                type: 'setOutputPath',
                path: result[0].fsPath
            });
        }
    }

    /**
     * 显示补丁导出配置界面
     */
    public async showExportConfig(): Promise<PatchInfo | null> {
        if (!this._view) {
            await vscode.commands.executeCommand('yonbip.patchExportConfig.focus');
        }

        return new Promise<PatchInfo | null>((resolve) => {
            this._resolvePromise = resolve;

            // 初始化表单数据
            this._view?.webview.postMessage({
                type: 'initForm',
                data: this._getDefaultPatchInfo()
            });
        });
    }

    private async _handleExportPatch(data: any) {
        console.log('收到导出补丁请求:', data);

        try {
            const patchInfo: PatchInfo = {
                name: data.name || 'patch',
                version: data.version || '1.0.0',
                description: data.description || '',
                files: [],
                outputPath: data.outputDir || './patches',
                includeSource: data.includeSource !== false,
                includeResources: data.includeResources !== false,
                includeConfig: data.includeConfig !== false
            };

            // 添加作者信息和包含源码选项到patchInfo（通过类型断言）
            (patchInfo as any).author = data.author || '';
            (patchInfo as any).includeJavaSource = data.includeJavaSource !== false;

            console.log('构建的补丁信息:', patchInfo);

            // 执行实际的导出逻辑
            await this._performPatchExport(patchInfo);

        } catch (error) {
            console.error('导出补丁失败:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log('准备发送错误消息到Webview:', errorMessage);
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'error',
                message: `导出补丁失败: ${errorMessage}`
            });
            console.log('错误消息已发送到Webview');
        }
    }

    private async _performPatchExport(patchInfo: PatchInfo): Promise<void> {
        console.log('开始执行补丁导出:', patchInfo);

        const fs = require('fs');
        const archiver = require('archiver');
        const { v4: uuidv4 } = require('uuid');

        const basePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!basePath) {
            throw new Error('请先打开一个工作区');
        }

        console.log('工作区路径:', basePath);

        // 显示进度
        this._view?.webview.postMessage({
            type: 'showMessage',
            level: 'info',
            message: '正在导出补丁...'
        });

        try {
            // 获取用户右键选择的路径（支持单个路径和多个路径）
            const selectedPath = this._context.workspaceState.get<string>('selectedExportPath');
            const selectedPaths = this._context.workspaceState.get<string[]>('selectedExportPaths');
            
            console.log('导出补丁 - selectedPath:', selectedPath);
            console.log('导出补丁 - selectedPaths:', selectedPaths);

            // 检查选择的Java文件是否有对应的编译码文件
            const hasCompiledFiles = await this._validateJavaFilesHaveCompiledFiles(selectedPath, selectedPaths, basePath);
            if (!hasCompiledFiles) {
                // 如果没有对应的编译码文件，终止导出流程并提醒用户配置源码
                const errorMessage = `编译文件检查失败

` +
                    `选择的Java文件缺少对应的编译码文件(.class)。

` +
                    `💡 解决方案：
` +
                    `1. 确保项目已成功编译（Build Project）
` +
                    `2. 或使用【全部加入源码路径】功能配置源码路径
` +
                    `3. 然后重新导出补丁`;
                this._view?.webview.postMessage({
                    type: 'showMessage',
                    level: 'error',
                    message: errorMessage
                });
                return;
            }

            let files: { path: string, type: string, relativePath: string }[] = [];

            if (selectedPaths && selectedPaths.length > 0) {
                console.log('处理多个路径导出:', selectedPaths);
                // 处理多个路径的情况
                const filePaths = new Set<string>(); // 用于去重
                for (const path of selectedPaths) {
                    console.log('处理路径:', path);
                    const pathFiles = await this._collectExportableFiles(path);
                    console.log('路径', path, '找到文件数量:', pathFiles.length);
                    
                    // 去重处理
                    for (const file of pathFiles) {
                        if (!filePaths.has(file.path)) {
                            filePaths.add(file.path);
                            files.push(file);
                        }
                    }
                }
            } else if (selectedPath) {
                console.log('处理单个路径导出:', selectedPath);
                // 仅使用用户选择的单个路径
                files = await this._collectExportableFiles(selectedPath);
            } else {
                console.log('使用工作区根目录导出');
                // 如果没有选择路径，使用工作区根目录
                files = await this._collectExportableFiles(basePath);
            }

            console.log('收集到的文件数量:', files.length);
            
            // 打印所有文件路径以便调试
            files.forEach((file, index) => {
                console.log(`文件 ${index + 1}:`, file.path, `类型: ${file.type}`);
            });

            if (files.length === 0) {
                throw new Error('没有找到需要导出的文件');
            }

            // 创建补丁包
            console.log('开始创建补丁包...');
            const zipPath = await this._createStandardPatchZip(files, patchInfo, basePath);
            console.log('补丁包创建成功:', zipPath);

            // 显示成功消息
            console.log('准备发送成功消息到Webview');
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'success',
                message: `补丁导出成功: ${path.basename(zipPath)}`
            });
            console.log('成功消息已发送到Webview');
            
            // 记录补丁导出统计
            StatisticsService.incrementCount(StatisticsService.PATCH_EXPORT_COUNT);

            // 显示系统通知
            vscode.window.showInformationMessage(
                `补丁导出成功: ${path.basename(zipPath)}`,
                '打开文件夹'
            ).then(choice => {
                if (choice === '打开文件夹') {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(zipPath));
                }
            });

        } catch (error) {
            console.error('补丁导出过程中出错:', error);
            // 直接向用户显示错误消息，而不是重新抛出错误
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log('准备发送错误消息到Webview:', errorMessage);
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'error',
                message: `导出补丁失败: ${errorMessage}`
            });
            console.log('错误消息已发送到Webview');
            // 不再重新抛出错误，而是在这里处理
        }
    }

    private async _refreshExportableFiles(): Promise<void> {
        try {
            // 获取用户右键选择的路径（支持单个路径和多个路径）
            const selectedPath = this._context.workspaceState.get<string>('selectedExportPath');
            const selectedPaths = this._context.workspaceState.get<string[]>('selectedExportPaths');
            
            console.log('刷新文件列表 - selectedPath:', selectedPath);
            console.log('刷新文件列表 - selectedPaths:', selectedPaths);

            if (selectedPaths && selectedPaths.length > 0) {
                console.log('处理多个路径:', selectedPaths);
                // 处理多个路径的情况
                let allFiles: { path: string, type: string, relativePath: string }[] = [];
                const filePaths = new Set<string>(); // 用于去重
                
                for (const path of selectedPaths) {
                    console.log('处理路径:', path);
                    const pathFiles = await this._collectExportableFiles(path);
                    console.log('路径', path, '找到文件数量:', pathFiles.length);
                    
                    // 去重处理
                    for (const file of pathFiles) {
                        if (!filePaths.has(file.path)) {
                            filePaths.add(file.path);
                            allFiles.push(file);
                        }
                    }
                }
                
                console.log('总共找到文件数量:', allFiles.length);

                // 发送文件列表到webview
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'filesRefreshed',
                        files: this._groupFilesByType(allFiles)
                    });
                }
            } else if (selectedPath) {
                console.log('处理单个路径:', selectedPath);
                // 处理单个路径的情况
                const files = await this._collectExportableFiles(selectedPath);
                console.log('单个路径找到文件数量:', files.length);

                // 发送文件列表到webview
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'filesRefreshed',
                        files: this._groupFilesByType(files)
                    });
                }
            } else {
                console.log('使用工作区根目录');
                // 如果没有选择路径，使用工作区根目录
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    return;
                }

                const files = await this._collectExportableFiles(workspaceFolder.uri.fsPath);
                console.log('工作区根目录找到文件数量:', files.length);

                // 发送文件列表到webview
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'filesRefreshed',
                        files: this._groupFilesByType(files)
                    });
                }
            }
        } catch (error) {
            console.error('刷新可导出文件失败:', error);
        }
    }

    private _clearExportableFiles(): void {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'filesRefreshed',
                files: {
                    source: [],
                    resources: [],
                    config: [],
                    libraries: []
                }
            });
        }
    }

    private async _collectExportableFiles(basePath: string): Promise<{ path: string, type: string, relativePath: string }[]> {
        const files: { path: string, type: string, relativePath: string }[] = [];
        const fs = require('fs');
        const path = require('path');

        // 首先检查传入的路径是否为文件
        try {
            const stat = await fs.promises.stat(basePath);
            
            // 如果是文件，直接判断文件类型并加入数组
            if (stat.isFile()) {
                const ext = path.extname(basePath).toLowerCase();
                let fileType = '';

                // 根据文件扩展名分类
                if (['.java'].includes(ext)) {
                    fileType = 'source';
                } else if (['.xml', '.upm', '.rest', '.aop'].includes(ext)) {
                    // 过滤掉特定的XML文件
                    const fileName = path.basename(basePath).toLowerCase();
                    if (fileName !== 'module.xml' && fileName !== 'component.xml') {
                        fileType = 'resource';
                    }
                }

                if (fileType) {
                    files.push({
                        path: basePath,
                        type: fileType,
                        relativePath: path.basename(basePath)
                    });
                }
                
                return files;
            }
        } catch (error) {
            // 如果无法获取文件状态，继续执行目录扫描逻辑
            console.warn(`无法获取文件状态: ${basePath}`, error);
        }

        // 使用异步方式扫描目录，避免阻塞UI
        const scanDir = async (dirPath: string, relativePath: string = ''): Promise<void> => {
            try {
                const items = await fs.promises.readdir(dirPath);

                // 创建所有子任务的Promise数组
                const tasks = items.map(async (item: string) => {
                    const fullPath = path.join(dirPath, item);
                    const itemRelativePath = relativePath ? path.join(relativePath, item) : item;

                    try {
                        const stat = await fs.promises.stat(fullPath);

                        if (stat.isDirectory()) {
                            // 跳过一些目录
                            if (item === 'node_modules' || item === '.git' || item === 'target' ||
                                item === 'build' || item === 'out' || item.startsWith('.')) {
                                return;
                            }
                            await scanDir(fullPath, itemRelativePath);
                        } else {
                            const ext = path.extname(item).toLowerCase();
                            let fileType = '';

                            // 根据文件扩展名分类
                            if (['.java'].includes(ext)) {
                                fileType = 'source';
                            } else if (['.xml', '.upm', '.rest', '.aop'].includes(ext)) {
                                // 过滤掉特定的XML文件
                                const fileName = path.basename(item).toLowerCase();
                                if (fileName !== 'module.xml' && fileName !== 'component.xml') {
                                    fileType = 'resource';
                                }
                            }

                            if (fileType) {
                                files.push({
                                    path: fullPath,
                                    type: fileType,
                                    relativePath: itemRelativePath
                                });
                            }
                        }
                    } catch (statError) {
                        // 忽略无法访问的文件
                        console.warn(`无法访问文件: ${fullPath}`, statError);
                        return;
                    }
                });

                // 等待所有子任务完成
                await Promise.all(tasks);
            } catch (readError) {
                // 忽略无法读取的目录
                console.warn(`无法读取目录: ${dirPath}`, readError);
                return;
            }
        };

        await scanDir(basePath);
        return files;
    }

    // 取消功能已移除
    // private _handleCancel() {
    //     if (this._resolvePromise) {
    //         this._resolvePromise(null);
    //         this._resolvePromise = undefined;
    //     }
    // }

    private async _handleSelectOutputDir() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: '选择补丁输出目录'
        };

        const folderUri = await vscode.window.showOpenDialog(options);
        if (folderUri && folderUri.length > 0) {
            const outputDir = folderUri[0].fsPath;
            this._view?.webview.postMessage({
                type: 'outputDirSelected',
                outputDir
            });
        }
    }

    private _getDefaultPatchInfo(): Partial<PatchInfo> & { author?: string, includeJavaSource?: boolean } {
        const config = vscode.workspace.getConfiguration('yonbip');
        return {
            name: '修复补丁',
            version: '1',
            description: '',
            author: 'yonyou',
            includeSource: true,
            includeResources: true,
            includeConfig: false,
            includeJavaSource: true, // 默认包含Java源码
            outputPath: config.get('patchOutputDir') || './patches'
        };
    }
    
    /**
     * 检查是否存在相关的内部类文件
     */
    private async _checkInnerClassFilesExist(mainClassPath: string): Promise<boolean> {
        const fs = require('fs');
        const path = require('path');
        
        // 获取class文件的目录和基础名称
        const classDir = path.dirname(mainClassPath);
        const classBaseName = path.basename(mainClassPath, '.class');
        
        // 检查是否存在相关的内部类文件（$1.class, $2.class等）
        let hasInnerClass = false;
        
        try {
            const dirFiles = await fs.promises.readdir(classDir);
            
            for (const file of dirFiles) {
                if (file.startsWith(classBaseName + '$') && file.endsWith('.class')) {
                    hasInnerClass = true;
                    break;
                }
            }
        } catch (error) {
            console.warn(`无法读取目录 ${classDir}:`, error);
        }
        
        return hasInnerClass;
    }
    
    /**
     * 添加相关的内部类文件到归档
     */
    private async _addInnerClassFiles(archive: any, mainClassPath: string, mainTargetPath: string, classDir: string): Promise<void> {
        const fs = require('fs');
        const path = require('path');
        
        // 获取class文件的基础名称
        const classBaseName = path.basename(mainClassPath, '.class');
        
        try {
            const dirFiles = await fs.promises.readdir(path.dirname(mainClassPath));
            
            for (const file of dirFiles) {
                // 检查是否为相关的内部类文件（如BaseClass$1.class, BaseClass$2.class等）
                if (file.startsWith(classBaseName + '$') && file.endsWith('.class')) {
                    const innerClassPath = path.join(path.dirname(mainClassPath), file);
                    const innerTargetPath = mainTargetPath.replace(`${classBaseName}.class`, file);
                    
                    // 确保目录存在
                    const innerClassDir = path.dirname(innerTargetPath);
                    if (innerClassDir !== classDir) {
                        // 如果内部类在不同的子目录中，创建相应目录
                        this._ensureDirectoryExists(archive, innerClassDir);
                    }
                    
                    // 添加内部类文件到归档
                    const innerClassStat = fs.statSync(innerClassPath);
                    archive.file(innerClassPath, { 
                        name: innerTargetPath,
                        date: innerClassStat.mtime // 确保使用正确的修改时间
                    });
                    
                    console.log(`添加内部类文件: ${innerClassPath} -> ${innerTargetPath}`);
                }
            }
        } catch (error) {
            console.warn(`无法读取目录以查找内部类文件 ${path.dirname(mainClassPath)}:`, error);
        }
    }
    
    /**
     * 确保归档中存在指定的目录
     */
    private _ensureDirectoryExists(archive: any, dirPath: string): void {
        const path = require('path');
        
        // 将路径转换为Unix风格
        const unixDirPath = dirPath.replace(/\\/g, '/');
        
        // 分割路径并逐级添加目录
        const parts = unixDirPath.split('/');
        let currentPath = '';
        
        for (const part of parts) {
            if (part) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                // 尝试添加目录（如果不存在）
                try {
                    archive.append('', { name: currentPath + '/' });
                } catch (e) {
                    // 如果目录已存在，会抛出异常，忽略即可
                }
            }
        }
    }

    public getHtmlForWebview(webview: vscode.Webview): string {
        return this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>补丁导出配置</title>
    <style>
        /* 全局样式优化 */
        * {
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-sideBar-background) 100%);
            padding: 0;
            margin: 0;
            line-height: 1.5;
        }

        .form-container {
            max-width: 100%;
            padding: 24px 24px 120px 24px; /* 增加底部padding为120px，为固定按钮留出空间 */
            background-color: var(--vscode-editor-background);
            border-radius: 12px;
            margin: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            border: 1px solid var(--vscode-widget-border);
        }

        /* 表单组样式优化 */
        .form-group {
            margin-bottom: 24px;
            position: relative;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--vscode-input-foreground);
            font-size: 13px;
            letter-spacing: 0.3px;
        }

        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 8px;
            font-size: 14px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            outline: none;
        }

        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
            transform: translateY(-1px);
        }

        .form-group input:hover,
        .form-group select:hover,
        .form-group textarea:hover {
            border-color: var(--vscode-inputOption-hoverBackground);
        }

        .form-group textarea {
            min-height: 80px;
            resize: vertical;
            font-family: var(--vscode-font-family);
        }

        /* 表单行样式 */
        .form-row {
            display: flex;
            gap: 12px;
            align-items: stretch;
        }

        .form-row input {
            flex: 1;
        }

        /* 浏览按钮优化 */
        .browse-button {
            padding: 12px 20px;
            background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            white-space: nowrap;
            font-weight: 500;
            font-size: 13px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .browse-button:hover {
            background: linear-gradient(135deg, var(--vscode-button-hoverBackground) 0%, var(--vscode-button-background) 100%);
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        }

        .browse-button:active {
            transform: translateY(0);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        /* 复选框组优化 */
        .checkbox-group {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px;
            background-color: var(--vscode-input-background);
            border-radius: 8px;
            border: 1px solid var(--vscode-input-border);
        }

        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px;
            border-radius: 6px;
            transition: background-color 0.2s ease;
        }

        .checkbox-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .checkbox-item input[type="checkbox"] {
            width: 18px;
            height: 18px;
            margin: 0;
            cursor: pointer;
            accent-color: var(--vscode-button-background);
        }

        .checkbox-item label {
            margin: 0;
            cursor: pointer;
            font-weight: 500;
        }

        /* 文件列表容器优化 */
        .file-list-container {
            max-height: 350px;
            overflow-y: auto;
            border: 2px solid var(--vscode-input-border);
            border-radius: 12px;
            margin-bottom: 24px;
            background-color: var(--vscode-input-background);
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .file-list {
            padding: 16px;
        }

        .file-category {
            margin-bottom: 20px;
            background-color: var(--vscode-editor-background);
            border-radius: 8px;
            padding: 12px;
            border-left: 4px solid var(--vscode-textLink-foreground);
        }

        .file-category-title {
            font-weight: 700;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 8px;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .file-category-title::before {
            content: "📁";
            font-size: 16px;
        }

        .file-item {
            padding: 6px 12px;
            font-size: 13px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-list-inactiveSelectionBackground);
            margin: 2px 0;
            border-radius: 4px;
            transition: all 0.2s ease;
        }

        .file-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            transform: translateX(4px);
        }

        /* 刷新按钮优化 */
        .refresh-button {
            background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            margin-left: 12px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        }

        .refresh-button:hover {
            background: linear-gradient(135deg, var(--vscode-button-hoverBackground) 0%, var(--vscode-button-background) 100%);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .refresh-button::before {
            content: "🔄";
            margin-right: 6px;
        }

        /* 加载状态优化 */
        .loading {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
        }

        .loading::before {
            content: "⏳";
            font-size: 32px;
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        /* 章节标题优化 */
        .section-title {
            font-size: 16px;
            font-weight: 700;
            margin: 32px 0 16px 0;
            color: var(--vscode-foreground);
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            padding-bottom: 8px;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .section-title::before {
            content: "";
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 60px;
            height: 2px;
            background: linear-gradient(90deg, var(--vscode-button-background), transparent);
        }

        /* 按钮组优化 - 固定在底部 */
        .button-group {
            display: flex;
            gap: 16px;
            justify-content: flex-end;
            padding: 24px;
            border-top: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-editor-background);
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(8px);
        }

        .button {
            padding: 14px 28px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            min-width: 120px;
        }

        .button::before {
            content: "";
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
        }

        .button:hover::before {
            left: 100%;
        }

        .button-primary {
            background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            color: var(--vscode-button-foreground);
            box-shadow: 0 4px 16px rgba(0, 122, 255, 0.3);
        }

        .button-primary:hover {
            background: linear-gradient(135deg, var(--vscode-button-hoverBackground) 0%, var(--vscode-button-background) 100%);
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0, 122, 255, 0.4);
        }

        .button-secondary {
            background: linear-gradient(135deg, var(--vscode-button-secondaryBackground) 0%, var(--vscode-input-background) 100%);
            color: var(--vscode-button-secondaryForeground);
            border: 2px solid var(--vscode-input-border);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .button-secondary:hover {
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, var(--vscode-button-secondaryBackground) 100%);
            border-color: var(--vscode-focusBorder);
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        }

        /* 错误和成功状态样式优化 */
        .error-message {
            color: var(--vscode-errorForeground);
            background: linear-gradient(135deg, var(--vscode-inputValidation-errorBackground) 0%, rgba(255, 0, 0, 0.05) 100%);
            font-size: 13px;
            margin-top: 8px;
            padding: 12px 16px;
            border-radius: 8px;
            border-left: 4px solid var(--vscode-inputValidation-errorBorder);
            display: none;
            animation: slideInUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            box-shadow: 0 2px 8px rgba(255, 0, 0, 0.1);
        }
        
        .error-message::before {
            content: '⚠️';
            margin-right: 8px;
            font-size: 16px;
        }
        
        @keyframes slideInUp {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .error-message.show {
            display: block;
        }

        .form-group.error input,
        .form-group.error select,
        .form-group.error textarea {
            border-color: var(--vscode-inputValidation-errorBorder);
            background-color: var(--vscode-inputValidation-errorBackground);
            animation: shake 0.5s ease-in-out;
            box-shadow: 0 0 0 3px rgba(255, 0, 0, 0.1);
        }
        
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-4px); }
            75% { transform: translateX(4px); }
        }
        
        /* 成功状态样式优化 */
        .form-group.success input,
        .form-group.success select,
        .form-group.success textarea {
            border-color: #4caf50;
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.05) 0%, var(--vscode-input-background) 100%);
            box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
        }
        
        .success-message {
            color: #4caf50;
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(76, 175, 80, 0.05) 100%);
            font-size: 13px;
            margin-top: 8px;
            padding: 12px 16px;
            border-radius: 8px;
            border-left: 4px solid #4caf50;
            display: none;
            animation: slideInUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 2px 8px rgba(76, 175, 80, 0.1);
        }
        
        .success-message::before {
            content: '✅';
            margin-right: 8px;
            font-size: 16px;
        }
        
        .success-message.show {
            display: block;
        }
        
        /* 加载状态样式优化 */
        .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.4) 100%);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
            animation: fadeIn 0.3s ease-out;
        }
        
        .loading-content {
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-sideBar-background) 100%);
            padding: 32px;
            border-radius: 16px;
            text-align: center;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
            min-width: 240px;
            border: 1px solid var(--vscode-widget-border);
        }
        
        .loading-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid var(--vscode-progressBar-background);
            border-top: 4px solid var(--vscode-progressBar-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        /* 按钮状态优化 */
        .button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
            box-shadow: none !important;
        }
        
        .button-primary:disabled {
            background: var(--vscode-button-background) !important;
        }
        
        /* 工具提示样式优化 */
        .tooltip {
            position: relative;
            display: inline-block;
        }
        
        .tooltip .tooltiptext {
            visibility: hidden;
            width: 220px;
            background: linear-gradient(135deg, var(--vscode-editorHoverWidget-background) 0%, var(--vscode-sideBar-background) 100%);
            color: var(--vscode-editorHoverWidget-foreground);
            text-align: center;
            border-radius: 8px;
            padding: 12px 16px;
            position: absolute;
            z-index: 1001;
            bottom: 125%;
            left: 50%;
            margin-left: -110px;
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            font-size: 13px;
            border: 1px solid var(--vscode-editorHoverWidget-border);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(4px);
        }
        
        .tooltip .tooltiptext::after {
            content: "";
            position: absolute;
            top: 100%;
            left: 50%;
            margin-left: -6px;
            border-width: 6px;
            border-style: solid;
            border-color: var(--vscode-editorHoverWidget-background) transparent transparent transparent;
        }
        
        .tooltip:hover .tooltiptext {
            visibility: visible;
            opacity: 1;
            transform: translateY(-4px);
        }

        /* 无数据状态优化 */
        .no-data {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, var(--vscode-editor-background) 100%);
            border-radius: 12px;
            margin: 20px 0;
        }
        
        .no-data-icon {
            font-size: 64px;
            margin-bottom: 20px;
            opacity: 0.6;
            animation: float 3s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }
        
        .no-data-text {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
        }
        
        .no-data-subtext {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
        }
        
        /* 消息显示样式优化 */
        .message-container {
            position: fixed;
            top: 20px;
            left: 20px;
            right: 20px;
            z-index: 1000;
            pointer-events: none;
        }
        
        .message-content {
            padding: 20px 24px;
            border-radius: 12px;
            font-size: 14px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            border-left: 5px solid;
            display: flex;
            align-items: flex-start;
            gap: 16px;
            animation: slideInDown 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            pointer-events: auto;
            max-height: 70vh;
            overflow-y: auto;
            backdrop-filter: blur(8px);
        }
        
        @keyframes slideInDown {
            from {
                transform: translateY(-100%) scale(0.95);
                opacity: 0;
            }
            to {
                transform: translateY(0) scale(1);
                opacity: 1;
            }
        }
        
        @keyframes slideOutUp {
            from {
                transform: translateY(0) scale(1);
                opacity: 1;
            }
            to {
                transform: translateY(-100%) scale(0.95);
                opacity: 0;
            }
        }
        
        .message-content.error {
            background: linear-gradient(135deg, var(--vscode-inputValidation-errorBackground) 0%, rgba(255, 0, 0, 0.1) 100%);
            color: var(--vscode-inputValidation-errorForeground);
            border-left-color: var(--vscode-inputValidation-errorBorder);
            white-space: pre-line;
            line-height: 1.6;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        
        .message-icon {
            font-size: 20px;
            flex-shrink: 0;
            margin-top: 2px;
        }
        
        .message-text {
            flex: 1;
            line-height: 1.6;
            word-wrap: break-word;
            overflow-wrap: break-word;
            white-space: pre-line;
        }
        
        .message-close {
            background: none;
            border: none;
            color: currentColor;
            cursor: pointer;
            padding: 6px;
            border-radius: 6px;
            opacity: 0.7;
            font-size: 18px;
            flex-shrink: 0;
            margin-top: -2px;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }
        
        .message-close:hover {
            opacity: 1;
            background-color: rgba(255, 255, 255, 0.15);
            transform: scale(1.1);
        }
        
        .message-content.info {
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, var(--vscode-editor-background) 100%);
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-input-border);
            border-left-color: var(--vscode-button-background);
        }
        
        .message-content.success {
            background: linear-gradient(135deg, var(--vscode-diffEditor-insertedTextBackground) 0%, rgba(76, 175, 80, 0.1) 100%);
            color: var(--vscode-diffEditor-insertedTextForeground);
            border: 1px solid var(--vscode-diffEditor-insertedTextBackground);
            border-left-color: #4caf50;
        }
    </style>
</head>
<body>
    <div class="form-container">
        <!-- 优化的消息显示区域 -->
        <div id="messageContainer" class="message-container" style="display: none;">
            <div id="messageContent" class="message-content">
                <span id="messageIcon" class="message-icon"></span>
                <div id="messageText" class="message-text"></div>
                <button id="messageClose" class="message-close" onclick="hideMessage()" title="关闭">&times;</button>
            </div>
        </div>
        
        <div class="form-group">
            <label for="patchName">补丁名称 *</label>
            <input type="text" id="patchName" placeholder="输入补丁名称">
            <div id="patchNameError" class="error-message"></div>
            <div id="patchNameSuccess" class="success-message"></div>
        </div>

        <div class="form-group">
            <label for="patchVersion">版本号 *</label>
            <input type="text" id="patchVersion" placeholder="例如: 1" value="1">
            <div id="patchVersionError" class="error-message"></div>
            <div id="patchVersionSuccess" class="success-message"></div>
        </div>

        <div class="form-group">
            <label for="patchAuthor">作者 *</label>
            <input type="text" id="patchAuthor" placeholder="补丁作者">
            <div id="patchAuthorError" class="error-message"></div>
            <div id="patchAuthorSuccess" class="success-message"></div>
        </div>

        <div class="form-group">
            <label for="patchDescription">补丁描述</label>
            <textarea id="patchDescription" placeholder="描述补丁的功能和修复的问题"></textarea>
            <div id="patchDescriptionError" class="error-message"></div>
        </div>

        <div class="section-title">补丁配置</div>
        <div class="checkbox-group">
            <div class="checkbox-item">
                <input type="checkbox" id="includeJavaSource" checked>
                <label for="includeJavaSource">包含Java源码文件</label>
            </div>
        </div>

        <div class="section-title">
            可导出文件列表
            <button class="refresh-button" onclick="refreshFiles()">刷新</button>
        </div>
        <div class="file-list-container">
            <div id="fileList" class="file-list">
                <div class="loading">正在扫描文件...</div>
            </div>
        </div>

        <div class="section-title">输出配置</div>
        <div class="form-group">
            <label for="outputDir">输出目录</label>
            <div class="form-row">
                <input type="text" id="outputDir" value="./patches" readonly>
                <button class="browse-button" onclick="selectOutputDir()">浏览...</button>
            </div>
        </div>

        <div class="button-group">
            <button class="button button-primary" onclick="exportPatch()">导出补丁</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // 表单验证规则
        const validationRules = {
            patchName: {
                required: true,
                pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5-]+$/,
                message: '补丁名称只能包含字母、数字、中文、下划线和连字符'
            },
            patchVersion: {
                required: true,
                pattern: /^\\d+$/,
                message: '版本号应为纯数字格式 (例如: 1, 2, 3...)'
            },
            patchDescription: {
                required: false,
                minLength: 0,
                message: '描述补丁的功能和修复的问题'
            },
            patchAuthor: {
                required: true,
                message: '请输入作者名称'
            },
            // patchType已移除，使用默认值
            // patchType: {
            //     required: true,
            //     message: '请选择补丁类型'
            // }
        };
        
        // 验证单个字段
        function validateField(fieldName, value) {
            const rule = validationRules[fieldName];
            if (!rule) return { valid: true };
            
            if (rule.required && (!value || value.trim() === '')) {
                return { valid: false, message: rule.message || '此字段为必填项' };
            }
            
            if (rule.pattern && value && !rule.pattern.test(value)) {
                return { valid: false, message: rule.message };
            }
            
            if (rule.minLength && value && value.length < rule.minLength) {
                return { valid: false, message: rule.message };
            }
            
            return { valid: true };
        }
        
        // 显示错误信息 - 优化版本
        function showError(fieldName, message) {
            const field = document.getElementById(fieldName);
            const errorElement = document.getElementById(fieldName + 'Error');
            const successElement = document.getElementById(fieldName + 'Success');
            const formGroup = field.closest('.form-group');
            
            // 隐藏成功消息
            if (successElement) {
                successElement.classList.remove('show');
            }
            
            if (errorElement) {
                errorElement.textContent = message;
                errorElement.classList.add('show');
            }
            
            if (formGroup) {
                formGroup.classList.remove('success');
                formGroup.classList.add('error');
            }
        }
        
        // 显示成功信息
        function showSuccess(fieldName, message = '输入正确') {
            const field = document.getElementById(fieldName);
            const errorElement = document.getElementById(fieldName + 'Error');
            const successElement = document.getElementById(fieldName + 'Success');
            const formGroup = field.closest('.form-group');
            
            // 隐藏错误消息
            if (errorElement) {
                errorElement.classList.remove('show');
            }
            
            if (successElement) {
                successElement.textContent = message;
                successElement.classList.add('show');
            }
            
            if (formGroup) {
                formGroup.classList.remove('error');
                formGroup.classList.add('success');
            }
        }
        
        // 清除错误信息 - 优化版本
        function clearError(fieldName) {
            const field = document.getElementById(fieldName);
            const errorElement = document.getElementById(fieldName + 'Error');
            const successElement = document.getElementById(fieldName + 'Success');
            const formGroup = field.closest('.form-group');
            
            if (errorElement) {
                errorElement.classList.remove('show');
            }
            
            if (successElement) {
                successElement.classList.remove('show');
            }
            
            if (formGroup) {
                formGroup.classList.remove('error', 'success');
            }
        }
        
        // 显示消息函数 - 优化版本
        function showMessage(message, level, autoHide = true) {
            const messageContainer = document.getElementById('messageContainer');
            const messageContent = document.getElementById('messageContent');
            const messageIcon = document.getElementById('messageIcon');
            const messageText = document.getElementById('messageText');
            
            if (messageContainer && messageContent && messageIcon && messageText) {
                // 设置图标
                const icons = {
                    error: '❌',
                    warning: '⚠️',
                    info: 'ℹ️',
                    success: '✅'
                };
                
                messageIcon.textContent = icons[level] || icons.info;
                messageText.textContent = message;
                messageContent.className = 'message-content ' + (level || 'info');
                
                // 显示消息容器
                messageContainer.style.display = 'block';
                
                // 清除之前的定时器
                if (window.messageTimer) {
                    clearTimeout(window.messageTimer);
                }
                
                // 自动隐藏
                if (autoHide) {
                    const hideDelay = level === 'error' ? 8000 : 3000; // 错误消息显示更久
                    window.messageTimer = setTimeout(() => {
                        hideMessage();
                    }, hideDelay);
                }
            }
        }
        
        // 隐藏消息函数
        function hideMessage() {
            const messageContainer = document.getElementById('messageContainer');
            const messageContent = document.getElementById('messageContent');
            
            if (messageContainer && messageContent) {
                // 添加退出动画
                messageContent.style.animation = 'slideOutUp 0.3s ease-out';
                
                setTimeout(() => {
                    messageContainer.style.display = 'none';
                    messageContent.style.animation = '';
                }, 300);
            }
            
            // 清除定时器
            if (window.messageTimer) {
                clearTimeout(window.messageTimer);
                window.messageTimer = null;
            }
        }
        
        // 验证整个表单 - 优化版本
        function validateForm() {
            let isValid = true;
            
            Object.keys(validationRules).forEach(fieldName => {
                const field = document.getElementById(fieldName);
                if (field) {
                    const validation = validateField(fieldName, field.value);
                    if (!validation.valid) {
                        showError(fieldName, validation.message);
                        isValid = false;
                    } else {
                        // 显示成功状态
                        showSuccess(fieldName);
                    }
                }
            });
            
            return isValid;
        }
        
        // 添加加载状态管理
        function showLoading(message = '正在处理...') {
            const loadingOverlay = document.createElement('div');
            loadingOverlay.id = 'loadingOverlay';
            loadingOverlay.className = 'loading-overlay';
            loadingOverlay.innerHTML = 
                '<div class="loading-content">' +
                    '<div class="loading-spinner"></div>' +
                    '<div>' + message + '</div>' +
                '</div>';
            document.body.appendChild(loadingOverlay);
            
            // 禁用表单按钮
            const buttons = document.querySelectorAll('.button');
            buttons.forEach(button => {
                button.disabled = true;
            });
        }
        
        function hideLoading() {
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.remove();
            }
            
            // 启用表单按钮
            const buttons = document.querySelectorAll('.button');
            buttons.forEach(button => {
                button.disabled = false;
            });
        }
        
        // 添加实时验证
        document.addEventListener('DOMContentLoaded', function() {
            Object.keys(validationRules).forEach(fieldName => {
                const field = document.getElementById(fieldName);
                if (field) {
                    field.addEventListener('blur', function() {
                        const validation = validateField(fieldName, this.value);
                        if (!validation.valid) {
                            showError(fieldName, validation.message);
                        } else if (this.value.trim()) {
                            // 只有当有值时才显示成功状态
                            showSuccess(fieldName);
                        } else {
                            clearError(fieldName);
                        }
                    });
                    
                    field.addEventListener('input', function() {
                        // 输入时清除错误状态，但不立即显示成功状态
                        const formGroup = this.closest('.form-group');
                        if (formGroup && formGroup.classList.contains('error')) {
                            clearError(fieldName);
                        }
                    });
                }
            });
        });

        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'initForm':
                    initializeForm(message.data);
                    break;
                case 'setOutputPath':
                    document.getElementById('outputDir').value = message.path;
                    break;
                case 'filesRefreshed':
                    displayFiles(message.files);
                    break;
                case 'showMessage':
                    console.log('收到Webview消息:', message);
                    // 隐藏加载状态
                    hideLoading();
                    // 显示消息在页面上
                    showMessage(message.message, message.level);
                    break;
                case 'outputDirSelected':
                    document.getElementById('outputDir').value = message.outputDir;
                    break;
            }
        });

        function initializeForm(data) {
            document.getElementById('patchName').value = data.name || '';
            document.getElementById('patchVersion').value = data.version || '';
            document.getElementById('patchDescription').value = data.description || '';
            document.getElementById('patchAuthor').value = data.author || 'yonyou';
            document.getElementById('includeJavaSource').checked = data.includeJavaSource !== false;
            document.getElementById('outputDir').value = data.outputDir || './patches';
        }

        function selectOutputDir() {
            vscode.postMessage({
                type: 'selectOutputDir'
            });
        }

        function exportPatch() {
            console.log('导出补丁按钮被点击');
            
            // 显示加载状态
            showLoading('正在导出补丁...');
            
            // 获取表单数据
            const name = document.getElementById('patchName').value.trim();
            const version = document.getElementById('patchVersion').value.trim();
            
            console.log('表单数据:', { name, version });
            
            // 基本验证 - 只检查必填字段
            if (!name) {
                hideLoading();
                showError('patchName', '请输入补丁名称');
                showMessage('请输入补丁名称', 'error');
                return;
            }
            
            if (!version) {
                hideLoading();
                showError('patchVersion', '请输入版本号');
                showMessage('请输入版本号', 'error');
                return;
            }
            
            const author = document.getElementById('patchAuthor').value.trim();
            if (!author) {
                hideLoading();
                showError('patchAuthor', '请输入作者名称');
                showMessage('请输入作者名称', 'error');
                return;
            }
            
            console.log('验证通过，准备发送消息');

            const data = {
                name,
                version,
                description: document.getElementById('patchDescription').value.trim(),
                author: document.getElementById('patchAuthor').value.trim(),
                includeJavaSource: document.getElementById('includeJavaSource') ? document.getElementById('includeJavaSource').checked : true,
                outputDir: document.getElementById('outputDir').value.trim()
            };

            console.log('发送导出消息:', data);
            
            vscode.postMessage({
                type: 'exportPatch',
                data
            });
        }

        // 取消功能已移除
        // function cancel() {
        //     vscode.postMessage({
        //         type: 'cancel'
        //     });
        // }

        // 刷新可导出文件列表
        function refreshFiles() {
            const fileList = document.getElementById('fileList');
            fileList.innerHTML = '<div class="loading">正在扫描文件...</div>';
            
            vscode.postMessage({
                type: 'refreshFiles'
            });
        }

        // 显示文件列表
        function displayFiles(files) {
            const fileList = document.getElementById('fileList');
            
            // 检查是否有文件
            const hasFiles = files && (
                (files.source && files.source.length > 0) ||
                (files.resources && files.resources.length > 0) ||
                (files.config && files.config.length > 0) ||
                (files.libraries && files.libraries.length > 0)
            );
            
            if (!hasFiles) {
                fileList.innerHTML = '<div class="no-data">' +
                    '<div class="no-data-icon">📄</div>' +
                    '<div class="no-data-text">暂无数据</div>' +
                    '<div class="no-data-subtext">暂未选择需要导出补丁的文件</div>' +
                    '</div>';
                return;
            }

            let html = '';
            
            if (files.source && files.source.length > 0) {
                html += '<div class="file-category">';
                html += '<div class="file-category-title">源码文件 (' + files.source.length + ')</div>';
                files.source.forEach(file => {
                    html += '<div class="file-item">' + file + '</div>';
                });
                html += '</div>';
            }

            if (files.resources && files.resources.length > 0) {
                html += '<div class="file-category">';
                html += '<div class="file-category-title">资源文件 (' + files.resources.length + ')</div>';
                files.resources.forEach(file => {
                    html += '<div class="file-item">' + file + '</div>';
                });
                html += '</div>';
            }

            if (files.config && files.config.length > 0) {
                html += '<div class="file-category">';
                html += '<div class="file-category-title">配置文件 (' + files.config.length + ')</div>';
                files.config.forEach(file => {
                    html += '<div class="file-item">' + file + '</div>';
                });
                html += '</div>';
            }

            if (files.libraries && files.libraries.length > 0) {
                html += '<div class="file-category">';
                html += '<div class="file-category-title">库文件 (' + files.libraries.length + ')</div>';
                files.libraries.forEach(file => {
                    html += '<div class="file-item">' + file + '</div>';
                });
                html += '</div>';
            }

            fileList.innerHTML = html;
        }

        // 页面加载完成后初始化
        document.addEventListener('DOMContentLoaded', function() {
            // 初始化表单
            initializeForm({
                name: '修复补丁',
                version: '1',
                description: '',
                author: 'yonyou',
                includeJavaSource: true, // 默认包含Java源码
                outputDir: './patches'
            });
            
            refreshFiles();
        });
    </script>
</body>
</html>`;
    }

    private async _buildReplacementContent(files: { path: string, type: string, relativePath: string }[], patchInfo: PatchInfo, archive: any, basePath: string): Promise<void> {
        const fs = require('fs');
        const path = require('path');

        console.log('开始构建替换内容，文件数量:', files.length);

        // 检查是否为NCC Home（是否存在hotwebs/nccloud目录）
        let config = this.configService.getConfig();
        const nccloudPath = path.join(config.homePath, 'hotwebs', 'nccloud');
        const isNCCHome = fs.existsSync(nccloudPath);
        
        // 获取当前时间，用于设置目录时间戳
        const now = new Date();
        
        // 用于跟踪已创建的目录
        const createdDirectories = new Set<string>();
        
        // 辅助函数：创建目录并设置时间戳
        const createDirectoryWithTimestamp = (directoryPath: string) => {
            if (!directoryPath || createdDirectories.has(directoryPath)) {
                return;
            }
            
            // 分割目录路径，递归创建所有父目录
            const parts = directoryPath.split('/');
            let currentPath = '';
            
            for (const part of parts) {
                if (!part) continue;
                
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                
                if (!createdDirectories.has(currentPath)) {
                    // 显式创建目录并设置当前时间戳
                    archive.append(null, { name: `${currentPath}/`, date: now });
                    createdDirectories.add(currentPath);
                }
            }
        };

        for (const file of files) {
            if (!fs.existsSync(file.path)) {
                continue;
            }

            const stat = fs.statSync(file.path);
            if (!stat.isFile()) {
                continue;
            }

            const filePath = file.path;
            const fileName = path.basename(filePath);

            // 跳过不需要的文件
            if (fileName.endsWith('.iml') || filePath.toLowerCase().includes('.idea')) {
                continue;
            }

            let targetPath = '';

            // 根据文件路径和类型确定目标路径
            if (this._isJavaSourceFile(filePath)) {
                targetPath = await this._getJavaFileTargetPath(filePath, isNCCHome, patchInfo);

                // 对于Java文件，我们需要使用编译后的class文件而不是源文件
                if (targetPath) {
                    // 查找项目根目录（包含.classpath文件的目录）
                    let projectPath = path.dirname(filePath);
                    while (projectPath && projectPath !== path.dirname(projectPath)) {
                        if (fs.existsSync(path.join(projectPath, '.classpath'))) {
                            break;
                        }
                        projectPath = path.dirname(projectPath);
                    }

                    // 如果没找到项目根目录，使用文件所在目录
                    if (!projectPath || projectPath === path.dirname(projectPath)) {
                        projectPath = path.dirname(filePath);
                    }

                    // 获取编译后的class文件路径
                    const compiledClassPath = await this._getCompiledClassPath(filePath, projectPath);

                    // 构造完整的class文件路径
                    // 获取输出路径
                    const outputPath = await this._getClasspathOutputPath(projectPath);
                    let fullClassPath = path.join(projectPath, outputPath, compiledClassPath);

                    // 检查编译后的class文件是否存在
                    if (!fs.existsSync(fullClassPath)) {
                        const parentProjectPath = path.dirname(projectPath);
                        if (parentProjectPath && parentProjectPath !== projectPath) {
                            const parentCompiledClassPath = await this._getCompiledClassPath(filePath, parentProjectPath);
                            const parentOutputPath = await this._getClasspathOutputPath(parentProjectPath);
                            const parentFullClassPath = path.join(parentProjectPath, parentOutputPath, parentCompiledClassPath);
                            if (fs.existsSync(parentFullClassPath)) {
                                fullClassPath = parentFullClassPath;
                            } else {
                                // 如果编译后的文件不存在，生成详细的错误信息
                                const outputPathMsg = await this._getClasspathOutputPath(projectPath);
                                const projectRelativePath = path.relative(projectPath, file.path);
                                
                                const errorMessage = `❌ 编译文件未找到\n\n` +
                                    `源文件: ${projectRelativePath}\n` +
                                    `期望的编译文件路径: ${path.join(outputPathMsg, compiledClassPath)}\n` +
                                    `完整路径: ${path.join(projectPath, outputPathMsg, compiledClassPath)}\n` +
                                    `已尝试上一层路径: ${parentFullClassPath}\n\n` +
                                    `可能的问题和解决方案:\n\n` +
                                    `1. 📁 编译输出目录配置问题\n` +
                                    `   • 当前配置的输出目录: ${outputPathMsg}\n` +
                                    `   • 检查项目根目录下的 .classpath 文件\n` +
                                    `   • 确认 <classpathentry kind="output" path=\"...\"/> 配置正确\n\n` +
                                    `2. 🔨 代码尚未编译\n` +
                                    `   • 请在IDE中编译项目 (Build Project)\n` +
                                    `   • 或使用命令行: javac 编译Java文件\n` +
                                    `   • 确保编译成功且无错误\n\n` +
                                    `3. 📂 源码路径配置问题\n` +
                                    `   • 检查源文件是否在正确的源码目录下\n` +
                                    `   • 支持的源码目录: ${await this._getFriendlySrcRootsText(projectPath)}\n` +
                                    `   • 当前源文件路径: ${file.path}\n\n` +
                                    `4. 🏗️ 项目结构问题\n` +
                                    `   • 确认项目是标准的Java项目结构\n` +
                                    `   • 检查包名与目录结构是否匹配\n` +
                                    `   • 验证Java文件的package声明\n\n` +
                                    `请按照上述步骤检查并解决问题后重新导出补丁。`;
                                
                                console.warn(`编译后的class文件不存在: ${path.join(projectPath, outputPathMsg, compiledClassPath)}`);
                                console.warn(`输出目录: ${outputPathMsg}`);
                                console.warn(`编译后的class路径: ${compiledClassPath}`);
                                console.warn(`上一层尝试路径: ${parentFullClassPath}`);
                                
                                // 向用户显示详细的错误消息
                                console.log('准备发送详细错误消息到Webview');
                                this._view?.webview.postMessage({
                                    type: 'showMessage',
                                    level: 'error',
                                    message: errorMessage
                                });
                                console.log('详细错误消息已发送到Webview');
                                
                                // 抛出错误以阻断整个导出流程
                                throw new Error(`编译文件未找到: ${path.join(projectPath, outputPathMsg, compiledClassPath)}`);
                            }
                        } else {
                            // 如果没有父级目录或父级目录相同，直接报错
                            const outputPathMsg = await this._getClasspathOutputPath(projectPath);
                            const projectRelativePath = path.relative(projectPath, file.path);
                            const fullPathMsg = path.join(projectPath, outputPathMsg, compiledClassPath);
                            const errorMessage = `❌ 编译文件未找到\n\n` +
                                `源文件: ${projectRelativePath}\n` +
                                `期望的编译文件路径: ${path.join(outputPathMsg, compiledClassPath)}\n` +
                                `完整路径: ${fullPathMsg}\n\n` +
                                `可能的问题和解决方案:\n\n` +
                                `1. 📁 编译输出目录配置问题\n` +
                                `   • 当前配置的输出目录: ${outputPathMsg}\n` +
                                `   • 检查项目根目录下的 .classpath 文件\n` +
                                `   • 确认 <classpathentry kind=\"output\" path=\"...\"/> 配置正确\n\n` +
                                `2. 🔨 代码尚未编译\n` +
                                `   • 请在IDE中编译项目 (Build Project)\n` +
                                `   • 或使用命令行: javac 编译Java文件\n` +
                                `   • 确保编译成功且无错误\n\n` +
                                `3. 📂 源码路径配置问题\n` +
                                `   • 检查源文件是否在正确的源码目录下\n` +
                                `   • 支持的源码目录: ${await this._getFriendlySrcRootsText(projectPath)}\n` +
                                `   • 当前源文件路径: ${file.path}\n\n` +
                                `4. 🏗️ 项目结构问题\n` +
                                `   • 确认项目是标准的Java项目结构\n` +
                                `   • 检查包名与目录结构是否匹配\n` +
                                `   • 验证Java文件的package声明\n\n` +
                                `请按照上述步骤检查并解决问题后重新导出补丁。`;
                            console.warn(`编译后的class文件不存在: ${fullPathMsg}`);
                            console.warn(`输出目录: ${outputPathMsg}`);
                            console.warn(`编译后的class路径: ${compiledClassPath}`);
                            this._view?.webview.postMessage({
                                type: 'showMessage',
                                level: 'error',
                                message: errorMessage
                            });
                            throw new Error(`编译文件未找到: ${fullPathMsg}`);
                        }
                    }

                    // 走正常的归档逻辑
                    if (fs.existsSync(fullClassPath)) {
                        // 获取目标文件的目录路径
                        const classDir = path.dirname(targetPath);
                        const javaDir = path.dirname(targetPath.replace('.class', '.java'));
                        
                        // 显式创建目录并设置当前时间戳
                        createDirectoryWithTimestamp(classDir);
                        if ((patchInfo as any).includeJavaSource !== false) {
                            createDirectoryWithTimestamp(javaDir);
                        }
                        
                        // 使用编译后的class文件作为源文件，并确保保留正确的时间戳
                        const classStat = fs.statSync(fullClassPath);
                        archive.file(fullClassPath, { 
                            name: targetPath,
                            date: classStat.mtime // 确保使用正确的修改时间
                        });
                        
                        // 同时收集和添加相关的内部类文件（如$1.class, $2.class等）
                        await this._addInnerClassFiles(archive, fullClassPath, targetPath, classDir);
                        
                        // 如果包含源码，则添加源码文件
                        if ((patchInfo as any).includeJavaSource !== false) {
                            const javaStat = fs.statSync(file.path);
                            archive.file(file.path, { 
                                name: targetPath.replace('.class', '.java'),
                                date: javaStat.mtime // 确保使用正确的修改时间
                            });
                        }
                    } else {
                        // 如果编译后的文件不存在，生成详细的错误信息
                        const outputPath = await this._getClasspathOutputPath(projectPath);
                        const projectRelativePath = path.relative(projectPath, file.path);
                        
                        const errorMessage = `❌ 编译文件未找到\n\n` +
                            `源文件: ${projectRelativePath}\n` +
                            `期望的编译文件路径: ${path.join(outputPath, compiledClassPath)}\n` +
                            `完整路径: ${fullClassPath}\n\n` +
                            `可能的问题和解决方案:\n\n` +
                            `1. 📁 编译输出目录配置问题\n` +
                            `   • 当前配置的输出目录: ${outputPath}\n` +
                            `   • 检查项目根目录下的 .classpath 文件\n` +
                            `   • 确认 <classpathentry kind="output" path="..."/> 配置正确\n\n` +
                            `2. 🔨 代码尚未编译\n` +
                            `   • 请在IDE中编译项目 (Build Project)\n` +
                            `   • 或使用命令行: javac 编译Java文件\n` +
                            `   • 确保编译成功且无错误\n\n` +
                            `3. 📂 源码路径配置问题\n` +
                            `   • 检查源文件是否在正确的源码目录下\n` +
                            `   • 支持的源码目录: ${await this._getFriendlySrcRootsText(projectPath)}\n` +
                            `   • 当前源文件路径: ${file.path}\n\n` +
                            `4. 🏗️ 项目结构问题\n` +
                            `   • 确认项目是标准的Java项目结构\n` +
                            `   • 检查包名与目录结构是否匹配\n` +
                            `   • 验证Java文件的package声明\n\n` +
                            `请按照上述步骤检查并解决问题后重新导出补丁。`;
                        
                        console.warn(`编译后的class文件不存在: ${fullClassPath}`);
                        console.warn(`输出目录: ${outputPath}`);
                        console.warn(`编译后的class路径: ${compiledClassPath}`);
                        
                        // 向用户显示详细的错误消息
                        console.log('准备发送详细错误消息到Webview');
                        this._view?.webview.postMessage({
                            type: 'showMessage',
                            level: 'error',
                            message: errorMessage
                        });
                        console.log('详细错误消息已发送到Webview');
                        
                        // 抛出错误以阻断整个导出流程
                        throw new Error(`编译文件未找到: ${fullClassPath}`);
                    }
                }
            } else if (this._isResourceFile(filePath)) {
                targetPath = this._getResourceFileTargetPath(filePath);
                if (targetPath) {
                    // 获取目标文件的目录路径
                    const targetDir = path.dirname(targetPath);
                    
                    // 显式创建目录并设置当前时间戳
                    createDirectoryWithTimestamp(targetDir);
                    
                    // 对于资源文件，确保保留正确的时间戳
                    const fileStat = fs.statSync(filePath);
                    archive.file(filePath, { 
                        name: targetPath,
                        date: fileStat.mtime // 确保使用正确的修改时间
                    });
                }
            } else if (this._isConfigFile(filePath)) {
                targetPath = this._getConfigFileTargetPath(filePath);
                if (targetPath) {
                    // 获取目标文件的目录路径
                    const targetDir = path.dirname(targetPath);
                    
                    // 显式创建目录并设置当前时间戳
                    createDirectoryWithTimestamp(targetDir);
                    
                    // 对于配置文件，确保保留正确的时间戳
                    const fileStat = fs.statSync(filePath);
                    archive.file(filePath, { 
                        name: targetPath,
                        date: fileStat.mtime // 确保使用正确的修改时间
                    });
                }
            } else if (this._isSqlFile(filePath)) {
                targetPath = this._getSqlFileTargetPath(filePath, basePath);
                if (targetPath) {
                    // 获取目标文件的目录路径
                    const targetDir = path.dirname(targetPath);
                    
                    // 显式创建目录并设置当前时间戳
                    createDirectoryWithTimestamp(targetDir);
                    
                    // 对于SQL文件，确保保留正确的时间戳
                    const fileStat = fs.statSync(filePath);
                    archive.file(filePath, { 
                        name: targetPath,
                        date: fileStat.mtime // 确保使用正确的修改时间
                    });
                }
            } else if (this._isMetaInfFile(filePath)) {
                targetPath = await this._getMetaInfFileTargetPath(filePath);
                if (targetPath) {
                    // 获取目标文件的目录路径
                    const targetDir = path.dirname(targetPath);
                    
                    // 显式创建目录并设置当前时间戳
                    createDirectoryWithTimestamp(targetDir);
                    
                    // 对于META-INF文件，确保保留正确的时间戳
                    const fileStat = fs.statSync(filePath);
                    archive.file(filePath, { 
                        name: targetPath,
                        date: fileStat.mtime // 确保使用正确的修改时间
                    });
                }
            } else {
                // 其他文件使用默认处理
                //targetPath = this._getDefaultFileTargetPath(filePath, basePath);
                continue;
            }
        }
        
        console.log('替换内容构建完成');
    }

    private async _createStandardPatchZip(files: { path: string, type: string, relativePath: string }[], patchInfo: PatchInfo, basePath: string): Promise<string> {
        const fs = require('fs');
        const archiver = require('archiver');
        const { v4: uuidv4 } = require('uuid');

        // 确保输出目录存在
        let outputDir: string;
        if (patchInfo.outputPath && path.isAbsolute(patchInfo.outputPath)) {
            outputDir = patchInfo.outputPath;
        } else if (patchInfo.outputPath) {
            outputDir = path.join(basePath, patchInfo.outputPath);
        } else {
            outputDir = path.join(basePath, 'patches');
        }

        console.log('输出目录:', outputDir);
        if (!fs.existsSync(outputDir)) {
            console.log('创建输出目录:', outputDir);
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 生成补丁文件名，自动添加patch_前缀，并包含作者信息
        // 修改日期格式，包含时分秒并放在最后
        const now = new Date();
        const timestamp = now.getFullYear().toString() + 
            (now.getMonth() + 1).toString().padStart(2, '0') + 
            now.getDate().toString().padStart(2, '0') + 
            now.getHours().toString().padStart(2, '0') + 
            now.getMinutes().toString().padStart(2, '0') + 
            now.getSeconds().toString().padStart(2, '0');
        // 从patchInfo中获取作者信息（如果存在）
        const authorPart = (patchInfo as any).author ? `_${(patchInfo as any).author}` : '';
        const patchName = `patch_${patchInfo.name}${authorPart}_V${patchInfo.version.replace(/\./g, '_')}_${timestamp}`;
        const zipPath = path.join(outputDir, `${patchName}.zip`);

        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            // 修改archiver配置，确保正确处理文件时间戳
            const archive = archiver('zip', { 
                zlib: { level: 9 },
                // 确保时间戳正确处理
                store: false, // 使用压缩而非存储模式
                // 强制使用本地时间，避免UTC转换导致的时间偏差
                forceLocalTime: true
            });

            output.on('close', () => {
                console.log('ZIP文件创建完成:', zipPath);
                console.log('补丁包总大小: ' + archive.pointer() + ' bytes');
                resolve(zipPath);
            });

            archive.on('error', (err: any) => {
                console.log('ZIP归档过程中出错:', err);
                reject(err);
            });

            archive.pipe(output);

            // 过滤并添加文件到zip
            const filteredFiles = files.filter(file => this._shouldIncludeFile(file, patchInfo));

            // 生成并添加元数据文件
            const patchId = uuidv4();

            // 添加packmetadata.xml
            const packmetadata = this._generatePackMetadata(patchInfo, patchId, files);
            archive.append(packmetadata, { name: 'packmetadata.xml', date: now });

            // 添加installpatch.xml
            const installpatch = this._generateInstallPatch();
            archive.append(installpatch, { name: 'installpatch.xml', date: now });

            // 添加readme.txt
            const readme = this._generateReadme(patchInfo, patchId);
            archive.append(readme, { name: 'readme.txt', date: now });

            // 使用IDEA插件的规则构建replacement内容
            // 使用basePath作为homePath
            this._buildReplacementContent(filteredFiles, patchInfo, archive, basePath).then(() => {
                // 只有在_buildReplacementContent完成后才调用finalize
                console.log('文件内容构建完成，开始finalize');
                archive.finalize();
            }).catch((error) => {
                console.log('捕获到_buildReplacementContent中的错误:', error);
                reject(error);
            });
        });
    }

    /**
     * 查找文件所属的模块名称
     */
    private async _findModuleName(filePath: string): Promise<string> {
        const fs = require('fs');
        const path = require('path');
        const xml2js = require('xml2js');

        // 先向下递归查找
        let moduleName = await this._findModuleNameDownward(filePath, 0);
        if (moduleName) {
            return moduleName;
        }

        // 再向上递归查找
        let currentDir = path.dirname(filePath);
        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const metaInfPath = path.join(currentDir, 'META-INF');
            const moduleXmlPath = path.join(metaInfPath, 'module.xml');

            if (fs.existsSync(moduleXmlPath)) {
                try {
                    const xmlContent = fs.readFileSync(moduleXmlPath, 'utf8');
                    const parser = new xml2js.Parser();
                    const result = await this._parseXml(parser, xmlContent);

                    if (result && result.module && result.module.$ && result.module.$.name) {
                        return result.module.$.name;
                    }
                } catch (error) {
                    console.error('解析module.xml失败:', error);
                }
            }

            currentDir = path.dirname(currentDir);
        }

        // 如果都找不到，尝试从.project文件中获取项目名称
        currentDir = path.dirname(filePath);
        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const projectFile = path.join(currentDir, '.project');

            if (fs.existsSync(projectFile)) {
                try {
                    const xmlContent = fs.readFileSync(projectFile, 'utf8');
                    const parser = new xml2js.Parser();
                    const result = await this._parseXml(parser, xmlContent);

                    // 从.project文件中提取name标签的值
                    if (result && result.projectDescription && result.projectDescription.name && result.projectDescription.name.length > 0) {
                        return result.projectDescription.name[0];
                    }
                } catch (error) {
                    console.error('解析.project文件失败:', error);
                }
            }

            currentDir = path.dirname(currentDir);
        }

        // 如果都找不到，返回默认模块名
        return 'unknown_module';
    }

    /**
     * 向下递归查找模块名称
     */
    private async _findModuleNameDownward(dirPath: string, depth: number): Promise<string | null> {
        const fs = require('fs');
        const path = require('path');
        const xml2js = require('xml2js');

        // 限制递归深度
        if (depth > 5) {
            return null;
        }

        const currentDir = fs.statSync(dirPath).isDirectory() ? dirPath : path.dirname(dirPath);
        const metaInfPath = path.join(currentDir, 'META-INF');
        const moduleXmlPath = path.join(metaInfPath, 'module.xml');

        if (fs.existsSync(moduleXmlPath)) {
            try {
                const xmlContent = fs.readFileSync(moduleXmlPath, 'utf8');
                const parser = new xml2js.Parser();
                const result = await this._parseXml(parser, xmlContent);

                if (result && result.module && result.module.$ && result.module.$.name) {
                    return result.module.$.name;
                }
            } catch (error) {
                console.error('解析module.xml失败:', error);
            }
        }

        // 递归查找子目录
        if (fs.existsSync(currentDir) && fs.statSync(currentDir).isDirectory()) {
            const children = fs.readdirSync(currentDir);
            for (const child of children) {
                const childPath = path.join(currentDir, child);
                if (fs.statSync(childPath).isDirectory()) {
                    const moduleName = await this._findModuleNameDownward(childPath, depth + 1);
                    if (moduleName) {
                        return moduleName;
                    }
                }
            }
        }

        return null;
    }

    /**
     * 异步解析XML内容
     */
    private _parseXml(parser: any, xmlContent: string): Promise<any> {
        return new Promise((resolve, reject) => {
            parser.parseString(xmlContent, (err: any, result: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * 判断是否为Java源文件
     */
    private _isJavaSourceFile(filePath: string): boolean {
        return filePath.endsWith('.java');
    }

    /**
     * 判断是否为资源文件
     */
    private _isResourceFile(filePath: string): boolean {
        return filePath.includes('/resources/') || filePath.includes('\\resources\\');
    }

    /**
     * 判断是否为配置文件
     */
    private _isConfigFile(filePath: string): boolean {
        return filePath.includes('/yyconfig/') || filePath.includes('\\yyconfig\\');
    }

    /**
     * 判断是否为SQL文件
     */
    private _isSqlFile(filePath: string): boolean {
        return filePath.toLowerCase().endsWith('.sql');
    }

    /**
     * 判断是否为META-INF文件
     */
    private _isMetaInfFile(filePath: string): boolean {
        return filePath.includes('/META-INF/') || filePath.includes('\\META-INF\\');
    }

    /**
     * 解析.classpath文件获取输出路径
     */
    private async _getClasspathOutputPath(projectPath: string): Promise<string> {
        const fs = require('fs');
        const path = require('path');
        const xml2js = require('xml2js');

        const classpathFile = path.join(projectPath, '.classpath');

        // 如果.classpath文件不存在，返回默认输出路径
        if (!fs.existsSync(classpathFile)) {
            return 'build/classes';
        }

        try {
            const xmlContent = fs.readFileSync(classpathFile, 'utf8');
            const parser = new xml2js.Parser();
            const result = await this._parseXml(parser, xmlContent);

            // 查找output类型的classpathentry
            if (result && result.classpath && result.classpath.classpathentry) {
                const entries = result.classpath.classpathentry;
                for (const entry of entries) {
                    if (entry.$ && entry.$.kind === 'output') {
                        return entry.$.path || 'build/classes';
                    }
                }
            }

            // 如果没有找到output类型的entry，返回默认值
            return 'build/classes';
        } catch (error) {
            console.error('解析.classpath文件失败:', error);
            return 'build/classes';
        }
    }

    /**
     * 解析.classpath文件获取所有源码根路径(kind='src')
     */
    private async _getClasspathSourceRoots(projectPath: string): Promise<string[]> {
        const fs = require('fs');
        const path = require('path');
        const xml2js = require('xml2js');
        const classpathFile = path.join(projectPath, '.classpath');
        if (this._classpathSrcRootsCache.has(projectPath)) {
            return this._classpathSrcRootsCache.get(projectPath) || [];
        }
        if (!fs.existsSync(classpathFile)) {
            return [];
        }
        try {
            const xmlContent = fs.readFileSync(classpathFile, 'utf8');
            const parser = new xml2js.Parser();
            const result = await this._parseXml(parser, xmlContent);
            const entries = result && result.classpath && result.classpath.classpathentry ? result.classpath.classpathentry : [];
            const srcRoots: string[] = [];
            for (const entry of entries) {
                if (entry.$ && entry.$.kind === 'src' && entry.$.path) {
                    srcRoots.push(String(entry.$.path).replace(/\\/g, '/'));
                }
            }
            this._classpathSrcRootsCache.set(projectPath, srcRoots);
            return srcRoots;
        } catch (error) {
            console.error('解析.classpath源码路径失败:', error);
            return [];
        }
    }
    
    private async _getFriendlySrcRootsText(projectPath: string): Promise<string> {
        const path = require('path');
        const proj = projectPath.replace(/\\/g, '/');
        const roots = await this._getClasspathSourceRoots(projectPath);
        const normalized = roots.map(r => {
            let s = String(r).replace(/\\/g, '/');
            if (s.startsWith('./')) s = s.substring(2);
            if (s.startsWith(proj + '/')) s = s.substring(proj.length + 1);
            if (s.startsWith('/')) s = s.substring(1);
            return s;
        }).filter(Boolean);
        return normalized.length > 0 ? normalized.join(', ') : 'src/*';
    }

    /**
     * 获取Java文件的编译后class文件路径
     */
    private async _getCompiledClassPath(javaFilePath: string, projectPath: string): Promise<string> {
        const fs = require('fs');
        const path = require('path');

        // 获取输出路径
        const outputPath = await this._getClasspathOutputPath(projectPath);

        let relativePath = '';
        let matchedByClasspath = false;
        const srcRoots = await this._getClasspathSourceRoots(projectPath);
        if (srcRoots.length > 0) {
            const projectRelative = path.relative(projectPath, javaFilePath).replace(/\\/g, '/');
            for (let root of srcRoots) {
                let normalizedRoot = String(root).replace(/\\/g, '/');
                const proj = projectPath.replace(/\\/g, '/');
                if (normalizedRoot.startsWith(proj + '/')) {
                    normalizedRoot = normalizedRoot.substring(proj.length + 1);
                }
                const withSlash = normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/';
                if (projectRelative.startsWith(withSlash) || projectRelative === normalizedRoot) {
                    relativePath = projectRelative.startsWith(withSlash)
                        ? projectRelative.substring(withSlash.length)
                        : '';
                    matchedByClasspath = true;
                    break;
                }
            }
        }
        if (!matchedByClasspath) {
            // 回退：根据常见目录或/src/拆分
            if (javaFilePath.includes('/src/public/')) {
                const parts = javaFilePath.split('/src/public/');
                relativePath = parts[1];
            } else if (javaFilePath.includes('\\src\\public\\')) {
                const parts = javaFilePath.split('\\src\\public\\');
                relativePath = parts[1];
            } else if (javaFilePath.includes('/src/private/')) {
                const parts = javaFilePath.split('/src/private/');
                relativePath = parts[1];
            } else if (javaFilePath.includes('\\src\\private\\')) {
                const parts = javaFilePath.split('\\src\\private\\');
                relativePath = parts[1];
            } else if (javaFilePath.includes('/src/client/')) {
                const parts = javaFilePath.split('/src/client/');
                relativePath = parts[1];
            } else if (javaFilePath.includes('\\src\\client\\')) {
                const parts = javaFilePath.split('\\src\\client\\');
                relativePath = parts[1];
            } else {
                const srcIndexUnix = javaFilePath.indexOf('/src/');
                const srcIndexWin = javaFilePath.indexOf('\\src\\');
                if (srcIndexUnix !== -1) {
                    relativePath = javaFilePath.substring(srcIndexUnix + 5);
                } else if (srcIndexWin !== -1) {
                    relativePath = javaFilePath.substring(srcIndexWin + 5);
                } else {
                    relativePath = path.relative(projectPath, javaFilePath);
                }
            }
        }

        // 构造编译后的class文件路径
        const classRelativePath = relativePath.replace(/\.java$/, '.class');

        // 构造完整的class文件路径（相对于项目根目录）
        const compiledClassPath = path.join(outputPath, classRelativePath);

        // 检查编译后的class文件是否实际存在
        const fullClassPath = path.join(projectPath, compiledClassPath);
        if (fs.existsSync(fullClassPath)) {
            // 返回相对路径，去掉outputPath前缀
            return classRelativePath.replace(/\\/g, '/');
        }

        // 如果编译后的class文件不存在，回退到原来的逻辑
        // 将.java替换为.class
        const fallbackClassRelativePath = relativePath.replace(/\.java$/, '.class');
        return fallbackClassRelativePath.replace(/\\/g, '/');
    }

    /**
     * 获取Java文件的目标路径
     */
    private async _getJavaFileTargetPath(filePath: string, isNCCHome: boolean, patchInfo: PatchInfo): Promise<string> {
        const path = require('path');
        const fs = require('fs');
        const moduleName = await this._findModuleName(filePath);

        // 查找项目根目录（包含.classpath文件的目录）
        let projectPath = path.dirname(filePath);
        while (projectPath && projectPath !== path.dirname(projectPath)) {
            if (fs.existsSync(path.join(projectPath, '.classpath'))) {
                break;
            }
            projectPath = path.dirname(projectPath);
        }

        // 如果没找到项目根目录，使用文件所在目录
        if (!projectPath || projectPath === path.dirname(projectPath)) {
            projectPath = path.dirname(filePath);
        }

        // 获取编译后的class文件路径
        const compiledClassPath = await this._getCompiledClassPath(filePath, projectPath);

        // 根据文件路径判断是public、private还是client
        if (filePath.includes('/src/public/') || filePath.includes('\\src\\public\\')) {
            return `replacement/modules/${moduleName}/classes/${compiledClassPath}`;
        } else if (filePath.includes('/src/private/') || filePath.includes('\\src\\private\\')) {
            return `replacement/modules/${moduleName}/META-INF/classes/${compiledClassPath}`;
        } else if (filePath.includes('/src/client/') || filePath.includes('\\src\\client\\')) {
            // 根据配置和环境决定目标路径
            if (isNCCHome) {
                return `replacement/hotwebs/nccloud/WEB-INF/classes/${compiledClassPath}`;
            } else {
                return `replacement/modules/${moduleName}/client/classes/${compiledClassPath}`;
            }
        } else if (filePath.includes('uap_special/src') &&
            (filePath.includes('/external/') || filePath.includes('/framework/') || filePath.includes('/lib/'))) {
            // 处理uap_special特殊情况
            return `replacement/external/classes/${compiledClassPath}`;
        }

        // 默认处理
        return `replacement/modules/${moduleName}/classes/${compiledClassPath}`;
    }

    /**
     * 获取资源文件的目标路径
     */
    private _getResourceFileTargetPath(filePath: string): string {
        const relativePath = this._extractRelativePath(filePath, '/resources/', '\\resources\\');
        return `replacement/resources${relativePath}`;
    }

    /**
     * 获取配置文件的目标路径
     */
    private _getConfigFileTargetPath(filePath: string): string {
        const relativePath = this._extractRelativePath(filePath, '/yyconfig/modules/', '\\yyconfig\\modules\\');
        return `replacement/hotwebs/nccloud/WEB-INF/extend/yyconfig/modules/${relativePath}`;
    }

    /**
     * 获取SQL文件的目标路径
     */
    private _getSqlFileTargetPath(filePath: string, basePath: string): string {
        const path = require('path');
        const relativePath = path.relative(basePath, filePath);
        return `sql/${relativePath}`;
    }

    /**
     * 获取META-INF文件的目标路径
     */
    private async _getMetaInfFileTargetPath(filePath: string): Promise<string> {
        const moduleName = await this._findModuleName(filePath);
        const relativePath = this._extractRelativePath(filePath, '/META-INF/', '\\META-INF\\');
        return `replacement/modules/${moduleName}/META-INF${relativePath}`;
    }

    /**
     * 获取默认文件的目标路径
     */
    private _getDefaultFileTargetPath(filePath: string, basePath: string): string {
        const path = require('path');
        const relativePath = path.relative(basePath, filePath);
        return relativePath;
    }

    /**
     * 提取相对路径
     */
    private _extractRelativePath(filePath: string, unixSeparator: string, windowsSeparator: string): string {
        const path = require('path');

        if (filePath.includes(unixSeparator)) {
            const parts = filePath.split(unixSeparator);
            return parts.length > 1 ? '/' + parts[parts.length - 1] : '';
        } else if (filePath.includes(windowsSeparator)) {
            const parts = filePath.split(windowsSeparator);
            return path.sep + parts[parts.length - 1];
        }

        return '';
    }

    /**
     * 提取uap_special路径
     */
    private _extractUapSpecialPath(filePath: string): string {
        const path = require('path');

        // 查找/nc/、/nccloud/或/uap/的位置
        let startIndex = -1;
        if (filePath.includes('/nc/')) {
            startIndex = filePath.indexOf('/nc/');
        } else if (filePath.includes('/nccloud/')) {
            startIndex = filePath.indexOf('/nccloud/');
        } else if (filePath.includes('/uap/')) {
            startIndex = filePath.indexOf('/uap/');
        }

        if (startIndex !== -1) {
            return filePath.substring(startIndex);
        }

        return '/' + path.basename(filePath);
    }

    private _shouldIncludeFile(file: { path: string, type: string, relativePath: string }, patchInfo: PatchInfo): boolean {
        switch (file.type) {
            case 'source':
                return patchInfo.includeSource !== false;
            case 'resource':
                return patchInfo.includeResources !== false;
            case 'config':
                return patchInfo.includeConfig !== false;
            case 'library':
                return false; // 通常不包含库文件在补丁中
            default:
                return true;
        }
    }

    private _generatePackMetadata(patchInfo: PatchInfo, patchId: string, files: { path: string, type: string, relativePath: string }[]): string {
        const modifiedClasses = files
            .filter(f => f.type === 'source' && f.path.endsWith('.java'))
            .map(f => {
                // 从文件路径推断类名
                const relativePath = f.relativePath.replace(/\\/g, '/');
                if (relativePath.includes('/classes/')) {
                    return relativePath.split('/classes/')[1].replace(/\.java$/, '').replace(/\//g, '.');
                }
                return '';
            })
            .filter(className => className)
            .join(',');

        return `<?xml version="1.0" encoding="UTF-8"?>
<packmetadata>
  <canAppliedMiddleware>Weblogic,Websphere 7.0,Yonyou Middleware V5,Yonyou Middleware V6</canAppliedMiddleware>
  <canAppliedDB>DB2 V9.7,SQL Server 2008 R2,Oracle 10,Oracle 11</canAppliedDB>
  <patchType>BUG修复补丁</patchType>
  <modifiedJavaClasses>${modifiedClasses}</modifiedJavaClasses>
  <description>${patchInfo.description || ''}</description>
  <modifiedModules></modifiedModules>
  <needRecreatedLoginJar>false</needRecreatedLoginJar>
  <applyVersion>1811,1903,2005,2105,2111</applyVersion>
  <patchName>${patchInfo.name}</patchName>
  <bugs></bugs>
  <provider>1</provider>
  <patchPriority>高危补丁</patchPriority>
  <patchVersion>${patchInfo.version}</patchVersion>
  <dependInfo></dependInfo>
  <canAppliedOS>Linux,Windows,AIX,Solaris</canAppliedOS>
  <id>${patchId}</id>
  <time>${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time>
  <department>1</department>
  <needDeploy>false</needDeploy>
  <searchKeys></searchKeys>
</packmetadata>`;
    }

    private _generateInstallPatch(): string {
        return `<?xml version="1.0" encoding="UTF-8"?>
<installpatch>
    <copy><from>/replacement/modules/</from><to>/modules/</to></copy>
</installpatch>`;
    }

    private _generateReadme(patchInfo: PatchInfo, patchId: string): string {
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

        return `
==============================================================================
1)补丁基本信息
==============================================================================

        补丁名称 - ${patchInfo.name}
        补丁编号 - ${patchId}
        产品版本 - 1811,1903,2005,2105,2111
        补丁修改模块 - 
        补丁依赖信息 - 
        适用的中间件平台 - Weblogic,Websphere 7.0,Yonyou Middleware V5,Yonyou Middleware V6
        适用的操作系统平台 - Linux,Windows,AIX,Solaris
        适用的数据库平台 - DB2 V9.7,SQL Server 2008 R2,Oracle 10,Oracle 11
        补丁创建时间 - ${timestamp}
        是否需要部署 - false
        是否需要重新生成客户端Applet Jar包 - false

==============================================================================
2)补丁安装步骤说明
==============================================================================


        补丁安装前置准备工作(比如数据备份)
        ======================================================================

        ${patchInfo.description ? `补丁说明：${patchInfo.description}` : ''}


        补丁安装
        ======================================================================


        补丁安装后置工作
        ======================================================================


        补丁安装成功的验证工作
        ======================================================================


        其它信息
        ======================================================================


==============================================================================
3)补丁修复bug列表说明
==============================================================================

`;
    }

    private _groupFilesByType(files: { path: string, type: string, relativePath: string }[]): any {
        const grouped: any = {
            source: [],
            resources: [],
            config: [],
            libraries: []
        };

        files.forEach(file => {
            switch (file.type) {
                case 'source':
                    grouped.source.push(file.relativePath);
                    break;
                case 'resource':
                    grouped.resources.push(file.relativePath);
                    break;
                case 'config':
                    grouped.config.push(file.relativePath);
                    break;
                case 'library':
                    grouped.libraries.push(file.relativePath);
                    break;
            }
        });

        return grouped;
    }

    /**
     * 检查选择的Java文件是否有对应的编译码文件
     */
    private async _validateJavaFilesHaveCompiledFiles(selectedPath: string | undefined, selectedPaths: string[] | undefined, basePath: string): Promise<boolean> {
        const fs = require('fs');
        const path = require('path');

        try {
            let filesToCheck: string[] = [];

            // 收集所有要检查的Java文件
            if (selectedPaths && selectedPaths.length > 0) {
                for (const selPath of selectedPaths) {
                    const javaFiles = await this._collectJavaFiles(selPath);
                    filesToCheck = filesToCheck.concat(javaFiles);
                }
            } else if (selectedPath) {
                const javaFiles = await this._collectJavaFiles(selectedPath);
                filesToCheck = filesToCheck.concat(javaFiles);
            } else {
                const javaFiles = await this._collectJavaFiles(basePath);
                filesToCheck = filesToCheck.concat(javaFiles);
            }

            // 检查每个Java文件是否有对应的编译码文件
            for (const javaFile of filesToCheck) {
                // 查找项目根目录（包含.classpath文件的目录）
                let projectPath = path.dirname(javaFile);
                while (projectPath && projectPath !== path.dirname(projectPath)) {
                    if (fs.existsSync(path.join(projectPath, '.classpath'))) {
                        break;
                    }
                    projectPath = path.dirname(projectPath);
                }

                // 如果没找到项目根目录，使用文件所在目录
                if (!projectPath || projectPath === path.dirname(projectPath)) {
                    projectPath = path.dirname(javaFile);
                }

                // 获取编译后的class文件路径
                const compiledClassPath = await this._getCompiledClassPath(javaFile, projectPath);
                
                // 获取输出路径
                const outputPath = await this._getClasspathOutputPath(projectPath);
                let fullClassPath = path.join(projectPath, outputPath, compiledClassPath);

                // 检查编译后的class文件是否存在
                if (!fs.existsSync(fullClassPath)) {
                    const parentProjectPath = path.dirname(projectPath);
                    if (parentProjectPath && parentProjectPath !== projectPath) {
                        const parentCompiledClassPath = await this._getCompiledClassPath(javaFile, parentProjectPath);
                        const parentOutputPath = await this._getClasspathOutputPath(parentProjectPath);
                        const parentFullClassPath = path.join(parentProjectPath, parentOutputPath, parentCompiledClassPath);
                        if (fs.existsSync(parentFullClassPath)) {
                            fullClassPath = parentFullClassPath;
                        } else {
                            console.log(`编译文件不存在: ${fullClassPath}`);
                            console.log(`已尝试上一层路径: ${parentFullClassPath}`);
                            return false;
                        }
                    } else {
                        console.log(`编译文件不存在: ${fullClassPath}`);
                        return false;
                    }
                }
                
                // 检查相关的内部类文件是否存在
                const innerClassExists = await this._checkInnerClassFilesExist(fullClassPath);
                if (!innerClassExists) {
                    console.log(`部分内部类文件不存在，但继续处理主类文件: ${fullClassPath}`);
                }
                
                // 额外检查：确保class文件是最新的（修改时间应该在java文件之后）
                const javaStat = fs.statSync(javaFile);
                const classStat = fs.statSync(fullClassPath);
                
                if (classStat.mtime < javaStat.mtime) {
                    console.log(`编译文件不是最新的: ${fullClassPath}`);
                    console.log(`Java文件修改时间: ${javaStat.mtime}`);
                    console.log(`Class文件修改时间: ${classStat.mtime}`);
                    // 自动刷新工作区以获取最新文件
                    await this._forceRefreshWorkspace();
                    
                    // 重新检查文件状态
                    const refreshedJavaStat = fs.statSync(javaFile);
                    const refreshedClassStat = fs.statSync(fullClassPath);
                    
                    if (refreshedClassStat.mtime < refreshedJavaStat.mtime) {
                        // 如果刷新后仍然不是最新的，提示用户需要重新编译
                        this._view?.webview.postMessage({
                            type: 'showMessage',
                            level: 'warning',
                            message: `检测到 ${path.basename(javaFile)} 的编译文件不是最新的，请重新编译项目后再导出补丁。`
                        });
                        return false;
                    }
                }
            }

            return true;
        } catch (error) {
            console.error('检查编译码文件时出错:', error);
            // 出错时为了保证流程继续，返回true，但在实际应用中可能需要更严格的处理
            return true;
        }
    }

    /**
     * 收集指定路径下的所有Java文件
     */
    private async _collectJavaFiles(basePath: string): Promise<string[]> {
        const fs = require('fs');
        const path = require('path');
        const javaFiles: string[] = [];

        // 首先检查传入的路径是否为文件
        try {
            const stat = await fs.promises.stat(basePath);
            
            // 如果是文件且为Java文件，直接加入数组
            if (stat.isFile() && basePath.endsWith('.java')) {
                javaFiles.push(basePath);
                return javaFiles;
            }
        } catch (error) {
            // 如果无法获取文件状态，继续执行目录扫描逻辑
            console.warn(`无法获取文件状态: ${basePath}`, error);
        }

        // 使用异步方式扫描目录，避免阻塞UI
        const scanDir = async (dirPath: string): Promise<void> => {
            try {
                const items = await fs.promises.readdir(dirPath);

                // 创建所有子任务的Promise数组
                const tasks = items.map(async (item: string) => {
                    const fullPath = path.join(dirPath, item);

                    try {
                        const stat = await fs.promises.stat(fullPath);

                        if (stat.isDirectory()) {
                            // 跳过一些目录
                            if (item === 'node_modules' || item === '.git' || item === 'target' ||
                                item === 'build' || item === 'out' || item.startsWith('.')) {
                                return;
                            }
                            await scanDir(fullPath);
                        } else {
                            // 如果是Java文件，加入数组
                            if (item.endsWith('.java')) {
                                javaFiles.push(fullPath);
                            }
                        }
                    } catch (statError) {
                        // 忽略无法访问的文件
                        console.warn(`无法访问文件: ${fullPath}`, statError);
                        return;
                    }
                });

                // 等待所有子任务完成
                await Promise.all(tasks);
            } catch (readError) {
                // 忽略无法读取的目录
                console.warn(`无法读取目录: ${dirPath}`, readError);
                return;
            }
        };

        await scanDir(basePath);
        return javaFiles;
    }
    
    /**
     * 强制刷新工作区文件系统
     * 在导出补丁前调用此方法可确保文件状态是最新的
     * @param showMessages 是否向用户显示刷新消息
     */
    private async _forceRefreshWorkspace(showMessages: boolean = true): Promise<void> {
        try {
            // 发送命令刷新文件资源管理器
            await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
            
            if (showMessages) {
                // 显示提示消息
                this._view?.webview.postMessage({
                    type: 'showMessage',
                    level: 'info',
                    message: '工作区文件已刷新，请重新导出补丁。'
                });
            }
            
            // 重新扫描可导出文件
            await this._refreshExportableFiles();
        } catch (error) {
            console.error('刷新工作区失败:', error);
            if (showMessages) {
                this._view?.webview.postMessage({
                    type: 'showMessage',
                    level: 'error',
                    message: '刷新工作区失败，请手动刷新后再试。'
                });
            }
        }
    }
}
