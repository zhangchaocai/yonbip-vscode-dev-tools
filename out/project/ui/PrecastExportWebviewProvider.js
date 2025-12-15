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
const NCHomeConfigService_1 = require("../../project/nc-home/config/NCHomeConfigService");
const PasswordEncryptor_1 = require("../../utils/PasswordEncryptor");
const OracleClientService_1 = require("../../project/nc-home/OracleClientService");
const TableRuleParser_1 = require("../../utils/TableRuleParser");
const StatisticsService_1 = require("../../utils/StatisticsService");
const xml2js = require('xml2js');
class PrecastExportWebviewProvider {
    _extensionUri;
    _context;
    static viewType = 'yonbip.precastExportConfig';
    _view;
    configService;
    oracleClientService;
    tableRuleParser;
    constructor(_extensionUri, _context) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this.configService = new NCHomeConfigService_1.NCHomeConfigService(_context);
        this.oracleClientService = new OracleClientService_1.OracleClientService(_context);
        this.tableRuleParser = new TableRuleParser_1.TableRuleParser(_context.extensionPath);
        this._context.subscriptions.push(vscode.commands.registerCommand('yonbip.precastExportConfig.refresh', () => {
            this._refreshDataSources();
            this._prefillDefaultOutputDir();
        }));
        this._context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this._checkXmlSelection();
        }));
        this._context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
            this._checkXmlSelection();
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
                    this._checkXmlSelection();
                    break;
                case 'checkXmlSelection':
                    this._checkXmlSelection();
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
    _checkXmlSelection() {
        try {
            const xmlPaths = this._resolveInitCfgXmlPaths();
            const showWarning = xmlPaths.length === 0;
            const currentXml = xmlPaths.length > 0 ? xmlPaths[0] : '';
            this._view?.webview.postMessage({
                type: 'showXmlWarning',
                show: showWarning
            });
            this._view?.webview.postMessage({
                type: 'setCurrentXml',
                path: currentXml
            });
            if (!showWarning && this._view) {
                this._view.webview.postMessage({
                    type: 'showMessage',
                    level: 'info',
                    message: `已选择XML文件: ${path.basename(currentXml)}`
                });
            }
        }
        catch (error) {
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
            const excludeTimestampTables = this.tableRuleParser.getExcludeTimestampTables();
            const xmlPaths = this._resolveInitCfgXmlPaths();
            if (xmlPaths.length === 0) {
                throw new Error('未找到 items.xml 文件，请在资源管理器中右键选择该文件后再导出');
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
            const cfg = this.configService.getConfig();
            const isBaseDataSource = ds.name === 'base' || ds.name === cfg.baseDatabase;
            if (!isBaseDataSource) {
                this._view?.webview.postMessage({
                    type: 'showMessage',
                    level: 'warning',
                    message: `警告：未找到base数据源，当前使用的是"${ds.name}"数据源进行导出`
                });
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
                const tableStructure = await this.tableRuleParser.parseTableRule(table);
                const excludeTimestamp = excludeTimestampTables.includes(table);
                if (tableStructure) {
                    sqlOutput += await this._processTableWithStructure(ds, tableStructure, where, excludeTimestamp);
                }
                else {
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
                    const inserts = this._generateInsertSql(ds.databaseType, table, rows, excludeTimestamp);
                    sqlOutput += `-- 插入 ${table} (${rows.length} 行)
${inserts.join("\n")}

`;
                    processed++;
                    const percent = 25 + Math.floor(processed / total * 60);
                    this._view?.webview.postMessage({ type: 'progress', percent, text: `完成处理 ${table} (${rows.length} 行)` });
                }
            }
            this._view?.webview.postMessage({
                type: 'progress',
                percent: 90,
                text: '正在写入文件...'
            });
            const ts = this._formatTimestamp(new Date());
            const filePath = path.join(outputDir, `allsql_${ts}.sql`);
            fs.writeFileSync(filePath, sqlOutput, 'utf-8');
            StatisticsService_1.StatisticsService.incrementCount(StatisticsService_1.StatisticsService.SCRIPT_EXPORT_COUNT);
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
            console.error('导出预置脚本时发生错误:', error);
            if (this._view && this._view.webview) {
                this._view.webview.postMessage({
                    type: 'showMessage',
                    level: 'error',
                    message: `导出失败: ${error.message || String(error)}`
                });
                this._view.webview.postMessage({ type: 'exportError' });
            }
            else {
                vscode.window.showErrorMessage(`导出失败: ${error.message || String(error)}`);
            }
        }
    }
    async _processTableWithStructure(ds, tableStructure, where, excludeTimestamp = false) {
        try {
            let sqlOutput = '';
            const mainTable = tableStructure.table;
            if (where) {
                sqlOutput += `-- 删除 ${mainTable}\nDELETE FROM ${mainTable} WHERE ${where};\n\n`;
            }
            const mainSelectSql = `SELECT * FROM ${mainTable}${where ? ' WHERE ' + where : ''}`;
            const mainRows = await this._queryRows(ds, mainSelectSql);
            if (!mainRows || mainRows.length === 0) {
                sqlOutput += `-- ${mainTable} 无匹配数据\n\n`;
                return sqlOutput;
            }
            const mainInserts = this._generateInsertSql(ds.databaseType, mainTable, mainRows, excludeTimestamp);
            sqlOutput += `-- 插入 ${mainTable} (${mainRows.length} 行)
${mainInserts.join("\n")}

`;
            for (const subTable of tableStructure.subTables) {
                sqlOutput += await this._processSubTable(ds, subTable, mainTable, mainRows, excludeTimestamp);
            }
            return sqlOutput;
        }
        catch (error) {
            console.error('处理表结构时发生错误:', error);
            throw new Error(`处理表 ${tableStructure.table} 时发生错误: ${error.message || String(error)}`);
        }
    }
    async _processSubTable(ds, subTable, parentTable, parentRows, excludeTimestamp = false) {
        try {
            let sqlOutput = '';
            let parentPkColumn = '';
            const parentTableStructure = await this.tableRuleParser.parseTableRule(parentTable.toUpperCase());
            if (parentTableStructure && parentTableStructure.primaryKey) {
                parentPkColumn = parentTableStructure.primaryKey.toUpperCase();
            }
            else {
                const parentPkColumnCandidates = [
                    'pk_' + parentTable.toUpperCase(),
                    'id',
                    parentTable.toUpperCase() + '_id',
                    'pkid'
                ];
                if (parentRows.length > 0) {
                    for (const candidate of parentPkColumnCandidates) {
                        if (candidate in parentRows[0]) {
                            parentPkColumn = candidate;
                            break;
                        }
                    }
                    if (!parentPkColumn) {
                        parentPkColumn = Object.keys(parentRows[0])[0];
                    }
                }
            }
            const parentPkValues = parentRows
                .map(row => row[parentPkColumn])
                .filter(pk => pk !== undefined && pk !== null);
            if (parentPkValues.length === 0) {
                return sqlOutput;
            }
            const pkList = parentPkValues.map(pk => `'${String(pk).replace(/'/g, "''")}'`).join(',');
            const subSelectSql = `SELECT * FROM ${subTable.table.toUpperCase()} WHERE ${subTable.foreignKeyColumn.toUpperCase()} IN (${pkList})`;
            const subRows = await this._queryRows(ds, subSelectSql);
            if (!subRows || subRows.length === 0) {
                sqlOutput += `-- ${subTable.table.toUpperCase()} 无匹配数据\n\n`;
            }
            else {
                const subInserts = this._generateInsertSql(ds.databaseType, subTable.table.toUpperCase(), subRows, excludeTimestamp);
                sqlOutput += `-- 插入 ${subTable.table.toUpperCase()} (${subRows.length} 行)
${subInserts.join("\n")}

`;
                for (const nestedSubTable of subTable.subTables) {
                    sqlOutput += await this._processSubTable(ds, nestedSubTable, subTable.table.toUpperCase(), subRows, excludeTimestamp);
                }
            }
            return sqlOutput;
        }
        catch (error) {
            console.error('处理子表时发生错误:', error);
            const errorMsg = `处理子表 ${subTable.table} 时发生错误: ${error.message || String(error)}`;
            vscode.window.showWarningMessage(errorMsg);
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'warning',
                message: errorMsg
            });
            return '';
        }
    }
    _refreshDataSources() {
        try {
            this.configService.reloadConfig();
            const { dataSources } = this.configService.getPortFromPropXml();
            const cfg = this.configService.getConfig();
            let selectedDataSource = dataSources.find(ds => ds.name === 'base');
            if (!selectedDataSource && cfg.baseDatabase) {
                selectedDataSource = dataSources.find(ds => ds.name === cfg.baseDatabase);
            }
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
    getHtmlForWebview(webview) {
        return this._getHtmlForWebview(webview);
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
        overflow-x: hidden; /* Prevent horizontal overflow */
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
        position: relative;
    }

    .form-row input {
        flex: 1;
        padding-right: 40px; /* 为图标留出空间 */
        cursor: pointer;
    }

    /* 文件夹图标样式 */
    .folder-icon {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        cursor: pointer;
        font-size: 18px;
        color: var(--vscode-foreground);
        background: none;
        border: none;
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s ease;
    }

    .folder-icon:hover {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }

    /* 警告提示样式 */
    .warning-message {
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        padding: 12px 16px;
        margin: 16px 0;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        animation: slideInUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .warning-message.warning {
        border-left: 4px solid #FFA500;
        background: linear-gradient(135deg, rgba(255, 165, 0, 0.1) 0%, var(--vscode-input-background) 100%);
    }

    .warning-icon {
        font-size: 18px;
        flex-shrink: 0;
        margin-top: 2px;
        color: #FFA500;
    }

    .warning-text {
        flex: 1;
        font-size: 13px;
        line-height: 1.6;
        color: var(--vscode-descriptionForeground);
    }

    /* 表格容器优化 */
    .table-container {
        border: 2px solid var(--vscode-input-border);
        border-radius: 12px;
        margin-bottom: 24px;
        background-color: var(--vscode-input-background);
        box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.05);
        overflow-x: auto;
        max-width: 100%;
    }

    table {
        width: 100%;
        min-width: 600px; /* 确保表格在小屏幕上也有最小宽度 */
        border-collapse: collapse;
        margin-top: 8px;
        table-layout: auto; /* 改为auto以适应内容 */
    }

    th {
        text-align: left;
        color: var(--vscode-foreground);
        font-weight: 600;
        font-size: 13px;
        padding: 12px 16px;
        border-bottom: 2px solid var(--vscode-input-border);
        background-color: var(--vscode-sideBar-background);
        white-space: nowrap; /* 防止表头换行 */
    }

    td {
        padding: 12px 16px;
        font-size: 13px;
        border-bottom: 1px solid var(--vscode-input-border);
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: nowrap; /* 防止单元格内容换行 */
    }

    tr:hover {
        background-color: var(--vscode-list-hoverBackground);
    }

    .muted {
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        text-align: center;
        padding: 24px;
    }

    /* 进度条容器优化 */
    .progress-container {
        width: 100%;
        margin-top: 20px;
        padding: 20px;
        border-radius: 12px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
    }

    .progress-bar {
        width: 100%;
        height: 12px;
        border-radius: 6px;
        background-color: var(--vscode-input-border);
        overflow: hidden;
        margin-bottom: 12px;
    }

    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--vscode-progressBar-background), var(--vscode-progressBar-foreground));
        border-radius: 6px;
        transition: width 0.3s ease;
    }

    .progress-text {
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        text-align: center;
        min-height: 20px;
        white-space: pre-wrap;
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
        gap: 12px;
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

    .section-description {
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        margin-bottom: 16px;
        line-height: 1.6;
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
        text-align: center;
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

    /* 状态消息样式优化 */
    .status-bar {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-top: 16px;
        padding: 16px;
        border-radius: 8px;
        background-color: var(--vscode-input-background);
        border-left: 4px solid var(--vscode-textLink-foreground);
        animation: slideInUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        max-width: 100%;
    }

    .status-bar.success {
        border-left-color: #4caf50;
        background: linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, var(--vscode-input-background) 100%);
    }

    .status-bar.error {
        border-left-color: var(--vscode-inputValidation-errorBorder);
        background: linear-gradient(135deg, var(--vscode-inputValidation-errorBackground) 0%, rgba(255, 0, 0, 0.05) 100%);
    }

    .status-bar.info {
        border-left-color: var(--vscode-button-background);
        background: linear-gradient(135deg, var(--vscode-input-background) 0%, var(--vscode-editor-background) 100%);
    }

    .status-icon {
        font-size: 18px;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .status-text {
        flex: 1;
        font-size: 13px;
        line-height: 1.6;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: pre-wrap;
        max-width: calc(100% - 30px); /* Account for icon width and gap */
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

    /* 响应式设计 */
    @media (max-width: 768px) {
        .form-container {
            padding: 16px 16px 100px 16px;
            margin: 12px;
        }
        
        .button-group {
            padding: 16px;
        }
        
        .button {
            padding: 12px 20px;
            font-size: 13px;
            min-width: 100px;
        }
        
        .section-title {
            font-size: 15px;
        }
        
        th, td {
            padding: 10px 12px;
            font-size: 12px;
        }
    }
</style>
</head>
<body>
<div class="form-container">
    <div class="section-title">
        <span>📁</span>
        输出目录配置
    </div>
    <p class="section-description">选择预置脚本导出的目标目录</p>
    <div class="form-group">
        <label for="outputDir">输出目录</label>
        <div class="form-row">
            <input type="text" id="outputDir" placeholder="点击选择导出目录" readonly>
            <button class="folder-icon" id="folderIcon">📁</button>
        </div>
    </div>

    <div id="xmlWarning" class="warning-message warning" style="display: none;">
        <span class="warning-icon">⚠️</span>
        <span class="warning-text">请在资源管理器中右键选择 items.xml 文件后再执行导出操作</span>
    </div>

    <div class="section-title">
        <span>📄</span>
        当前XML文件
    </div>
    <p class="section-description">导出预置脚本将基于以下XML文件</p>
    <div class="form-group">
        <div class="form-row">
            <input type="text" id="currentXml" placeholder="未选择XML文件" readonly>
        </div>
    </div>

    <div class="section-title">
        <span>💾</span>
        当前数据源信息
    </div>
    <p class="section-description">导出预置脚本时将默认使用Base数据源</p>
    <div class="table-container">
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
                    <td colspan="6" class="muted">暂无数据源信息</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="section-title">
        <span>📤</span>
        导出预置脚本
    </div>
    <p class="section-description">根据选中的 items.xml 文件生成预置脚本 SQL 文件</p>
    <div class="progress-container" id="progressContainer" style="display:none">
        <div class="progress-bar">
            <div class="progress-fill" id="progressFill" style="width: 0%"></div>
        </div>
        <div class="progress-text" id="progressText"></div>
    </div>
    <div id="statusBar" class="status-bar" style="display:none">
        <span id="statusIcon" class="status-icon"></span>
        <span id="statusText" class="status-text"></span>
    </div>
</div>

<div class="button-group">
    <button class="button button-secondary" id="refreshBtn">
        <span>🔄 刷新</span>
    </button>
    <button class="button button-primary" id="exportBtn">
        <span>🚀 开始导出</span>
    </button>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const outputDirInput = document.getElementById('outputDir');
const exportBtn = document.getElementById('exportBtn');
const refreshBtn = document.getElementById('refreshBtn');
const folderIcon = document.getElementById('folderIcon');
const xmlWarning = document.getElementById('xmlWarning');
const currentXmlInput = document.getElementById('currentXml');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statusBar = document.getElementById('statusBar');
const statusIcon = document.getElementById('statusIcon');
const statusText = document.getElementById('statusText');
const currentDsBody = document.getElementById('currentDsBody');

// 表单验证规则
const validationRules = {
    outputDir: {
        required: true,
        message: '请选择输出目录'
    }
};

// 验证单个字段
function validateField(fieldName, value) {
    const rule = validationRules[fieldName];
    if (!rule) return { valid: true };
    
    if (rule.required && (!value || value.trim() === '')) {
        return { valid: false, message: rule.message || '此字段为必填项' };
    }
    
    return { valid: true };
}

// 显示错误信息
function showError(message) {
    showStatus(message, 'error');
}

// 显示成功信息
function showSuccess(message) {
    showStatus(message, 'success');
}

// 显示信息
function showInfo(message) {
    showStatus(message, 'info');
}

function setExporting(is) {
    exportBtn.disabled = is;
    refreshBtn.disabled = is;
    progressContainer.style.display = is ? 'block' : 'none';
    if (!is) {
        progressFill.style.width = '0%';
        progressText.textContent = '';
    }
}

function renderCurrentDataSource(ds) {
    if (!ds) {
        currentDsBody.innerHTML = '<tr><td colspan="6" class="muted">暂无数据源信息</td></tr>';
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
    statusBar.className = 'status-bar ' + (type || 'info');
    statusText.textContent = message;
    
    switch (type) {
        case 'success':
            statusIcon.textContent = '✅';
            break;
        case 'error':
            statusIcon.textContent = '❌';
            break;
        case 'info':
            statusIcon.textContent = 'ℹ️';
            break;
        default:
            statusIcon.textContent = 'ℹ️';
    }
}

function selectOutputDir() {
    vscode.postMessage({ type: 'selectOutputDir' });
}

function exportPrecast() {
    // 表单验证
    const outputDir = outputDirInput.value.trim();
    const validation = validateField('outputDir', outputDir);
    
    if (!validation.valid) {
        showError(validation.message);
        return;
    }
    
    // 检查是否选择了XML文件
    const currentXml = currentXmlInput.value.trim();
    if (!currentXml || currentXml === '未选择XML文件') {
        showError('请先选择 items.xml 文件后再执行导出操作');
        return;
    }
    
    // 显示导出开始状态
    showInfo('开始导出预置脚本...');
    vscode.postMessage({ type: 'exportPrecast', data: { outputDir: outputDir } });
}

function refreshDataSources() {
    showInfo('正在刷新数据源信息...');
    vscode.postMessage({ type: 'refreshDataSources' });
}

// 检查是否选择了XML文件
function checkXmlSelection() {
    // 向后端请求检查XML文件状态
    vscode.postMessage({ type: 'checkXmlSelection' });
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
            progressFill.style.width = '0%';
            progressText.textContent = msg.text || '开始导出...';
            break;
        case 'progress':
            if (typeof msg.percent === 'number') {
                var p = Math.max(0, Math.min(100, Math.floor(msg.percent)));
                progressFill.style.width = p + '%';
            }
            progressText.textContent = msg.text || '';
            break;
        case 'exportFinished':
            setExporting(false);
            // 只有在没有显示错误消息的情况下才显示成功消息
            if (!statusBar.classList.contains('error')) {
                showStatus('预置脚本导出完成', 'success');
            }
            break;
        case 'exportError':
            // 处理导出错误，重置界面状态
            setExporting(false);
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
            // Show success message when data sources are updated
            setTimeout(() => {
                showSuccess('数据源信息刷新完成');
            }, 500);
            
            // 处理数据源更新消息，刷新当前数据源显示
            if (msg.dataSources && msg.dataSources.length > 0) {
                // 优先选择base数据源
                let selectedDataSource = msg.dataSources.find(ds => ds.name === 'base');
                if (!selectedDataSource) {
                    // 如果没有base数据源，使用第一个数据源
                    selectedDataSource = msg.dataSources[0];
                }
                renderCurrentDataSource(selectedDataSource);
            } else {
                renderCurrentDataSource(null);
            }
            break;
        case 'showXmlWarning':
            xmlWarning.style.display = msg.show ? 'flex' : 'none';
            break;
        case 'setCurrentXml':
            console.log('设置当前XML文件路径:', msg.path);
            currentXmlInput.value = msg.path || '未选择XML文件';
            // 如果没有XML文件，显示警告
            if (!msg.path) {
                currentXmlInput.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
                currentXmlInput.style.backgroundColor = 'var(--vscode-inputValidation-errorBackground)';
            } else {
                currentXmlInput.style.borderColor = 'var(--vscode-input-border)';
                currentXmlInput.style.backgroundColor = 'var(--vscode-input-background)';
            }
            break;
    }
});

// 事件绑定
outputDirInput.addEventListener('click', selectOutputDir);
folderIcon.addEventListener('click', selectOutputDir);
exportBtn.addEventListener('click', exportPrecast);
refreshBtn.addEventListener('click', refreshDataSources);

// 初始握手，触发默认目录预填和数据源刷新
vscode.postMessage({ type: 'ready' });
// 检查XML文件选择状态
checkXmlSelection();
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
                    if (name === 'items.xml' || name === 'item.xml')
                        res.push(p);
                }
                else if (stat.isDirectory()) {
                    const files = fs.readdirSync(p).map(f => f.toLowerCase());
                    const itemsXml = files.find(f => f === 'items.xml');
                    const itemXml = files.find(f => f === 'item.xml');
                    if (itemsXml) {
                        res.push(path.join(p, itemsXml));
                    }
                    else if (itemXml) {
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
                    if (name === 'items.xml' || name === 'item.xml') {
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
        let ds = dataSources.find(d => d.name === 'base');
        if (!ds) {
            const namePref = cfg.selectedDataSource || cfg.baseDatabase || 'base';
            ds = dataSources.find(d => d.name === namePref);
        }
        if (!ds && dataSources.length > 0)
            ds = dataSources[0];
        if (!ds)
            return undefined;
        const decryptedPassword = PasswordEncryptor_1.PasswordEncryptor.getSecurePassword(cfg.homePath, ds.password || '');
        ds.password = typeof decryptedPassword === 'string' ? decryptedPassword : String(decryptedPassword || '');
        return ds;
    }
    _getDataSource() {
        const cfg = this.configService.getConfig();
        if (!cfg)
            return undefined;
        let ds = cfg.dataSources?.find((d) => d.name === 'design');
        const dataSources = cfg.dataSources || [];
        if (!ds && dataSources.length > 0)
            ds = dataSources[0];
        if (!ds)
            return undefined;
        const decryptedPassword = PasswordEncryptor_1.PasswordEncryptor.getSecurePassword(cfg.homePath, ds.password || '');
        ds.password = typeof decryptedPassword === 'string' ? decryptedPassword : String(decryptedPassword || '');
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
            const password = typeof ds.password === 'string' ? ds.password : String(ds.password || '');
            const client = new pg.Client({ host: ds.host, port: ds.port, user: ds.username, password: password, database: ds.databaseName, connectionTimeoutMillis: 10000 });
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
    _generateInsertSql(dbType, table, rows, excludeTimestamp = false) {
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
        const timestampFields = [
            'createdtime',
            'creationtime',
            'lastmodifiedtime',
            'lastupdatetime',
            'modifytime',
            'ts',
            'updatetime'
        ];
        const sqls = [];
        for (const row of rows) {
            let cols = Object.keys(row);
            if (excludeTimestamp) {
                cols = cols.filter(col => !timestampFields.includes(col.toLowerCase()));
            }
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