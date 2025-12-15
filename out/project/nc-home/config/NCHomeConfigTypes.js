"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRIVER_INFO_MAP = exports.DATABASE_TYPES = void 0;
exports.DATABASE_TYPES = {
    MYSQL: 'MySQL',
    ORACLE: 'Oracle',
    SQLSERVER: 'SQL Server',
    POSTGRESQL: 'PostgreSQL',
    SQLITE: 'SQLite',
    DM: 'DM',
    KINGBASE: 'KingBase'
};
exports.DRIVER_INFO_MAP = {
    [exports.DATABASE_TYPES.MYSQL]: [
        {
            name: 'MySQL Connector/J',
            className: 'com.mysql.cj.jdbc.Driver',
            url: 'jdbc:mysql://{host}:{port}/{database}?useSSL=false&serverTimezone=UTC',
            defaultPort: 3306
        }
    ],
    [exports.DATABASE_TYPES.ORACLE]: [
        {
            name: 'Oracle JDBC Thin',
            className: 'oracle.jdbc.driver.OracleDriver',
            url: 'jdbc:oracle:thin:@{host}:{port}:{database}',
            defaultPort: 1521
        }
    ],
    [exports.DATABASE_TYPES.SQLSERVER]: [
        {
            name: 'SQL Server JDBC',
            className: 'com.microsoft.sqlserver.jdbc.SQLServerDriver',
            url: 'jdbc:sqlserver://{host}:{port};databaseName={database}',
            defaultPort: 1433
        }
    ],
    [exports.DATABASE_TYPES.POSTGRESQL]: [
        {
            name: 'PostgreSQL JDBC',
            className: 'org.postgresql.Driver',
            url: 'jdbc:postgresql://{host}:{port}/{database}',
            defaultPort: 5432
        }
    ],
    [exports.DATABASE_TYPES.SQLITE]: [
        {
            name: 'SQLite JDBC',
            className: 'org.sqlite.JDBC',
            url: 'jdbc:sqlite:{database}',
            defaultPort: 0
        }
    ],
    [exports.DATABASE_TYPES.DM]: [
        {
            name: 'DM JDBC',
            className: 'dm.jdbc.driver.DmDriver',
            url: 'jdbc:dm://{host}:{port}/{database}',
            defaultPort: 5236
        }
    ],
    [exports.DATABASE_TYPES.KINGBASE]: [
        {
            name: 'KingBase JDBC',
            className: 'com.kingbase8.Driver',
            url: 'jdbc:kingbase8://{host}:{port}/{database}',
            defaultPort: 54321
        }
    ]
};
//# sourceMappingURL=NCHomeConfigTypes.js.map