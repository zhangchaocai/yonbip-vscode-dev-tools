import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { NCHomeConfig, DataSourceMeta, ConnectionTestResult, AutoParseResult, DRIVER_INFO_MAP } from './NCHomeConfigTypes';
import { PasswordEncryptor } from '../../../utils/PasswordEncryptor';
import { PropXmlUpdater } from '../../../utils/PropXmlUpdater';

/**
 * NC Home配置服务
 */
export class NCHomeConfigService {
    private context: vscode.ExtensionContext;
    private static outputChannelInstance: vscode.OutputChannel | null = null;
    private static oracleClientInitialized: boolean = false;
    private static oracleClientLibDir: string | null = null;
    private outputChannel: vscode.OutputChannel;
    private config: NCHomeConfig;
    private configFilePath: string;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        // 确保outputChannel只初始化一次
        if (!NCHomeConfigService.outputChannelInstance) {
            NCHomeConfigService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP NC Home配置');
        }
        this.outputChannel = NCHomeConfigService.outputChannelInstance;
        this.configFilePath = this.getConfigFilePath();
        this.config = this.loadConfig();
    }

    /**
     * 获取配置文件路径
     * 只使用工作区目录下的配置文件
     */
    private getConfigFilePath(): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            // 使用工作区根目录下的配置文件
            const workspaceConfigPath = path.join(workspaceFolders[0].uri.fsPath, '.nc-home-config.json');
            return workspaceConfigPath;
        } else {
            // 如果没有工作区，仍然使用工作区目录下的配置文件（这种情况理论上不应该发生）
            // 但为了防止错误，我们使用一个默认路径
            const defaultPath = path.join(this.context.extensionPath, '.nc-home-config.json');
            this.outputChannel.appendLine(`警告：没有工作区，使用默认路径: ${defaultPath}`);
            return defaultPath;
        }
    }

    /**
     * 重新加载配置
     */
    public reloadConfig(): void {
        // 重新计算配置文件路径
        this.configFilePath = this.getConfigFilePath();
        // 重新加载配置
        this.config = this.loadConfig();
        this.outputChannel.appendLine(`配置已重新加载，使用路径: ${this.configFilePath}`);
    }

    /**
     * 获取配置（在返回给前端前处理密码解密）
     */
    public getConfig(): NCHomeConfig {
        // 创建配置的深拷贝，避免修改原始配置
        const configCopy: NCHomeConfig = JSON.parse(JSON.stringify(this.config));

        // 如果存在数据源，对密码进行解密处理
        if (configCopy.dataSources && configCopy.dataSources.length > 0) {
            for (const dataSource of configCopy.dataSources) {
                if (dataSource.password) {
                    // 使用PasswordEncryptor解密密码
                    const decryptedPassword = PasswordEncryptor.getSecurePassword(dataSource.password);

                    // 检查解密结果是否包含大量乱码字符
                    // 如果解密后包含多个连续的替换字符，说明解密可能失败
                    const replacementCharCount = (decryptedPassword.match(/\uFFFD/g) || []).length;
                    if (replacementCharCount > 2) {
                        // 如果解密后包含过多乱码，说明可能使用了不同的加密方式
                        // 在这种情况下，我们显示一个占位符而不是乱码
                        dataSource.password = '[加密密码-需要重新输入]';
                    } else {
                        dataSource.password = decryptedPassword;
                    }
                }
            }
        }

        return configCopy;
    }

    /**
     * 获取完整配置（直接返回配置对象引用）
     */
    public getFullConfig(): NCHomeConfig {
        return this.config;
    }

    /**
     * 保存配置
     */
    public async saveConfig(config: NCHomeConfig): Promise<void> {
        try {
            this.config = { ...config };

            // 确保存储目录存在
            const storageDir = path.dirname(this.configFilePath);
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }

            // 保存到文件
            fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf-8');

            // 同时保存到VS Code配置
            await this.saveToWorkspaceConfig();

            this.outputChannel.appendLine(`配置已保存: ${this.configFilePath}`);
            vscode.window.showInformationMessage('NC Home配置已保存');

        } catch (error: any) {
            this.outputChannel.appendLine(`保存配置失败: ${error.message}`);
            vscode.window.showErrorMessage(`保存配置失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 从文件加载配置
     */
    private loadConfig(): NCHomeConfig {
        try {
            if (fs.existsSync(this.configFilePath)) {
                const content = fs.readFileSync(this.configFilePath, 'utf-8');
                const config = JSON.parse(content) as NCHomeConfig;
                this.outputChannel.appendLine(`配置已加载: ${this.configFilePath}`);

                // 确保所有默认字段都存在，特别是 debugMode
                const defaultConfig = this.getDefaultConfig();
                const mergedConfig = { ...defaultConfig, ...config };

                return mergedConfig;
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`加载配置失败: ${error.message}`);
        }

        // 返回默认配置
        return this.getDefaultConfig();
    }

    /**
     * 获取默认配置
     */
    private getDefaultConfig(): NCHomeConfig {
        // 从工作区配置中获取debugPort的值，如果获取不到则使用默认值8888
        const workspaceConfig = vscode.workspace.getConfiguration('yonbip');
        const debugPort = workspaceConfig.get<number>('home.debugPort') || 8888;

        return {
            homePath: '',
            asyncTask: false,
            autoClient: true,
            exportAllsql: true,
            customTableCheck: false,
            showLocalDatadict: false,
            autoChangeJdk: false,
            standardMode: true,
            dataSources: [],

            port: 9999,
            wsPort: 8080,
            debugMode: true,  // 默认启用调试模式
            debugPort: debugPort   // 使用工作区配置的调试端口，默认为8888
        };
    }

    /**
     * 保存到工作区配置
     */
    private async saveToWorkspaceConfig(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('yonbip');

            // 保存NC HOME路径到工作区配置
            if (this.config.homePath) {
                await config.update('homePath', this.config.homePath, vscode.ConfigurationTarget.Global);
            }

            // 保存其他配置到工作区
            await config.update('hotwebs', this.config.hotwebs, vscode.ConfigurationTarget.Global);
            await config.update('exModules', this.config.exModules, vscode.ConfigurationTarget.Global);
            await config.update('home.debugPort', this.config.debugPort, vscode.ConfigurationTarget.Global);
        } catch (error: any) {
            this.outputChannel.appendLine(`保存到工作区配置失败: ${error.message}`);
        }
    }

    /**
     * 选择Home目录
     */
    public async selectHomeDirectory(): Promise<string | undefined> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: '选择 NC Home 目录',
            title: '选择 YonBIP NC Home 目录'
        });

        if (result && result[0]) {
            const homePath = result[0].fsPath;

            // 验证是否为有效的NC Home目录
            if (await this.validateHomeDirectory(homePath)) {
                return homePath;
            } else {
                vscode.window.showWarningMessage('选择的目录不是有效的NC Home目录');
                return undefined;
            }
        }

        return undefined;
    }

    /**
     * 验证Home目录
     */
    private async validateHomeDirectory(homePath: string): Promise<boolean> {
        try {
            // 检查关键目录和文件
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

        } catch (error: any) {
            this.outputChannel.appendLine(`验证Home目录失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 打开Home目录
     */
    public async openHomeDirectory(): Promise<void> {
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
        } catch (error: any) {
            this.outputChannel.appendLine(`打开Home目录失败: ${error.message}`);
            vscode.window.showErrorMessage(`打开Home目录失败: ${error.message}`);
        }
    }

    /**
     * 打开SysConfig
     */
    public async openSysConfig(): Promise<void> {
        if (!this.config.homePath) {
            vscode.window.showWarningMessage('请先配置NC Home路径');
            return;
        }

        const sysConfigPath = path.join(this.config.homePath, 'bin', 'sysconfig.bat');
        const sysConfigPathSh = path.join(this.config.homePath, 'bin', 'sysconfig.sh');

        let configPath = '';
        // 根据操作系统选择合适的脚本文件
        if (process.platform === 'win32' && fs.existsSync(sysConfigPath)) {
            configPath = sysConfigPath;
        } else if ((process.platform === 'darwin' || process.platform === 'linux') && fs.existsSync(sysConfigPathSh)) {
            configPath = sysConfigPathSh;
        } else if (fs.existsSync(sysConfigPath)) {
            // Windows系统，使用.bat文件
            configPath = sysConfigPath;
        } else if (fs.existsSync(sysConfigPathSh)) {
            // Unix系统，使用.sh文件
            configPath = sysConfigPathSh;
        } else {
            vscode.window.showErrorMessage('未找到SysConfig工具');
            return;
        }

        try {
            const terminal = vscode.window.createTerminal('SysConfig');
            // 根据操作系统决定是否需要添加执行权限
            if ((process.platform === 'darwin' || process.platform === 'linux') && configPath.endsWith('.sh')) {
                // 对于Unix系统上的shell脚本，确保有执行权限
                terminal.sendText(`chmod +x "${configPath}" && "${configPath}"`);
            } else {
                terminal.sendText(`"${configPath}"`);
            }
            terminal.show();
        } catch (error: any) {
            this.outputChannel.appendLine(`启动SysConfig失败: ${error.message}`);
            vscode.window.showErrorMessage(`启动SysConfig失败: ${error.message}`);
        }
    }

    /**
     * 测试数据库连接
     */
    public async testConnection(dataSource: DataSourceMeta): Promise<ConnectionTestResult> {
        try {
            this.outputChannel.appendLine(`开始测试数据库连接: ${dataSource.name}`);

            // 验证基本参数
            if (!dataSource.host || !dataSource.username || !dataSource.databaseName) {
                return {
                    success: false,
                    message: '连接参数不完整，请检查主机、用户名和数据库名'
                };
            }

            // 处理密码解密
            const securePassword = PasswordEncryptor.getSecurePassword(dataSource.password || '');
            const secureDataSource = {
                ...dataSource,
                password: securePassword
            };

            this.outputChannel.appendLine(`使用解密后的密码进行连接测试`);

            if (!dataSource.port || dataSource.port <= 0 || dataSource.port > 65535) {
                return {
                    success: false,
                    message: '端口号无效'
                };
            }

            let connectionResult: ConnectionTestResult;

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

        } catch (error: any) {
            const errorMsg = `连接测试失败: ${error.message}`;
            this.outputChannel.appendLine(errorMsg);

            return {
                success: false,
                message: errorMsg,
                error: error.message
            };
        }
    }

    /**
     * 测试MySQL连接
     */
    private async testMySQLConnection(dataSource: DataSourceMeta): Promise<ConnectionTestResult> {
        try {
            // 动态导入mysql2驱动
            const mysql = await import('mysql2/promise');

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

            // 执行简单的查询测试
            const [rows] = await connection.execute('SELECT 1 as test');
            await connection.end();

            return {
                success: true,
                message: `MySQL连接成功 - 主机: ${dataSource.host}:${dataSource.port}, 数据库: ${dataSource.databaseName}`
            };

        } catch (error: any) {
            return {
                success: false,
                message: `MySQL连接失败: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * 测试PostgreSQL连接
     */
    private async testPostgreSQLConnection(dataSource: DataSourceMeta): Promise<ConnectionTestResult> {
        try {
            // 动态导入pg驱动
            const pg = await import('pg');

            const connectionConfig = {
                host: dataSource.host,
                port: dataSource.port,
                user: dataSource.username,
                password: dataSource.password || '',
                database: dataSource.databaseName,
                connectionTimeoutMillis: 10000,
                statement_timeout: 10000
            };

            this.outputChannel.appendLine(`连接PostgreSQL: ${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`);

            const client = new pg.Client(connectionConfig);
            await client.connect();

            // 执行简单的查询测试
            const result = await client.query('SELECT 1 as test');
            await client.end();

            return {
                success: true,
                message: `PostgreSQL连接成功 - 主机: ${dataSource.host}:${dataSource.port}, 数据库: ${dataSource.databaseName}`
            };

        } catch (error: any) {
            return {
                success: false,
                message: `PostgreSQL连接失败: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * 测试SQL Server连接
     */
    private async testSQLServerConnection(dataSource: DataSourceMeta): Promise<ConnectionTestResult> {
        try {
            // 动态导入mssql驱动
            const mssql = await import('mssql');

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

            // 执行简单的查询测试
            const result = await pool.request().query('SELECT 1 as test');
            await pool.close();

            return {
                success: true,
                message: `SQL Server连接成功 - 主机: ${dataSource.host}:${dataSource.port}, 数据库: ${dataSource.databaseName}`
            };

        } catch (error: any) {
            return {
                success: false,
                message: `SQL Server连接失败: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * 测试Oracle连接 - 使用Thick模式确保兼容所有Oracle版本
     */
    private async testOracleConnection(dataSource: DataSourceMeta): Promise<ConnectionTestResult> {
        try {
            // 动态导入oracledb驱动
            const oracledb = await import('oracledb');

            // 构建连接字符串
            const connectString = `${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;

            this.outputChannel.appendLine(`🔍 开始测试Oracle连接: ${connectString}`);

            // 检查是否已经初始化过Oracle客户端
            // 修复NJS-090错误：在调用initOracleClient前检查oracleClientVersion是否存在
            if (!oracledb.oracleClientVersion && !NCHomeConfigService.oracleClientInitialized) {
                this.outputChannel.appendLine(`🔄 初始化Oracle Thick模式...`);

                try {
                    // 尝试初始化Thick模式
                    // 首先尝试使用默认路径初始化
                    oracledb.initOracleClient();
                    this.outputChannel.appendLine(`✅ Oracle Thick模式初始化成功`);
                    NCHomeConfigService.oracleClientInitialized = true;
                } catch (initError: any) {
                    this.outputChannel.appendLine(`⚠️ Oracle Thick模式初始化失败: ${initError.message}`);

                    // 检查是否是DPI-1047错误（无法找到Oracle客户端库）
                    if (initError.message && initError.message.includes('DPI-1047')) {
                        // 尝试使用常见的Oracle Instant Client安装路径
                        const commonPaths = [
                            '/opt/oracle/instantclient_23_3',  // 你的实际安装路径
                            '/opt/oracle/instantclient_21_8',
                            '/opt/oracle/instantclient_19_17',
                            '/usr/local/oracle/instantclient_23_3',
                            '/usr/local/oracle/instantclient_21_8',
                            '/usr/local/oracle/instantclient_19_17',
                            '/opt/homebrew/lib',  // Homebrew库路径
                            path.join(this.context.globalStoragePath, 'oracle_client')
                        ];

                        // 添加从环境变量中获取的路径
                        if (process.env.DYLD_LIBRARY_PATH) {
                            const dyldPaths = process.env.DYLD_LIBRARY_PATH.split(':');
                            commonPaths.unshift(...dyldPaths);  // 将环境变量路径放在最前面
                        }

                        let initialized = false;
                        for (const clientPath of commonPaths) {
                            if (clientPath && fs.existsSync(clientPath)) {
                                try {
                                    // 检查是否已经初始化过Oracle客户端
                                    // 修复NJS-090错误：在调用initOracleClient前检查oracleClientVersion是否存在
                                    if (!oracledb.oracleClientVersion) {
                                        oracledb.initOracleClient({ libDir: clientPath });
                                    }
                                    this.outputChannel.appendLine(`✅ Oracle Thick模式使用路径初始化成功: ${clientPath}`);
                                    initialized = true;
                                    NCHomeConfigService.oracleClientInitialized = true;
                                    break;
                                } catch (pathError: any) {
                                    this.outputChannel.appendLine(`⚠️ 路径 ${clientPath} 初始化失败: ${pathError.message}`);
                                }
                            }
                        }

                        // 如果所有常见路径都失败了，返回详细的错误信息
                        if (!initialized) {
                            return {
                                success: false,
                                message: `❌ Oracle客户端库未找到\n\n` +
                                    `错误详情: ${initError.message}\n\n` +
                                    `解决方法:\n` +
                                    `1. 从 https://www.oracle.com/database/technologies/instant-client.html 下载Oracle Instant Client\n` +
                                    `2. 将Instant Client解压到目录（如: /opt/oracle/instantclient_21_8）\n` +
                                    `3. 在macOS上创建符号链接:\n` +
                                    `   cd /opt/oracle/instantclient_21_8\n` +
                                    `   ln -s libclntsh.dylib.* libclntsh.dylib\n` +
                                    `4. 设置环境变量:\n` +
                                    `   export LD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$LD_LIBRARY_PATH\n` +
                                    `   (Linux) 或 export DYLD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$DYLD_LIBRARY_PATH (macOS)\n\n` +
                                    `或者在代码中指定libDir路径:\n` +
                                    `oracledb.initOracleClient({libDir: '/path/to/instantclient'});`
                            };
                        }
                    } else {
                        this.outputChannel.appendLine(`💡 提示: 请确保已安装Oracle Instant Client`);
                        NCHomeConfigService.oracleClientInitialized = true;
                    }
                }
            } else {
                this.outputChannel.appendLine(`ℹ️ Oracle客户端已初始化，跳过重复初始化`);
            }

            try {
                // 使用Thick模式进行连接
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
            } catch (thickError: any) {
                this.outputChannel.appendLine(`⚠️ Thick模式连接失败: ${thickError.message}`);
                // 如果Thick模式也失败了，尝试旧版本兼容模式
                return await this.testOracleLegacyCompatibility(dataSource);
            }

        } catch (error: any) {
            this.outputChannel.appendLine(`❌ Oracle连接测试出现未处理的错误: ${error.message}`);
            return await this.handleOracleConnectionError(error, dataSource);
        }
    }

    /**
     * Oracle旧版本兼容模式
     */
    private async testOracleLegacyCompatibility(dataSource: DataSourceMeta): Promise<ConnectionTestResult> {
        try {
            // 动态导入oracledb驱动
            const oracledb = await import('oracledb');

            this.outputChannel.appendLine(`🔄 尝试Oracle旧版本兼容模式...`);

            // 检查是否已经初始化过Oracle客户端
            // 修复NJS-090错误：在调用initOracleClient前检查oracleClientVersion是否存在
            if (!oracledb.oracleClientVersion && !NCHomeConfigService.oracleClientInitialized) {
                this.outputChannel.appendLine(`⚠️ Oracle客户端未初始化，尝试初始化...`);
                try {
                    oracledb.initOracleClient();
                    NCHomeConfigService.oracleClientInitialized = true;
                    this.outputChannel.appendLine(`✅ Oracle客户端初始化成功`);
                } catch (initError: any) {
                    this.outputChannel.appendLine(`⚠️ Oracle客户端初始化失败: ${initError.message}`);
                    // 即使初始化失败，仍然尝试连接，因为可能是Thin模式
                }
            }

            // 尝试多种连接格式
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
                } catch (formatError: any) {
                    this.outputChannel.appendLine(`   格式 ${i + 1} 失败: ${formatError.message.substring(0, 100)}...`);
                    continue;
                }
            }

            // 如果所有格式都失败了，返回错误信息
            return {
                success: false,
                message: `❌ 所有Oracle连接格式都失败，请检查连接参数和网络连接`
            };

        } catch (error: any) {
            this.outputChannel.appendLine(`❌ Oracle兼容模式出现未处理的错误: ${error.message}`);
            return {
                success: false,
                message: `❌ Oracle兼容模式连接失败: ${error.message}`
            };
        }
    }

    /**
     * 处理Oracle连接错误
     */
    private async handleOracleConnectionError(error: any, dataSource: DataSourceMeta): Promise<ConnectionTestResult> {
        let errorMessage = error.message || '未知Oracle连接错误';
        let solution = '';

        this.outputChannel.appendLine(`❌ Oracle连接错误: ${errorMessage}`);

        // 检查版本兼容性
        if (errorMessage.includes('NJS-138') || errorMessage.includes('Thin mode') || errorMessage.includes('version')) {
            return this.testOracleLegacyCompatibility(dataSource);
        }

        // 处理ORA错误
        if (errorMessage.includes('ORA-')) {
            const oraCode = this.extractOracleErrorCode(errorMessage);
            solution = this.getOracleErrorSuggestion(oraCode, dataSource);
        }

        // 处理网络错误
        if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
            solution = `
🔧 网络连接问题解决方案：
1. 检查主机名解析：nslookup ${dataSource.host}
2. 测试端口连通性：telnet ${dataSource.host} ${dataSource.port}
3. 检查防火墙设置
4. 确认Oracle监听器运行状态：lsnrctl status`;
        }

        // 处理认证错误
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

    /**
     * 创建Oracle兼容性错误信息（已弃用，使用handleOracleConnectionError替代）
     */
    private createOracleCompatibilityError(error: any, dataSource: DataSourceMeta): ConnectionTestResult {
        // 由于handleOracleConnectionError是异步的，这里同步处理
        let errorMessage = error.message || '未知Oracle连接错误';
        let solution = '';

        // 检查版本兼容性
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

        // 处理ORA错误
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

    /**
     * 检查Oracle版本兼容性
     */
    private checkOracleVersionCompatibility(errorMessage: string): { detectedVersion?: string; errorType: string } {
        if (errorMessage.includes('NJS-138')) {
            return { errorType: '版本不兼容', detectedVersion: '低于11g R2' };
        }
        return { errorType: '未知错误' };
    }

    /**
     * 提取Oracle错误代码
     */
    private extractOracleErrorCode(errorMessage: string): string {
        const match = errorMessage.match(/ORA-\d+/);
        return match ? match[0] : 'UNKNOWN';
    }

    /**
     * 获取Oracle错误建议
     */
    private getOracleErrorSuggestion(oraCode: string, dataSource: DataSourceMeta): string {
        const suggestions: Record<string, string> = {
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

    /**
     * 自动解析连接字符串
     * 格式：用户名/密码@IP:port/数据库名称
     * 示例：yonbip_2023/password@127.0.0.1:1521/orcl
     */
    public parseConnectionString(connectionString: string): AutoParseResult {
        try {
            // 解析连接字符串
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

        } catch (error: any) {
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

    /**
     * 获取数据源
     */
    public getDataSource(name: string): DataSourceMeta | undefined {
        if (!this.config.dataSources) {
            return undefined;
        }
        return this.config.dataSources.find(ds => ds.name === name);
    }

    /**
     * 添加数据源
     */
    public async addDataSource(dataSource: DataSourceMeta): Promise<void> {
        // 完整验证 - 检查所有字段是否已填写
        if (!dataSource.name || dataSource.name.trim() === '') {
            throw new Error('数据源名称不能为空');
        }

        // 数据源名称格式校验 - 只能包含英文、数字、下划线和短横线
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

        // 密码字段必填校验
        if (!dataSource.password || dataSource.password.trim() === '') {
            throw new Error('密码不能为空');
        }

        // 检查数据源名称是否重复
        if (this.config.dataSources) {
            const exists = this.config.dataSources.some(ds => ds.name === dataSource.name);
            if (exists) {
                throw new Error(`数据源名称 "${dataSource.name}" 已存在`);
            }
        }

        // 注意：这里不再将数据源添加到config.dataSources中，只保存到prop.xml文件
        // this.config.dataSources.push(dataSource);
        // await this.saveConfig(this.config);

        // 直接更新prop.xml文件
        if (this.config.homePath) {
            try {
                PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, dataSource, false);
                this.outputChannel.appendLine(`已将数据源 "${dataSource.name}" 写入prop.xml文件`);
            } catch (error: any) {
                this.outputChannel.appendLine(`写入prop.xml文件失败: ${error.message}`);
                throw new Error(`添加数据源失败: ${error.message}`);
            }
        }

        this.outputChannel.appendLine(`添加数据源: ${dataSource.name}`);
    }

    /**
     * 更新数据源
     */
    public async updateDataSource(dataSource: DataSourceMeta): Promise<void> {
        // 完整验证 - 检查所有字段是否已填写
        if (!dataSource.name || dataSource.name.trim() === '') {
            throw new Error('数据源名称不能为空');
        }

        // 数据源名称格式校验 - 只能包含英文、数字、下划线和短横线
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

        // 注意：密码字段可以为空，表示不修改密码

        // 注意：这里不再更新config.dataSources，只更新prop.xml文件
        // if (!this.config.dataSources) {
        //     this.config.dataSources = [];
        //     return;
        // }

        // const index = this.config.dataSources.findIndex(ds => ds.name === dataSource.name);
        // if (index === -1) {
        //     throw new Error(`数据源 "${dataSource.name}" 不存在`);
        // }

        // this.config.dataSources[index] = dataSource;
        // await this.saveConfig(this.config);

        // 直接更新prop.xml文件
        if (this.config.homePath) {
            try {
                PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, dataSource, true);
                this.outputChannel.appendLine(`已将数据源 "${dataSource.name}" 更新到prop.xml文件`);
            } catch (error: any) {
                this.outputChannel.appendLine(`更新prop.xml文件失败: ${error.message}`);
                throw new Error(`更新数据源失败: ${error.message}`);
            }
        }

        this.outputChannel.appendLine(`更新数据源: ${dataSource.name}`);
    }

    /**
     * 删除数据源
     */
    public async deleteDataSource(dataSourceName: string): Promise<void> {
        // 注意：这里不再从config.dataSources中删除，只从prop.xml文件中删除
        // if (!this.config.dataSources) {
        //     return;
        // }

        // const index = this.config.dataSources.findIndex(ds => ds.name === dataSourceName);
        // if (index === -1) {
        //     throw new Error(`数据源 "${dataSourceName}" 不存在`);
        // }

        // this.config.dataSources.splice(index, 1);

        // // 如果删除的是当前选中的数据源，清除选择
        // if (this.config.selectedDataSource === dataSourceName) {
        //     this.config.selectedDataSource = undefined;
        // }

        // // 如果删除的是基准库，清除基准库设置
        // if (this.config.baseDatabase === dataSourceName) {
        //     this.config.baseDatabase = undefined;
        // }

        // await this.saveConfig(this.config);

        // 直接从prop.xml文件中删除数据源
        if (this.config.homePath) {
            try {
                PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, dataSourceName);
                this.outputChannel.appendLine(`已从prop.xml文件中删除数据源 "${dataSourceName}"`);
            } catch (error: any) {
                this.outputChannel.appendLine(`从prop.xml文件中删除数据源失败: ${error.message}`);
                throw new Error(`删除数据源失败: ${error.message}`);
            }
        }

        this.outputChannel.appendLine(`删除数据源: ${dataSourceName}`);
    }

    /**
     * 设置为开发库
     */
    public async setAsDesignDatabase(dataSourceName: string): Promise<void> {
        // 从prop.xml文件中获取当前数据源列表
        let dataSources: DataSourceMeta[] = [];
        if (this.config.homePath) {
            const portsAndDataSourcesFromProp = this.getPortFromPropXml();
            dataSources = portsAndDataSourcesFromProp.dataSources;
        }

        const dataSourceIndex = dataSources.findIndex(ds => ds.name === dataSourceName);
        if (dataSourceIndex === -1) {
            throw new Error(`数据源 "${dataSourceName}" 不存在`);
        }

        // 保存原始数据源名称
        const originalDataSourceName = dataSourceName;

        // 将数据源名称改为"design"
        const dataSource = dataSources[dataSourceIndex];
        const originalDataSource = { ...dataSource }; // 保存原始数据源信息
        dataSource.name = 'design';

        // 更新config中的selectedDataSource为"design"
        this.config.selectedDataSource = 'design';

        // 保存配置（只保存selectedDataSource，不保存数据源列表）
        await this.saveConfig(this.config);

        // 同时更新prop.xml文件中的数据源名称
        if (this.config.homePath) {
            try {
                // 先删除原来的数据源
                PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, originalDataSourceName);
                // 再添加更新后的数据源
                PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, dataSource, false);
                this.outputChannel.appendLine(`已将数据源 "${originalDataSourceName}" 重命名为 "design" 并写入prop.xml文件`);
            } catch (error: any) {
                // 如果更新失败，恢复原始数据源
                try {
                    PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, 'design');
                    PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, originalDataSource, false);
                } catch (restoreError: any) {
                    this.outputChannel.appendLine(`恢复原始数据源失败: ${restoreError.message}`);
                }
                this.outputChannel.appendLine(`更新prop.xml文件失败: ${error.message}`);
                throw new Error(`数据源已设置为开发库，但更新prop.xml文件失败: ${error.message}`);
            }
        }

        this.outputChannel.appendLine(`设置开发库: ${originalDataSourceName} 已重命名为 design`);
        vscode.window.showInformationMessage(`已将 "${originalDataSourceName}" 设置为开发库并重命名为 "design"`);
    }

    /**
     * 设置基准库
     */
    public async setBaseDatabase(dataSourceName: string): Promise<void> {
        // 从prop.xml文件中获取当前数据源列表
        let dataSources: DataSourceMeta[] = [];
        if (this.config.homePath) {
            const portsAndDataSourcesFromProp = this.getPortFromPropXml();
            dataSources = portsAndDataSourcesFromProp.dataSources;
        }

        if (!dataSources.some(ds => ds.name === dataSourceName)) {
            throw new Error(`数据源 "${dataSourceName}" 不存在`);
        }

        this.config.baseDatabase = dataSourceName;
        await this.saveConfig(this.config);

        this.outputChannel.appendLine(`设置基准库: ${dataSourceName}`);
        vscode.window.showInformationMessage(`已设置 "${dataSourceName}" 为基准库`);
    }

    /**
     * 显示输出通道
     */
    public showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * 检查系统配置文件
     */
    public checkSystemConfig(): { valid: boolean; message: string } {
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

        // 检查配置文件是否包含基本配置
        try {
            const content = fs.readFileSync(propFile, 'utf-8');
            // 支持多种配置文件格式
            // 标准格式包含<config>标签
            // 简化格式可能只包含<dataSources>标签
            if ((content.includes('<config>') && content.includes('</config>')) ||
                (content.includes('<dataSources>') && content.includes('</dataSources>'))) {
                return { valid: true, message: '系统配置文件检查通过' };
            }

            // 检查是否是有效的XML格式
            if (content.trim().startsWith('<?xml') && content.includes('<')) {
                return { valid: true, message: '系统配置文件检查通过' };
            }

            return { valid: false, message: '系统配置文件格式不正确' };
        } catch (error: any) {
            return { valid: false, message: `读取配置文件失败: ${error.message}` };
        }
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        // 只有在扩展完全停用时才应该dispose outputChannel
        if (NCHomeConfigService.outputChannelInstance) {
            NCHomeConfigService.outputChannelInstance.dispose();
            NCHomeConfigService.outputChannelInstance = null;
        }
    }

    /**
     * 从prop.xml文件中获取服务端口信息和数据源信息
     * @returns 包含http端口、service端口和数据源列表的对象，如果无法获取则对应值为null
     */
    public getPortFromPropXml(): { port: number | null, wsPort: number | null, dataSources: DataSourceMeta[] } {
        try {
            // 检查homePath是否已配置
            if (!this.config.homePath) {
                this.outputChannel.appendLine('Home路径未配置，无法读取prop.xml');
                return { port: null, wsPort: null, dataSources: [] };
            }

            // 构建prop.xml文件路径
            const propXmlPath = path.join(this.config.homePath, 'ierp', 'bin', 'prop.xml');

            // 检查文件是否存在
            if (!fs.existsSync(propXmlPath)) {
                this.outputChannel.appendLine(`prop.xml文件不存在: ${propXmlPath}`);
                return { port: null, wsPort: null, dataSources: [] };
            }

            // 读取文件内容，文件编码为gb2312
            const buffer = fs.readFileSync(propXmlPath);
            const content = iconv.decode(buffer, 'gb2312');

            // 使用正则表达式查找http/port元素
            const portMatch = content.match(/<http>\s*<address>.*?<\/address>\s*<port>(\d+)<\/port>\s*<\/http>/s);
            let port: number | null = null;
            if (portMatch && portMatch[1]) {
                const parsedPort = parseInt(portMatch[1], 10);
                if (!isNaN(parsedPort)) {
                    this.outputChannel.appendLine(`从prop.xml中读取到端口: ${parsedPort}`);
                    port = parsedPort;
                }
            }

            // 使用正则表达式查找servicePort元素
            const wsPortMatch = content.match(/<servicePort>(\d+)<\/servicePort>/);
            let wsPort: number | null = null;
            if (wsPortMatch && wsPortMatch[1]) {
                const parsedWsPort = parseInt(wsPortMatch[1], 10);
                if (!isNaN(parsedWsPort)) {
                    this.outputChannel.appendLine(`从prop.xml中读取到service端口: ${parsedWsPort}`);
                    wsPort = parsedWsPort;
                }
            }

            // 提取数据源信息
            const dataSources: DataSourceMeta[] = [];

            // 使用正则表达式查找所有dataSource元素
            const dataSourceMatches = content.match(/<dataSource>([\s\S]*?)<\/dataSource>/g);

            if (dataSourceMatches) {
                for (const dataSourceMatch of dataSourceMatches) {
                    try {
                        // 提取各个字段
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

                            // 从URL中解析主机、端口和数据库名
                            let host = '';
                            let port = 0;
                            let databaseName = '';

                            // 处理不同数据库类型的URL解析
                            if (databaseUrl.startsWith('jdbc:oracle:')) {
                                // Oracle: jdbc:oracle:thin:@10.16.232.123:1521/ORCL
                                const urlMatch = databaseUrl.match(/jdbc:oracle:thin:@([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            } else if (databaseUrl.startsWith('jdbc:mysql:')) {
                                // MySQL: jdbc:mysql://localhost:3306/nc6x?useSSL=false&serverTimezone=UTC
                                const urlMatch = databaseUrl.match(/jdbc:mysql:\/\/([^:]+):(\d+)\/([^?]+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            } else if (databaseUrl.startsWith('jdbc:sqlserver:')) {
                                // SQL Server: jdbc:sqlserver://localhost:1433;database=nc6x
                                const urlMatch = databaseUrl.match(/jdbc:sqlserver:\/\/([^:]+):(\d+);database=([^;]+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            } else if (databaseUrl.startsWith('jdbc:postgresql:')) {
                                // PostgreSQL: jdbc:postgresql://localhost:5432/nc6x
                                const urlMatch = databaseUrl.match(/jdbc:postgresql:\/\/([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            } else if (databaseUrl.startsWith('jdbc:dm:')) {
                                // 达梦数据库: jdbc:dm://localhost:5236/nc6x
                                const urlMatch = databaseUrl.match(/jdbc:dm:\/\/([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            } else if (databaseUrl.startsWith('jdbc:kingbase8:')) {
                                // 人大金仓: jdbc:kingbase8://localhost:54321/nc6x
                                const urlMatch = databaseUrl.match(/jdbc:kingbase8:\/\/([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            } else {
                                // 其他类型，尝试通用解析
                                const urlMatch = databaseUrl.match(/\/\/([^:]+):(\d+)\/(.+)/);
                                if (urlMatch) {
                                    host = urlMatch[1];
                                    port = parseInt(urlMatch[2], 10);
                                    databaseName = urlMatch[3];
                                }
                            }

                            // 解密密码（如果需要）
                            let decryptedPassword = password;
                            if (password) {
                                try {
                                    decryptedPassword = PasswordEncryptor.getSecurePassword(password);
                                    // 检查解密结果是否包含大量乱码字符
                                    // 如果解密后包含多个连续的替换字符，说明解密可能失败
                                    const replacementCharCount = (decryptedPassword.match(/\uFFFD/g) || []).length;
                                    if (replacementCharCount > 2) {
                                        // 如果解密后包含过多乱码，说明可能使用了不同的加密方式
                                        // 在这种情况下，我们显示一个占位符而不是乱码
                                        decryptedPassword = '[加密密码-需要重新输入]';
                                    }
                                } catch (decryptError: any) {
                                    this.outputChannel.appendLine(`解密密码失败: ${decryptError.message}`);
                                    decryptedPassword = '[加密密码-需要重新输入]';
                                }
                            }

                            // 创建DataSourceMeta对象
                            const dataSource: DataSourceMeta = {
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

                            dataSources.push(dataSource);
                            this.outputChannel.appendLine(`从prop.xml中读取到数据源: ${dataSourceName}`);
                        }
                    } catch (error: any) {
                        this.outputChannel.appendLine(`解析数据源信息时出错: ${error.message}`);
                    }
                }
            }

            if (port === null && wsPort === null && dataSources.length === 0) {
                this.outputChannel.appendLine('未在prop.xml中找到有效的端口配置或数据源配置');
            }

            return { port, wsPort, dataSources };
        } catch (error: any) {
            this.outputChannel.appendLine(`读取prop.xml文件失败: ${error.message}`);
            return { port: null, wsPort: null, dataSources: [] };
        }
    }
}