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
exports.PrecastExportWebviewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const iconv = __importStar(require("iconv-lite"));
const NCHomeConfigService_1 = require("../../home/config/NCHomeConfigService");
const PasswordEncryptor_1 = require("../../../shared/utils/PasswordEncryptor");
const OracleClientService_1 = require("../../home/OracleClientService");
const xml2js = require('xml2js');
class PrecastExportWebviewProvider {
    _extensionUri;
    _context;
    static viewType = 'yonbip.precastExportConfig';
    _view;
    configService;
    oracleClientService;
    constructor(_extensionUri, _context) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this.configService = new NCHomeConfigService_1.NCHomeConfigService(_context);
        this.oracleClientService = new OracleClientService_1.OracleClientService(_context);
        this._context.subscriptions.push(vscode.commands.registerCommand('yonbip.precastExportConfig.refresh', () => {
            this._refreshDataSources();
            this._prefillDefaultOutputDir();
        }));
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(message => {
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
                    }
                    else {
                        vscode.window.showInformationMessage(message.message);
                    }
                    break;
                case 'ready':
                    this._refreshDataSources();
                    this._prefillDefaultOutputDir();
                    break;
            }
        }, undefined, this._context.subscriptions);
    }
    async _handleSelectOutputDir() {
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
    _prefillDefaultOutputDir() {
        try {
            const defaultDir = this._resolveDefaultOutputDir();
            if (defaultDir) {
                this._view?.webview.postMessage({ type: 'setOutputDir', path: defaultDir });
            }
        }
        catch (e) {
        }
    }
    _resolveDefaultOutputDir() {
        const selectedPrecastPath = this._context.workspaceState.get('selectedPrecastPath');
        const firstSelected = selectedPrecastPath;
        if (firstSelected) {
            try {
                const stat = fs.existsSync(firstSelected) ? fs.statSync(firstSelected) : undefined;
                if (stat?.isFile())
                    return path.dirname(firstSelected);
                if (stat?.isDirectory())
                    return firstSelected;
            }
            catch {
            }
        }
        const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
        if (active && fs.existsSync(active)) {
            try {
                const stat = fs.statSync(active);
                if (stat.isFile())
                    return path.dirname(active);
            }
            catch {
            }
        }
        const root = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
        return root;
    }
    async _handleExportPrecast(data) {
        try {
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            if (!config.homePath) {
                throw new Error('请先在"NC HOME配置"视图中设置 HOME 路径');
            }
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
            const xmlPaths = this._resolveInitCfgXmlPaths();
            if (xmlPaths.length === 0) {
                throw new Error('未找到 item.xml，请在资源管理器中右键选择该文件后再导出');
            }
            this._view?.webview.postMessage({ type: 'progress', percent: 10, text: `定位 InitDataCfgs 文件 (${xmlPaths.length} 个)` });
            const allItems = [];
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
            const ds = this._pickAndSecureDataSource();
            if (!ds) {
                throw new Error('未找到有效的数据源，请先在"NC HOME配置"视图中配置数据源');
            }
            this._view?.webview.postMessage({ type: 'progress', percent: 25, text: `已选择数据源：${ds.name}` });
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
                this._view?.webview.postMessage({
                    type: 'progress',
                    percent: 25 + Math.floor(processed / total * 60),
                    text: `处理表: ${table}...`
                });
                if (where) {
                    sqlOutput += `-- 删除 ${table}\nDELETE FROM ${table} WHERE ${where};\n\n`;
                }
                const selectSql = `SELECT * FROM ${table}${where ? ' WHERE ' + where : ''}`;
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
            const fileName = path.basename(filePath);
            const fileDir = path.dirname(filePath);
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'success',
                message: `预置脚本导出成功！\n文件名：${fileName}\n位置：${fileDir}`
            });
            vscode.window.showInformationMessage(`预置脚本导出成功！文件已保存到：${filePath}`, '打开文件').then(selection => {
                if (selection === '打开文件') {
                    vscode.workspace.openTextDocument(filePath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        }
        catch (error) {
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'error',
                message: `导出失败: ${error.message || String(error)}`
            });
            this._view?.webview.postMessage({ type: 'exportFinished' });
        }
    }
    _refreshDataSources() {
        try {
            this.configService.reloadConfig();
            const { dataSources } = this.configService.getPortFromPropXml();
            let selectedDataSource = dataSources.find(ds => ds.name === 'design');
            if (!selectedDataSource && dataSources.length > 0) {
                selectedDataSource = dataSources[0];
            }
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
        }
        catch (error) {
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'error',
                message: `读取prop.xml失败: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }
    _getHtmlForWebview(webview) {
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
        --vscode-badge-background: #4d4d4d;
        --vscode-badge-foreground: #ffffff;
        --success-color: #89d185;
        --error-color: #f48771;
        --warning-color: #cca700;
        --info-color: #75beff;
        --border-radius: 8px;
        --box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
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
    
    .container { 
        max-width: 100%;
        padding: 24px 24px 120px 24px;
        background-color: var(--vscode-editor-background);
        border-radius: 12px;
        margin: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        border: 1px solid var(--vscode-widget-border);
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
        border-radius: var(--border-radius); 
        padding: 24px; 
        margin-bottom: 24px; 
        background: var(--vscode-editorWidget-background);
        box-shadow: var(--box-shadow);
        transition: var(--transition);
    }
    
    .card:hover {
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        transform: translateY(-2px);
    }
    
    .card-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
    }
    
    .card-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--vscode-foreground);
    }
    
    .card-icon {
        font-size: 20px;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: 8px;
        flex-shrink: 0;
    }
    
    .section-description {
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        margin: 0 0 20px 0;
        line-height: 1.5;
    }
    
    .row { 
        display: flex; 
        align-items: center; 
        gap: 16px; 
        margin-top: 24px;
        flex-wrap: wrap;
    }
    
    .form-group {
        display: flex;
        flex-direction: column;
        width: 100%;
        margin-bottom: 24px;
    }
    
    .form-group label {
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--vscode-input-foreground);
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
        width: 100%;
        padding: 12px 16px;
        border: 2px solid var(--vscode-input-border);
        background-color: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border-radius: 8px;
        font-size: 14px;
        transition: var(--transition);
        outline: none;
    }
    
    input[type="text"]:focus {
        border-color: var(--vscode-focusBorder);
        box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
        transform: translateY(-1px);
    }
    
    input[type="text"]:hover:not(:focus) {
        border-color: var(--vscode-inputOption-hoverBackground);
    }
    
    .btn { 
        padding: 14px 28px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        position: relative;
        overflow: hidden;
        min-width: 120px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: var(--transition);
        box-shadow: 0 4px 16px rgba(0, 122, 255, 0.3);
    }
    
    .btn::before {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
        transition: left 0.5s;
    }
    
    .btn:hover::before {
        left: 100%;
    }
    
    .btn-primary {
        background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
        color: var(--vscode-button-foreground);
        box-shadow: 0 4px 16px rgba(0, 122, 255, 0.3);
    }
    
    .btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, var(--vscode-button-hoverBackground) 0%, var(--vscode-button-background) 100%);
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 122, 255, 0.4);
    }
    
    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
        box-shadow: none !important;
    }
    
    .btn-primary:disabled {
        background: var(--vscode-button-background) !important;
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
        margin-top: 16px;
        background-color: var(--vscode-input-background);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    th { 
        text-align: left; 
        color: var(--vscode-foreground); 
        font-weight: 600;
        font-size: 13px;
        padding: 12px 16px;
        background-color: var(--vscode-button-background);
        border-bottom: 1px solid var(--vscode-editorWidget-border);
    }
    
    td { 
        padding: 12px 16px; 
        font-size: 13px; 
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        background-color: var(--vscode-editorWidget-background);
    }
    
    tr:last-child td {
        border-bottom: none;
    }
    tr:hover td {
        background-color: var(--vscode-list-hoverBackground);
    }
    
    .muted { 
        color: var(--vscode-descriptionForeground); 
        font-size: 13px;
        text-align: center;
        padding: 24px;
    }
    
    .progress-container {
        width: 100%;
        margin-top: 24px;
        padding: 20px;
        background-color: var(--vscode-input-background);
        border-radius: 8px;
        border: 1px solid var(--vscode-input-border);
    }
    
    progress {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        background: var(--vscode-input-background);
        border: none;
        overflow: hidden;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    
    progress::-webkit-progress-bar {
        background: var(--vscode-input-background);
        border-radius: 4px;
    }
    
    progress::-webkit-progress-value {
        background: linear-gradient(90deg, var(--vscode-button-background), var(--vscode-button-hoverBackground));
        border-radius: 4px;
        transition: width 0.3s ease;
    }
    
    .progress-text {
        font-size: 13px;
        margin-top: 12px;
        min-height: 20px;
        color: var(--vscode-descriptionForeground);
        font-family: monospace;
        text-align: center;
    }
    
    .status-bar {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-top: 24px;
        padding: 20px;
        border-radius: 8px;
        font-size: 14px;
        display: none;
        animation: fadeIn 0.3s ease;
        border: 1px solid;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    .status-bar.success {
        background: linear-gradient(135deg, rgba(137, 209, 133, 0.15) 0%, rgba(76, 175, 80, 0.1) 100%);
        border-color: rgba(137, 209, 133, 0.3);
        color: var(--success-color);
    }
    
    .status-bar.error {
        background: linear-gradient(135deg, rgba(244, 135, 113, 0.15) 0%, rgba(244, 67, 54, 0.1) 100%);
        border-color: rgba(244, 135, 113, 0.3);
        color: var(--error-color);
    }
    
    .status-bar.warning {
        background: linear-gradient(135deg, rgba(204, 167, 0, 0.15) 0%, rgba(255, 193, 7, 0.1) 100%);
        border-color: rgba(204, 167, 0, 0.3);
        color: var(--warning-color);
    }
    
    .status-bar.info {
        background: linear-gradient(135deg, rgba(117, 190, 255, 0.15) 0%, rgba(33, 150, 243, 0.1) 100%);
        border-color: rgba(117, 190, 255, 0.3);
        color: var(--info-color);
    }
    
    .icon {
        font-size: 20px;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        align-self: flex-start;
    }
    
    .status-text {
        flex: 1;
        word-break: break-word;
        line-height: 1.5;
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
    _resolveInitCfgXmlPaths() {
        const res = [];
        const selectedPrecastPath = this._context.workspaceState.get('selectedPrecastPath');
        const candidates = [];
        if (selectedPrecastPath)
            candidates.push(selectedPrecastPath);
        if (candidates.length === 0) {
            const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
            if (active)
                candidates.push(active);
        }
        const pushIfItemXml = (p) => {
            if (fs.existsSync(p)) {
                const stat = fs.statSync(p);
                if (stat.isFile()) {
                    const name = path.basename(p).toLowerCase();
                    if (name === 'item.xml' || name === 'items.xml')
                        res.push(p);
                }
                else if (stat.isDirectory()) {
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
        }
        else {
            const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
            if (active && fs.existsSync(active)) {
                const stat = fs.statSync(active);
                if (stat.isFile()) {
                    const name = path.basename(active).toLowerCase();
                    if (name === 'item.xml' || name === 'items.xml') {
                        res.push(active);
                    }
                    else {
                        pushIfItemXml(path.dirname(active));
                    }
                }
            }
        }
        return res;
    }
    async _parseInitDataCfgs(xmlPath) {
        try {
            const buf = fs.readFileSync(xmlPath);
            let content = buf.toString('utf-8');
            if (/encoding\s*=\s*"gb2312"|encoding\s*=\s*"gbk"/i.test(content)) {
                content = iconv.decode(buf, 'gb2312');
            }
            const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, trim: true });
            const obj = await parser.parseStringPromise(content);
            const itemsNode = obj?.items;
            const docType = itemsNode?.$?.docType || itemsNode?.docType;
            let rawItems = [];
            if ((docType || '').toString().toUpperCase() === 'SDP_SCRIPT_ITEM') {
                const it = itemsNode?.item;
                if (Array.isArray(it))
                    rawItems = it;
                else if (it)
                    rawItems = [it];
            }
            if (rawItems.length === 0) {
                const candidates = [];
                const tryPush = (arr) => {
                    if (!arr)
                        return;
                    if (Array.isArray(arr))
                        candidates.push(...arr);
                    else
                        candidates.push(arr);
                };
                tryPush(obj?.InitDataCfgs?.item);
                tryPush(obj?.InitDataCfgs?.InitDataCfg);
                tryPush(obj?.items?.item);
                tryPush(obj?.InitDataCfgs?.items?.item);
                tryPush(obj?.root?.items?.item);
                rawItems = candidates;
            }
            const items = [];
            for (const it of rawItems) {
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
        }
        catch (e) {
            vscode.window.showWarningMessage(`解析 ${path.basename(xmlPath)} 失败: ${e.message || String(e)}`);
            return [];
        }
    }
    _pickAndSecureDataSource() {
        const cfg = this.configService.getConfig();
        const { dataSources } = this.configService.getPortFromPropXml();
        let ds = dataSources.find(d => d.name === 'design');
        if (!ds) {
            const namePref = cfg.selectedDataSource || cfg.baseDatabase || 'design';
            ds = dataSources.find(d => d.name === namePref);
        }
        if (!ds && dataSources.length > 0)
            ds = dataSources[0];
        if (!ds)
            return undefined;
        ds.password = PasswordEncryptor_1.PasswordEncryptor.getSecurePassword(cfg.homePath, ds.password || '');
        return ds;
    }
    async _queryRows(ds, sql) {
        const type = (ds.databaseType || '').toLowerCase();
        if (['mysql', 'mysql5', 'mysql8'].includes(type)) {
            const mysql = await Promise.resolve().then(() => __importStar(require('mysql2/promise')));
            const conn = await mysql.createConnection({ host: ds.host, port: ds.port, user: ds.username, password: ds.password || '', database: ds.databaseName, connectTimeout: 10000 });
            const [rows] = await conn.execute(sql);
            await conn.end();
            return rows;
        }
        if (['postgresql', 'pg'].includes(type)) {
            const pg = await Promise.resolve().then(() => __importStar(require('pg')));
            const client = new pg.Client({ host: ds.host, port: ds.port, user: ds.username, password: ds.password || '', database: ds.databaseName, connectionTimeoutMillis: 10000 });
            await client.connect();
            const result = await client.query(sql);
            await client.end();
            return result.rows;
        }
        if (['sqlserver', 'mssql'].includes(type)) {
            const mssql = await Promise.resolve().then(() => __importStar(require('mssql')));
            const pool = await mssql.connect({ user: ds.username, password: ds.password || '', server: ds.host, port: ds.port, database: ds.databaseName, options: { trustServerCertificate: true, enableArithAbort: true } });
            const result = await pool.request().query(sql);
            await pool.close();
            return result.recordset;
        }
        if (type.startsWith('oracle')) {
            const oracledb = await Promise.resolve().then(() => __importStar(require('oracledb')));
            try {
                const clientCheck = await this.oracleClientService.checkOracleClientInstalled();
                if (clientCheck.installed && clientCheck.path && !oracledb.oracleClientVersion) {
                    oracledb.initOracleClient({ libDir: clientCheck.path });
                }
                else if (!clientCheck.installed && !oracledb.oracleClientVersion) {
                    try {
                        oracledb.initOracleClient();
                    }
                    catch (e) { }
                }
            }
            catch (e) {
                console.warn('Oracle Thick模式初始化检查失败:', e?.message || String(e));
            }
            try {
                if (!oracledb.oracleClientVersion) {
                    try {
                        oracledb.initOracleClient();
                    }
                    catch (initError) {
                        console.warn('Oracle客户端初始化失败:', initError.message);
                    }
                }
            }
            catch (initError) {
                console.warn('检查Oracle客户端版本失败:', initError.message);
            }
            const connectionFormats = [
                `${ds.host}:${ds.port}/${ds.databaseName}`,
                `${ds.host}:${ds.port}:${ds.databaseName}`,
                `${ds.host}/${ds.databaseName}`
            ];
            let connection;
            let lastError;
            try {
                const connectString = `${ds.host}:${ds.port}/${ds.databaseName}`;
                connection = await oracledb.getConnection({
                    user: ds.username,
                    password: ds.password || '',
                    connectString
                });
            }
            catch (error) {
                lastError = error;
                if (error.message.includes('NJS-138') ||
                    error.message.includes('Thin mode') ||
                    error.message.includes('version')) {
                    try {
                        if (!oracledb.oracleClientVersion) {
                            oracledb.initOracleClient();
                        }
                    }
                    catch (thickInitError) {
                        console.warn('Oracle Thick模式初始化失败:', thickInitError.message);
                    }
                    for (const connectString of connectionFormats) {
                        try {
                            connection = await oracledb.getConnection({
                                user: ds.username,
                                password: ds.password || '',
                                connectString
                            });
                            break;
                        }
                        catch (formatError) {
                            lastError = formatError;
                            continue;
                        }
                    }
                }
            }
            if (!connection) {
                throw new Error(`Oracle数据库连接失败: ${lastError?.message || '未知错误'}

可能的解决方案:
1. 检查Oracle Instant Client是否已安装
2. 确认数据库版本兼容性
3. 尝试不同的连接格式`);
            }
            const result = await connection.execute(sql);
            await connection.close();
            const meta = result.metaData || [];
            const colNames = meta.map((m) => m.name);
            const rows = [];
            (result.rows || []).forEach((arr) => {
                const obj = {};
                arr.forEach((v, i) => { obj[colNames[i]] = v; });
                rows.push(obj);
            });
            return rows;
        }
        throw new Error(`不支持的数据库类型: ${ds.databaseType}`);
    }
    _generateInsertSql(dbType, table, rows) {
        const type = (dbType || '').toLowerCase();
        const escapeStr = (val) => {
            if (val === null || val === undefined)
                return 'NULL';
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
                if (['sqlserver', 'mssql'].includes(type))
                    return `0x${hex}`;
                return `'\\x${hex}'`;
            }
            if (typeof val === 'number')
                return String(val);
            const s = String(val).replace(/'/g, "''");
            return `'${s}'`;
        };
        const sqls = [];
        for (const row of rows) {
            const cols = Object.keys(row);
            const vals = cols.map(c => escapeStr(row[c]));
            sqls.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
        }
        return sqls;
    }
    _formatTimestamp(d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
    }
}
exports.PrecastExportWebviewProvider = PrecastExportWebviewProvider;
//# sourceMappingURL=PrecastExportWebviewProvider.js.map