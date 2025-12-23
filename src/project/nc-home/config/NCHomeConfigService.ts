import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { NCHomeConfig, DataSourceMeta, ConnectionTestResult, AutoParseResult, DRIVER_INFO_MAP } from './NCHomeConfigTypes';
import { PasswordEncryptor } from '../../../utils/PasswordEncryptor';
import { PropXmlUpdater } from '../../../utils/PropXmlUpdater';
import { OracleClientService } from '../OracleClientService';
import { StatisticsService } from '../../../utils/StatisticsService';

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
    private oracleClientService: OracleClientService;
    // 添加配置缓存相关属性
    private configCache: NCHomeConfig | null = null;
    private configCacheTimestamp: number = 0;
    private readonly CACHE_TTL: number = 5000; // 5秒缓存时间

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.oracleClientService = new OracleClientService(context);
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
     * 实现缓存机制，避免频繁读取和解密操作
     */
    public getConfig(): NCHomeConfig {
        const now = Date.now();
        
        // 检查缓存是否有效
        if (this.configCache && (now - this.configCacheTimestamp) < this.CACHE_TTL) {
            // 返回缓存的配置副本
            return JSON.parse(JSON.stringify(this.configCache));
        }
        
        // 创建配置的深拷贝，避免修改原始配置
        const configCopy: NCHomeConfig = JSON.parse(JSON.stringify(this.config));

        // 如果存在数据源，确保密码已正确处理
        // 注意：数据源应该已经从prop.xml中读取，并且密码已经被正确处理过了
        // 这里只需要确保密码是字符串类型
        if (configCopy.dataSources && configCopy.dataSources.length > 0) {
            for (const dataSource of configCopy.dataSources) {
                if (dataSource.password) {
                    // 确保密码是字符串类型，避免SCRAM认证错误
                    dataSource.password = typeof dataSource.password === 'string' ? dataSource.password : String(dataSource.password || '');
                }
            }
        }
        
        // 更新缓存
        this.configCache = JSON.parse(JSON.stringify(configCopy));
        this.configCacheTimestamp = now;

        return configCopy;
    }
    
    /**
     * 使配置缓存失效
     * 在配置更新后调用此方法以确保下次获取最新配置
     */
    public invalidateConfigCache(): void {
        this.configCache = null;
        this.configCacheTimestamp = 0;
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

            // 如果配置了JVM参数并且homePath存在，更新prop.xml文件
            // if (this.config.vmParameters !== undefined && this.config.homePath) {
            //     try {
            //         PropXmlUpdater.updateVmParametersInPropXml(this.config.homePath, this.config.vmParameters);
            //         this.outputChannel.appendLine(`JVM参数已更新到prop.xml文件: ${this.config.vmParameters}`);
            //     } catch (error: any) {
            //         this.outputChannel.appendLine(`更新JVM参数到prop.xml文件失败: ${error.message}`);
            //         // 不抛出错误，因为这不应该阻止配置保存
            //     }
            // }

            // 使配置缓存失效，确保下次获取最新配置
            this.invalidateConfigCache();

            this.outputChannel.appendLine(`配置已保存: ${this.configFilePath}`);
            vscode.window.showInformationMessage('NC Home配置已保存');
            
            // 记录HOME配置统计
            StatisticsService.incrementCount(StatisticsService.HOME_CONFIG_COUNT);

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
        const vmParameters = workspaceConfig.get<string>('home.vmParameters') || '';
        const hotwebs = workspaceConfig.get<string>('hotwebs') || 'nccloud,fs,yonbip';

        return {
            homePath: '',
            homeVersion: undefined, // 默认为undefined，后续会尝试从HOME目录获取
            exportAllsql: true,
            customTableCheck: false,
            showLocalDatadict: false,
            autoChangeJdk: false,
            // 移除了standardMode属性
            // 移除了autoClient属性
            dataSources: [],

            port: 9999,
            wsPort: 8080,
            debugMode: true,  // 默认启用调试模式
            debugPort: debugPort,   // 使用工作区配置的调试端口，默认为8888
            vmParameters: vmParameters,  // 使用工作区配置的JVM参数，默认为空
            hotwebs: hotwebs  // 使用工作区配置的hotwebs参数，默认为'nccloud,fs,yonbip'
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
            await config.update('home.vmParameters', this.config.vmParameters, vscode.ConfigurationTarget.Global);
            
            console.log('Saved JVM parameters to workspace config:', this.config.vmParameters);
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
                terminal.sendText(`${configPath}`);
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

            // 使用从prop.xml中读取的已经解密的密码
            // 注意：dataSource.password应该已经是从prop.xml中读取并处理过的密码
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

            let connectionResult: ConnectionTestResult;

            switch (secureDataSource.databaseType.toLowerCase()) {
                case 'mysql':
                case 'mysql5':
                case 'mysql8':
                    connectionResult = await this.testMySQLConnection(secureDataSource);
                    break;
                case 'dm':
                case 'dmdb':
                case 'dameng':
                    connectionResult = await this.testDMConnection(secureDataSource);
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

            // 确保密码是字符串类型，避免SCRAM认证错误
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

            // 执行简单的查询测试
            const result = await client.query('SELECT 1 as test');
            await client.end();

            return {
                success: true,
                message: `PostgreSQL连接成功 - 主机: ${dataSource.host}:${dataSource.port}, 数据库: ${dataSource.databaseName}`
            };

        } catch (error: any) {
            this.outputChannel.appendLine(`PostgreSQL连接失败详情: ${error.message}`);
            return {
                success: false,
                message: `PostgreSQL连接失败: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * 测试达梦数据库连接
     */
    private async testDMConnection(dataSource: DataSourceMeta): Promise<ConnectionTestResult> {
        try {
            // 动态导入达梦数据库驱动
            const dmdb = await import('dmdb');

            // 确保密码是字符串类型
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
                connectTimeout: 10000,
                socketTimeout: 10000
            };

            this.outputChannel.appendLine(`连接达梦数据库: ${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`);
            this.outputChannel.appendLine(`用户名: ${dataSource.username}, 密码类型: ${typeof password}, 密码值: ${password}`);

            const connection = await dmdb.getConnection(connectionConfig);
            // 执行简单的查询测试
            const result = await connection.execute('SELECT 1 as test FROM DUAL');
            await connection.close();
            return {
                success: true,
                message: `达梦数据库连接成功 - 主机: ${dataSource.host}:${dataSource.port}, 数据库: ${dataSource.databaseName}`
            };        } catch (error: any) {
            this.outputChannel.appendLine(`达梦数据库连接失败详情: ${error.message}`);
            return {
                success: false,
                message: `达梦数据库连接失败: ${error.message}`,
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

            // 检查Oracle Instant Client是否已安装
            const oracleClientCheck = await this.oracleClientService.checkOracleClientInstalled();
            if (!oracleClientCheck.installed) {
                this.outputChannel.appendLine(`⚠️ 未检测到Oracle Instant Client`);
                
                // 提示用户安装Oracle Instant Client
                const installConfirmed = await this.oracleClientService.promptInstallOracleClient();
                if (!installConfirmed) {
                    return {
                        success: false,
                        message: 'Oracle Instant Client未安装，无法连接Oracle数据库。\n请安装Oracle Instant Client后重试。'
                    };
                }
            }

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
                                message: this.getOracleClientInstallationGuide(initError.message)
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

        // 数据源名称格式校验 - 不能包含中文字符，只能包含英文、数字、下划线和短横线
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

        // 同时更新内存中的config.dataSources
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }
        this.config.dataSources.push(dataSource);
        await this.saveConfig(this.config);

        // 直接更新prop.xml文件（排除别名属性）
        if (this.config.homePath) {
            try {
                // 创建一个不包含别名属性的数据源对象用于更新prop.xml
                const dataSourceForPropXml = { ...dataSource };
                delete dataSourceForPropXml.alias;
                PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, dataSourceForPropXml, false);
                this.outputChannel.appendLine(`已将数据源 "${dataSource.name}" 写入prop.xml文件`);
            } catch (error: any) {
                // 如果更新prop.xml失败，回滚内存中的更改
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

    /**
     * 更新数据源
     */
    public async updateDataSource(dataSource: DataSourceMeta): Promise<void> {
        // 完整验证 - 检查所有字段是否已填写
        if (!dataSource.name || dataSource.name.trim() === '') {
            throw new Error('数据源名称不能为空');
        }

        // 数据源名称格式校验 - 不能包含中文字符，只能包含英文、数字、下划线和短横线
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

        // 注意：密码字段可以为空，表示不修改密码

        // 同时更新内存中的config.dataSources
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }

        const index = this.config.dataSources.findIndex(ds => ds.name === dataSource.name);
        let oldDataSource: DataSourceMeta | null = null;
        if (index !== -1) {
            // 保存旧的数据源信息用于回滚
            oldDataSource = { ...this.config.dataSources[index] };
            // 如果密码为空，表示不修改密码，保留原来的密码
            if (!dataSource.password || dataSource.password.trim() === '') {
                dataSource.password = oldDataSource.password;
            }
            this.config.dataSources[index] = dataSource;
        } else {
            // 如果找不到现有数据源，添加新的数据源
            this.config.dataSources.push(dataSource);
        }
        await this.saveConfig(this.config);

        // 直接更新prop.xml文件（排除别名属性）
        if (this.config.homePath) {
            try {
                // 创建一个不包含别名属性的数据源对象用于更新prop.xml
                const dataSourceForPropXml = { ...dataSource };
                delete dataSourceForPropXml.alias;
                PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, dataSourceForPropXml, true);
                this.outputChannel.appendLine(`已将数据源 "${dataSource.name}" 更新到prop.xml文件`);
            } catch (error: any) {
                // 如果更新prop.xml失败，回滚内存中的更改
                if (index !== -1 && oldDataSource) {
                    this.config.dataSources[index] = oldDataSource;
                } else if (index === -1) {
                    // 如果是新增的数据源，需要删除
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

    /**
     * 删除数据源
     */
    public async deleteDataSource(dataSourceName: string): Promise<void> {
        // 同时从内存中的config.dataSources中删除
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }

        const index = this.config.dataSources.findIndex(ds => ds.name === dataSourceName);
        let removedDataSource: DataSourceMeta | null = null;
        if (index !== -1) {
            removedDataSource = this.config.dataSources.splice(index, 1)[0];
            
            // 如果删除的是当前选中的数据源，清除选择
            if (this.config.selectedDataSource === dataSourceName) {
                this.config.selectedDataSource = undefined;
            }

            // 如果删除的是基准库，清除基准库设置
            if (this.config.baseDatabase === dataSourceName) {
                this.config.baseDatabase = undefined;
            }

            await this.saveConfig(this.config);
        }

        // 直接从prop.xml文件中删除数据源
        if (this.config.homePath) {
            try {
                PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, dataSourceName);
                this.outputChannel.appendLine(`已从prop.xml文件中删除数据源 "${dataSourceName}"`);
            } catch (error: any) {
                // 如果删除prop.xml失败，回滚内存中的更改
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

        // 检查指定的数据源是否存在
        const dataSourceIndex = dataSources.findIndex(ds => ds.name === dataSourceName);
        if (dataSourceIndex === -1) {
            throw new Error(`数据源 "${dataSourceName}" 不存在`);
        }

        // 保存原始数据源信息，用于可能的回滚
        const originalDataSource = { ...dataSources[dataSourceIndex] };
        
        // 保存所有数据源的别名信息，确保别名不丢失
        const allDataSourceAliases = new Map<string, string>();
        if (this.config.dataSources) {
            for (const ds of this.config.dataSources) {
                if (ds.alias) {
                    allDataSourceAliases.set(ds.name, ds.alias);
                }
            }
        }

        // 检查是否已经存在design数据源
        const existingDesignIndex = dataSources.findIndex(ds => ds.name === 'design');
        let replacedDataSource: DataSourceMeta | null = null;
        
        // 如果已存在design数据源，需要将其恢复为原始名称
        if (existingDesignIndex !== -1) {
            replacedDataSource = { ...dataSources[existingDesignIndex] };
            
            // 使用保存的replacedDesignDataSourceName来恢复原始名称
            // 如果没有保存的原始名称，则使用带时间戳的名称
            const restoredName = this.config.replacedDesignDataSourceName || `design_${Date.now()}`;
            
            // 更新被替换数据源的名称
            replacedDataSource.name = restoredName;
            
            // 确保保留被替换数据源的别名
            if (allDataSourceAliases.has('design')) {
                replacedDataSource.alias = allDataSourceAliases.get('design');
            }
        }

        // 准备新的design数据源
        const newDesignDataSource = { ...originalDataSource };
        newDesignDataSource.name = 'design';
        
        // 确保新的design数据源保留原始数据源的别名
        if (allDataSourceAliases.has(originalDataSource.name)) {
            newDesignDataSource.alias = allDataSourceAliases.get(originalDataSource.name);
        }

        // 构建完整的操作计划，确保事务一致性
        const rollbackPlan = {
            originalDataSource,
            replacedDataSource: replacedDataSource ? { ...replacedDataSource } : null,
            originalConfig: { ...this.config },
            existingDesignIndex
        };

        try {
            // 更新配置信息
            this.config.selectedDataSource = 'design';
            this.config.replacedDesignDataSourceName = originalDataSource.name;
            
            // 同时更新prop.xml文件中的数据源名称
            if (this.config.homePath) {
                // 1. 如果存在原有的design数据源，先移除它
                if (existingDesignIndex !== -1) {
                    PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, 'design');
                    
                    // 2. 将被替换的design数据源重新添加回去（使用恢复的名称）
                    PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, replacedDataSource!, false);
                    this.outputChannel.appendLine(`已将原有design数据源恢复为 "${replacedDataSource!.name}"`);
                }
                
                // 3. 移除要设置为design的原始数据源
                PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, originalDataSource.name);
                
                // 4. 添加新的design数据源
                PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, newDesignDataSource, false);
                this.outputChannel.appendLine(`已将数据源 "${originalDataSource.name}" 设置为design并写入prop.xml文件`);
            }
            
            // 从prop.xml重新加载最新的数据源列表
            const updatedDataSources = this.getPortFromPropXml().dataSources;
            
            // 更新内存中的config.dataSources
            if (!this.config.dataSources) {
                this.config.dataSources = [];
            }
            this.config.dataSources = updatedDataSources;
            
            // 恢复所有别名信息
            for (const ds of this.config.dataSources) {
                // 对于design数据源，使用原始数据源的别名
                if (ds.name === 'design' && allDataSourceAliases.has(originalDataSource.name)) {
                    ds.alias = allDataSourceAliases.get(originalDataSource.name);
                }
                // 对于被替换的数据源，如果有保存的别名则恢复
                else if (replacedDataSource && ds.name === replacedDataSource.name && allDataSourceAliases.has('design')) {
                    ds.alias = allDataSourceAliases.get('design');
                }
                // 对于其他数据源，恢复原来的别名
                else if (allDataSourceAliases.has(ds.name)) {
                    ds.alias = allDataSourceAliases.get(ds.name);
                }
            }
            
            // 保存配置到config.json
            await this.saveConfig(this.config);

            this.outputChannel.appendLine(`设置开发库: ${originalDataSource.name} 已设置为design`);
            vscode.window.showInformationMessage(`已将 "${originalDataSource.name}" 设置为开发库`);
        } catch (error: any) {
            // 发生错误时执行回滚
            this.outputChannel.appendLine(`设置开发库失败: ${error.message}，正在回滚...`);
            await this.rollbackDesignDatabaseChange(rollbackPlan);
            throw new Error(`设置开发库失败: ${error.message}`);
        }
    }
    
    /**
     * 回滚design数据源更改
     * 确保在操作失败时能够完全恢复到原始状态
     */
    private async rollbackDesignDatabaseChange(rollbackPlan: {
        originalDataSource: DataSourceMeta;
        replacedDataSource: DataSourceMeta | null;
        originalConfig: Partial<NCHomeConfig>;
        existingDesignIndex: number;
    }): Promise<void> {
        try {
            if (this.config.homePath) {
                // 1. 移除可能创建的design数据源
                PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, 'design');
                
                // 2. 如果之前有design数据源，恢复它
                if (rollbackPlan.replacedDataSource && rollbackPlan.existingDesignIndex !== -1) {
                    // 移除可能添加的被替换数据源
                    PropXmlUpdater.removeDataSourceFromPropXml(this.config.homePath, rollbackPlan.replacedDataSource.name);
                    // 恢复为design名称
                    const restoredDesign = { ...rollbackPlan.replacedDataSource };
                    restoredDesign.name = 'design';
                    PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, restoredDesign, false);
                }
                
                // 3. 确保原始数据源存在
                PropXmlUpdater.updateDataSourceInPropXml(this.config.homePath, rollbackPlan.originalDataSource, false);
            }
            
            // 4. 恢复配置
            this.config = { ...this.config, ...rollbackPlan.originalConfig } as NCHomeConfig;
            
            // 5. 重新从prop.xml加载数据源以确保一致性
            const updatedDataSources = this.getPortFromPropXml().dataSources;
            this.config.dataSources = updatedDataSources;
            
            // 6. 保存恢复后的配置
            await this.saveConfig(this.config);
            
            this.outputChannel.appendLine(`已成功回滚设计库更改`);
        } catch (rollbackError: any) {
            this.outputChannel.appendLine(`回滚失败: ${rollbackError.message}`);
            // 即使回滚失败，也尝试最终保存原始配置到config.json
            try {
                await this.saveConfig({ ...this.config, ...rollbackPlan.originalConfig } as NCHomeConfig);
                this.outputChannel.appendLine('已尝试保存原始配置到config.json');
            } catch (finalError: any) {
                this.outputChannel.appendLine(`最终配置保存失败: ${finalError.message}`);
                vscode.window.showErrorMessage(`回滚操作失败，配置可能已损坏。请检查prop.xml和config.json文件。`);
            }
        }
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
        
        // 同时更新内存中的config.dataSources，确保数据是最新的
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }
        
        // 保存当前数据源的别名信息
        const dataSourceAliases = new Map<string, string>();
        for (const ds of this.config.dataSources) {
            if (ds.alias) {
                dataSourceAliases.set(ds.name, ds.alias);
            }
        }
        
        // 从prop.xml中获取最新的数据源列表
        const updatedDataSources = this.getPortFromPropXml().dataSources;
        this.config.dataSources = updatedDataSources;
        
        // 恢复别名信息
        for (const ds of this.config.dataSources) {
            if (dataSourceAliases.has(ds.name)) {
                ds.alias = dataSourceAliases.get(ds.name);
            }
        }

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
     * 同步配置信息从prop.xml文件
     * 这个方法会从prop.xml中读取所有配置信息并更新当前配置
     */
    public syncConfigFromPropXml(): void {
        try {
            // 保存当前重要的配置信息，避免被覆盖
            const currentHomeVersion = this.config.homeVersion;
            const currentReplacedDesignDataSourceName = this.config.replacedDesignDataSourceName;
            
            const portsAndDataSourcesFromProp = this.getPortFromPropXml();
            
            // 更新端口信息
            if (portsAndDataSourcesFromProp.port !== null) {
                this.config.port = portsAndDataSourcesFromProp.port;
                this.outputChannel.appendLine(`已同步HTTP端口: ${portsAndDataSourcesFromProp.port}`);
            }
            
            if (portsAndDataSourcesFromProp.wsPort !== null) {
                this.config.wsPort = portsAndDataSourcesFromProp.wsPort;
                this.outputChannel.appendLine(`已同步Service端口: ${portsAndDataSourcesFromProp.wsPort}`);
            }
            
            // 确保不从prop.xml中获取JVM参数，始终使用用户在界面中设置的参数
            // 更新JVM参数
            // if (portsAndDataSourcesFromProp.vmParameters !== undefined) {
            //     this.config.vmParameters = portsAndDataSourcesFromProp.vmParameters;
            //     this.outputChannel.appendLine(`已同步JVM参数: ${portsAndDataSourcesFromProp.vmParameters}`);
            // }
            
            // 更新数据源信息
            if (portsAndDataSourcesFromProp.dataSources.length > 0) {
                // 保存当前数据源的别名信息
                const dataSourceAliases = new Map<string, string>();
                if (this.config.dataSources) {
                    for (const ds of this.config.dataSources) {
                        if (ds.alias) {
                            dataSourceAliases.set(ds.name, ds.alias);
                        }
                    }
                }
                
                this.config.dataSources = portsAndDataSourcesFromProp.dataSources;
                this.outputChannel.appendLine(`已同步${portsAndDataSourcesFromProp.dataSources.length}个数据源`);
                
                // 恢复别名信息
                if (this.config.dataSources) {
                    for (const ds of this.config.dataSources) {
                        if (dataSourceAliases.has(ds.name)) {
                            ds.alias = dataSourceAliases.get(ds.name);
                        }
                    }
                }
                
                // 如果有design数据源，设置为选中的数据源
                const designDataSource = portsAndDataSourcesFromProp.dataSources.find(ds => ds.name === 'design');
                if (designDataSource) {
                    this.config.selectedDataSource = 'design';
                    this.config.baseDatabase = 'design';
                    this.outputChannel.appendLine('已设置design为默认数据源');
                } else if (portsAndDataSourcesFromProp.dataSources.length > 0) {
                    // 如果没有design数据源，选择第一个数据源
                    this.config.selectedDataSource = portsAndDataSourcesFromProp.dataSources[0].name;
                    this.outputChannel.appendLine(`已设置${portsAndDataSourcesFromProp.dataSources[0].name}为默认数据源`);
                }
            } else {
                // 如果没有从prop.xml读取到数据源，清空现有数据源配置
                this.config.dataSources = [];
                this.config.selectedDataSource = undefined;
                this.config.baseDatabase = undefined;
                // 保持replacedDesignDataSourceName不变，用于后续可能的恢复操作
                this.config.replacedDesignDataSourceName = currentReplacedDesignDataSourceName;
                this.outputChannel.appendLine('未找到数据源配置，已清空数据源信息');
            }
            
            // 恢复重要配置信息（如果之前有设置）
            if (currentHomeVersion) {
                this.config.homeVersion = currentHomeVersion;
            }
            // 恢复被替换的design数据源名称
            this.config.replacedDesignDataSourceName = currentReplacedDesignDataSourceName;
            
            // 使配置缓存失效，确保下次获取最新配置
            this.invalidateConfigCache();
            
            this.outputChannel.appendLine('配置同步完成');
        } catch (error: any) {
            this.outputChannel.appendLine(`同步配置失败: ${error.message}`);
        }
    }

    /**
     * 从prop.xml文件中获取服务端口信息和数据源信息
     * @returns 包含http端口、service端口和数据源列表的对象，如果无法获取则对应值为null
     */
    public getPortFromPropXml(): { port: number | null, wsPort: number | null, dataSources: DataSourceMeta[], vmParameters?: string } {
        try {
            // 检查homePath是否已配置
            if (!this.config.homePath) {
                this.outputChannel.appendLine('Home路径未配置，无法读取prop.xml');
                return { port: null, wsPort: null, dataSources: [], vmParameters: undefined };
            }

            // 构建prop.xml文件路径
            const propXmlPath = path.join(this.config.homePath, 'ierp', 'bin', 'prop.xml');

            // 检查文件是否存在
            if (!fs.existsSync(propXmlPath)) {
                this.outputChannel.appendLine(`prop.xml文件不存在: ${propXmlPath}`);
                return { port: null, wsPort: null, dataSources: [], vmParameters: undefined };
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

            // 确保不从prop.xml中获取JVM参数，始终使用用户在界面中设置的参数
            // 使用正则表达式查找jvmArgs元素
            // const vmParametersMatch = content.match(/<jvmArgs>([^<]*)<\/jvmArgs>/);
            // let vmParameters: string | undefined = undefined;
            // if (vmParametersMatch && vmParametersMatch[1]) {
            //     vmParameters = vmParametersMatch[1].trim();
            //     // 将参数按照空格进行换行处理，方便在界面中显示和编辑
            //     if (vmParameters) {
            //         // 先按空格分割，然后过滤掉空字符串，最后用换行符连接
            //         vmParameters = vmParameters.split(' ').filter(param => param.trim() !== '').join('\n');
            //     }
            //     this.outputChannel.appendLine(`从prop.xml中读取到JVM参数: ${vmParameters}`);
            //     console.log('Read JVM parameters from prop.xml:', vmParameters);
            // }

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
                                    decryptedPassword = PasswordEncryptor.getSecurePassword(this.config.homePath, password);
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
                            
                            // 确保密码是字符串类型，避免SCRAM认证错误
                            if (typeof decryptedPassword !== 'string') {
                                decryptedPassword = String(decryptedPassword || '');
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

                            // 保留.nc-home-config.json中已有的别名属性
                            if (this.config.dataSources) {
                                const existingDataSource = this.config.dataSources.find(ds => ds.name === dataSourceName);
                                if (existingDataSource && existingDataSource.alias) {
                                    dataSource.alias = existingDataSource.alias;
                                }
                            }

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

            return { port, wsPort, dataSources, vmParameters: undefined };
        } catch (error: any) {
            this.outputChannel.appendLine(`读取prop.xml文件失败: ${error.message}`);
            return { port: null, wsPort: null, dataSources: [], vmParameters: undefined };
        }
    }

    /**
     * 获取最新的日志信息
     * @returns 最新的日志内容
     */
    public async getLatestLogs(): Promise<{ fileName: string; content: string }[]> {
        try {
            // 检查homePath是否已配置
            if (!this.config.homePath) {
                throw new Error('NC HOME路径未配置');
            }

            // 构建日志目录路径
            const logsDir = path.join(this.config.homePath, 'nclogs', 'server');

            // 检查日志目录是否存在
            if (!fs.existsSync(logsDir)) {
                throw new Error(`日志目录不存在: ${logsDir}`);
            }

            // 读取目录中的所有文件
            const files = fs.readdirSync(logsDir);

            // 过滤出.log文件并按修改时间排序
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

            // 获取最新的几个日志文件（最多5个）
            const latestLogFiles = logFiles.slice(0, 5);

            // 读取这些日志文件的内容
            const logs = await Promise.all(
                latestLogFiles.map(async file => {
                    try {
                        // 读取文件的最后10KB内容（避免读取过大的文件）
                        const buffer = Buffer.alloc(10240);
                        const fd = fs.openSync(file.path, 'r');
                        const stats = fs.fstatSync(fd);
                        const startPosition = Math.max(0, stats.size - 10240);
                        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, startPosition);
                        fs.closeSync(fd);
                        
                        // 将buffer转换为字符串并返回
                        const content = buffer.slice(0, bytesRead).toString('utf-8');
                        return {
                            fileName: file.name,
                            content: content
                        };
                    } catch (readError: any) {
                        return {
                            fileName: file.name,
                            content: `读取文件失败: ${readError.message}`
                        };
                    }
                })
            );

            return logs;
        } catch (error: any) {
            this.outputChannel.appendLine(`获取日志失败: ${error.message}`);
            throw new Error(`获取日志失败: ${error.message}`);
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
     * 根据不同操作系统生成Oracle客户端安装指南
     * @param errorMessage 错误信息
     * @returns 安装指南字符串
     */
    private getOracleClientInstallationGuide(errorMessage: string): string {
        const platform = process.platform;
        let guide = `❌ Oracle客户端库未找到

错误详情: ${errorMessage}

解决方法:
`;
        
        if (platform === 'win32') {
            // Windows系统
            guide += `1. 从 https://www.oracle.com/database/technologies/instant-client.html 下载Oracle Instant Client\n`;
            guide += `2. 选择Windows平台的Instant Client Basic包（如: instantclient-basic-windows.x64-21.8.0.0.0dbru.zip）\n`;
            guide += `3. 将Instant Client解压到目录（如: C:\\oracle\\instantclient_21_8）\n`;
            guide += `4. 将解压目录添加到系统PATH环境变量中\n`;
            guide += `5. 重启VS Code以使环境变量生效\n\n`;
            guide += `或者在代码中指定libDir路径:\n`;
            guide += `oracledb.initOracleClient({libDir: 'C:\\\\path\\\\to\\\\instantclient'});`;
        } else if (platform === 'darwin') {
            // macOS系统
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
        } else if (platform === 'linux') {
            // Linux系统
            guide += `1. 从 https://www.oracle.com/database/technologies/instant-client.html 下载Oracle Instant Client\n`;
            guide += `2. 选择Linux平台的Instant Client Basic包（如: instantclient-basic-linux.x64-21.8.0.0.0dbru.zip）\n`;
            guide += `3. 将Instant Client解压到目录（如: /opt/oracle/instantclient_21_8）\n`;
            guide += `4. 设置环境变量:\n`;
            guide += `   export LD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$LD_LIBRARY_PATH\n\n`;
            guide += `或者在代码中指定libDir路径:\n`;
            guide += `oracledb.initOracleClient({libDir: '/path/to/instantclient'});`;
        } else {
            // 其他系统
            guide += `1. 从 https://www.oracle.com/database/technologies/instant-client.html 下载适用于您系统的Oracle Instant Client\n`;
            guide += `2. 将Instant Client解压到目录\n`;
            guide += `3. 根据您系统的文档设置相应的环境变量\n\n`;
            guide += `或者在代码中指定libDir路径:\n`;
            guide += `oracledb.initOracleClient({libDir: '/path/to/instantclient'});`;
        }
        
        return guide;
    }
}