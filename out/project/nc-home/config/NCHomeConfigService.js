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
exports.NCHomeConfigService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const iconv = __importStar(require("iconv-lite"));
const PasswordEncryptor_1 = require("../../../utils/PasswordEncryptor");
const PropXmlUpdater_1 = require("../../../utils/PropXmlUpdater");
const OracleClientService_1 = require("../OracleClientService");
const StatisticsService_1 = require("../../../utils/StatisticsService");
class NCHomeConfigService {
    context;
    static outputChannelInstance = null;
    static oracleClientInitialized = false;
    static oracleClientLibDir = null;
    outputChannel;
    config;
    configFilePath;
    oracleClientService;
    configCache = null;
    configCacheTimestamp = 0;
    CACHE_TTL = 5000;
    constructor(context) {
        this.context = context;
        this.oracleClientService = new OracleClientService_1.OracleClientService(context);
        if (!NCHomeConfigService.outputChannelInstance) {
            NCHomeConfigService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP NC Home配置');
        }
        this.outputChannel = NCHomeConfigService.outputChannelInstance;
        this.configFilePath = this.getConfigFilePath();
        this.config = this.loadConfig();
    }
    getConfigFilePath() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceConfigPath = path.join(workspaceFolders[0].uri.fsPath, '.nc-home-config.json');
            return workspaceConfigPath;
        }
        else {
            const defaultPath = path.join(this.context.extensionPath, '.nc-home-config.json');
            this.outputChannel.appendLine(`警告：没有工作区，使用默认路径: ${defaultPath}`);
            return defaultPath;
        }
    }
    reloadConfig() {
        this.configFilePath = this.getConfigFilePath();
        this.config = this.loadConfig();
        this.outputChannel.appendLine(`配置已重新加载，使用路径: ${this.configFilePath}`);
    }
    getConfig() {
        const now = Date.now();
        if (this.configCache && (now - this.configCacheTimestamp) < this.CACHE_TTL) {
            return JSON.parse(JSON.stringify(this.configCache));
        }
        const configCopy = JSON.parse(JSON.stringify(this.config));
        if (configCopy.dataSources && configCopy.dataSources.length > 0) {
            for (const dataSource of configCopy.dataSources) {
                if (dataSource.password) {
                    dataSource.password = typeof dataSource.password === 'string' ? dataSource.password : String(dataSource.password || '');
                }
            }
        }
        this.configCache = JSON.parse(JSON.stringify(configCopy));
        this.configCacheTimestamp = now;
        return configCopy;
    }
    invalidateConfigCache() {
        this.configCache = null;
        this.configCacheTimestamp = 0;
    }
    getFullConfig() {
        return this.config;
    }
    async saveConfig(config) {
        try {
            this.config = { ...config };
            const storageDir = path.dirname(this.configFilePath);
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }
            fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf-8');
            await this.saveToWorkspaceConfig();
            this.invalidateConfigCache();
            this.outputChannel.appendLine(`配置已保存: ${this.configFilePath}`);
            vscode.window.showInformationMessage('NC Home配置已保存');
            StatisticsService_1.StatisticsService.incrementCount(StatisticsService_1.StatisticsService.HOME_CONFIG_COUNT);
        }
        catch (error) {
            this.outputChannel.appendLine(`保存配置失败: ${error.message}`);
            vscode.window.showErrorMessage(`保存配置失败: ${error.message}`);
            throw error;
        }
    }
    loadConfig() {
        try {
            if (fs.existsSync(this.configFilePath)) {
                const content = fs.readFileSync(this.configFilePath, 'utf-8');
                const config = JSON.parse(content);
                this.outputChannel.appendLine(`配置已加载: ${this.configFilePath}`);
                const defaultConfig = this.getDefaultConfig();
                const mergedConfig = { ...defaultConfig, ...config };
                return mergedConfig;
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`加载配置失败: ${error.message}`);
        }
        return this.getDefaultConfig();
    }
    getDefaultConfig() {
        const workspaceConfig = vscode.workspace.getConfiguration('yonbip');
        const debugPort = workspaceConfig.get('home.debugPort') || 8888;
        const vmParameters = workspaceConfig.get('home.vmParameters') || '';
        const hotwebs = workspaceConfig.get('hotwebs') || 'nccloud,fs,yonbip';
        return {
            homePath: '',
            exportAllsql: true,
            customTableCheck: false,
            showLocalDatadict: false,
            autoChangeJdk: false,
            dataSources: [],
            port: 9999,
            wsPort: 8080,
            debugMode: true,
            debugPort: debugPort,
            vmParameters: vmParameters,
            hotwebs: hotwebs
        };
    }
    async saveToWorkspaceConfig() {
        try {
            const config = vscode.workspace.getConfiguration('yonbip');
            if (this.config.homePath) {
                await config.update('homePath', this.config.homePath, vscode.ConfigurationTarget.Global);
            }
            await config.update('hotwebs', this.config.hotwebs, vscode.ConfigurationTarget.Global);
            await config.update('exModules', this.config.exModules, vscode.ConfigurationTarget.Global);
            await config.update('home.debugPort', this.config.debugPort, vscode.ConfigurationTarget.Global);
            await config.update('home.vmParameters', this.config.vmParameters, vscode.ConfigurationTarget.Global);
            console.log('Saved JVM parameters to workspace config:', this.config.vmParameters);
        }
        catch (error) {
            this.outputChannel.appendLine(`保存到工作区配置失败: ${error.message}`);
        }
    }
    async selectHomeDirectory() {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择 NC Home 目录',
            title: '选择 YonBIP NC Home 目录'
        });
        if (result && result[0]) {
            const homePath = result[0].fsPath;
            if (await this.validateHomeDirectory(homePath)) {
                return homePath;
            }
            else {
                vscode.window.showWarningMessage('选择的目录不是有效的NC Home目录');
                return undefined;
            }
        }
        return undefined;
    }
    async validateHomeDirectory(homePath) {
        try {
            const requiredPaths = [
                'bin',
                'lib',
                'modules',
                'hotwebs'
            ];
            for (const requiredPath of requiredPaths) {
                const fullPath = path.join(homePath, requiredPath);
                if (!fs.existsSync(fullPath)) {
                    this.outputChannel.appendLine(`缺少必需的目录/文件: ${requiredPath}`);
                    return false;
                }
            }
            this.outputChannel.appendLine(`Home目录验证通过: ${homePath}`);
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`验证Home目录失败: ${error.message}`);
            return false;
        }
    }
    async openHomeDirectory() {
        if (!this.config.homePath) {
            vscode.window.showWarningMessage('请先配置NC Home路径');
            return;
        }
        if (!fs.existsSync(this.config.homePath)) {
            vscode.window.showErrorMessage('Home目录不存在: ' + this.config.homePath);
            return;
        }
        try {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(this.config.homePath));
        }
        catch (error) {
            this.outputChannel.appendLine(`打开Home目录失败: ${error.message}`);
            vscode.window.showErrorMessage(`打开Home目录失败: ${error.message}`);
        }
    }
    async openSysConfig() {
        if (!this.config.homePath) {
            vscode.window.showWarningMessage('请先配置NC Home路径');
            return;
        }
        const sysConfigPath = path.join(this.config.homePath, 'bin', 'sysconfig.bat');
        const sysConfigPathSh = path.join(this.config.homePath, 'bin', 'sysconfig.sh');
        let configPath = '';
        if (process.platform === 'win32' && fs.existsSync(sysConfigPath)) {
            configPath = sysConfigPath;
        }
        else if ((process.platform === 'darwin' || process.platform === 'linux') && fs.existsSync(sysConfigPathSh)) {
            configPath = sysConfigPathSh;
        }
        else if (fs.existsSync(sysConfigPath)) {
            configPath = sysConfigPath;
        }
        else if (fs.existsSync(sysConfigPathSh)) {
            configPath = sysConfigPathSh;
        }
        else {
            vscode.window.showErrorMessage('未找到SysConfig工具');
            return;
        }
        try {
            const terminal = vscode.window.createTerminal('SysConfig');
            if ((process.platform === 'darwin' || process.platform === 'linux') && configPath.endsWith('.sh')) {
                terminal.sendText(`chmod +x "${configPath}" && "${configPath}"`);
            }
            else {
                terminal.sendText(`${configPath}`);
            }
            terminal.show();
        }
        catch (error) {
            this.outputChannel.appendLine(`启动SysConfig失败: ${error.message}`);
            vscode.window.showErrorMessage(`启动SysConfig失败: ${error.message}`);
        }
    }
    async testConnection(dataSource) {
        try {
            this.outputChannel.appendLine(`开始测试数据库连接: ${dataSource.name}`);
            if (!dataSource.host || !dataSource.username || !dataSource.databaseName) {
                return {
                    success: false,
                    message: '连接参数不完整，请检查主机、用户名和数据库名'
                };
            }
            const secureDataSource = {
                ...dataSource,
                password: dataSource.password || ''
            };
            this.outputChannel.appendLine(`使用解密后的密码进行连接测试`);
            if (!dataSource.port || dataSource.port <= 0 || dataSource.port > 65535) {
                return {
                    success: false,
                    message: '端口号无效'
                };
            }
            let connectionResult;
            switch (secureDataSource.databaseType.toLowerCase()) {
                case 'mysql':
                case 'mysql5':
                case 'mysql8':
                    connectionResult = await this.testMySQLConnection(secureDataSource);
                    break;
                case 'oracle':
                case 'oracle11g':
                case 'oracle12c':
                case 'oracle19c':
                    connectionResult = await this.testOracleConnection(secureDataSource);
                    break;
                case 'sqlserver':
                case 'mssql':
                    connectionResult = await this.testSQLServerConnection(secureDataSource);
                    break;
                case 'postgresql':
                case 'pg':
                    connectionResult = await this.testPostgreSQLConnection(secureDataSource);
                    break;
                default:
                    return {
                        success: false,
                        message: `不支持的数据库类型: ${secureDataSource.databaseType}`
                    };
            }
            this.outputChannel.appendLine(`连接测试结果: ${connectionResult.success ? '成功' : '失败'}`);
            this.outputChannel.appendLine(`消息: ${connectionResult.message}`);
            return connectionResult;
        }
        catch (error) {
            const errorMsg = `连接测试失败: ${error.message}`;
            this.outputChannel.appendLine(errorMsg);
            return {
                success: false,
                message: errorMsg,
                error: error.message
            };
        }
    }
    async testMySQLConnection(dataSource) {
        try {
            const mysql = await Promise.resolve().then(() => __importStar(require('mysql2/promise')));
            const connectionConfig = {
                host: dataSource.host,
                port: dataSource.port,
                user: dataSource.username,
                password: dataSource.password || '',
                database: dataSource.databaseName,
                connectTimeout: 10000,
                timeout: 10000
            };
            this.outputChannel.appendLine(`连接MySQL: ${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`);
            const connection = await mysql.createConnection(connectionConfig);
            const [rows] = await connection.execute('SELECT 1 as test');
            await connection.end();
            return {
                success: true,
                message: `MySQL连接成功 - 主机: ${dataSource.host}:${dataSource.port}, 数据库: ${dataSource.databaseName}`
            };
        }
        catch (error) {
            return {
                success: false,
                message: `MySQL连接失败: ${error.message}`,
                error: error.message
            };
        }
    }
    async testPostgreSQLConnection(dataSource) {
        try {
            const pg = await Promise.resolve().then(() => __importStar(require('pg')));
            let password = dataSource.password || '';
            if (typeof password !== 'string') {
                password = String(password);
            }
            const connectionConfig = {
                host: dataSource.host,
                port: dataSource.port,
                user: dataSource.username,
                password: password,
                database: dataSource.databaseName,
                connectionTimeoutMillis: 10000,
                statement_timeout: 10000
            };
            this.outputChannel.appendLine(`连接PostgreSQL: ${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`);
            this.outputChannel.appendLine(`用户名: ${dataSource.username}, 密码类型: ${typeof password}, 密码值: ${password}`);
            const client = new pg.Client(connectionConfig);
            await client.connect();
            const result = await client.query('SELECT 1 as test');
            await client.end();
            return {
                success: true,
                message: `PostgreSQL连接成功 - 主机: ${dataSource.host}:${dataSource.port}, 数据库: ${dataSource.databaseName}`
            };
        }
        catch (error) {
            this.outputChannel.appendLine(`PostgreSQL连接失败详情: ${error.message}`);
            return {
                success: false,
                message: `PostgreSQL连接失败: ${error.message}`,
                error: error.message
            };
        }
    }
    async testSQLServerConnection(dataSource) {
        try {
            const mssql = await Promise.resolve().then(() => __importStar(require('mssql')));
            const connectionConfig = {
                server: dataSource.host,
                port: dataSource.port,
                user: dataSource.username,
                password: dataSource.password || '',
                database: dataSource.databaseName,
                connectionTimeout: 10000,
                requestTimeout: 10000,
                options: {
                    encrypt: false,
                    trustServerCertificate: true
                }
            };
            this.outputChannel.appendLine(`连接SQL Server: ${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`);
            const pool = new mssql.ConnectionPool(connectionConfig);
            await pool.connect();
            const result = await pool.request().query('SELECT 1 as test');
            await pool.close();
            return {
                success: true,
                message: `SQL Server连接成功 - 主机: ${dataSource.host}:${dataSource.port}, 数据库: ${dataSource.databaseName}`
            };
        }
        catch (error) {
            return {
                success: false,
                message: `SQL Server连接失败: ${error.message}`,
                error: error.message
            };
        }
    }
    async testOracleConnection(dataSource) {
        try {
            const oracledb = await Promise.resolve().then(() => __importStar(require('oracledb')));
            const connectString = `${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
            this.outputChannel.appendLine(`🔍 开始测试Oracle连接: ${connectString}`);
            const oracleClientCheck = await this.oracleClientService.checkOracleClientInstalled();
            if (!oracleClientCheck.installed) {
                this.outputChannel.appendLine(`⚠️ 未检测到Oracle Instant Client`);
                const installConfirmed = await this.oracleClientService.promptInstallOracleClient();
                if (!installConfirmed) {
                    return {
                        success: false,
                        message: 'Oracle Instant Client未安装，无法连接Oracle数据库。\n请安装Oracle Instant Client后重试。'
                    };
                }
            }
            if (!oracledb.oracleClientVersion && !NCHomeConfigService.oracleClientInitialized) {
                this.outputChannel.appendLine(`🔄 初始化Oracle Thick模式...`);
                try {
                    oracledb.initOracleClient();
                    this.outputChannel.appendLine(`✅ Oracle Thick模式初始化成功`);
                    NCHomeConfigService.oracleClientInitialized = true;
                }
                catch (initError) {
                    this.outputChannel.appendLine(`⚠️ Oracle Thick模式初始化失败: ${initError.message}`);
                    if (initError.message && initError.message.includes('DPI-1047')) {
                        const commonPaths = [
                            '/opt/oracle/instantclient_23_3',
                            '/opt/oracle/instantclient_21_8',
                            '/opt/oracle/instantclient_19_17',
                            '/usr/local/oracle/instantclient_23_3',
                            '/usr/local/oracle/instantclient_21_8',
                            '/usr/local/oracle/instantclient_19_17',
                            '/opt/homebrew/lib',
                            path.join(this.context.globalStoragePath, 'oracle_client')
                        ];
                        if (process.env.DYLD_LIBRARY_PATH) {
                            const dyldPaths = process.env.DYLD_LIBRARY_PATH.split(':');
                            commonPaths.unshift(...dyldPaths);
                        }
                        let initialized = false;
                        for (const clientPath of commonPaths) {
                            if (clientPath && fs.existsSync(clientPath)) {
                                try {
                                    if (!oracledb.oracleClientVersion) {
                                        oracledb.initOracleClient({ libDir: clientPath });
                                    }
                                    this.outputChannel.appendLine(`✅ Oracle Thick模式使用路径初始化成功: ${clientPath}`);
                                    initialized = true;
                                    NCHomeConfigService.oracleClientInitialized = true;
                                    break;
                                }
                                catch (pathError) {
                                    this.outputChannel.appendLine(`⚠️ 路径 ${clientPath} 初始化失败: ${pathError.message}`);
                                }
                            }
                        }
                        if (!initialized) {
                            return {
                                success: false,
                                message: this.getOracleClientInstallationGuide(initError.message)
                            };
                        }
                    }
                    else {
                        this.outputChannel.appendLine(`💡 提示: 请确保已安装Oracle Instant Client`);
                        NCHomeConfigService.oracleClientInitialized = true;
                    }
                }
            }
            else {
                this.outputChannel.appendLine(`ℹ️ Oracle客户端已初始化，跳过重复初始化`);
            }
            try {
                const connection = await oracledb.getConnection({
                    user: dataSource.username,
                    password: dataSource.password || '',
                    connectString: connectString
                });
                const result = await connection.execute('SELECT 1 as test FROM dual');
                await connection.close();
                return {
                    success: true,
                    message: `✅ Oracle连接成功 - 使用格式: ${connectString}`
                };
            }
            catch (thickError) {
                this.outputChannel.appendLine(`⚠️ Thick模式连接失败: ${thickError.message}`);
                return await this.testOracleLegacyCompatibility(dataSource);
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`❌ Oracle连接测试出现未处理的错误: ${error.message}`);
            return await this.handleOracleConnectionError(error, dataSource);
        }
    }
    async testOracleLegacyCompatibility(dataSource) {
        try {
            const oracledb = await Promise.resolve().then(() => __importStar(require('oracledb')));
            this.outputChannel.appendLine(`🔄 尝试Oracle旧版本兼容模式...`);
            if (!oracledb.oracleClientVersion && !NCHomeConfigService.oracleClientInitialized) {
                this.outputChannel.appendLine(`⚠️ Oracle客户端未初始化，尝试初始化...`);
                try {
                    oracledb.initOracleClient();
                    NCHomeConfigService.oracleClientInitialized = true;
                    this.outputChannel.appendLine(`✅ Oracle客户端初始化成功`);
                }
                catch (initError) {
                    this.outputChannel.appendLine(`⚠️ Oracle客户端初始化失败: ${initError.message}`);
                }
            }
            const connectionFormats = [
                `${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`,
                `${dataSource.host}:${dataSource.port}:${dataSource.databaseName}`,
                `${dataSource.host}/${dataSource.databaseName}`
            ];
            for (let i = 0; i < connectionFormats.length; i++) {
                const connectString = connectionFormats[i];
                this.outputChannel.appendLine(`   尝试连接格式 ${i + 1}: ${connectString}`);
                try {
                    const connection = await oracledb.getConnection({
                        user: dataSource.username,
                        password: dataSource.password || '',
                        connectString: connectString
                    });
                    const result = await connection.execute('SELECT 1 as test FROM dual');
                    await connection.close();
                    return {
                        success: true,
                        message: `✅ Oracle旧版本兼容连接成功 - 使用格式 ${i + 1}: ${connectString}`
                    };
                }
                catch (formatError) {
                    this.outputChannel.appendLine(`   格式 ${i + 1} 失败: ${formatError.message.substring(0, 100)}...`);
                    continue;
                }
            }
            return {
                success: false,
                message: `❌ 所有Oracle连接格式都失败，请检查连接参数和网络连接`
            };
        }
        catch (error) {
            this.outputChannel.appendLine(`❌ Oracle兼容模式出现未处理的错误: ${error.message}`);
            return {
                success: false,
                message: `❌ Oracle兼容模式连接失败: ${error.message}`
            };
        }
    }
    async handleOracleConnectionError(error, dataSource) {
        let errorMessage = error.message || '未知Oracle连接错误';
        let solution = '';
        this.outputChannel.appendLine(`❌ Oracle连接错误: ${errorMessage}`);
        if (errorMessage.includes('NJS-138') || errorMessage.includes('Thin mode') || errorMessage.includes('version')) {
            return this.testOracleLegacyCompatibility(dataSource);
        }
        if (errorMessage.includes('ORA-')) {
            const oraCode = this.extractOracleErrorCode(errorMessage);
            solution = this.getOracleErrorSuggestion(oraCode, dataSource);
        }
        if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
            solution = `
🔧 网络连接问题解决方案：
1. 检查主机名解析：nslookup ${dataSource.host}
2. 测试端口连通性：telnet ${dataSource.host} ${dataSource.port}
3. 检查防火墙设置
4. 确认Oracle监听器运行状态：lsnrctl status`;
        }
        if (errorMessage.includes('ORA-01017') || errorMessage.includes('invalid username/password')) {
            solution = `
🔐 认证问题解决方案：
1. 验证用户名和密码
2. 检查用户是否被锁定：SELECT ACCOUNT_STATUS FROM DBA_USERS WHERE USERNAME='${dataSource.username.toUpperCase()}'
3. 重置密码：ALTER USER ${dataSource.username} IDENTIFIED BY new_password`;
        }
        const fullError = `❌ Oracle连接失败: ${errorMessage}\n\n${solution}`;
        this.outputChannel.appendLine(fullError);
        return {
            success: false,
            message: `Oracle连接失败: ${errorMessage}`,
            error: fullError
        };
    }
    createOracleCompatibilityError(error, dataSource) {
        let errorMessage = error.message || '未知Oracle连接错误';
        let solution = '';
        if (errorMessage.includes('NJS-138') || errorMessage.includes('Thin mode') || errorMessage.includes('version')) {
            solution = `
🎯 Oracle版本兼容性解决方案

📊 当前配置：
- 主机: ${dataSource.host}
- 端口: ${dataSource.port}
- 服务名/SID: ${dataSource.databaseName}
- 错误: 版本不兼容

🛠️ 立即尝试：
1. 使用SID格式: ${dataSource.host}:${dataSource.port}:${dataSource.databaseName}
2. 使用服务名格式: ${dataSource.host}:${dataSource.port}/${dataSource.databaseName}
3. 检查Oracle版本: SELECT * FROM PRODUCT_COMPONENT_VERSION
4. 验证监听器: lsnrctl status`;
        }
        if (errorMessage.includes('ORA-')) {
            const oraCode = this.extractOracleErrorCode(errorMessage);
            solution = this.getOracleErrorSuggestion(oraCode, dataSource);
        }
        return {
            success: false,
            message: `Oracle连接失败: ${errorMessage}`,
            error: errorMessage + '\n\n' + solution
        };
    }
    checkOracleVersionCompatibility(errorMessage) {
        if (errorMessage.includes('NJS-138')) {
            return { errorType: '版本不兼容', detectedVersion: '低于11g R2' };
        }
        return { errorType: '未知错误' };
    }
    extractOracleErrorCode(errorMessage) {
        const match = errorMessage.match(/ORA-\d+/);
        return match ? match[0] : 'UNKNOWN';
    }
    getOracleErrorSuggestion(oraCode, dataSource) {
        const suggestions = {
            'ORA-12514': `监听器无法识别服务名：
- 检查服务名是否正确：${dataSource.databaseName}
- 使用lsnrctl status查看可用服务
- 尝试使用SID替代服务名`,
            'ORA-12541': `无监听器：
- Oracle监听器未启动
- 执行：lsnrctl start
- 检查监听器配置：listener.ora`,
            'ORA-01017': `用户名/密码无效：
- 检查用户名：${dataSource.username}
- 确认密码正确性
- 检查用户权限`,
            'ORA-12154': `TNS无法解析服务名：
- 检查tnsnames.ora配置
- 确认服务名：${dataSource.databaseName}
- 验证网络配置`
        };
        return suggestions[oraCode] || `Oracle错误 ${oraCode}：
- 检查连接参数
- 验证Oracle服务状态
- 查看监听器日志`;
    }
    parseConnectionString(connectionString) {
        try {
            const pattern = /^([^\/]+)\/([^@]+)@([^:]+):(\d+)\/(.+)$/;
            const match = connectionString.match(pattern);
            if (!match) {
                return {
                    username: '',
                    password: '',
                    host: '',
                    port: 0,
                    database: '',
                    valid: false,
                    error: '连接字符串格式不正确，应为：用户名/密码@IP:port/数据库名称'
                };
            }
            const [, username, password, host, portStr, database] = match;
            const port = parseInt(portStr, 10);
            if (isNaN(port) || port <= 0 || port > 65535) {
                return {
                    username,
                    password,
                    host,
                    port: 0,
                    database,
                    valid: false,
                    error: '端口号无效'
                };
            }
            return {
                username,
                password,
                host,
                port,
                database,
                valid: true
            };
        }
        catch (error) {
            return {
                username: '',
                password: '',
                host: '',
                port: 0,
                database: '',
                valid: false,
                error: error.message
            };
        }
    }
    getDataSource(name) {
        if (!this.config.dataSources) {
            return undefined;
        }
        return this.config.dataSources.find(ds => ds.name === name);
    }
    async addDataSource(dataSource) {
        if (!dataSource.name || dataSource.name.trim() === '') {
            throw new Error('数据源名称不能为空');
        }
        if (/[\u4e00-\u9fa5]/.test(dataSource.name)) {
            throw new Error('数据源名称不能包含中文字符');
        }
        const nameRegex = /^[a-zA-Z0-9_-]+$/;
        if (!nameRegex.test(dataSource.name)) {
            throw new Error('数据源名称只能包含英文、数字、下划线(_)和短横线(-)');
        }
        if (!dataSource.databaseType || dataSource.databaseType.trim() === '') {
            throw new Error('数据库类型不能为空');
        }
        if (!dataSource.host || dataSource.host.trim() === '') {
            throw new Error('主机地址不能为空');
        }
        if (!dataSource.port || dataSource.port <= 0 || dataSource.port > 65535) {
            throw new Error('端口号必须在1-65535之间');
        }
        if (!dataSource.databaseName || dataSource.databaseName.trim() === '') {
            throw new Error('数据库名不能为空');
        }
        if (!dataSource.username || dataSource.username.trim() === '') {
            throw new Error('用户名不能为空');
        }
        if (!dataSource.password || dataSource.password.trim() === '') {
            throw new Error('密码不能为空');
        }
        if (this.config.dataSources) {
            const exists = this.config.dataSources.some(ds => ds.name === dataSource.name);
            if (exists) {
                throw new Error(`数据源名称 "${dataSource.name}" 已存在`);
            }
        }
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }
        this.config.dataSources.push(dataSource);
        await this.saveConfig(this.config);
        if (this.config.homePath) {
            try {
                const dataSourceForPropXml = { ...dataSource };
                delete dataSourceForPropXml.alias;
                PropXmlUpdater_1.PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, dataSourceForPropXml, false);
                this.outputChannel.appendLine(`已将数据源 "${dataSource.name}" 写入prop.xml文件`);
            }
            catch (error) {
                const index = this.config.dataSources.findIndex(ds => ds.name === dataSource.name);
                if (index !== -1) {
                    this.config.dataSources.splice(index, 1);
                    await this.saveConfig(this.config);
                }
                this.outputChannel.appendLine(`写入prop.xml文件失败: ${error.message}`);
                throw new Error(`添加数据源失败: ${error.message}`);
            }
        }
        this.outputChannel.appendLine(`添加数据源: ${dataSource.name}`);
    }
    async updateDataSource(dataSource) {
        if (!dataSource.name || dataSource.name.trim() === '') {
            throw new Error('数据源名称不能为空');
        }
        if (/[\u4e00-\u9fa5]/.test(dataSource.name)) {
            throw new Error('数据源名称不能包含中文字符');
        }
        const nameRegex = /^[a-zA-Z0-9_-]+$/;
        if (!nameRegex.test(dataSource.name)) {
            throw new Error('数据源名称只能包含英文、数字、下划线(_)和短横线(-)');
        }
        if (!dataSource.databaseType || dataSource.databaseType.trim() === '') {
            throw new Error('数据库类型不能为空');
        }
        if (!dataSource.host || dataSource.host.trim() === '') {
            throw new Error('主机地址不能为空');
        }
        if (!dataSource.port || dataSource.port <= 0 || dataSource.port > 65535) {
            throw new Error('端口号必须在1-65535之间');
        }
        if (!dataSource.databaseName || dataSource.databaseName.trim() === '') {
            throw new Error('数据库名不能为空');
        }
        if (!dataSource.username || dataSource.username.trim() === '') {
            throw new Error('用户名不能为空');
        }
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }
        const index = this.config.dataSources.findIndex(ds => ds.name === dataSource.name);
        let oldDataSource = null;
        if (index !== -1) {
            oldDataSource = { ...this.config.dataSources[index] };
            if (!dataSource.password || dataSource.password.trim() === '') {
                dataSource.password = oldDataSource.password;
            }
            this.config.dataSources[index] = dataSource;
        }
        else {
            this.config.dataSources.push(dataSource);
        }
        await this.saveConfig(this.config);
        if (this.config.homePath) {
            try {
                const dataSourceForPropXml = { ...dataSource };
                delete dataSourceForPropXml.alias;
                PropXmlUpdater_1.PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, dataSourceForPropXml, true);
                this.outputChannel.appendLine(`已将数据源 "${dataSource.name}" 更新到prop.xml文件`);
            }
            catch (error) {
                if (index !== -1 && oldDataSource) {
                    this.config.dataSources[index] = oldDataSource;
                }
                else if (index === -1) {
                    const newIndex = this.config.dataSources.findIndex(ds => ds.name === dataSource.name);
                    if (newIndex !== -1) {
                        this.config.dataSources.splice(newIndex, 1);
                    }
                }
                await this.saveConfig(this.config);
                this.outputChannel.appendLine(`更新prop.xml文件失败: ${error.message}`);
                throw new Error(`更新数据源失败: ${error.message}`);
            }
        }
        this.outputChannel.appendLine(`更新数据源: ${dataSource.name}`);
    }
    async deleteDataSource(dataSourceName) {
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }
        const index = this.config.dataSources.findIndex(ds => ds.name === dataSourceName);
        let removedDataSource = null;
        if (index !== -1) {
            removedDataSource = this.config.dataSources.splice(index, 1)[0];
            if (this.config.selectedDataSource === dataSourceName) {
                this.config.selectedDataSource = undefined;
            }
            if (this.config.baseDatabase === dataSourceName) {
                this.config.baseDatabase = undefined;
            }
            await this.saveConfig(this.config);
        }
        if (this.config.homePath) {
            try {
                PropXmlUpdater_1.PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, dataSourceName);
                this.outputChannel.appendLine(`已从prop.xml文件中删除数据源 "${dataSourceName}"`);
            }
            catch (error) {
                if (index !== -1 && removedDataSource) {
                    this.config.dataSources.splice(index, 0, removedDataSource);
                    await this.saveConfig(this.config);
                }
                this.outputChannel.appendLine(`从prop.xml文件中删除数据源失败: ${error.message}`);
                throw new Error(`删除数据源失败: ${error.message}`);
            }
        }
        this.outputChannel.appendLine(`删除数据源: ${dataSourceName}`);
    }
    async setAsDesignDatabase(dataSourceName) {
        let dataSources = [];
        if (this.config.homePath) {
            const portsAndDataSourcesFromProp = this.getPortFromPropXml();
            dataSources = portsAndDataSourcesFromProp.dataSources;
        }
        const dataSourceIndex = dataSources.findIndex(ds => ds.name === dataSourceName);
        if (dataSourceIndex === -1) {
            throw new Error(`数据源 "${dataSourceName}" 不存在`);
        }
        const originalDataSource = { ...dataSources[dataSourceIndex] };
        const allDataSourceAliases = new Map();
        if (this.config.dataSources) {
            for (const ds of this.config.dataSources) {
                if (ds.alias) {
                    allDataSourceAliases.set(ds.name, ds.alias);
                }
            }
        }
        const existingDesignIndex = dataSources.findIndex(ds => ds.name === 'design');
        let replacedDataSource = null;
        if (existingDesignIndex !== -1) {
            replacedDataSource = { ...dataSources[existingDesignIndex] };
            const restoredName = this.config.replacedDesignDataSourceName || `design_${Date.now()}`;
            replacedDataSource.name = restoredName;
            if (allDataSourceAliases.has('design')) {
                replacedDataSource.alias = allDataSourceAliases.get('design');
            }
        }
        const newDesignDataSource = { ...originalDataSource };
        newDesignDataSource.name = 'design';
        if (allDataSourceAliases.has(originalDataSource.name)) {
            newDesignDataSource.alias = allDataSourceAliases.get(originalDataSource.name);
        }
        const rollbackPlan = {
            originalDataSource,
            replacedDataSource: replacedDataSource ? { ...replacedDataSource } : null,
            originalConfig: { ...this.config },
            existingDesignIndex
        };
        try {
            this.config.selectedDataSource = 'design';
            this.config.replacedDesignDataSourceName = originalDataSource.name;
            if (this.config.homePath) {
                if (existingDesignIndex !== -1) {
                    PropXmlUpdater_1.PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, 'design');
                    PropXmlUpdater_1.PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, replacedDataSource, false);
                    this.outputChannel.appendLine(`已将原有design数据源恢复为 "${replacedDataSource.name}"`);
                }
                PropXmlUpdater_1.PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, originalDataSource.name);
                PropXmlUpdater_1.PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, newDesignDataSource, false);
                this.outputChannel.appendLine(`已将数据源 "${originalDataSource.name}" 设置为design并写入prop.xml文件`);
            }
            const updatedDataSources = this.getPortFromPropXml().dataSources;
            if (!this.config.dataSources) {
                this.config.dataSources = [];
            }
            this.config.dataSources = updatedDataSources;
            for (const ds of this.config.dataSources) {
                if (ds.name === 'design' && allDataSourceAliases.has(originalDataSource.name)) {
                    ds.alias = allDataSourceAliases.get(originalDataSource.name);
                }
                else if (replacedDataSource && ds.name === replacedDataSource.name && allDataSourceAliases.has('design')) {
                    ds.alias = allDataSourceAliases.get('design');
                }
                else if (allDataSourceAliases.has(ds.name)) {
                    ds.alias = allDataSourceAliases.get(ds.name);
                }
            }
            await this.saveConfig(this.config);
            this.outputChannel.appendLine(`设置开发库: ${originalDataSource.name} 已设置为design`);
            vscode.window.showInformationMessage(`已将 "${originalDataSource.name}" 设置为开发库`);
        }
        catch (error) {
            this.outputChannel.appendLine(`设置开发库失败: ${error.message}，正在回滚...`);
            await this.rollbackDesignDatabaseChange(rollbackPlan);
            throw new Error(`设置开发库失败: ${error.message}`);
        }
    }
    async rollbackDesignDatabaseChange(rollbackPlan) {
        try {
            if (this.config.homePath) {
                PropXmlUpdater_1.PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, 'design');
                if (rollbackPlan.replacedDataSource && rollbackPlan.existingDesignIndex !== -1) {
                    PropXmlUpdater_1.PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, rollbackPlan.replacedDataSource.name);
                    const restoredDesign = { ...rollbackPlan.replacedDataSource };
                    restoredDesign.name = 'design';
                    PropXmlUpdater_1.PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, restoredDesign, false);
                }
                PropXmlUpdater_1.PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, rollbackPlan.originalDataSource, false);
            }
            this.config = { ...this.config, ...rollbackPlan.originalConfig };
            const updatedDataSources = this.getPortFromPropXml().dataSources;
            this.config.dataSources = updatedDataSources;
            await this.saveConfig(this.config);
            this.outputChannel.appendLine(`已成功回滚设计库更改`);
        }
        catch (rollbackError) {
            this.outputChannel.appendLine(`回滚失败: ${rollbackError.message}`);
            try {
                await this.saveConfig({ ...this.config, ...rollbackPlan.originalConfig });
                this.outputChannel.appendLine('已尝试保存原始配置到config.json');
            }
            catch (finalError) {
                this.outputChannel.appendLine(`最终配置保存失败: ${finalError.message}`);
                vscode.window.showErrorMessage(`回滚操作失败，配置可能已损坏。请检查prop.xml和config.json文件。`);
            }
        }
    }
    async setBaseDatabase(dataSourceName) {
        let dataSources = [];
        if (this.config.homePath) {
            const portsAndDataSourcesFromProp = this.getPortFromPropXml();
            dataSources = portsAndDataSourcesFromProp.dataSources;
        }
        if (!dataSources.some(ds => ds.name === dataSourceName)) {
            throw new Error(`数据源 "${dataSourceName}" 不存在`);
        }
        this.config.baseDatabase = dataSourceName;
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }
        const dataSourceAliases = new Map();
        for (const ds of this.config.dataSources) {
            if (ds.alias) {
                dataSourceAliases.set(ds.name, ds.alias);
            }
        }
        const updatedDataSources = this.getPortFromPropXml().dataSources;
        this.config.dataSources = updatedDataSources;
        for (const ds of this.config.dataSources) {
            if (dataSourceAliases.has(ds.name)) {
                ds.alias = dataSourceAliases.get(ds.name);
            }
        }
        await this.saveConfig(this.config);
        this.outputChannel.appendLine(`设置基准库: ${dataSourceName}`);
        vscode.window.showInformationMessage(`已设置 "${dataSourceName}" 为基准库`);
    }
    showOutput() {
        this.outputChannel.show();
    }
    checkSystemConfig() {
        if (!this.config.homePath) {
            return { valid: false, message: 'NC HOME路径未配置' };
        }
        if (!fs.existsSync(this.config.homePath)) {
            return { valid: false, message: `NC HOME路径不存在: ${this.config.homePath}` };
        }
        const propDir = path.join(this.config.homePath, 'ierp', 'bin');
        const propFile = path.join(propDir, 'prop.xml');
        if (!fs.existsSync(propDir)) {
            return { valid: false, message: `配置目录不存在: ${propDir}` };
        }
        if (!fs.existsSync(propFile)) {
            return { valid: false, message: `系统配置文件不存在: ${propFile}` };
        }
        try {
            const content = fs.readFileSync(propFile, 'utf-8');
            if ((content.includes('<config>') && content.includes('</config>')) ||
                (content.includes('<dataSources>') && content.includes('</dataSources>'))) {
                return { valid: true, message: '系统配置文件检查通过' };
            }
            if (content.trim().startsWith('<?xml') && content.includes('<')) {
                return { valid: true, message: '系统配置文件检查通过' };
            }
            return { valid: false, message: '系统配置文件格式不正确' };
        }
        catch (error) {
            return { valid: false, message: `读取配置文件失败: ${error.message}` };
        }
    }
    syncConfigFromPropXml() {
        try {
            const currentHomeVersion = this.config.homeVersion;
            const currentReplacedDesignDataSourceName = this.config.replacedDesignDataSourceName;
            const portsAndDataSourcesFromProp = this.getPortFromPropXml();
            if (portsAndDataSourcesFromProp.port !== null) {
                this.config.port = portsAndDataSourcesFromProp.port;
                this.outputChannel.appendLine(`已同步HTTP端口: ${portsAndDataSourcesFromProp.port}`);
            }
            if (portsAndDataSourcesFromProp.wsPort !== null) {
                this.config.wsPort = portsAndDataSourcesFromProp.wsPort;
                this.outputChannel.appendLine(`已同步Service端口: ${portsAndDataSourcesFromProp.wsPort}`);
            }
            if (portsAndDataSourcesFromProp.dataSources.length > 0) {
                const dataSourceAliases = new Map();
                if (this.config.dataSources) {
                    for (const ds of this.config.dataSources) {
                        if (ds.alias) {
                            dataSourceAliases.set(ds.name, ds.alias);
                        }
                    }
                }
                this.config.dataSources = portsAndDataSourcesFromProp.dataSources;
                this.outputChannel.appendLine(`已同步${portsAndDataSourcesFromProp.dataSources.length}个数据源`);
                if (this.config.dataSources) {
                    for (const ds of this.config.dataSources) {
                        if (dataSourceAliases.has(ds.name)) {
                            ds.alias = dataSourceAliases.get(ds.name);
                        }
                    }
                }
                const designDataSource = portsAndDataSourcesFromProp.dataSources.find(ds => ds.name === 'design');
                if (designDataSource) {
                    this.config.selectedDataSource = 'design';
                    this.config.baseDatabase = 'design';
                    this.outputChannel.appendLine('已设置design为默认数据源');
                }
                else if (portsAndDataSourcesFromProp.dataSources.length > 0) {
                    this.config.selectedDataSource = portsAndDataSourcesFromProp.dataSources[0].name;
                    this.outputChannel.appendLine(`已设置${portsAndDataSourcesFromProp.dataSources[0].name}为默认数据源`);
                }
            }
            else {
                this.config.dataSources = [];
                this.config.selectedDataSource = undefined;
                this.config.baseDatabase = undefined;
                this.config.replacedDesignDataSourceName = currentReplacedDesignDataSourceName;
                this.outputChannel.appendLine('未找到数据源配置，已清空数据源信息');
            }
            if (currentHomeVersion) {
                this.config.homeVersion = currentHomeVersion;
            }
            this.config.replacedDesignDataSourceName = currentReplacedDesignDataSourceName;
            this.invalidateConfigCache();
            this.outputChannel.appendLine('配置同步完成');
        }
        catch (error) {
            this.outputChannel.appendLine(`同步配置失败: ${error.message}`);
        }
    }
    getPortFromPropXml() {
        try {
            if (!this.config.homePath) {
                this.outputChannel.appendLine('Home路径未配置，无法读取prop.xml');
                return { port: null, wsPort: null, dataSources: [], vmParameters: undefined };
            }
            const propXmlPath = path.join(this.config.homePath, 'ierp', 'bin', 'prop.xml');
            if (!fs.existsSync(propXmlPath)) {
                this.outputChannel.appendLine(`prop.xml文件不存在: ${propXmlPath}`);
                return { port: null, wsPort: null, dataSources: [], vmParameters: undefined };
            }
            const buffer = fs.readFileSync(propXmlPath);
            const content = iconv.decode(buffer, 'gb2312');
            const portMatch = content.match(/<http>\s*<address>.*?<\/address>\s*<port>(\d+)<\/port>\s*<\/http>/s);
            let port = null;
            if (portMatch && portMatch[1]) {
                const parsedPort = parseInt(portMatch[1], 10);
                if (!isNaN(parsedPort)) {
                    this.outputChannel.appendLine(`从prop.xml中读取到端口: ${parsedPort}`);
                    port = parsedPort;
                }
            }
            const wsPortMatch = content.match(/<servicePort>(\d+)<\/servicePort>/);
            let wsPort = null;
            if (wsPortMatch && wsPortMatch[1]) {
                const parsedWsPort = parseInt(wsPortMatch[1], 10);
                if (!isNaN(parsedWsPort)) {
                    this.outputChannel.appendLine(`从prop.xml中读取到service端口: ${parsedWsPort}`);
                    wsPort = parsedWsPort;
                }
            }
            const dataSources = [];
            const dataSourceMatches = content.match(/<dataSource>([\s\S]*?)<\/dataSource>/g);
            if (dataSourceMatches) {
                for (const dataSourceMatch of dataSourceMatches) {
                    try {
                        const dataSourceNameMatch = dataSourceMatch.match(/<dataSourceName>(.*?)<\/dataSourceName>/);
                        const databaseUrlMatch = dataSourceMatch.match(/<databaseUrl>(.*?)<\/databaseUrl>/);
                        const userMatch = dataSourceMatch.match(/<user>(.*?)<\/user>/);
                        const passwordMatch = dataSourceMatch.match(/<password>(.*?)<\/password>/);
                        const driverClassNameMatch = dataSourceMatch.match(/<driverClassName>(.*?)<\/driverClassName>/);
                        const databaseTypeMatch = dataSourceMatch.match(/<databaseType>(.*?)<\/databaseType>/);
                        const oidMarkMatch = dataSourceMatch.match(/<oidMark>(.*?)<\/oidMark>/);
                        if (dataSourceNameMatch && databaseUrlMatch && userMatch) {
                            const dataSourceName = dataSourceNameMatch[1];
                            const databaseUrl = databaseUrlMatch[1];
                            const username = userMatch[1];
                            const password = passwordMatch ? passwordMatch[1] : '';
                            const driverClassName = driverClassNameMatch ? driverClassNameMatch[1] : '';
                            const databaseType = databaseTypeMatch ? databaseTypeMatch[1] : '';
                            const oidFlag = oidMarkMatch ? oidMarkMatch[1] : '';
                            let host = '';
                            let port = 0;
                            let databaseName = '';
                            if (databaseUrl.startsWith('jdbc:oracle:')) {
                                const urlMatch = databaseUrl.match(/jdbc:oracle:thin:@([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            }
                            else if (databaseUrl.startsWith('jdbc:mysql:')) {
                                const urlMatch = databaseUrl.match(/jdbc:mysql:\/\/([^:]+):(\d+)\/([^?]+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            }
                            else if (databaseUrl.startsWith('jdbc:sqlserver:')) {
                                const urlMatch = databaseUrl.match(/jdbc:sqlserver:\/\/([^:]+):(\d+);database=([^;]+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            }
                            else if (databaseUrl.startsWith('jdbc:postgresql:')) {
                                const urlMatch = databaseUrl.match(/jdbc:postgresql:\/\/([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            }
                            else if (databaseUrl.startsWith('jdbc:dm:')) {
                                const urlMatch = databaseUrl.match(/jdbc:dm:\/\/([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            }
                            else if (databaseUrl.startsWith('jdbc:kingbase8:')) {
                                const urlMatch = databaseUrl.match(/jdbc:kingbase8:\/\/([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            }
                            else {
                                const urlMatch = databaseUrl.match(/\/\/([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            }
                            let decryptedPassword = password;
                            if (password) {
                                try {
                                    decryptedPassword = PasswordEncryptor_1.PasswordEncryptor.getSecurePassword(this.config.homePath, password);
                                    const replacementCharCount = (decryptedPassword.match(/\uFFFD/g) || []).length;
                                    if (replacementCharCount > 2) {
                                        decryptedPassword = '[加密密码-需要重新输入]';
                                    }
                                }
                                catch (decryptError) {
                                    this.outputChannel.appendLine(`解密密码失败: ${decryptError.message}`);
                                    decryptedPassword = '[加密密码-需要重新输入]';
                                }
                            }
                            if (typeof decryptedPassword !== 'string') {
                                decryptedPassword = String(decryptedPassword || '');
                            }
                            const dataSource = {
                                name: dataSourceName,
                                databaseType: databaseType,
                                driverClassName: driverClassName,
                                host: host,
                                port: port,
                                databaseName: databaseName,
                                oidFlag: oidFlag,
                                username: username,
                                password: decryptedPassword
                            };
                            if (this.config.dataSources) {
                                const existingDataSource = this.config.dataSources.find(ds => ds.name === dataSourceName);
                                if (existingDataSource && existingDataSource.alias) {
                                    dataSource.alias = existingDataSource.alias;
                                }
                            }
                            dataSources.push(dataSource);
                            this.outputChannel.appendLine(`从prop.xml中读取到数据源: ${dataSourceName}`);
                        }
                    }
                    catch (error) {
                        this.outputChannel.appendLine(`解析数据源信息时出错: ${error.message}`);
                    }
                }
            }
            if (port === null && wsPort === null && dataSources.length === 0) {
                this.outputChannel.appendLine('未在prop.xml中找到有效的端口配置或数据源配置');
            }
            return { port, wsPort, dataSources, vmParameters: undefined };
        }
        catch (error) {
            this.outputChannel.appendLine(`读取prop.xml文件失败: ${error.message}`);
            return { port: null, wsPort: null, dataSources: [], vmParameters: undefined };
        }
    }
    async getLatestLogs() {
        try {
            if (!this.config.homePath) {
                throw new Error('NC HOME路径未配置');
            }
            const logsDir = path.join(this.config.homePath, 'nclogs', 'server');
            if (!fs.existsSync(logsDir)) {
                throw new Error(`日志目录不存在: ${logsDir}`);
            }
            const files = fs.readdirSync(logsDir);
            const logFiles = files
                .filter(file => file.endsWith('.log'))
                .map(file => {
                const filePath = path.join(logsDir, file);
                const stat = fs.statSync(filePath);
                return {
                    name: file,
                    path: filePath,
                    mtime: stat.mtime
                };
            })
                .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            const latestLogFiles = logFiles.slice(0, 5);
            const logs = await Promise.all(latestLogFiles.map(async (file) => {
                try {
                    const buffer = Buffer.alloc(10240);
                    const fd = fs.openSync(file.path, 'r');
                    const stats = fs.fstatSync(fd);
                    const startPosition = Math.max(0, stats.size - 10240);
                    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, startPosition);
                    fs.closeSync(fd);
                    const content = buffer.slice(0, bytesRead).toString('utf-8');
                    return {
                        fileName: file.name,
                        content: content
                    };
                }
                catch (readError) {
                    return {
                        fileName: file.name,
                        content: `读取文件失败: ${readError.message}`
                    };
                }
            }));
            return logs;
        }
        catch (error) {
            this.outputChannel.appendLine(`获取日志失败: ${error.message}`);
            throw new Error(`获取日志失败: ${error.message}`);
        }
    }
    dispose() {
        if (NCHomeConfigService.outputChannelInstance) {
            NCHomeConfigService.outputChannelInstance.dispose();
            NCHomeConfigService.outputChannelInstance = null;
        }
    }
    getOracleClientInstallationGuide(errorMessage) {
        const platform = process.platform;
        let guide = `❌ Oracle客户端库未找到

错误详情: ${errorMessage}

解决方法:
`;
        if (platform === 'win32') {
            guide += `1. 从 https://www.oracle.com/database/technologies/instant-client.html 下载Oracle Instant Client\n`;
            guide += `2. 选择Windows平台的Instant Client Basic包（如: instantclient-basic-windows.x64-21.8.0.0.0dbru.zip）\n`;
            guide += `3. 将Instant Client解压到目录（如: C:\\oracle\\instantclient_21_8）\n`;
            guide += `4. 将解压目录添加到系统PATH环境变量中\n`;
            guide += `5. 重启VS Code以使环境变量生效\n\n`;
            guide += `或者在代码中指定libDir路径:\n`;
            guide += `oracledb.initOracleClient({libDir: 'C:\\\\path\\\\to\\\\instantclient'});`;
        }
        else if (platform === 'darwin') {
            guide += `1. 从 https://www.oracle.com/database/technologies/instant-client.html 下载Oracle Instant Client\n`;
            guide += `2. 选择macOS平台的Instant Client Basic包（如: instantclient-basic-macos.x64-21.8.0.0.0dbru.zip）\n`;
            guide += `3. 将Instant Client解压到目录（如: /opt/oracle/instantclient_21_8）\n`;
            guide += `4. 在macOS上创建符号链接:\n`;
            guide += `   cd /opt/oracle/instantclient_21_8\n`;
            guide += `   ln -s libclntsh.dylib.* libclntsh.dylib\n`;
            guide += `5. 设置环境变量:\n`;
            guide += `   export DYLD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$DYLD_LIBRARY_PATH\n\n`;
            guide += `或者在代码中指定libDir路径:\n`;
            guide += `oracledb.initOracleClient({libDir: '/path/to/instantclient'});`;
        }
        else if (platform === 'linux') {
            guide += `1. 从 https://www.oracle.com/database/technologies/instant-client.html 下载Oracle Instant Client\n`;
            guide += `2. 选择Linux平台的Instant Client Basic包（如: instantclient-basic-linux.x64-21.8.0.0.0dbru.zip）\n`;
            guide += `3. 将Instant Client解压到目录（如: /opt/oracle/instantclient_21_8）\n`;
            guide += `4. 设置环境变量:\n`;
            guide += `   export LD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$LD_LIBRARY_PATH\n\n`;
            guide += `或者在代码中指定libDir路径:\n`;
            guide += `oracledb.initOracleClient({libDir: '/path/to/instantclient'});`;
        }
        else {
            guide += `1. 从 https://www.oracle.com/database/technologies/instant-client.html 下载适用于您系统的Oracle Instant Client\n`;
            guide += `2. 将Instant Client解压到目录\n`;
            guide += `3. 根据您系统的文档设置相应的环境变量\n\n`;
            guide += `或者在代码中指定libDir路径:\n`;
            guide += `oracledb.initOracleClient({libDir: '/path/to/instantclient'});`;
        }
        return guide;
    }
}
exports.NCHomeConfigService = NCHomeConfigService;
//# sourceMappingURL=NCHomeConfigService.js.map