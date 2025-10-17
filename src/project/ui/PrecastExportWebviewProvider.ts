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

            this._view?.webview.postMessage({ type: 'showMessage', level: 'info', message: '正在读取 InitDataCfgs 并生成SQL...' });

            // 解析 InitDataCfgs XML 路径
            const xmlPaths = this._resolveInitCfgXmlPaths();
            if (xmlPaths.length === 0) {
                throw new Error('未找到 item.xml，请在资源管理器中右键选择该文件后再导出');
            }

            // 解析所有XML，汇总条目
            const allItems: InitDataCfgItem[] = [];
            for (const xmlPath of xmlPaths) {
                const items = await this._parseInitDataCfgs(xmlPath);
                if (items.length === 0) {
                    this._view?.webview.postMessage({ type: 'showMessage', level: 'warning', message: `文件 ${path.basename(xmlPath)} 未解析到条目` });
                }
                allItems.push(...items);
            }
            if (allItems.length === 0) {
                throw new Error('InitDataCfgs 中没有可处理的条目');
            }

            // 选择数据源（优先 selectedDataSource，然后 baseDatabase，然后第一个）并解密密码
            const ds = this._pickAndSecureDataSource();
            if (!ds) {
                throw new Error('未找到有效的数据源，请先在"NC HOME配置"视图中配置数据源');
            }

            // 逐条生成SQL
            let sqlOutput = `-- 预置脚本导出
-- 数据源: ${ds.name} (${ds.databaseType}) ${ds.host}:${ds.port}/${ds.databaseName}\n\n`;

            for (const item of allItems) {
                const table = item.tableName?.trim();
                const where = (item.whereCondition || '').trim();
                if (!table) continue;

                // DELETE 语句（如果有 where 条件）
                if (where) {
                    sqlOutput += `-- 删除 ${table}\nDELETE FROM ${table} WHERE ${where};\n\n`;
                }

                // 查询并生成 INSERT
                const selectSql = `SELECT * FROM ${table}${where ? ' WHERE ' + where : ''}`;
                const rows = await this._queryRows(ds, selectSql);
                if (!rows || rows.length === 0) {
                    sqlOutput += `-- ${table} 无匹配数据\n\n`;
                    continue;
                }

                const inserts = this._generateInsertSql(ds.databaseType, table, rows);
                sqlOutput += `-- 插入 ${table} (${rows.length} 行)
\` + inserts.join('\\n') + '\\n\\n`;

            }

            // 写入文件
            const ts = this._formatTimestamp(new Date());
            const filePath = path.join(outputDir, `allsql_${ts}.sql`);
            fs.writeFileSync(filePath, sqlOutput, 'utf-8');

            this._view?.webview.postMessage({ type: 'showMessage', level: 'success', message: `预置脚本导出完成：${filePath}` });
            vscode.window.showInformationMessage(`预置脚本已导出到 ${filePath}`);
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'showMessage',
                level: 'error',
                message: `导出失败: ${error.message || String(error)}`
            });
        }
    }

    private _refreshDataSources(): void {
        try {
            this.configService.reloadConfig();
            const { dataSources } = this.configService.getPortFromPropXml();
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
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    .container { padding: 12px; }
    h2 { margin: 0 0 8px; font-size: 16px; }
    .card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
    .row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .btn { cursor: pointer; padding: 6px 10px; border: 1px solid var(--vscode-button-border); border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--vscode-editorWidget-border); padding: 6px; font-size: 12px; }
    th { text-align: left; color: var(--vscode-foreground); }
    .muted { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div class="container">
    <div class="card">
        <h2>输出目录</h2>
        <div class="row">
            <input id="outputDir" type="text" style="flex:1" placeholder="选择导出目录" />
            <button class="btn" id="pickOutput">选择目录</button>
        </div>
    </div>

    <div class="card">
        <h2>数据源信息（来自 prop.xml）</h2>
        <div class="row">
            <button class="btn" id="refreshDs">刷新</button>
            <span class="muted">未配置 HOME 路径时无法读取</span>
        </div>
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
            <tbody id="dsBody"></tbody>
        </table>
    </div>

    <div class="card">
        <h2>导出</h2>
        <div class="row">
            <button class="btn" id="exportBtn">导出预置脚本</button>
        </div>
    </div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const dsBody = document.getElementById('dsBody');
const outputDirInput = document.getElementById('outputDir');

function renderDataSources(list) {
    var rows = '';
    (list || []).forEach(function(ds) {
        rows += '<tr>' +
            '<td>' + (ds.name || '') + '</td>' +
            '<td>' + (ds.type || '') + '</td>' +
            '<td>' + (ds.host || '') + '</td>' +
            '<td>' + (ds.port || '') + '</td>' +
            '<td>' + (ds.database || '') + '</td>' +
            '<td>' + (ds.user || '') + '</td>' +
        '</tr>';
    });
    dsBody.innerHTML = rows;
}

window.addEventListener('message', (event) => {
    const msg = event.data || {};
    switch (msg.type) {
        case 'dataSourcesUpdated':
            renderDataSources(msg.dataSources);
            break;
        case 'setOutputDir':
            outputDirInput.value = msg.path || '';
            break;
        case 'showMessage':
            // 宿主弹消息
            break;
    }
});

// 事件绑定
(document.getElementById('pickOutput')).addEventListener('click', () => {
    vscode.postMessage({ type: 'selectOutputDir' });
});
(document.getElementById('refreshDs')).addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshDataSources' });
});
(document.getElementById('exportBtn')).addEventListener('click', () => {
    vscode.postMessage({ type: 'exportPrecast', data: { outputDir: outputDirInput.value } });
});

// 初始握手，触发数据源刷新 & 默认目录预填
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
        const namePref = cfg.selectedDataSource || cfg.baseDatabase || 'design';
        let ds = dataSources.find(d => d.name === namePref);
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