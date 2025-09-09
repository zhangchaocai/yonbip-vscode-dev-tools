import * as vscode from 'vscode';
import { ProjectService } from './ProjectService';

/**
 * 项目管理WebView提供者
 */
export class ProjectProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip.project';
    
    private _view?: vscode.WebviewView;
    private projectService: ProjectService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) {
        this.projectService = new ProjectService(context);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 处理来自WebView的消息
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'createProject':
                    await this.handleCreateProject();
                    break;
                case 'exportPatch':
                    await this.handleExportPatch(data.selectedPath);
                    break;
                case 'analyzeStructure':
                    await this.handleAnalyzeStructure();
                    break;
                case 'selectExportPath':
                    await this.handleSelectExportPath();
                    break;
            }
        });
    }

    private async handleCreateProject() {
        try {
            await this.projectService.createYonBipProject();
            this._view?.webview.postMessage({
                type: 'projectCreated',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'projectCreated',
                success: false,
                error: error.message
            });
        }
    }

    private async handleExportPatch(selectedPath?: string) {
        try {
            await this.projectService.exportPatch(selectedPath);
            this._view?.webview.postMessage({
                type: 'patchExported',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'patchExported',
                success: false,
                error: error.message
            });
        }
    }

    private async handleAnalyzeStructure() {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('请先打开一个工作区');
            }
            
            // 简化的结构分析
            const structure = `项目结构分析\n项目路径: ${workspaceFolder.uri.fsPath}\n分析时间: ${new Date().toLocaleString()}`;
            
            this._view?.webview.postMessage({
                type: 'structureAnalyzed',
                success: true,
                structure
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'structureAnalyzed',
                success: false,
                error: error.message
            });
        }
    }

    private async handleSelectExportPath() {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: '选择导出目录'
            });

            if (result && result[0]) {
                this._view?.webview.postMessage({
                    type: 'exportPathSelected',
                    success: true,
                    path: result[0].fsPath
                });
            }
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'exportPathSelected',
                success: false,
                error: error.message
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>项目管理</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 15px; margin: 0; }
        .section { margin-bottom: 20px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 20px; }
        .section-title { font-weight: bold; margin-bottom: 15px; color: var(--vscode-textLink-foreground); }
        button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 10px 18px; border-radius: 4px; cursor: pointer; margin-right: 10px; margin-bottom: 8px; }
        .tabs { display: flex; border-bottom: 2px solid var(--vscode-widget-border); margin-bottom: 20px; }
        .tab { padding: 12px 20px; cursor: pointer; border: none; background: none; color: var(--vscode-foreground); }
        .tab.active { background-color: var(--vscode-tab-activeBackground); border-bottom: 3px solid var(--vscode-textLink-foreground); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        input { width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; margin-bottom: 10px; }
        .result-area { background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); padding: 10px; border-radius: 4px; white-space: pre-wrap; font-family: monospace; }
    </style>
</head>
<body>
    <div class="tabs">
        <button class="tab active" onclick="switchTab('create')">🏗️ 项目创建</button>
        <button class="tab" onclick="switchTab('export')">📦 补丁导出</button>
        <button class="tab" onclick="switchTab('analyze')">📊 结构分析</button>
    </div>

    <div id="create-tab" class="tab-content active">
        <div class="section">
            <div class="section-title">创建YonBIP项目</div>
            <p>创建标准的YonBIP高级版项目结构和配置文件</p>
            <button onclick="createProject()">🏗️ 创建新项目</button>
        </div>
    </div>

    <div id="export-tab" class="tab-content">
        <div class="section">
            <div class="section-title">导出补丁包</div>
            <label>导出路径:</label>
            <div style="display: flex; align-items: center;">
                <input type="text" id="exportPath" placeholder="选择导出目录" readonly>
                <button onclick="selectExportPath()" style="margin-left: 10px;">浏览...</button>
            </div>
            <button onclick="exportPatch()">📦 导出补丁包</button>
        </div>
    </div>

    <div id="analyze-tab" class="tab-content">
        <div class="section">
            <div class="section-title">项目结构分析</div>
            <button onclick="analyzeStructure()">📊 分析项目结构</button>
            <div id="structureResult" class="result-area" style="margin-top: 15px; min-height: 200px;">
                点击"分析项目结构"按钮查看结果
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function switchTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }
        
        function createProject() { vscode.postMessage({ type: 'createProject' }); }
        function exportPatch() {
            const path = document.getElementById('exportPath').value;
            vscode.postMessage({ type: 'exportPatch', selectedPath: path });
        }
        function analyzeStructure() { vscode.postMessage({ type: 'analyzeStructure' }); }
        function selectExportPath() { vscode.postMessage({ type: 'selectExportPath' }); }
        
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'projectCreated':
                    console.log(message.success ? '项目创建成功' : '项目创建失败: ' + message.error);
                    break;
                case 'patchExported':
                    console.log(message.success ? '补丁导出成功' : '补丁导出失败: ' + message.error);
                    break;
                case 'structureAnalyzed':
                    if (message.success) {
                        document.getElementById('structureResult').textContent = message.structure;
                    } else {
                        document.getElementById('structureResult').textContent = '分析失败: ' + message.error;
                    }
                    break;
                case 'exportPathSelected':
                    if (message.success) {
                        document.getElementById('exportPath').value = message.path;
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}