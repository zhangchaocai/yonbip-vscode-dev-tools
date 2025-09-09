import * as vscode from 'vscode';
import { DatabaseService, DatabaseConfig, ConnectionStatus } from './DatabaseService';

/**
 * 数据库命令类
 */
export class DatabaseCommands {
    private databaseService: DatabaseService;

    constructor(context: vscode.ExtensionContext) {
        this.databaseService = new DatabaseService(context);
    }

    /**
     * 注册所有数据库相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext): DatabaseCommands {
        const databaseCommands = new DatabaseCommands(context);

        // 注册配置数据库命令
        const configCommand = vscode.commands.registerCommand('yonbip.database.config', () => {
            databaseCommands.showDatabaseConfig();
        });

        // 注册连接数据库命令
        const connectCommand = vscode.commands.registerCommand('yonbip.database.connect', () => {
            databaseCommands.connectDatabase();
        });

        // 注册断开连接命令
        const disconnectCommand = vscode.commands.registerCommand('yonbip.database.disconnect', () => {
            databaseCommands.disconnectDatabase();
        });

        // 注册查询命令
        const queryCommand = vscode.commands.registerCommand('yonbip.database.query', () => {
            databaseCommands.executeQuery();
        });

        // 注册显示表命令
        const showTablesCommand = vscode.commands.registerCommand('yonbip.database.showTables', () => {
            databaseCommands.showTables();
        });

        context.subscriptions.push(
            configCommand,
            connectCommand,
            disconnectCommand,
            queryCommand,
            showTablesCommand
        );

        return databaseCommands;
    }

    /**
     * 显示数据库配置
     */
    public async showDatabaseConfig(): Promise<void> {
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = '数据库管理';
        
        const connections = this.databaseService.getConnections();
        const activeConnection = this.databaseService.getActiveConnection();
        
        const items = [
            { 
                label: '$(add) 添加连接', 
                description: '创建新的数据库连接',
                detail: '配置新的数据库连接参数'
            },
            ...connections.map(conn => ({
                label: `$(database) ${conn.name}`,
                description: `${conn.type}://${conn.host}:${conn.port}/${conn.database}`,
                detail: conn.isActive ? '当前连接' : '点击连接或管理',
                connection: conn
            }))
        ];

        quickPick.items = items;

        quickPick.onDidChangeSelection(async (selection) => {
            if (selection.length > 0) {
                const selected = selection[0];
                quickPick.hide();
                
                if (selected.label === '$(add) 添加连接') {
                    await this.addConnection();
                } else {
                    const conn = (selected as any).connection as DatabaseConfig;
                    await this.manageConnection(conn);
                }
            }
        });

        quickPick.show();
    }

