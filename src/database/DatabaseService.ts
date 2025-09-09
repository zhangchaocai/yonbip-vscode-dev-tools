import * as vscode from 'vscode';
import * as path from 'path';

/**
 * 数据库连接配置接口
 */
export interface DatabaseConfig {
    id: string;
    name: string;
    type: 'mysql' | 'oracle' | 'sqlserver' | 'postgresql' | 'sqlite';
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    schema?: string;
    ssl?: boolean;
    connectionTimeout?: number;
    isActive?: boolean;
}

/**
 * 查询结果接口
 */
export interface QueryResult {
    columns: string[];
    rows: any[][];
    affectedRows?: number;
    executionTime: number;
    sql: string;
}

/**
 * 数据库连接状态
 */
export enum ConnectionStatus {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    ERROR = 'error'
}

/**
 * 数据库服务类
 */
export class DatabaseService {
    private context: vscode.ExtensionContext;
    private connections: Map<string, DatabaseConfig> = new Map();
    private activeConnection: string | null = null;
    private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('YonBIP 数据库');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
        this.loadConnections();
        this.updateStatusBar();
        this.statusBarItem.show();
    }

    /**
     * 加载数据库连接配置
     */
    private loadConnections(): void {
        const connections = this.context.globalState.get<DatabaseConfig[]>('database.connections', []);
        this.connections.clear();
        
        for (const config of connections) {
            this.connections.set(config.id, config);
        }
        
        const activeId = this.context.globalState.get<string>('database.activeConnection');
        if (activeId && this.connections.has(activeId)) {
            this.activeConnection = activeId;
        }
    }

    /**
     * 保存数据库连接配置
     */
    private async saveConnections(): Promise<void> {
        const connections = Array.from(this.connections.values());
        await this.context.globalState.update('database.connections', connections);
        
        if (this.activeConnection) {
            await this.context.globalState.update('database.activeConnection', this.activeConnection);
        }
    }

    /**
     * 添加数据库连接
     */
    public async addConnection(config: Omit<DatabaseConfig, 'id'>): Promise<string> {
        const id = this.generateConnectionId();
        const fullConfig: DatabaseConfig = {
            id,
            ...config,
            isActive: false
        };
        
        this.connections.set(id, fullConfig);
        await this.saveConnections();
        
        this.outputChannel.appendLine(`添加数据库连接: ${config.name}`);
        return id;
    }

    /**
     * 更新数据库连接
     */
    public async updateConnection(id: string, config: Partial<DatabaseConfig>): Promise<void> {
        const existing = this.connections.get(id);
        if (!existing) {
            throw new Error(`连接不存在: ${id}`);
        }
        
        const updated = { ...existing, ...config };
        this.connections.set(id, updated);
        await this.saveConnections();
        
        this.outputChannel.appendLine(`更新数据库连接: ${updated.name}`);
    }

    /**
     * 删除数据库连接
     */
    public async removeConnection(id: string): Promise<void> {
        const config = this.connections.get(id);
        if (!config) {
            throw new Error(`连接不存在: ${id}`);
        }
        
        // 如果是当前活动连接，先断开
        if (this.activeConnection === id) {
            await this.disconnect();
        }
        
        this.connections.delete(id);
        await this.saveConnections();
        
        this.outputChannel.appendLine(`删除数据库连接: ${config.name}`);
    }

    /**
     * 获取所有连接
     */
    public getConnections(): DatabaseConfig[] {
        return Array.from(this.connections.values());
    }

    /**
     * 获取连接
     */
    public getConnection(id: string): DatabaseConfig | undefined {
        return this.connections.get(id);
    }

    /**
     * 获取活动连接
     */
    public getActiveConnection(): DatabaseConfig | undefined {
        if (!this.activeConnection) {
            return undefined;
        }
        return this.connections.get(this.activeConnection);
    }

    /**
     * 连接数据库
     */
    public async connect(id: string): Promise<void> {
        const config = this.connections.get(id);
        if (!config) {
            throw new Error(`连接配置不存在: ${id}`);
        }

        this.connectionStatus = ConnectionStatus.CONNECTING;
        this.updateStatusBar();
        this.outputChannel.appendLine(`正在连接数据库: ${config.name}`);

        try {
            // 测试连接
            await this.testConnection(config);
            
            // 更新状态
            this.activeConnection = id;
            this.connectionStatus = ConnectionStatus.CONNECTED;
            config.isActive = true;
            
            // 清除其他连接的活动状态
            for (const [otherId, otherConfig] of this.connections) {
                if (otherId !== id) {
                    otherConfig.isActive = false;
                }
            }
            
            await this.saveConnections();
            this.updateStatusBar();
            
            this.outputChannel.appendLine(`数据库连接成功: ${config.name}`);
            vscode.window.showInformationMessage(`已连接到数据库: ${config.name}`);

        } catch (error: any) {
            this.connectionStatus = ConnectionStatus.ERROR;
            this.updateStatusBar();
            
            const message = `连接数据库失败: ${error.message}`;
            this.outputChannel.appendLine(message);
            throw new Error(message);
        }
    }

    /**
     * 断开数据库连接
     */
    public async disconnect(): Promise<void> {
        if (!this.activeConnection) {
            return;
        }

        const config = this.getActiveConnection();
        if (config) {
            config.isActive = false;
            this.outputChannel.appendLine(`断开数据库连接: ${config.name}`);
        }

        this.activeConnection = null;
        this.connectionStatus = ConnectionStatus.DISCONNECTED;
        await this.saveConnections();
        this.updateStatusBar();
        
        vscode.window.showInformationMessage('数据库连接已断开');
    }

    /**
     * 测试数据库连接
     */
    public async testConnection(config: DatabaseConfig): Promise<boolean> {
        try {
            this.outputChannel.appendLine(`测试连接: ${config.name} (${config.type}://${config.host}:${config.port}/${config.database})`);
            
            // 这里应该根据数据库类型使用相应的驱动进行连接测试
            // 由于简化，我们模拟连接测试
            await this.simulateConnectionTest(config);
            
            this.outputChannel.appendLine(`连接测试成功: ${config.name}`);
            return true;
            
        } catch (error: any) {
            this.outputChannel.appendLine(`连接测试失败: ${config.name} - ${error.message}`);
            return false;
        }
    }

    /**
     * 模拟连接测试
     */
    private async simulateConnectionTest(config: DatabaseConfig): Promise<void> {
        // 模拟网络延迟
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
        // 简单的连接参数验证
        if (!config.host || !config.database || !config.username) {
            throw new Error('连接参数不完整');
        }
        
        // 模拟部分连接失败
        if (config.host === 'invalid-host') {
            throw new Error('无法解析主机名');
        }
        
        if (config.username === 'invalid-user') {
            throw new Error('用户名或密码错误');
        }
    }

    /**
     * 执行SQL查询
     */
    public async executeQuery(sql: string, maxRows: number = 1000): Promise<QueryResult> {
        if (!this.activeConnection) {
            throw new Error('未连接到数据库');
        }

        const config = this.getActiveConnection()!;
        const startTime = Date.now();
        
        this.outputChannel.appendLine(`执行查询: ${sql}`);
        
        try {
            // 这里应该使用真实的数据库驱动执行查询
            // 由于简化，我们模拟查询结果
            const result = await this.simulateQuery(sql, maxRows, config);
            
            const executionTime = Date.now() - startTime;
            this.outputChannel.appendLine(`查询完成，耗时: ${executionTime}ms，返回 ${result.rows.length} 行`);
            
            return {
                ...result,
                executionTime,
                sql
            };
            
        } catch (error: any) {
            const executionTime = Date.now() - startTime;
            this.outputChannel.appendLine(`查询失败: ${error.message}，耗时: ${executionTime}ms`);
            throw error;
        }
    }

    /**
     * 模拟SQL查询
     */
    private async simulateQuery(sql: string, maxRows: number, config: DatabaseConfig): Promise<Omit<QueryResult, 'executionTime' | 'sql'>> {
        // 模拟查询延迟
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1500));
        
        const upperSql = sql.toUpperCase().trim();
        
        if (upperSql.startsWith('SELECT')) {
            // 模拟查询结果
            if (upperSql.includes('USER') || upperSql.includes('DUAL')) {
                return {
                    columns: ['ID', 'USERNAME', 'EMAIL', 'CREATED_TIME'],
                    rows: [
                        [1, 'admin', 'admin@example.com', '2023-01-01 10:00:00'],
                        [2, 'user1', 'user1@example.com', '2023-01-02 11:00:00'],
                        [3, 'user2', 'user2@example.com', '2023-01-03 12:00:00']
                    ]
                };
            } else if (upperSql.includes('TABLE')) {
                return {
                    columns: ['TABLE_NAME', 'TABLE_TYPE', 'ROWS'],
                    rows: [
                        ['users', 'TABLE', 100],
                        ['orders', 'TABLE', 500],
                        ['products', 'TABLE', 50]
                    ]
                };
            } else {
                return {
                    columns: ['COLUMN1', 'COLUMN2', 'COLUMN3'],
                    rows: Array.from({ length: Math.min(maxRows, 10) }, (_, i) => [
                        `value${i + 1}_1`,
                        `value${i + 1}_2`,
                        `value${i + 1}_3`
                    ])
                };
            }
        } else if (upperSql.startsWith('INSERT') || upperSql.startsWith('UPDATE') || upperSql.startsWith('DELETE')) {
            // 模拟DML操作结果
            const affectedRows = Math.floor(Math.random() * 5) + 1;
            return {
                columns: [],
                rows: [],
                affectedRows
            };
        } else {
            // 其他类型的SQL
            return {
                columns: ['RESULT'],
                rows: [['操作成功']]
            };
        }
    }

    /**
     * 获取数据库表列表
     */
    public async getTables(): Promise<string[]> {
        if (!this.activeConnection) {
            throw new Error('未连接到数据库');
        }

        const config = this.getActiveConnection()!;
        
        // 根据数据库类型构建查询表的SQL
        let sql: string;
        switch (config.type) {
            case 'mysql':
                sql = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${config.database}'`;
                break;
            case 'oracle':
                sql = `SELECT TABLE_NAME FROM user_tables`;
                break;
            case 'sqlserver':
                sql = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`;
                break;
            case 'postgresql':
                sql = `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
                break;
            case 'sqlite':
                sql = `SELECT name FROM sqlite_master WHERE type='table'`;
                break;
            default:
                throw new Error(`不支持的数据库类型: ${config.type}`);
        }

        const result = await this.executeQuery(sql);
        return result.rows.map(row => row[0] as string);
    }

    /**
     * 获取表结构
     */
    public async getTableStructure(tableName: string): Promise<any[]> {
        if (!this.activeConnection) {
            throw new Error('未连接到数据库');
        }

        const config = this.getActiveConnection()!;
        
        // 根据数据库类型构建查询表结构的SQL
        let sql: string;
        switch (config.type) {
            case 'mysql':
                sql = `DESCRIBE ${tableName}`;
                break;
            case 'oracle':
                sql = `SELECT COLUMN_NAME, DATA_TYPE, NULLABLE FROM user_tab_columns WHERE TABLE_NAME = '${tableName.toUpperCase()}'`;
                break;
            case 'sqlserver':
                sql = `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_NAME = '${tableName}'`;
                break;
            case 'postgresql':
                sql = `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '${tableName}'`;
                break;
            case 'sqlite':
                sql = `PRAGMA table_info(${tableName})`;
                break;
            default:
                throw new Error(`不支持的数据库类型: ${config.type}`);
        }

        const result = await this.executeQuery(sql);
        return result.rows;
    }

    /**
     * 生成连接ID
     */
    private generateConnectionId(): string {
        return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 更新状态栏
     */
    private updateStatusBar(): void {
        const statusMap = {
            [ConnectionStatus.DISCONNECTED]: { 
                text: '$(database) 未连接', 
                color: undefined,
                tooltip: '点击配置数据库连接'
            },
            [ConnectionStatus.CONNECTING]: { 
                text: '$(loading~spin) 连接中', 
                color: 'yellow',
                tooltip: '正在连接数据库...'
            },
            [ConnectionStatus.CONNECTED]: { 
                text: '$(database) 已连接', 
                color: 'green',
                tooltip: `已连接到: ${this.getActiveConnection()?.name || '未知'}`
            },
            [ConnectionStatus.ERROR]: { 
                text: '$(error) 连接错误', 
                color: 'red',
                tooltip: '数据库连接出错，点击重试'
            }
        };

        const statusInfo = statusMap[this.connectionStatus];
        this.statusBarItem.text = statusInfo.text;
        this.statusBarItem.color = statusInfo.color;
        this.statusBarItem.tooltip = statusInfo.tooltip;
        this.statusBarItem.command = 'yonbip.database.config';
    }

    /**
     * 获取连接状态
     */
    public getConnectionStatus(): ConnectionStatus {
        return this.connectionStatus;
    }

    /**
     * 显示输出通道
     */
    public showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * 获取数据库类型的默认端口
     */
    public static getDefaultPort(type: string): number {
        const portMap: Record<string, number> = {
            mysql: 3306,
            oracle: 1521,
            sqlserver: 1433,
            postgresql: 5432,
            sqlite: 0
        };
        return portMap[type] || 3306;
    }

    /**
     * 获取支持的数据库类型
     */
    public static getSupportedDatabaseTypes(): Array<{ label: string; description: string; detail: string }> {
        return [
            { label: 'mysql', description: 'MySQL', detail: '开源关系型数据库' },
            { label: 'oracle', description: 'Oracle', detail: '企业级关系型数据库' },
            { label: 'sqlserver', description: 'SQL Server', detail: 'Microsoft SQL Server' },
            { label: 'postgresql', description: 'PostgreSQL', detail: '高级开源关系型数据库' },
            { label: 'sqlite', description: 'SQLite', detail: '轻量级嵌入式数据库' }
        ];
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.disconnect();
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
    }
}