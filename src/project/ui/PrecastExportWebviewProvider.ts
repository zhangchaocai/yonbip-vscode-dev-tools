import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { NCHomeConfigService } from '../../project/nc-home/config/NCHomeConfigService';
import { PasswordEncryptor } from '../../utils/PasswordEncryptor';
import { DataSourceMeta } from '../../project/nc-home/config/NCHomeConfigTypes';
import { OracleClientService } from '../../project/nc-home/OracleClientService';
const xml2js = require('xml2js');

/**
 * 预置脚本导出配置 Webview Provider
 */
export class PrecastExportWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip.precastExportConfig';

    private _view?: vscode.WebviewView;
    private configService: NCHomeConfigService;
    private oracleClientService: OracleClientService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this.configService = new NCHomeConfigService(_context);
        this.oracleClientService = new OracleClientService(_context);

        // 注册刷新命令
        this._context.subscriptions.push(
            vscode.commands.registerCommand('yonbip.precastExportConfig.refresh', () => {
                this._refreshDataSources();
                this._prefillDefaultOutputDir();
            })
        );
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'selectOutputDir':
                        this._handleSelectOutputDir();
                        break;
                    case 'exportPrecast':
                        this._handleExportPrecast(message.data);
                        break;
                    case 'refreshDataSources':
                        this._refreshDataSources();
                        break;
                    case 'showMessage':
                        if (message.level === 'error') {
                            vscode.window.showErrorMessage(message.message);
                        } else {
                            vscode.window.showInformationMessage(message.message);
                        }
                        break;
                    case 'ready':
                        this._refreshDataSources();
                        this._prefillDefaultOutputDir();
                        break;
                }
            },
            undefined,
            this._context.subscriptions
        );
    }

    private async _handleSelectOutputDir(): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择输出目录'
        });
        if (result && result[0]) {
            this._view?.webview.postMessage({
                type: 'setOutputDir',
                path: result[0].fsPath
            });
        }
    }

    private _prefillDefaultOutputDir(): void {
        try {
            const defaultDir = this._resolveDefaultOutputDir();
            if (defaultDir) {
                this._view?.webview.postMessage({ type: 'setOutputDir', path: defaultDir });
            }
        } catch (e) {
            // ignore prefill errors
        }
    }

    private _resolveDefaultOutputDir(): string | undefined {
        // 优先使用用户选择的路径（来自工作区状态）
        const selectedPrecastPath: string | undefined = this._context.workspaceState.get('selectedPrecastPath');
        const firstSelected = selectedPrecastPath;
        if (firstSelected) {
            try {
                const stat = fs.existsSync(firstSelected) ? fs.statSync(firstSelected) : undefined;
                if (stat?.isFile()) return path.dirname(firstSelected);
                if (stat?.isDirectory()) return firstSelected;
            } catch {
                // fallthrough
            }
        }
        // 其次使用当前激活编辑器中的文件目录
        const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
        if (active && fs.existsSync(active)) {
            try {
                const stat = fs.statSync(active);
                if (stat.isFile()) return path.dirname(active);
            } catch {
                // ignore
            }
        }
        // 最后使用工作区根目录
        const root = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        return root;
    }

    private async _handleExportPrecast(data: any): Promise<void> {
        try {
            // 校验 HOME 配置
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            if (!config.homePath) {
                throw new Error('请先在"NC HOME配置"视图中设置 HOME 路径');
            }

            // 输出目录
            let outputDir = (data && data.outputDir) ? String(data.outputDir).trim() : '';
            if (!outputDir) {
                outputDir = this._resolveDefaultOutputDir() || '';
            }
            if (!outputDir) {
                throw new Error('未能确定输出目录，请手动选择输出目录');
            }
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            this._view?.webview.postMessage({ type: 'exportStarted', text: '准备导出...' });
            this._view?.webview.postMessage({ type: 'progress', percent: 5, text: '校验配置与输出目录' });
            this._view?.webview.postMessage({ type: 'showMessage', level: 'info', message: '正在读取 InitDataCfgs 并生成SQL...' });

            // 解析 InitDataCfgs XML 路径
            const xmlPaths = this._resolveInitCfgXmlPaths();
            if (xmlPaths.length === 0) {
                throw new Error('未找到 item.xml，请在资源管理器中右键选择该文件后再导出');
            }
            this._view?.webview.postMessage({ type: 'progress', percent: 10, text: `定位 InitDataCfgs 文件 (${xmlPaths.length} 个)` });

            // 解析所有XML，汇总条目
            const allItems: InitDataCfgItem[] = [];
            for (let i = 0; i < xmlPaths.length; i++) {
                const xmlPath = xmlPaths[i];
                this._view?.webview.postMessage({ 
                    type: 'progress', 
                    percent: 10 + Math.floor((i / xmlPaths.length) * 5), 
                    text: `解析文件 ${path.basename(xmlPath)}...` 
                });
                
                const items = await this._parseInitDataCfgs(xmlPath);
                if (items.length === 0) {
                    this._view?.webview.postMessage({ type: 'showMessage', level: 'warning', message: `文件 ${path.basename(xmlPath)} 未解析到条目` });
                }
                allItems.push(...items);
            }
            if (allItems.length === 0) {
                throw new Error('InitDataCfgs 中没有可处理的条目');
            }
            this._view?.webview.postMessage({ type: 'progress', percent: 20, text: `解析完成，共 ${allItems.length} 个条目` });

            // 选择数据源（优先 selectedDataSource，然后 baseDatabase，然后第一个）并解密密码
            const ds = this._pickAndSecureDataSource();
            if (!ds) {
                throw new Error('未找到有效的数据源，请先在"NC HOME配置"视图中配置数据源');
            }
            this._view?.webview.postMessage({ type: 'progress', percent: 25, text: `已选择数据源：${ds.name}` });
            
            // 向Webview发送当前使用的数据源信息
            this._view?.webview.postMessage({
                type: 'currentDataSource',
                dataSource: {
                    name: ds.name,
                    type: ds.databaseType,
                    host: ds.host,
                    port: ds.port,
                    database: ds.databaseName,
                    user: ds.username
                }
            });

            // 逐条生成SQL
            let sqlOutput = `-- 预置脚本导出
-- 数据源: ${ds.name} (${ds.databaseType}) ${ds.host}:${ds.port}/${ds.databaseName}
-- 导出时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

            let processed = 0;
            const total = allItems.length;
            
            this._view?.webview.postMessage({ 
                type: 'progress', 
                percent: 25, 
                text: `开始处理 ${total} 个表...` 
            });
            
            for (const item of allItems) {
                const table = item.tableName?.trim();
                const where = (item.whereCondition || '').trim();
                if (!table) { 
                    processed++;
                    continue; 
                }

                // 更新进度 - 表开始处理
                this._view?.webview.postMessage({ 
                    type: 'progress', 
                    percent: 25 + Math.floor(processed / total * 60), 
                    text: `处理表: ${table}...` 
                });

                // DELETE 语句（如果有 where 条件）
                if (where) {
                    sqlOutput += `-- 删除 ${table}\nDELETE FROM ${table} WHERE ${where};\n\n`;
                }

                // 查询并生成 INSERT
                const selectSql = `SELECT * FROM ${table}${where ? ' WHERE ' + where : ''}`;
                
                // 更新进度 - 正在查询数据
                this._view?.webview.postMessage({ 
                    type: 'progress', 
                    percent: 25 + Math.floor(processed / total * 60), 
                    text: `查询表 ${table} 数据...` 
                });
                
                const rows = await this._queryRows(ds, selectSql);
                if (!rows || rows.length === 0) {
                    sqlOutput += `-- ${table} 无匹配数据\n\n`;
                    processed++;
                    const percent = 25 + Math.floor(processed / total * 60);
                    this._view?.webview.postMessage({ type: 'progress', percent, text: `处理 ${table}（无数据）` });
                    continue;
                }

                // 更新进度 - 正在生成INSERT语句
                this._view?.webview.postMessage({ 
                    type: 'progress', 
                    percent: 25 + Math.floor(processed / total * 60), 
                    text: `生成 ${table} 的 ${rows.length} 行 INSERT 语句...` 
                });
                
                const inserts = this._generateInsertSql(ds.databaseType, table, rows);
                sqlOutput += `-- 插入 ${table} (${rows.length} 行)
${inserts.join("\n")}

`;

                processed++;
                const percent = 25 + Math.floor(processed / total * 60);
                this._view?.webview.postMessage({ type: 'progress', percent, text: `完成处理 ${table} (${rows.length} 行)` });
            }

            // 写入文件
            this._view?.webview.postMessage({ 
                type: 'progress', 
                percent: 90, 
                text: '正在写入文件...' 
            });
            
            const ts = this._formatTimestamp(new Date());
            const filePath = path.join(outputDir, `allsql_${ts}.sql`);
            fs.writeFileSync(filePath, sqlOutput, 'utf-8');

            this._view?.webview.postMessage({ type: 'progress', percent: 100, text: '导出完成' });
            this._view?.webview.postMessage({ type: 'exportFinished' });
            
            // 提供更详细的成功提示信息
            const fileName = path.basename(filePath);
            const fileDir = path.dirname(filePath);
            this._view?.webview.postMessage({ 
                type: 'showMessage', 
                level: 'success', 
                message: `预置脚本导出成功！\n文件名：${fileName}\n位置：${fileDir}` 
            });
            
            // 在VS Code中也显示通知
            vscode.window.showInformationMessage(
                `预置脚本导出成功！文件已保存到：${filePath}`, 
                '打开文件'
            ).then(selection => {
                if (selection === '打开文件') {
                    vscode.workspace.openTextDocument(filePath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'error',
                message: `导出失败: ${error.message || String(error)}`
            });
            this._view?.webview.postMessage({ type: 'exportFinished' });
        }
    }

    private _refreshDataSources(): void {
        try {
            this.configService.reloadConfig();
            const { dataSources } = this.configService.getPortFromPropXml();
            
            // 优先选择design数据源
            let selectedDataSource = dataSources.find(ds => ds.name === 'design');
            if (!selectedDataSource && dataSources.length > 0) {
                // 如果没有design数据源，使用第一个数据源
                selectedDataSource = dataSources[0];
            }
            
            // 向Webview发送当前使用的数据源信息
            if (selectedDataSource) {
                this._view?.webview.postMessage({
                    type: 'currentDataSource',
                    dataSource: {
                        name: selectedDataSource.name,
                        type: selectedDataSource.databaseType,
                        host: selectedDataSource.host,
                        port: selectedDataSource.port,
                        database: selectedDataSource.databaseName,
                        user: selectedDataSource.username
                    }
                });
            }
            
            const dsList = (dataSources || []).map(ds => ({
                name: ds.name,
                type: ds.databaseType,
                host: ds.host,
                port: ds.port,
                database: ds.databaseName,
                user: ds.username
            }));

            this._view?.webview.postMessage({
                type: 'dataSourcesUpdated',
                dataSources: dsList
            });
        } catch (error) {
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'error',
                message: `读取prop.xml失败: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = String(Date.now());

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>预置脚本导出</title>
<style>
    :root {
        --vscode-button-icon-dimmed: #cccccc;
        --vscode-input-background: #3c3c3c;
        --vscode-input-foreground: #cccccc;
        --vscode-input-border: #3c3c3c;
        --vscode-focusBorder: #007fd4;
        --vscode-list-hoverBackground: #2a2d2e;
        --vscode-list-activeSelectionBackground: #094771;
        --vscode-list-activeSelectionForeground: #ffffff;
    }
    
    body { 
        font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; 
        color: var(--vscode-editor-foreground); 
        background: var(--vscode-editor-background); 
        margin: 0;
        padding: 0;
        font-size: 13px;
        overflow-x: hidden; /* 防止水平滚动 */
    }
    
    .container { 
        padding: 16px; 
        max-width: 800px;
        margin: 0 auto;
        box-sizing: border-box; /* 确保padding包含在width内 */
    }
    
    h2 { 
        margin: 0; 
        font-size: 16px; 
        font-weight: 600;
        color: var(--vscode-foreground);
        line-height: 1.5;
        word-wrap: break-word; /* 允许标题换行 */
    }
    
    .card { 
        border: 1px solid var(--vscode-editorWidget-border); 
        border-radius: 5px; 
        padding: 16px; 
        margin-bottom: 16px; 
        background: var(--vscode-editorWidget-background);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        box-sizing: border-box; /* 确保padding和border包含在width内 */
    }
    
    .card-header {
        display: flex;
        align-items: center;
        margin-bottom: 12px;
        word-wrap: break-word; /* 允许标题换行 */
    }
    
    .card-icon {
        margin-right: 8px;
        color: var(--vscode-textLink-foreground);
        font-size: 16px;
        line-height: 1;
        display: flex;
        align-items: center;
        height: 20px;
        flex-shrink: 0; /* 防止图标被压缩 */
    }
    
    .section-description {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        margin-bottom: 16px;
        line-height: 1.4;
        word-wrap: break-word; /* 允许描述换行 */
    }
    
    .row { 
        display: flex; 
        align-items: center; 
        gap: 8px; 
        margin-bottom: 12px; 
        flex-wrap: wrap; /* 允许换行 */
    }
    
    .form-group {
        display: flex;
        flex-direction: column;
        width: 100%;
        margin-bottom: 12px;
        box-sizing: border-box; /* 确保padding包含在width内 */
    }
    
    .form-group label {
        margin-bottom: 4px;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        word-wrap: break-word; /* 允许标签换行 */
    }
    
    .path-input-container {
        position: relative;
        display: flex;
        align-items: center;
        width: 100%;
        box-sizing: border-box; /* 确保padding包含在width内 */
    }
    
    .path-input-icon {
        position: absolute;
        right: 8px;
        color: var(--vscode-descriptionForeground);
        pointer-events: none;
        z-index: 1;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    input[type="text"] {
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        color: var(--vscode-input-foreground);
        padding: 6px 30px 6px 8px;
        border-radius: 2px;
        font-size: 13px;
        width: 100%;
        cursor: pointer;
        box-sizing: border-box; /* 确保padding包含在width内 */
    }
    
    input[type="text"]:focus {
        outline: 1px solid var(--vscode-focusBorder);
    }
    
    .btn { 
        cursor: pointer; 
        padding: 6px 14px; 
        border: 1px solid var(--vscode-button-border); 
        border-radius: 2px; 
        background: var(--vscode-button-background); 
        color: var(--vscode-button-foreground); 
        font-size: 13px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap; /* 防止文字换行 */
        flex-shrink: 0; /* 防止按钮被压缩 */
        max-width: 100%; /* 防止按钮超出容器 */
    }
    
    .btn:hover {
        background: var(--vscode-button-hoverBackground);
    }
    
    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    
    .btn-icon {
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0; /* 防止图标被压缩 */
    }
    
    table { 
        width: 100%; 
        border-collapse: collapse; 
        margin-top: 8px;
        table-layout: fixed; /* 固定表格布局 */
    }
    
    th { 
        text-align: left; 
        color: var(--vscode-foreground); 
        font-weight: 600;
        font-size: 12px;
        padding: 8px 6px;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        word-wrap: break-word; /* 允许表头换行 */
    }
    
    td { 
        padding: 6px; 
        font-size: 12px; 
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        word-wrap: break-word; /* 允许单元格内容换行 */
        overflow-wrap: break-word; /* 确保长单词也能换行 */
    }
    
    tr:hover {
        background-color: var(--vscode-list-hoverBackground);
    }
    
    .muted { 
        color: var(--vscode-descriptionForeground); 
        font-size: 12px;
        word-wrap: break-word; /* 允许静默文本换行 */
    }
    
    .progress-container {
        width: 100%;
        margin-top: 8px;
        box-sizing: border-box; /* 确保padding包含在width内 */
    }
    
    progress {
        width: 100%;
        height: 4px;
    }
    
    .progress-text {
        font-size: 12px;
        margin-top: 4px;
        min-height: 18px;
        word-wrap: break-word; /* 允许长文本换行 */
        overflow-wrap: break-word; /* 确保长单词也能换行 */
        white-space: pre-wrap; /* 保持空白符序列，但正常换行 */
    }
    
    .status-bar {
        display: flex;
        align-items: flex-start; /* 顶部对齐 */
        gap: 8px;
        margin-top: 8px;
        width: 100%;
        box-sizing: border-box; /* 确保padding包含在width内 */
    }
    
    .icon {
        font-size: 14px;
        width: 16px;
        text-align: center;
        display: flex;
        align-items: center;
        height: 16px;
        flex-shrink: 0; /* 防止图标被压缩 */
        align-self: flex-start; /* 顶部对齐 */
    }
    
    .status-text {
        flex: 1; /* 占据剩余空间 */
        word-wrap: break-word; /* 允许状态文本换行 */
        overflow-wrap: break-word; /* 确保长单词也能换行 */
        white-space: pre-wrap; /* 保持空白符序列，但正常换行 */
    }
    
    .success {
        color: #89d185;
    }
    
    .error {
        color: #f48771;
    }
    
    .info {
        color: #75beff;
    }
    
    /* 响应式设计 */
    @media (max-width: 600px) {
        .container {
            padding: 12px;
        }
        
        .card {
            padding: 12px;
        }
        
        .btn {
            padding: 6px 10px;
            font-size: 12px;
        }
        
        h2, .section-description, .muted, .progress-text, .status-text {
            font-size: 12px; /* 在小屏幕上减小字体 */
        }
    }
</style>
</head>
<body>
<div class="container">
    <div class="card">
        <div class="card-header">
            <span class="card-icon">📁</span>
            <h2>输出目录</h2>
        </div>
        <p class="section-description">选择预置脚本导出的目标目录</p>
        <div class="form-group">
            <div class="path-input-container">
                <input id="outputDir" type="text" placeholder="点击选择导出目录" readonly />
                <span class="path-input-icon">📁</span>
            </div>
        </div>
    </div>

    <div class="card">
        <div class="card-header">
            <span class="card-icon">💾</span>
            <h2>当前数据源</h2>
        </div>
        <p class="section-description">导出预置脚本时将默认使用Design数据源</p>
        <div style="overflow-x: auto;">
            <table>
                <thead>
                    <tr>
                        <th>名称</th>
                        <th>类型</th>
                        <th>主机</th>
                        <th>端口</th>
                        <th>库名</th>
                        <th>用户</th>
                    </tr>
                </thead>
                <tbody id="currentDsBody">
                    <tr>
                        <td colspan="6" class="muted" style="text-align: center; padding: 16px;">暂无数据源信息</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div class="card">
        <div class="card-header">
            <span class="card-icon">📤</span>
            <h2>导出预置脚本</h2>
        </div>
        <p class="section-description">根据选中的 item.xml 文件生成预置脚本 SQL 文件</p>
        <div class="row">
            <button class="btn" id="exportBtn">
                <span class="btn-icon">🚀</span>
                开始导出
            </button>
        </div>
        <div class="progress-container" id="progressContainer" style="display:none">
            <progress id="progressBar" value="0" max="100"></progress>
            <div class="progress-text" id="progressText"></div>
        </div>
        <div class="status-bar" id="statusBar" style="display:none">
            <span id="statusIcon" class="icon"></span>
            <span id="statusText" class="status-text"></span>
        </div>
    </div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const outputDirInput = document.getElementById('outputDir');
const exportBtn = document.getElementById('exportBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const statusBar = document.getElementById('statusBar');
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const currentDsBody = document.getElementById('currentDsBody');

function setExporting(is) {
    exportBtn.disabled = is;
    progressContainer.style.display = is ? 'block' : 'none';
    statusBar.style.display = 'none';
    if (!is) {
        progressBar.value = 0;
        progressText.textContent = '';
    }
}

function renderCurrentDataSource(ds) {
    if (!ds) {
        currentDsBody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align: center; padding: 16px;">暂无数据源信息</td></tr>';
        return;
    }
    
    currentDsBody.innerHTML = '<tr>' +
        '<td>' + (ds.name || '') + '</td>' +
        '<td>' + (ds.type || '') + '</td>' +
        '<td>' + (ds.host || '') + '</td>' +
        '<td>' + (ds.port || '') + '</td>' +
        '<td>' + (ds.database || '') + '</td>' +
        '<td>' + (ds.user || '') + '</td>' +
    '</tr>';
}

function showStatus(message, type) {
    statusBar.style.display = 'flex';
    statusText.textContent = message;
    
    switch (type) {
        case 'success':
            statusIcon.textContent = '✓';
            statusIcon.className = 'icon success';
            statusText.className = 'status-text success';
            break;
        case 'error':
            statusIcon.textContent = '✗';
            statusIcon.className = 'icon error';
            statusText.className = 'status-text error';
            break;
        case 'info':
            statusIcon.textContent = 'ℹ';
            statusIcon.className = 'icon info';
            statusText.className = 'status-text info';
            break;
        default:
            statusIcon.textContent = '';
            statusIcon.className = 'icon';
            statusText.className = 'status-text';
    }
}

window.addEventListener('message', (event) => {
    const msg = event.data || {};
    switch (msg.type) {
        case 'setOutputDir':
            outputDirInput.value = msg.path || '';
            break;
        case 'currentDataSource':
            renderCurrentDataSource(msg.dataSource);
            break;
        case 'exportStarted':
            setExporting(true);
            progressBar.value = 0;
            progressText.textContent = msg.text || '开始导出...';
            break;
        case 'progress':
            if (typeof msg.percent === 'number') {
                var p = Math.max(0, Math.min(100, Math.floor(msg.percent)));
                progressBar.value = p;
            }
            progressText.textContent = msg.text || '';
            break;
        case 'exportFinished':
            setExporting(false);
            showStatus('导出完成', 'success');
            break;
        case 'showMessage':
            if (msg.level === 'error') {
                showStatus(msg.message, 'error');
            } else if (msg.level === 'success') {
                showStatus(msg.message, 'success');
            } else {
                showStatus(msg.message, 'info');
            }
            break;
        case 'dataSourcesUpdated':
            // 处理数据源更新消息，刷新当前数据源显示
            if (msg.dataSources && msg.dataSources.length > 0) {
                // 优先选择design数据源
                let selectedDataSource = msg.dataSources.find(ds => ds.name === 'design');
                if (!selectedDataSource) {
                    // 如果没有design数据源，使用第一个数据源
                    selectedDataSource = msg.dataSources[0];
                }
                renderCurrentDataSource(selectedDataSource);
            } else {
                renderCurrentDataSource(null);
            }
            break;
    }
});

// 事件绑定
outputDirInput.addEventListener('click', () => {
    vscode.postMessage({ type: 'selectOutputDir' });
});
exportBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'exportPrecast', data: { outputDir: outputDirInput.value } });
});