    /**
     * 添加数据库连接
     */
    private async addConnection(): Promise<void> {
        try {
            const config = await this.getConnectionConfig();
            if (config) {
                await this.databaseService.addConnection(config);
                vscode.window.showInformationMessage(`数据库连接 "${config.name}" 已添加`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`添加连接失败: ${error.message}`);
        }
    }

    /**
     * 管理数据库连接
     */
    private async manageConnection(connection: DatabaseConfig): Promise<void> {
        const actions = [
            { label: '$(plug) 连接', description: '连接到此数据库' },
            { label: '$(edit) 编辑', description: '修改连接配置' },
            { label: '$(testing-passed-icon) 测试', description: '测试连接是否正常' },
            { label: '$(trash) 删除', description: '删除此连接配置' }
        ];

        if (connection.isActive) {
            actions.unshift({ label: '$(debug-disconnect) 断开', description: '断开当前连接' });
        }

        const action = await vscode.window.showQuickPick(actions, {
            placeHolder: `管理连接: ${connection.name}`
        });

        if (action) {
            switch (action.label) {
                case '$(plug) 连接':
                    await this.connectToDatabase(connection.id);
                    break;
                case '$(debug-disconnect) 断开':
                    await this.databaseService.disconnect();
                    break;
                case '$(edit) 编辑':
                    await this.editConnection(connection);
                    break;
                case '$(testing-passed-icon) 测试':
                    await this.testConnection(connection);
                    break;
                case '$(trash) 删除':
                    await this.deleteConnection(connection);
                    break;
            }
        }
    }

    /**
     * 获取连接配置
     */
    private async getConnectionConfig(existing?: DatabaseConfig): Promise<Omit<DatabaseConfig, 'id'> | undefined> {
        // 连接名称
        const name = await vscode.window.showInputBox({
            prompt: '请输入连接名称',
            value: existing?.name || '',
            validateInput: (value) => !value.trim() ? '连接名称不能为空' : null
        });

        if (!name) return undefined;

        // 数据库类型
        const typeOptions = DatabaseService.getSupportedDatabaseTypes();
        const selectedType = await vscode.window.showQuickPick(typeOptions, {
            placeHolder: '选择数据库类型'
        });

        if (!selectedType) return undefined;

        const type = selectedType.label as DatabaseConfig['type'];

        // 主机地址
        const host = await vscode.window.showInputBox({
            prompt: '请输入主机地址',
            value: existing?.host || 'localhost',
            validateInput: (value) => !value.trim() ? '主机地址不能为空' : null
        });

        if (!host) return undefined;

        // 端口
        const defaultPort = DatabaseService.getDefaultPort(type);
        const portStr = await vscode.window.showInputBox({
            prompt: '请输入端口号',
            value: existing?.port?.toString() || defaultPort.toString(),
            validateInput: (value) => {
                const port = parseInt(value);
                if (isNaN(port) || port < 1 || port > 65535) {
                    return '端口号必须在1-65535之间';
                }
                return null;
            }
        });

        if (!portStr) return undefined;
        const port = parseInt(portStr);

        // 数据库名
        const database = await vscode.window.showInputBox({
            prompt: '请输入数据库名',
            value: existing?.database || '',
            validateInput: (value) => !value.trim() ? '数据库名不能为空' : null
        });

        if (!database) return undefined;

        // 用户名
        const username = await vscode.window.showInputBox({
            prompt: '请输入用户名',
            value: existing?.username || '',
            validateInput: (value) => !value.trim() ? '用户名不能为空' : null
        });

        if (!username) return undefined;

        // 密码
        const password = await vscode.window.showInputBox({
            prompt: '请输入密码',
            value: existing?.password || '',
            password: true
        });

        if (password === undefined) return undefined;

        // Schema (可选)
        const schema = await vscode.window.showInputBox({
            prompt: '请输入Schema (可选，Oracle/PostgreSQL)',
            value: existing?.schema || ''
        });

        return {
            name,
            type,
            host,
            port,
            database,
            username,
            password: password || '',
            schema: schema || undefined,
            ssl: false,
            connectionTimeout: 30000
        };
    }

    /**
     * 编辑连接
     */
    private async editConnection(connection: DatabaseConfig): Promise<void> {
        try {
            const updatedConfig = await this.getConnectionConfig(connection);
            if (updatedConfig) {
                await this.databaseService.updateConnection(connection.id, updatedConfig);
                vscode.window.showInformationMessage(`连接 "${updatedConfig.name}" 已更新`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`更新连接失败: ${error.message}`);
        }
    }

    /**
     * 测试连接
     */
    private async testConnection(connection: DatabaseConfig): Promise<void> {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `测试连接: ${connection.name}`,
                cancellable: false
            }, async () => {
                const success = await this.databaseService.testConnection(connection);
                if (success) {
                    vscode.window.showInformationMessage(`连接测试成功: ${connection.name}`);
                } else {
                    vscode.window.showErrorMessage(`连接测试失败: ${connection.name}`);
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`连接测试失败: ${error.message}`);
        }
    }

    /**
     * 删除连接
     */
    private async deleteConnection(connection: DatabaseConfig): Promise<void> {
        const choice = await vscode.window.showWarningMessage(
            `确定要删除连接 "${connection.name}" 吗？`,
            '删除',
            '取消'
        );

        if (choice === '删除') {
            try {
                await this.databaseService.removeConnection(connection.id);
                vscode.window.showInformationMessage(`连接 "${connection.name}" 已删除`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`删除连接失败: ${error.message}`);
            }
        }
    }

    /**
     * 连接数据库
     */
    public async connectDatabase(connectionId?: string): Promise<void> {
        if (!connectionId) {
            const connections = this.databaseService.getConnections();
            if (connections.length === 0) {
                vscode.window.showWarningMessage('没有可用的数据库连接，请先添加连接配置');
                return;
            }

            const connection = await vscode.window.showQuickPick(
                connections.map(conn => ({
                    label: conn.name,
                    description: `${conn.type}://${conn.host}:${conn.port}/${conn.database}`,
                    id: conn.id
                })),
                { placeHolder: '选择要连接的数据库' }
            );

            if (!connection) return;
            connectionId = connection.id;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在连接数据库...',
                cancellable: false
            }, async () => {
                await this.databaseService.connect(connectionId!);
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`连接数据库失败: ${error.message}`);
        }
    }

