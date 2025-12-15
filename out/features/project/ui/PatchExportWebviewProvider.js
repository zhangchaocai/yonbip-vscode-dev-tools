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
exports.PatchExportWebviewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const NCHomeConfigService_1 = require("../../home/config/NCHomeConfigService");
class PatchExportWebviewProvider {
    _extensionUri;
    _context;
    static viewType = 'yonbip.patchExportConfig';
    _view;
    _resolvePromise;
    configService;
    constructor(_extensionUri, _context) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this.configService = new NCHomeConfigService_1.NCHomeConfigService(_context);
        this._context.subscriptions.push(vscode.commands.registerCommand('yonbip.patchExportConfig.refresh', () => {
            this._refreshExportableFiles();
        }));
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'exportPatch':
                    this._handleExportPatch(message.data);
                    break;
                case 'selectOutputPath':
                    this._handleSelectOutputPath();
                    break;
                case 'cancel':
                    this._handleCancel();
                    break;
                case 'refreshFiles':
                    this._refreshExportableFiles();
                    break;
                case 'selectOutputDir':
                    this._handleSelectOutputDir();
                    break;
                case 'showMessage':
                    console.log('收到Webview消息:', message);
                    if (message.level === 'error') {
                        vscode.window.showErrorMessage(message.message);
                    }
                    else if (message.level === 'success') {
                        vscode.window.showInformationMessage(message.message);
                    }
                    else {
                        vscode.window.showInformationMessage(message.message);
                    }
                    break;
            }
        }, undefined, this._context.subscriptions);
        this._clearExportableFiles();
    }
    async _handleSelectOutputPath() {
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
    async showExportConfig() {
        if (!this._view) {
            await vscode.commands.executeCommand('yonbip.patchExportConfig.focus');
        }
        return new Promise((resolve) => {
            this._resolvePromise = resolve;
            this._view?.webview.postMessage({
                type: 'initForm',
                data: this._getDefaultPatchInfo()
            });
        });
    }
    async _handleExportPatch(data) {
        console.log('收到导出补丁请求:', data);
        try {
            const patchInfo = {
                name: data.name || 'patch',
                version: data.version || '1.0.0',
                description: data.description || '',
                files: [],
                outputPath: data.outputDir || './patches',
                includeSource: data.includeSource !== false,
                includeResources: data.includeResources !== false,
                includeConfig: data.includeConfig !== false
            };
            patchInfo.author = data.author || '';
            patchInfo.includeJavaSource = data.includeJavaSource !== false;
            console.log('构建的补丁信息:', patchInfo);
            await this._performPatchExport(patchInfo);
        }
        catch (error) {
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
    async _performPatchExport(patchInfo) {
        console.log('开始执行补丁导出:', patchInfo);
        const fs = require('fs');
        const archiver = require('archiver');
        const { v4: uuidv4 } = require('uuid');
        const basePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!basePath) {
            throw new Error('请先打开一个工作区');
        }
        console.log('工作区路径:', basePath);
        this._view?.webview.postMessage({
            type: 'showMessage',
            level: 'info',
            message: '正在导出补丁...'
        });
        try {
            const selectedPath = this._context.workspaceState.get('selectedExportPath');
            const selectedPaths = this._context.workspaceState.get('selectedExportPaths');
            console.log('导出补丁 - selectedPath:', selectedPath);
            console.log('导出补丁 - selectedPaths:', selectedPaths);
            let files = [];
            if (selectedPaths && selectedPaths.length > 0) {
                console.log('处理多个路径导出:', selectedPaths);
                const filePaths = new Set();
                for (const path of selectedPaths) {
                    console.log('处理路径:', path);
                    const pathFiles = await this._collectExportableFiles(path);
                    console.log('路径', path, '找到文件数量:', pathFiles.length);
                    for (const file of pathFiles) {
                        if (!filePaths.has(file.path)) {
                            filePaths.add(file.path);
                            files.push(file);
                        }
                    }
                }
            }
            else if (selectedPath) {
                console.log('处理单个路径导出:', selectedPath);
                files = await this._collectExportableFiles(selectedPath);
            }
            else {
                console.log('使用工作区根目录导出');
                files = await this._collectExportableFiles(basePath);
            }
            console.log('收集到的文件数量:', files.length);
            files.forEach((file, index) => {
                console.log(`文件 ${index + 1}:`, file.path, `类型: ${file.type}`);
            });
            if (files.length === 0) {
                throw new Error('没有找到需要导出的文件');
            }
            console.log('开始创建补丁包...');
            const zipPath = await this._createStandardPatchZip(files, patchInfo, basePath);
            console.log('补丁包创建成功:', zipPath);
            console.log('准备发送成功消息到Webview');
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'success',
                message: `补丁导出成功: ${path.basename(zipPath)}`
            });
            console.log('成功消息已发送到Webview');
            vscode.window.showInformationMessage(`补丁导出成功: ${path.basename(zipPath)}`, '打开文件夹').then(choice => {
                if (choice === '打开文件夹') {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(zipPath));
                }
            });
        }
        catch (error) {
            console.error('补丁导出过程中出错:', error);
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
    async _refreshExportableFiles() {
        try {
            const selectedPath = this._context.workspaceState.get('selectedExportPath');
            const selectedPaths = this._context.workspaceState.get('selectedExportPaths');
            console.log('刷新文件列表 - selectedPath:', selectedPath);
            console.log('刷新文件列表 - selectedPaths:', selectedPaths);
            if (selectedPaths && selectedPaths.length > 0) {
                console.log('处理多个路径:', selectedPaths);
                let allFiles = [];
                const filePaths = new Set();
                for (const path of selectedPaths) {
                    console.log('处理路径:', path);
                    const pathFiles = await this._collectExportableFiles(path);
                    console.log('路径', path, '找到文件数量:', pathFiles.length);
                    for (const file of pathFiles) {
                        if (!filePaths.has(file.path)) {
                            filePaths.add(file.path);
                            allFiles.push(file);
                        }
                    }
                }
                console.log('总共找到文件数量:', allFiles.length);
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'filesRefreshed',
                        files: this._groupFilesByType(allFiles)
                    });
                }
            }
            else if (selectedPath) {
                console.log('处理单个路径:', selectedPath);
                const files = await this._collectExportableFiles(selectedPath);
                console.log('单个路径找到文件数量:', files.length);
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'filesRefreshed',
                        files: this._groupFilesByType(files)
                    });
                }
            }
            else {
                console.log('使用工作区根目录');
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    return;
                }
                const files = await this._collectExportableFiles(workspaceFolder.uri.fsPath);
                console.log('工作区根目录找到文件数量:', files.length);
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'filesRefreshed',
                        files: this._groupFilesByType(files)
                    });
                }
            }
        }
        catch (error) {
            console.error('刷新可导出文件失败:', error);
        }
    }
    _clearExportableFiles() {
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
    async _collectExportableFiles(basePath) {
        const files = [];
        const fs = require('fs');
        const path = require('path');
        try {
            const stat = await fs.promises.stat(basePath);
            if (stat.isFile()) {
                const ext = path.extname(basePath).toLowerCase();
                let fileType = '';
                if (['.java'].includes(ext)) {
                    fileType = 'source';
                }
                else if (['.xml', '.upm', '.rest', '.aop'].includes(ext)) {
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
        }
        catch (error) {
            console.warn(`无法获取文件状态: ${basePath}`, error);
        }
        const scanDir = async (dirPath, relativePath = '') => {
            try {
                const items = await fs.promises.readdir(dirPath);
                const tasks = items.map(async (item) => {
                    const fullPath = path.join(dirPath, item);
                    const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
                    try {
                        const stat = await fs.promises.stat(fullPath);
                        if (stat.isDirectory()) {
                            if (item === 'node_modules' || item === '.git' || item === 'target' ||
                                item === 'build' || item === 'out' || item.startsWith('.')) {
                                return;
                            }
                            await scanDir(fullPath, itemRelativePath);
                        }
                        else {
                            const ext = path.extname(item).toLowerCase();
                            let fileType = '';
                            if (['.java'].includes(ext)) {
                                fileType = 'source';
                            }
                            else if (['.xml', '.upm', '.rest', '.aop'].includes(ext)) {
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
                    }
                    catch (statError) {
                        console.warn(`无法访问文件: ${fullPath}`, statError);
                        return;
                    }
                });
                await Promise.all(tasks);
            }
            catch (readError) {
                console.warn(`无法读取目录: ${dirPath}`, readError);
                return;
            }
        };
        await scanDir(basePath);
        return files;
    }
    _handleCancel() {
        if (this._resolvePromise) {
            this._resolvePromise(null);
            this._resolvePromise = undefined;
        }
    }
    async _handleSelectOutputDir() {
        const options = {
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
    _getDefaultPatchInfo() {
        const config = vscode.workspace.getConfiguration('yonbip');
        return {
            name: '修复补丁',
            version: '1',
            description: '',
            author: 'yonyou',
            includeSource: true,
            includeResources: true,
            includeConfig: false,
            includeJavaSource: true,
            outputPath: config.get('patchOutputDir') || './patches'
        };
    }
    _getHtmlForWebview(webview) {
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
            <button class="button button-secondary" onclick="cancel()">取消</button>
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

        function cancel() {
            vscode.postMessage({
                type: 'cancel'
            });
        }

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
    async _buildReplacementContent(files, patchInfo, archive, basePath) {
        const fs = require('fs');
        const path = require('path');
        console.log('开始构建替换内容，文件数量:', files.length);
        let config = this.configService.getConfig();
        const nccloudPath = path.join(config.homePath, 'hotwebs', 'nccloud');
        const isNCCHome = fs.existsSync(nccloudPath);
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
            if (fileName.endsWith('.iml') || filePath.toLowerCase().includes('.idea')) {
                continue;
            }
            let targetPath = '';
            if (this._isJavaSourceFile(filePath)) {
                targetPath = await this._getJavaFileTargetPath(filePath, isNCCHome, patchInfo);
                if (targetPath) {
                    let projectPath = path.dirname(filePath);
                    while (projectPath && projectPath !== path.dirname(projectPath)) {
                        if (fs.existsSync(path.join(projectPath, '.classpath'))) {
                            break;
                        }
                        projectPath = path.dirname(projectPath);
                    }
                    if (!projectPath || projectPath === path.dirname(projectPath)) {
                        projectPath = path.dirname(filePath);
                    }
                    const compiledClassPath = await this._getCompiledClassPath(filePath, projectPath);
                    const outputPath = await this._getClasspathOutputPath(projectPath);
                    const fullClassPath = path.join(projectPath, outputPath, compiledClassPath);
                    if (fs.existsSync(fullClassPath)) {
                        archive.file(fullClassPath, { name: targetPath });
                        if (patchInfo.includeJavaSource !== false) {
                            archive.file(file.path, { name: targetPath.replace('.class', '.java') });
                        }
                    }
                    else {
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
                            `   • 支持的源码目录: src/public/, src/private/, src/client/, src/\n` +
                            `   • 当前源文件路径: ${file.path}\n\n` +
                            `4. 🏗️ 项目结构问题\n` +
                            `   • 确认项目是标准的Java项目结构\n` +
                            `   • 检查包名与目录结构是否匹配\n` +
                            `   • 验证Java文件的package声明\n\n` +
                            `请按照上述步骤检查并解决问题后重新导出补丁。`;
                        console.warn(`编译后的class文件不存在: ${fullClassPath}`);
                        console.warn(`输出目录: ${outputPath}`);
                        console.warn(`编译后的class路径: ${compiledClassPath}`);
                        console.log('准备发送详细错误消息到Webview');
                        this._view?.webview.postMessage({
                            type: 'showMessage',
                            level: 'error',
                            message: errorMessage
                        });
                        console.log('详细错误消息已发送到Webview');
                        throw new Error(`编译文件未找到: ${fullClassPath}`);
                    }
                }
            }
            else if (this._isResourceFile(filePath)) {
                targetPath = this._getResourceFileTargetPath(filePath);
                if (targetPath) {
                    archive.file(filePath, { name: targetPath });
                }
            }
            else if (this._isConfigFile(filePath)) {
                targetPath = this._getConfigFileTargetPath(filePath);
                if (targetPath) {
                    archive.file(filePath, { name: targetPath });
                }
            }
            else if (this._isSqlFile(filePath)) {
                targetPath = this._getSqlFileTargetPath(filePath, basePath);
                if (targetPath) {
                    archive.file(filePath, { name: targetPath });
                }
            }
            else if (this._isMetaInfFile(filePath)) {
                targetPath = await this._getMetaInfFileTargetPath(filePath);
                if (targetPath) {
                    archive.file(filePath, { name: targetPath });
                }
            }
            else {
                continue;
            }
        }
        console.log('替换内容构建完成');
    }
    async _createStandardPatchZip(files, patchInfo, basePath) {
        const fs = require('fs');
        const archiver = require('archiver');
        const { v4: uuidv4 } = require('uuid');
        let outputDir;
        if (patchInfo.outputPath && path.isAbsolute(patchInfo.outputPath)) {
            outputDir = patchInfo.outputPath;
        }
        else if (patchInfo.outputPath) {
            outputDir = path.join(basePath, patchInfo.outputPath);
        }
        else {
            outputDir = path.join(basePath, 'patches');
        }
        console.log('输出目录:', outputDir);
        if (!fs.existsSync(outputDir)) {
            console.log('创建输出目录:', outputDir);
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const authorPart = patchInfo.author ? `_${patchInfo.author}` : '';
        const patchName = `patch_${patchInfo.name}${authorPart}_${timestamp}_V${patchInfo.version.replace(/\./g, '_')}`;
        const zipPath = path.join(outputDir, `${patchName}.zip`);
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', () => {
                console.log('ZIP文件创建完成:', zipPath);
                resolve(zipPath);
            });
            archive.on('error', (err) => {
                console.log('ZIP归档过程中出错:', err);
                reject(err);
            });
            archive.pipe(output);
            const filteredFiles = files.filter(file => this._shouldIncludeFile(file, patchInfo));
            const patchId = uuidv4();
            const packmetadata = this._generatePackMetadata(patchInfo, patchId, files);
            archive.append(packmetadata, { name: 'packmetadata.xml' });
            const installpatch = this._generateInstallPatch();
            archive.append(installpatch, { name: 'installpatch.xml' });
            const readme = this._generateReadme(patchInfo, patchId);
            archive.append(readme, { name: 'readme.txt' });
            this._buildReplacementContent(filteredFiles, patchInfo, archive, basePath).then(() => {
                console.log('文件内容构建完成，开始finalize');
                archive.finalize();
            }).catch((error) => {
                console.log('捕获到_buildReplacementContent中的错误:', error);
                reject(error);
            });
        });
    }
    async _findModuleName(filePath) {
        const fs = require('fs');
        const path = require('path');
        const xml2js = require('xml2js');
        let moduleName = await this._findModuleNameDownward(filePath, 0);
        if (moduleName) {
            return moduleName;
        }
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
                }
                catch (error) {
                    console.error('解析module.xml失败:', error);
                }
            }
            currentDir = path.dirname(currentDir);
        }
        currentDir = path.dirname(filePath);
        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const projectFile = path.join(currentDir, '.project');
            if (fs.existsSync(projectFile)) {
                try {
                    const xmlContent = fs.readFileSync(projectFile, 'utf8');
                    const parser = new xml2js.Parser();
                    const result = await this._parseXml(parser, xmlContent);
                    if (result && result.projectDescription && result.projectDescription.name && result.projectDescription.name.length > 0) {
                        return result.projectDescription.name[0];
                    }
                }
                catch (error) {
                    console.error('解析.project文件失败:', error);
                }
            }
            currentDir = path.dirname(currentDir);
        }
        return 'unknown_module';
    }
    async _findModuleNameDownward(dirPath, depth) {
        const fs = require('fs');
        const path = require('path');
        const xml2js = require('xml2js');
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
            }
            catch (error) {
                console.error('解析module.xml失败:', error);
            }
        }
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
    _parseXml(parser, xmlContent) {
        return new Promise((resolve, reject) => {
            parser.parseString(xmlContent, (err, result) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(result);
                }
            });
        });
    }
    _isJavaSourceFile(filePath) {
        return filePath.endsWith('.java');
    }
    _isResourceFile(filePath) {
        return filePath.includes('/resources/') || filePath.includes('\\resources\\');
    }
    _isConfigFile(filePath) {
        return filePath.includes('/yyconfig/') || filePath.includes('\\yyconfig\\');
    }
    _isSqlFile(filePath) {
        return filePath.toLowerCase().endsWith('.sql');
    }
    _isMetaInfFile(filePath) {
        return filePath.includes('/META-INF/') || filePath.includes('\\META-INF\\');
    }
    async _getClasspathOutputPath(projectPath) {
        const fs = require('fs');
        const path = require('path');
        const xml2js = require('xml2js');
        const classpathFile = path.join(projectPath, '.classpath');
        if (!fs.existsSync(classpathFile)) {
            return 'build/classes';
        }
        try {
            const xmlContent = fs.readFileSync(classpathFile, 'utf8');
            const parser = new xml2js.Parser();
            const result = await this._parseXml(parser, xmlContent);
            if (result && result.classpath && result.classpath.classpathentry) {
                const entries = result.classpath.classpathentry;
                for (const entry of entries) {
                    if (entry.$ && entry.$.kind === 'output') {
                        return entry.$.path || 'build/classes';
                    }
                }
            }
            return 'build/classes';
        }
        catch (error) {
            console.error('解析.classpath文件失败:', error);
            return 'build/classes';
        }
    }
    async _getCompiledClassPath(javaFilePath, projectPath) {
        const fs = require('fs');
        const path = require('path');
        const outputPath = await this._getClasspathOutputPath(projectPath);
        let sourceRoot = '';
        let relativePath = '';
        if (javaFilePath.includes('/src/public/')) {
            const parts = javaFilePath.split('/src/public/');
            sourceRoot = path.join(parts[0], 'src/public');
            relativePath = parts[1];
        }
        else if (javaFilePath.includes('\\src\\public\\')) {
            const parts = javaFilePath.split('\\src\\public\\');
            sourceRoot = path.join(parts[0], 'src/public');
            relativePath = parts[1];
        }
        else if (javaFilePath.includes('/src/private/')) {
            const parts = javaFilePath.split('/src/private/');
            sourceRoot = path.join(parts[0], 'src/private');
            relativePath = parts[1];
        }
        else if (javaFilePath.includes('\\src\\private\\')) {
            const parts = javaFilePath.split('\\src\\private\\');
            sourceRoot = path.join(parts[0], 'src/private');
            relativePath = parts[1];
        }
        else if (javaFilePath.includes('/src/client/')) {
            const parts = javaFilePath.split('/src/client/');
            sourceRoot = path.join(parts[0], 'src/client');
            relativePath = parts[1];
        }
        else if (javaFilePath.includes('\\src\\client\\')) {
            const parts = javaFilePath.split('\\src\\client\\');
            sourceRoot = path.join(parts[0], 'src/client');
            relativePath = parts[1];
        }
        else {
            const srcIndexUnix = javaFilePath.indexOf('/src/');
            const srcIndexWin = javaFilePath.indexOf('\\src\\');
            if (srcIndexUnix !== -1) {
                sourceRoot = javaFilePath.substring(0, srcIndexUnix + 4);
                relativePath = javaFilePath.substring(srcIndexUnix + 5);
            }
            else if (srcIndexWin !== -1) {
                sourceRoot = javaFilePath.substring(0, srcIndexWin + 4);
                relativePath = javaFilePath.substring(srcIndexWin + 5);
            }
            else {
                relativePath = path.relative(projectPath, javaFilePath);
            }
        }
        const classRelativePath = relativePath.replace(/\.java$/, '.class');
        const compiledClassPath = path.join(outputPath, classRelativePath);
        const fullClassPath = path.join(projectPath, compiledClassPath);
        if (fs.existsSync(fullClassPath)) {
            return classRelativePath.replace(/\\/g, '/');
        }
        const fallbackClassRelativePath = relativePath.replace(/\.java$/, '.class');
        return fallbackClassRelativePath.replace(/\\/g, '/');
    }
    async _getJavaFileTargetPath(filePath, isNCCHome, patchInfo) {
        const path = require('path');
        const fs = require('fs');
        const moduleName = await this._findModuleName(filePath);
        let projectPath = path.dirname(filePath);
        while (projectPath && projectPath !== path.dirname(projectPath)) {
            if (fs.existsSync(path.join(projectPath, '.classpath'))) {
                break;
            }
            projectPath = path.dirname(projectPath);
        }
        if (!projectPath || projectPath === path.dirname(projectPath)) {
            projectPath = path.dirname(filePath);
        }
        const compiledClassPath = await this._getCompiledClassPath(filePath, projectPath);
        if (filePath.includes('/src/public/') || filePath.includes('\\src\\public\\')) {
            return `replacement/modules/${moduleName}/classes/${compiledClassPath}`;
        }
        else if (filePath.includes('/src/private/') || filePath.includes('\\src\\private\\')) {
            return `replacement/modules/${moduleName}/META-INF/classes/${compiledClassPath}`;
        }
        else if (filePath.includes('/src/client/') || filePath.includes('\\src\\client\\')) {
            if (isNCCHome) {
                return `replacement/hotwebs/nccloud/WEB-INF/classes/${compiledClassPath}`;
            }
            else {
                return `replacement/modules/${moduleName}/client/classes/${compiledClassPath}`;
            }
        }
        else if (filePath.includes('uap_special/src') &&
            (filePath.includes('/external/') || filePath.includes('/framework/') || filePath.includes('/lib/'))) {
            return `replacement/external/classes/${compiledClassPath}`;
        }
        return `replacement/modules/${moduleName}/classes/${compiledClassPath}`;
    }
    _getResourceFileTargetPath(filePath) {
        const relativePath = this._extractRelativePath(filePath, '/resources/', '\\resources\\');
        return `replacement/resources${relativePath}`;
    }
    _getConfigFileTargetPath(filePath) {
        const relativePath = this._extractRelativePath(filePath, '/yyconfig/modules/', '\\yyconfig\\modules\\');
        return `replacement/hotwebs/nccloud/WEB-INF/extend/yyconfig/modules/${relativePath}`;
    }
    _getSqlFileTargetPath(filePath, basePath) {
        const path = require('path');
        const relativePath = path.relative(basePath, filePath);
        return `sql/${relativePath}`;
    }
    async _getMetaInfFileTargetPath(filePath) {
        const moduleName = await this._findModuleName(filePath);
        const relativePath = this._extractRelativePath(filePath, '/META-INF/', '\\META-INF\\');
        return `replacement/modules/${moduleName}/META-INF${relativePath}`;
    }
    _getDefaultFileTargetPath(filePath, basePath) {
        const path = require('path');
        const relativePath = path.relative(basePath, filePath);
        return relativePath;
    }
    _extractRelativePath(filePath, unixSeparator, windowsSeparator) {
        const path = require('path');
        if (filePath.includes(unixSeparator)) {
            const parts = filePath.split(unixSeparator);
            return parts.length > 1 ? '/' + parts[parts.length - 1] : '';
        }
        else if (filePath.includes(windowsSeparator)) {
            const parts = filePath.split(windowsSeparator);
            return path.sep + parts[parts.length - 1];
        }
        return '';
    }
    _extractUapSpecialPath(filePath) {
        const path = require('path');
        let startIndex = -1;
        if (filePath.includes('/nc/')) {
            startIndex = filePath.indexOf('/nc/');
        }
        else if (filePath.includes('/nccloud/')) {
            startIndex = filePath.indexOf('/nccloud/');
        }
        else if (filePath.includes('/uap/')) {
            startIndex = filePath.indexOf('/uap/');
        }
        if (startIndex !== -1) {
            return filePath.substring(startIndex);
        }
        return '/' + path.basename(filePath);
    }
    _shouldIncludeFile(file, patchInfo) {
        switch (file.type) {
            case 'source':
                return patchInfo.includeSource !== false;
            case 'resource':
                return patchInfo.includeResources !== false;
            case 'config':
                return patchInfo.includeConfig !== false;
            case 'library':
                return false;
            default:
                return true;
        }
    }
    _generatePackMetadata(patchInfo, patchId, files) {
        const modifiedClasses = files
            .filter(f => f.type === 'source' && f.path.endsWith('.java'))
            .map(f => {
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
    _generateInstallPatch() {
        return `<?xml version="1.0" encoding="UTF-8"?>
<installpatch>
    <copy><from>/replacement/modules/</from><to>/modules/</to></copy>
</installpatch>`;
    }
    _generateReadme(patchInfo, patchId) {
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
    _groupFilesByType(files) {
        const grouped = {
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
}
exports.PatchExportWebviewProvider = PatchExportWebviewProvider;
//# sourceMappingURL=PatchExportWebviewProvider.js.map