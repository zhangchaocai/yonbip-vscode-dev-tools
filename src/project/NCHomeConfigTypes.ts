/**
 * NC Home配置相关的类型定义
 */

/**
 * 数据库驱动信息
 */
export interface DriverInfo {
    name: string;
    className: string;
    url: string;
    defaultPort: number;
}

/**
 * 数据源元数据
 */
export interface DataSourceMeta {
    name: string;
    databaseType: string;
    driverClassName: string;
    host: string;
    port: number;
    databaseName: string;
    oidFlag: string;
    username: string;
    password: string;
    url?: string;
}

/**
 * NC Home配置
 */
export interface NCHomeConfig {
    // Home路径配置
    homePath: string;
    tempHomePath?: string;

    // MCP配置
    mcpPort?: string;

    // 服务器端口配置
    port?: number;
    wsPort?: number;

    // 调试模式
    debugMode?: boolean;

    // 补丁信息
    exportPatchPath?: string;
    provider?: string;
    department?: string;
    versions?: string;
    OSs?: string;
    middlewares?: string;
    DBs?: string;

    // 用户信息
    devuser?: string;
    devpwd?: string;
    loginToken?: string;
    uuid?: string;

    // 插件配置
    asyncTask?: boolean;
    autoClient?: boolean;
    exportAllsql?: boolean;
    customTableCheck?: boolean;
    customTablePath?: string;
    showLocalDatadict?: boolean;
    autoChangeJdk?: boolean;
    standardMode?: boolean;

    // 模块配置
    hotwebs?: string;
    exModules?: string;

    // 数据源配置
    dataSources?: DataSourceMeta[];
    selectedDataSource?: string;
    baseDatabase?: string;
}

/**
 * 数据库类型常量
 */
export const DATABASE_TYPES = {
    MYSQL: 'MySQL',
    ORACLE: 'Oracle',
    SQLSERVER: 'SQL Server',
    POSTGRESQL: 'PostgreSQL',
    SQLITE: 'SQLite',
    DM: 'DM',
    KINGBASE: 'KingBase'
} as const;

/**
 * 各数据库类型的驱动信息
 */
export const DRIVER_INFO_MAP: Record<string, DriverInfo[]> = {
    [DATABASE_TYPES.MYSQL]: [
        {
            name: 'MySQL Connector/J',
            className: 'com.mysql.cj.jdbc.Driver',
            url: 'jdbc:mysql://{host}:{port}/{database}?useSSL=false&serverTimezone=UTC',
            defaultPort: 3306
        }
    ],
    [DATABASE_TYPES.ORACLE]: [
        {
            name: 'Oracle JDBC Thin',
            className: 'oracle.jdbc.driver.OracleDriver',
            url: 'jdbc:oracle:thin:@{host}:{port}:{database}',
            defaultPort: 1521
        }
    ],
    [DATABASE_TYPES.SQLSERVER]: [
        {
            name: 'SQL Server JDBC',
            className: 'com.microsoft.sqlserver.jdbc.SQLServerDriver',
            url: 'jdbc:sqlserver://{host}:{port};databaseName={database}',
            defaultPort: 1433
        }
    ],
    [DATABASE_TYPES.POSTGRESQL]: [
        {
            name: 'PostgreSQL JDBC',
            className: 'org.postgresql.Driver',
            url: 'jdbc:postgresql://{host}:{port}/{database}',
            defaultPort: 5432
        }
    ],
    [DATABASE_TYPES.SQLITE]: [
        {
            name: 'SQLite JDBC',
            className: 'org.sqlite.JDBC',
            url: 'jdbc:sqlite:{database}',
            defaultPort: 0
        }
    ],
    [DATABASE_TYPES.DM]: [
        {
            name: 'DM JDBC',
            className: 'dm.jdbc.driver.DmDriver',
            url: 'jdbc:dm://{host}:{port}/{database}',
            defaultPort: 5236
        }
    ],
    [DATABASE_TYPES.KINGBASE]: [
        {
            name: 'KingBase JDBC',
            className: 'com.kingbase8.Driver',
            url: 'jdbc:kingbase8://{host}:{port}/{database}',
            defaultPort: 54321
        }
    ]
};

/**
 * 数据库连接测试结果
 */
export interface ConnectionTestResult {
    success: boolean;
    message: string;
    error?: string;
}

/**
 * 自动识别连接字符串的结果
 */
export interface AutoParseResult {
    username: string;
    password: string;
    host: string;
    port: number;
    database: string;
    valid: boolean;
    error?: string;
}