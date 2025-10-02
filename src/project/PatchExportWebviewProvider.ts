import * as vscode from 'vscode';
import * as path from 'path';
import { PatchInfo } from './ProjectService';
import { NCHomeConfigService } from './NCHomeConfigService';

/**
 * 补丁导出配置Webview提供者
 */
export class PatchExportWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip.patchExportConfig';

    private _view?: vscode.WebviewView;
    private _resolvePromise?: (value: PatchInfo | null) => void;
    private configService: NCHomeConfigService;

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
                        if (message.messageType === 'error') {
                            vscode.window.showErrorMessage(message.message);
                        } else if (message.messageType === 'info') {
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

            console.log('构建的补丁信息:', patchInfo);

            // 执行实际的导出逻辑
            await this._performPatchExport(patchInfo);

        } catch (error) {
            console.error('导出补丁失败:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'error',
                message: `导出补丁失败: ${errorMessage}`
            });
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
            // 获取用户右键选择的路径
            const selectedPath = this._context.workspaceState.get<string>('selectedExportPath');

            let files: { path: string, type: string, relativePath: string }[] = [];

            if (!selectedPath) {
                // 如果没有选择路径，使用工作区根目录
                files = await this._collectExportableFiles(basePath);
            } else {
                // 仅使用用户选择目录下的文件
                files = await this._collectExportableFiles(selectedPath);
            }

            console.log('收集到的文件数量:', files.length);

            if (files.length === 0) {
                throw new Error('没有找到需要导出的文件');
            }

            // 创建补丁包
            console.log('开始创建补丁包...');
            const zipPath = await this._createStandardPatchZip(files, patchInfo, basePath);
            console.log('补丁包创建成功:', zipPath);

            // 显示成功消息
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'success',
                message: `补丁导出成功: ${path.basename(zipPath)}`
            });

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
            throw error;
        }
    }

    private async _refreshExportableFiles(): Promise<void> {
        try {
            // 获取用户右键选择的路径
            const selectedPath = this._context.workspaceState.get<string>('selectedExportPath');

            if (!selectedPath) {
                // 如果没有选择路径，使用工作区根目录
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    return;
                }

                const files = await this._collectExportableFiles(workspaceFolder.uri.fsPath);

                // 发送文件列表到webview
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'filesRefreshed',
                        files: this._groupFilesByType(files)
                    });
                }
            } else {
                // 仅扫描用户选择的目录
                const files = await this._collectExportableFiles(selectedPath);

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
                            if (['.java', '.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
                                fileType = 'source';
                            } else if (['.xml', '.properties', '.json', '.txt'].includes(ext)) {
                                fileType = 'resource';
                            } else if (['.yml', '.yaml', '.conf', '.config'].includes(ext)) {
                                fileType = 'config';
                            } else if (['.jar', '.war', '.ear'].includes(ext)) {
                                fileType = 'library';
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
                        return;
                    }
                });

                // 等待所有子任务完成
                await Promise.all(tasks);
            } catch (readError) {
                // 忽略无法读取的目录
                return;
            }
        };

        await scanDir(basePath);
        return files;
    }

    private _handleCancel() {
        if (this._resolvePromise) {
            this._resolvePromise(null);
            this._resolvePromise = undefined;
        }
    }

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

    private _getDefaultPatchInfo(): Partial<PatchInfo> {
        const config = vscode.workspace.getConfiguration('yonbip');
        return {
            name: 'patch',
            version: '1.0.0',
            description: '',
            includeSource: true,
            includeResources: true,
            includeConfig: false,
            outputPath: config.get('patchOutputDir') || './patches'
        };
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>补丁导出配置</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
        }

        .form-container {
            max-width: 100%;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .form-group label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
            color: var(--vscode-input-foreground);
        }

        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
            box-sizing: border-box;
        }

        .form-group textarea {
            min-height: 60px;
            resize: vertical;
        }

        .form-row {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .form-row input {
            flex: 1;
        }

        .browse-button {
            padding: 6px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            white-space: nowrap;
        }

        .browse-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .checkbox-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checkbox-item input[type="checkbox"] {
            width: auto;
            margin: 0;
        }

        .file-list-container {
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            margin-bottom: 16px;
        }

        .file-list {
            padding: 8px;
        }

        .file-category {
            margin-bottom: 12px;
        }

        .file-category-title {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 4px;
            font-size: 14px;
        }

        .file-item {
            padding: 2px 0;
            font-size: 13px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-editor-font-family);
        }

        .refresh-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            margin-left: 8px;
        }

        .refresh-button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .loading {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 20px;
        }

        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin: 20px 0 12px 0;
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-widget-border);
            padding-bottom: 4px;
        }

        .button-group {
            display: flex;
            gap: 8px;
            margin-top: 24px;
            justify-content: flex-end;
        }

        .button {
            padding: 8px 16px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
        }

        .button-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .button-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .button-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .button-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .error-message {
            color: var(--vscode-errorForeground);
            font-size: 12px;
            margin-top: 4px;
            display: none;
        }

        .error-message.show {
            display: block;
        }

        .form-group.error input,
        .form-group.error select,
        .form-group.error textarea {
            border-color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <div class="form-container">
        <div class="form-group">
            <label for="patchName">补丁名称 *</label>
            <input type="text" id="patchName" placeholder="输入补丁名称">
            <div id="patchNameError" class="error-message"></div>
        </div>

        <div class="form-group">
            <label for="patchVersion">版本号 *</label>
            <input type="text" id="patchVersion" placeholder="例如: 1.0.0">
            <div id="patchVersionError" class="error-message"></div>
        </div>

        <div class="form-group">
            <label for="patchDescription">补丁描述</label>
            <textarea id="patchDescription" placeholder="描述补丁的功能和修复的问题"></textarea>
            <div id="patchDescriptionError" class="error-message"></div>
        </div>

        <div class="form-group">
            <label for="patchAuthor">作者</label>
            <input type="text" id="patchAuthor" placeholder="补丁作者">
            <div id="patchAuthorError" class="error-message"></div>
        </div>

        <div class="form-group">
            <label for="patchType">补丁类型</label>
            <select id="patchType">
                <option value="hotfix">热修复</option>
                <option value="feature">功能补丁</option>
                <option value="security">安全补丁</option>
                <option value="performance">性能优化</option>
            </select>
            <div id="patchTypeError" class="error-message"></div>
        </div>

        <div class="form-group">
            <label for="targetVersion">目标版本</label>
            <input type="text" id="targetVersion" placeholder="适用的产品版本">
        </div>

        <div class="form-group">
            <label for="baseVersion">基础版本</label>
            <input type="text" id="baseVersion" placeholder="基于的版本">
        </div>

        <div class="section-title">包含文件类型</div>
        <div class="checkbox-group">
            <div class="checkbox-item">
                <input type="checkbox" id="includeSource" checked>
                <label for="includeSource">包含源码文件</label>
            </div>
            <div class="checkbox-item">
                <input type="checkbox" id="includeResources" checked>
                <label for="includeResources">包含资源文件</label>
            </div>
            <div class="checkbox-item">
                <input type="checkbox" id="includeConfig">
                <label for="includeConfig">包含配置文件</label>
            </div>
            <div class="checkbox-item">
                <input type="checkbox" id="includeLibs">
                <label for="includeLibs">包含库文件</label>
            </div>
        </div>

        <div class="form-group">
            <label for="excludePatterns">排除文件模式</label>
            <textarea id="excludePatterns" placeholder="使用glob模式，如 **/.git/**&#10;**/node_modules/**&#10;**/target/**"></textarea>
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

        <div class="section-title">说明信息</div>
        <div class="form-group">
            <label for="installInstructions">安装说明</label>
            <textarea id="installInstructions" placeholder="补丁安装步骤和注意事项"></textarea>
        </div>

        <div class="form-group">
            <label for="rollbackInstructions">回滚说明</label>
            <textarea id="rollbackInstructions" placeholder="补丁回滚步骤"></textarea>
        </div>

        <div class="form-group">
            <label for="testInstructions">测试说明</label>
            <textarea id="testInstructions" placeholder="补丁测试方法和验证步骤"></textarea>
        </div>

        <div class="form-group">
            <label for="notes">备注</label>
            <textarea id="notes" placeholder="其他备注信息"></textarea>
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
                pattern: /^[a-zA-Z0-9_-]+$/,
                message: '补丁名称只能包含字母、数字、下划线和连字符'
            },
            patchVersion: {
                required: true,
                pattern: /^\\d+\\.\\d+\\.\\d+$/,
                message: '版本号格式应为 x.y.z (例如: 1.0.0)'
            },
            patchDescription: {
                required: true,
                minLength: 10,
                message: '描述至少需要10个字符'
            },
            patchAuthor: {
                required: true,
                message: '请输入作者名称'
            },
            patchType: {
                required: true,
                message: '请选择补丁类型'
            }
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
        
        // 显示错误信息
        function showError(fieldName, message) {
            const field = document.getElementById(fieldName);
            const errorElement = document.getElementById(fieldName + 'Error');
            const formGroup = field.closest('.form-group');
            
            if (errorElement) {
                errorElement.textContent = message;
                errorElement.classList.add('show');
            }
            
            if (formGroup) {
                formGroup.classList.add('error');
            }
        }
        
        // 清除错误信息
        function clearError(fieldName) {
            const field = document.getElementById(fieldName);
            const errorElement = document.getElementById(fieldName + 'Error');
            const formGroup = field.closest('.form-group');
            
            if (errorElement) {
                errorElement.classList.remove('show');
            }
            
            if (formGroup) {
                formGroup.classList.remove('error');
            }
        }
        
        // 验证整个表单
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
                        clearError(fieldName);
                    }
                }
            });
            
            return isValid;
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
                        } else {
                            clearError(fieldName);
                        }
                    });
                    
                    field.addEventListener('input', function() {
                        clearError(fieldName);
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
                    if (message.level === 'error') {
                        vscode.window.showErrorMessage(message.message);
                    } else if (message.level === 'success') {
                        vscode.window.showInformationMessage(message.message);
                    } else {
                        vscode.window.showInformationMessage(message.message);
                    }
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
            document.getElementById('patchAuthor').value = data.author || '';
            document.getElementById('patchType').value = data.patchType || 'hotfix';
            document.getElementById('targetVersion').value = data.targetVersion || '';
            document.getElementById('baseVersion').value = data.baseVersion || '';
            document.getElementById('includeSource').checked = data.includeSource !== false;
            document.getElementById('includeResources').checked = data.includeResources !== false;
            document.getElementById('includeConfig').checked = data.includeConfig === true;
            document.getElementById('includeLibs').checked = data.includeLibs === true;
            document.getElementById('excludePatterns').value = (data.excludePatterns || []).join('\\n');
            document.getElementById('outputDir').value = data.outputDir || './patches';
            document.getElementById('installInstructions').value = data.installInstructions || '';
            document.getElementById('rollbackInstructions').value = data.rollbackInstructions || '';
            document.getElementById('testInstructions').value = data.testInstructions || '';
            document.getElementById('notes').value = data.notes || '';
        }

        function selectOutputDir() {
            vscode.postMessage({
                type: 'selectOutputDir'
            });
        }

        function exportPatch() {
            console.log('导出补丁按钮被点击');
            
            // 获取表单数据
            const name = document.getElementById('patchName').value.trim();
            const version = document.getElementById('patchVersion').value.trim();
            
            console.log('表单数据:', { name, version });
            
            // 基本验证 - 只检查必填字段
            if (!name) {
                showError('patchName', '请输入补丁名称');
                return;
            }
            
            if (!version) {
                showError('patchVersion', '请输入版本号');
                return;
            }
            
            console.log('验证通过，准备发送消息');

            const data = {
                name,
                version,
                description: document.getElementById('patchDescription').value.trim(),
                author: document.getElementById('patchAuthor').value.trim(),
                patchType: document.getElementById('patchType').value,
                targetVersion: document.getElementById('targetVersion').value.trim(),
                baseVersion: document.getElementById('baseVersion').value.trim(),
                includeSource: document.getElementById('includeSource').checked,
                includeResources: document.getElementById('includeResources').checked,
                includeConfig: document.getElementById('includeConfig').checked,
                includeLibs: document.getElementById('includeLibs').checked,
                excludePatterns: document.getElementById('excludePatterns').value
                    .split('\\n')
                    .map(p => p.trim())
                    .filter(p => p.length > 0),
                outputDir: document.getElementById('outputDir').value.trim(),
                installInstructions: document.getElementById('installInstructions').value.trim(),
                rollbackInstructions: document.getElementById('rollbackInstructions').value.trim(),
                testInstructions: document.getElementById('testInstructions').value.trim(),
                notes: document.getElementById('notes').value.trim()
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
            
            if (!files || Object.keys(files).length === 0) {
                fileList.innerHTML = '<div class="loading">未找到可导出的文件</div>';
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
            refreshFiles();
        });
    </script>
</body>
</html>`;
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

        // 生成补丁文件名，自动添加patch_前缀
        const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const patchName = `patch_${patchInfo.name}_${timestamp}_V${patchInfo.version.replace(/\./g, '_')}`;
        const zipPath = path.join(outputDir, `${patchName}.zip`);

        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                resolve(zipPath);
            });

            archive.on('error', (err: any) => {
                reject(err);
            });

            archive.pipe(output);

            // 过滤并添加文件到zip
            const filteredFiles = files.filter(file => this._shouldIncludeFile(file, patchInfo));

            // 使用IDEA插件的规则构建replacement内容
            this._buildReplacementContent(archive, filteredFiles, basePath, patchInfo);

            // 生成并添加元数据文件
            const patchId = uuidv4();

            // 添加packmetadata.xml
            const packmetadata = this._generatePackMetadata(patchInfo, patchId, files);
            archive.append(packmetadata, { name: 'packmetadata.xml' });

            // 添加installpatch.xml
            const installpatch = this._generateInstallPatch();
            archive.append(installpatch, { name: 'installpatch.xml' });

            // 添加readme.txt
            const readme = this._generateReadme(patchInfo, patchId);
            archive.append(readme, { name: 'readme.txt' });

            archive.finalize();
        });
    }

    /**
     * 根据IDEA插件规则构建replacement内容
     */
    private _buildReplacementContent(archive: any, files: { path: string, type: string, relativePath: string }[], basePath: string, patchInfo: PatchInfo): void {
        const fs = require('fs');
        const path = require('path');

        // 获取home路径配置
        const config = this.configService.getConfig();
        const homePath = config.homePath;

        if (!homePath) {
            // 如果没有配置home路径，使用默认逻辑
            for (const file of files) {
                if (fs.existsSync(file.path)) {
                    const stat = fs.statSync(file.path);
                    if (stat.isFile()) {
                        const targetPath = `replacement/modules/${file.relativePath}`;
                        archive.file(file.path, { name: targetPath });
                    }
                }
            }
            return;
        }

        // 检查是否为NCC Home（是否存在hotwebs/nccloud目录）
        const nccloudPath = path.join(homePath, 'hotwebs', 'nccloud');
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

            // 跳过不需要的文件
            if (fileName.endsWith('.iml') || filePath.toLowerCase().includes('.idea')) {
                continue;
            }

            let targetPath = '';

            // 根据文件路径和类型确定目标路径
            if (this._isJavaSourceFile(filePath)) {
                targetPath = this._getJavaFileTargetPath(filePath, isNCCHome, patchInfo);
            } else if (this._isResourceFile(filePath)) {
                targetPath = this._getResourceFileTargetPath(filePath);
            } else if (this._isConfigFile(filePath)) {
                targetPath = this._getConfigFileTargetPath(filePath);
            } else if (this._isSqlFile(filePath)) {
                targetPath = this._getSqlFileTargetPath(filePath, basePath);
            } else if (this._isMetaInfFile(filePath)) {
                targetPath = this._getMetaInfFileTargetPath(filePath);
            } else {
                // 其他文件使用默认处理
                //targetPath = this._getDefaultFileTargetPath(filePath, basePath);
                continue;
            }

            if (targetPath) {
                archive.file(filePath, { name: targetPath });
            }
        }
    }

    /**
     * 查找文件所属的模块名称
     */
    private _findModuleName(filePath: string): string {
        const fs = require('fs');
        const path = require('path');
        const xml2js = require('xml2js');

        // 先向下递归查找
        let moduleName = this._findModuleNameDownward(filePath, 0);
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
                    const result = parser.parseStringSync(xmlContent);

                    if (result && result.module && result.module.$ && result.module.$.name) {
                        return result.module.$.name;
                    }
                } catch (error) {
                    console.error('解析module.xml失败:', error);
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
    private _findModuleNameDownward(dirPath: string, depth: number): string | null {
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
                const result = parser.parseStringSync(xmlContent);

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
                    const moduleName = this._findModuleNameDownward(childPath, depth + 1);
                    if (moduleName) {
                        return moduleName;
                    }
                }
            }
        }

        return null;
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
     * 获取Java文件的目标路径
     */
    private _getJavaFileTargetPath(filePath: string, isNCCHome: boolean, patchInfo: PatchInfo): string {
        const path = require('path');
        const moduleName = this._findModuleName(filePath);

        // 根据文件路径判断是public、private还是client
        if (filePath.includes('/src/public/') || filePath.includes('\\src\\public\\')) {
            const relativePath = this._extractRelativePath(filePath, '/src/public/', '\\src\\public\\');
            // 将.java文件转换为.class文件路径
            const classPath = relativePath.replace(/\.java$/, '.class');
            return `replacement/modules/${moduleName}/classes${classPath}`;
        } else if (filePath.includes('/src/private/') || filePath.includes('\\src\\private\\')) {
            const relativePath = this._extractRelativePath(filePath, '/src/private/', '\\src\\private\\');
            const classPath = relativePath.replace(/\.java$/, '.class');
            return `replacement/modules/${moduleName}/META-INF/classes${classPath}`;
        } else if (filePath.includes('/src/client/') || filePath.includes('\\src\\client\\')) {
            const relativePath = this._extractRelativePath(filePath, '/src/client/', '\\src\\client\\');
            const classPath = relativePath.replace(/\.java$/, '.class');

            // 根据配置和环境决定目标路径
            if (isNCCHome) {
                return `replacement/hotwebs/nccloud/WEB-INF/classes${classPath}`;
            } else {
                return `replacement/modules/${moduleName}/client/classes${classPath}`;
            }
        } else if (filePath.includes('uap_special/src') &&
            (filePath.includes('/external/') || filePath.includes('/framework/') || filePath.includes('/lib/'))) {
            // 处理uap_special特殊情况
            const relativePath = this._extractUapSpecialPath(filePath);
            const classPath = relativePath.replace(/\.java$/, '.class');
            return `replacement/external/classes${classPath}`;
        }

        // 默认处理
        const classPath = path.basename(filePath).replace(/\.java$/, '.class');
        return `replacement/modules/${moduleName}/classes/${classPath}`;
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
        return `replacement/hotwebs/nccloud/WEB-INF/extend${relativePath}`;
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
    private _getMetaInfFileTargetPath(filePath: string): string {
        const moduleName = this._findModuleName(filePath);
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
}