    /**
     * 连接到指定数据库
     */
    private async connectToDatabase(connectionId: string): Promise<void> {
        await this.connectDatabase(connectionId);
    }

    /**
     * 断开数据库连接
     */
    public async disconnectDatabase(): Promise<void> {
        try {
            await this.databaseService.disconnect();
        } catch (error: any) {
            vscode.window.showErrorMessage(`断开连接失败: ${error.message}`);
        }
    }

    /**
     * 执行SQL查询
     */
    public async executeQuery(): Promise<void> {
        if (this.databaseService.getConnectionStatus() !== ConnectionStatus.CONNECTED) {
            vscode.window.showWarningMessage('请先连接到数据库');
            return;
        }

        const sql = await vscode.window.showInputBox({
            prompt: '请输入SQL查询语句',
            validateInput: (value) => !value.trim() ? 'SQL语句不能为空' : null
        });

        if (!sql) return;

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在执行查询...',
                cancellable: false
            }, async () => {
                const result = await this.databaseService.executeQuery(sql);
                await this.showQueryResult(result);
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`查询执行失败: ${error.message}`);
        }
    }

    /**
     * 显示查询结果
     */
    private async showQueryResult(result: any): Promise<void> {
        let content = `查询结果\n`;
        content += `SQL: ${result.sql}\n`;
        content += `执行时间: ${result.executionTime}ms\n`;
        
        if (result.affectedRows !== undefined) {
            content += `影响行数: ${result.affectedRows}\n`;
        } else {
            content += `返回行数: ${result.rows.length}\n`;
        }
        
        content += '\n';

        if (result.columns && result.columns.length > 0) {
            // 表格标题
            content += result.columns.join('\t') + '\n';
            content += result.columns.map(() => '---').join('\t') + '\n';
            
            // 数据行
            for (const row of result.rows) {
                content += row.join('\t') + '\n';
            }
        } else if (result.affectedRows !== undefined) {
            content += `操作成功，影响了 ${result.affectedRows} 行数据\n`;
        }

        const document = await vscode.workspace.openTextDocument({
            content,
            language: 'text'
        });
        
        await vscode.window.showTextDocument(document);
    }

    /**
     * 显示数据库表
     */
    public async showTables(): Promise<void> {
        if (this.databaseService.getConnectionStatus() !== ConnectionStatus.CONNECTED) {
            vscode.window.showWarningMessage('请先连接到数据库');
            return;
        }

        try {
            const tables = await this.databaseService.getTables();
            
            if (tables.length === 0) {
                vscode.window.showInformationMessage('当前数据库中没有表');
                return;
            }

            const selectedTable = await vscode.window.showQuickPick(
                tables.map(table => ({
                    label: `$(table) ${table}`,
                    description: '数据表',
                    table
                })),
                { placeHolder: '选择要查看的表' }
            );

            if (selectedTable) {
                await this.showTableStructure((selectedTable as any).table);
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`获取表列表失败: ${error.message}`);
        }
    }

    /**
     * 显示表结构
     */
    private async showTableStructure(tableName: string): Promise<void> {
        try {
            const structure = await this.databaseService.getTableStructure(tableName);
            
            let content = `表结构: ${tableName}\n`;
            content += `连接: ${this.databaseService.getActiveConnection()?.name}\n`;
            content += `查询时间: ${new Date().toLocaleString()}\n\n`;

            if (structure.length > 0) {
                // 表格标题（根据数据库类型可能不同）
                const firstRow = structure[0];
                if (Array.isArray(firstRow)) {
                    content += '列名\t数据类型\t可空\t其他\n';
                    content += '---\t---\t---\t---\n';
                    
                    for (const row of structure) {
                        content += row.join('\t') + '\n';
                    }
                }
            } else {
                content += '无法获取表结构信息\n';
            }

            const document = await vscode.workspace.openTextDocument({
                content,
                language: 'text'
            });
            
            await vscode.window.showTextDocument(document);

        } catch (error: any) {
            vscode.window.showErrorMessage(`获取表结构失败: ${error.message}`);
        }
    }

    /**
     * 获取数据库服务实例
     */
    public getDatabaseService(): DatabaseService {
        return this.databaseService;
    }
}