// 初始握手，触发默认目录预填
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }

    // === 业务逻辑：InitDataCfgs解析 & SQL生成 ===

    private _resolveInitCfgXmlPaths(): string[] {
        const res: string[] = [];
        const selectedPrecastPath: string | undefined = this._context.workspaceState.get('selectedPrecastPath');
        const candidates: string[] = [];
        if (selectedPrecastPath) candidates.push(selectedPrecastPath);
        
        if (candidates.length === 0) {
            const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
            if (active) candidates.push(active);
        }
        
        const pushIfItemXml = (p: string) => {
            if (fs.existsSync(p)) {
                const stat = fs.statSync(p);
                if (stat.isFile()) {
                    // 仅当文件名为 item.xml 或 items.xml 时加入
                    const name = path.basename(p).toLowerCase();
                    if (name === 'item.xml' || name === 'items.xml') res.push(p);
                } else if (stat.isDirectory()) {
                    // 在目录内优先查找 item.xml / items.xml
                    const files = fs.readdirSync(p).map(f => f.toLowerCase());
                    const itemXml = files.find(f => f === 'item.xml') || files.find(f => f === 'items.xml');
                    if (itemXml) {
                        res.push(path.join(p, itemXml));
                    }
                }
            }
        };

        if (candidates.length > 0) {
            candidates.forEach(p => pushIfItemXml(p));
        } else {
            // 尝试使用当前激活文件
            const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
            if (active && fs.existsSync(active)) {
                const stat = fs.statSync(active);
                if (stat.isFile()) {
                    const name = path.basename(active).toLowerCase();
                    if (name === 'item.xml' || name === 'items.xml') {
                        res.push(active);
                    } else {
                        pushIfItemXml(path.dirname(active));
                    }
                }
            }
        }
        return res;
    }

    private async _parseInitDataCfgs(xmlPath: string): Promise<InitDataCfgItem[]> {
        try {
            const buf = fs.readFileSync(xmlPath);
            let content = buf.toString('utf-8');
            if (/encoding\s*=\s*"gb2312"|encoding\s*=\s*"gbk"/i.test(content)) {
                content = iconv.decode(buf, 'gb2312');
            }
            const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, trim: true });
            const obj = await parser.parseStringPromise(content);

            // 优先识别 SDP_SCRIPT_ITEM 结构
            const itemsNode = obj?.items;
            const docType = itemsNode?.$?.docType || itemsNode?.docType;
            let rawItems: any[] = [];
            if ((docType || '').toString().toUpperCase() === 'SDP_SCRIPT_ITEM') {
                const it = itemsNode?.item;
                if (Array.isArray(it)) rawItems = it; else if (it) rawItems = [it];
            }

            // 如果不是 SDP_SCRIPT_ITEM，则回退到旧的InitDataCfgs解析
            if (rawItems.length === 0) {
                const candidates: any[] = [];
                const tryPush = (arr: any) => {
                    if (!arr) return;
                    if (Array.isArray(arr)) candidates.push(...arr);
                    else candidates.push(arr);
                };
                tryPush(obj?.InitDataCfgs?.item);
                tryPush(obj?.InitDataCfgs?.InitDataCfg);
                tryPush(obj?.items?.item);
                tryPush(obj?.InitDataCfgs?.items?.item);
                tryPush(obj?.root?.items?.item);
                rawItems = candidates;
            }

            const items: InitDataCfgItem[] = [];
            for (const it of rawItems) {
                // item.xml 映射：itemRule -> tableName, fixedWhere -> whereCondition
                const tableName = it?.itemRule || it?.tableName || it?.table || it?.TableName;
                const where = it?.fixedWhere || it?.whereCondition || it?.where || it?.WhereCondition;
                const itemKey = it?.itemKey || it?.ItemKey;
                if (tableName) {
                    items.push({
                        itemKey: itemKey ? String(itemKey) : undefined,
                        tableName: String(tableName),
                        whereCondition: where ? String(where).trim() : undefined,
                        corpField: it?.corpField || it?.CorpField,
                        grpField: it?.grpField || it?.GrpField,
                        sysField: it?.sysField || it?.SysField
                    });
                }
            }
            return items;
        } catch (e: any) {
            vscode.window.showWarningMessage(`解析 ${path.basename(xmlPath)} 失败: ${e.message || String(e)}`);
            return [];
        }
    }

    private _pickAndSecureDataSource(): DataSourceMeta | undefined {
        const cfg = this.configService.getConfig();
        const { dataSources } = this.configService.getPortFromPropXml();
        
        // 优先选择design数据源，如果没有则按原来逻辑选择
        let ds = dataSources.find(d => d.name === 'design');
        if (!ds) {
            const namePref = cfg.selectedDataSource || cfg.baseDatabase || 'design';
            ds = dataSources.find(d => d.name === namePref);
        }
        if (!ds && dataSources.length > 0) ds = dataSources[0];
        if (!ds) return undefined;
        ds.password = PasswordEncryptor.getSecurePassword(cfg.homePath, ds.password || '');
        return ds;
    }

    private async _queryRows(ds: DataSourceMeta, sql: string): Promise<Array<Record<string, any>>> {
        const type = (ds.databaseType || '').toLowerCase();
        if (['mysql', 'mysql5', 'mysql8'].includes(type)) {
            const mysql = await import('mysql2/promise');
            const conn = await mysql.createConnection({ host: ds.host, port: ds.port, user: ds.username, password: ds.password || '', database: ds.databaseName, connectTimeout: 10000 });
            const [rows] = await conn.execute(sql);
            await conn.end();
            return rows as any[];
        }
        if (['postgresql', 'pg'].includes(type)) {
            const pg = await import('pg');
            const client = new pg.Client({ host: ds.host, port: ds.port, user: ds.username, password: ds.password || '', database: ds.databaseName, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(sql);
            await client.end();
            return result.rows as any[];
        }
        if (['sqlserver', 'mssql'].includes(type)) {
            const mssql = await import('mssql');
            const pool = await mssql.connect({ user: ds.username, password: ds.password || '', server: ds.host, port: ds.port, database: ds.databaseName, options: { trustServerCertificate: true, enableArithAbort: true } });
            const result = await pool.request().query(sql);
            await pool.close();
            return result.recordset as any[];
        }
        if (type.startsWith('oracle')) {
            const oracledb = await import('oracledb');
            
            // 优先初始化Thick模式（若已安装Instant Client）
            try {
                const clientCheck = await this.oracleClientService.checkOracleClientInstalled();
                if (clientCheck.installed && clientCheck.path && !oracledb.oracleClientVersion) {
                    oracledb.initOracleClient({ libDir: clientCheck.path });
                } else if (!clientCheck.installed && !oracledb.oracleClientVersion) {
                    // 尝试默认初始化（依赖环境变量），失败则继续Thin模式尝试
                    try { oracledb.initOracleClient(); } catch (e) { /* ignore */ }
                }
            } catch (e: any) {
                console.warn('Oracle Thick模式初始化检查失败:', e?.message || String(e));
            }
            
            // 兼容初始化（复制NCHomeConfigService逻辑的简化版）
            try {
                // 检查是否已经初始化过Oracle客户端
                // 修复NJS-090错误：在调用initOracleClient前检查oracleClientVersion是否存在
                if (!oracledb.oracleClientVersion) {
                    try { 
                        oracledb.initOracleClient(); 
                    } catch (initError: any) {
                        console.warn('Oracle客户端初始化失败:', initError.message);
                        // 即使初始化失败，仍然尝试连接，因为可能是Thin模式
                    }
                }
            } catch (initError: any) { 
                console.warn('检查Oracle客户端版本失败:', initError.message);
                // 忽略检查错误，继续尝试连接
            }
            
            // 尝试多种连接格式来解决NJS-138错误
            const connectionFormats = [
                `${ds.host}:${ds.port}/${ds.databaseName}`,  // 服务名格式
                `${ds.host}:${ds.port}:${ds.databaseName}`,  // SID格式
                `${ds.host}/${ds.databaseName}`              // 简化格式
            ];
            
            let connection;
            let lastError;
            
            // 首先尝试默认的Thin模式连接
            try {
                const connectString = `${ds.host}:${ds.port}/${ds.databaseName}`;
                connection = await oracledb.getConnection({ 
                    user: ds.username, 
                    password: ds.password || '', 
                    connectString 
                });
            } catch (error: any) {
                lastError = error;
                
                // 如果是NJS-138错误或版本兼容性问题，尝试 Thick 模式
                if (error.message.includes('NJS-138') || 
                    error.message.includes('Thin mode') || 
                    error.message.includes('version')) {
                    
                    // 尝试初始化Thick模式
                    try {
                        if (!oracledb.oracleClientVersion) {
                            oracledb.initOracleClient();
                        }
                    } catch (thickInitError: any) {
                        console.warn('Oracle Thick模式初始化失败:', thickInitError.message);
                    }
                    
                    // 尝试不同的连接格式
                    for (const connectString of connectionFormats) {
                        try {
                            connection = await oracledb.getConnection({ 
                                user: ds.username, 
                                password: ds.password || '', 
                                connectString 
                            });
                            // 如果连接成功，跳出循环
                            break;
                        } catch (formatError: any) {
                            lastError = formatError;
                            continue;
                        }
                    }
                }
            }
            
            // 如果所有连接尝试都失败了，抛出错误
            if (!connection) {
                throw new Error(`Oracle数据库连接失败: ${lastError?.message || '未知错误'}

可能的解决方案:
1. 检查Oracle Instant Client是否已安装
2. 确认数据库版本兼容性
3. 尝试不同的连接格式`);
            }
            
            const result = await connection.execute(sql);
            await connection.close();
            const meta = (result as any).metaData || [];
            const colNames = meta.map((m: any) => m.name);
            const rows: Array<Record<string, any>> = [];
            ((result as any).rows || []).forEach((arr: any[]) => {
                const obj: Record<string, any> = {};
                arr.forEach((v, i) => { obj[colNames[i]] = v; });
                rows.push(obj);
            });
            return rows;
        }
        throw new Error(`不支持的数据库类型: ${ds.databaseType}`);
    }

    private _generateInsertSql(dbType: string, table: string, rows: Array<Record<string, any>>): string[] {
        const type = (dbType || '').toLowerCase();
        const escapeStr = (val: any): string => {
            if (val === null || val === undefined) return 'NULL';
            if (val instanceof Date) {
                const yyyy = val.getFullYear();
                const mm = String(val.getMonth() + 1).padStart(2, '0');
                const dd = String(val.getDate()).padStart(2, '0');
                const hh = String(val.getHours()).padStart(2, '0');
                const mi = String(val.getMinutes()).padStart(2, '0');
                const ss = String(val.getSeconds()).padStart(2, '0');
                return `'${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}'`;
            }
            if (Buffer.isBuffer(val)) {
                const hex = val.toString('hex');
                if (['sqlserver', 'mssql'].includes(type)) return `0x${hex}`;
                return `'\\x${hex}'`;
            }
            if (typeof val === 'number') return String(val);
            const s = String(val).replace(/'/g, "''");
            return `'${s}'`;
        };

        const sqls: string[] = [];
        for (const row of rows) {
            const cols = Object.keys(row);
            const vals = cols.map(c => escapeStr(row[c]));
            sqls.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
        }
        return sqls;
    }

    private _formatTimestamp(d: Date): string {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
    }
}

// 类型定义
interface InitDataCfgItem {
    itemKey?: string;
    tableName: string;
    whereCondition?: string;
    corpField?: string;
    grpField?: string;
    sysField?: string;
}