import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NCHomeConfig, DataSourceMeta, ConnectionTestResult, AutoParseResult, DRIVER_INFO_MAP } from './NCHomeConfigTypes';

/**
 * NC Home配置服务
 */
export class NCHomeConfigService {
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;
    private config: NCHomeConfig;
    private configFilePath: string;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('YonBIP NC Home配置');
        this.configFilePath = path.join(context.globalStoragePath, 'nc-home-config.json');
        this.config = this.loadConfig();
    }

    /**
     * 获取配置
     */
    public getConfig(): NCHomeConfig {
        return { ...this.config };
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
                return config;
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
            exportPatchPath: './patches'
        };
    }

    /**
     * 保存到工作区配置
     */
    private async saveToWorkspaceConfig(): Promise<void> {
        const workspaceConfig = vscode.workspace.getConfiguration('yonbip');
        
        if (this.config.homePath) {
            await workspaceConfig.update('homePath', this.config.homePath, vscode.ConfigurationTarget.Workspace);
        }
        
        if (this.config.exportPatchPath) {
            await workspaceConfig.update('patchOutputDir', this.config.exportPatchPath, vscode.ConfigurationTarget.Workspace);
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
            this.outputChannel.appendLine(`测试数据库连接: ${dataSource.name}`);
            
            // 构建连接URL
            const driverInfo = DRIVER_INFO_MAP[dataSource.databaseType]?.find(
                driver => driver.className === dataSource.driverClassName
            );

            if (!driverInfo) {
                return {
                    success: false,
                    message: '未找到匹配的数据库驱动信息'
                };
            }

            const url = driverInfo.url
                .replace('{host}', dataSource.host)
                .replace('{port}', dataSource.port.toString())
                .replace('{database}', dataSource.databaseName);

            // 模拟连接测试（实际应该使用相应的数据库驱动）
            // 这里只做基本的参数验证
            if (!dataSource.host || !dataSource.username) {
                return {
                    success: false,
                    message: '连接参数不完整'
                };
            }

            // 模拟延迟
            await new Promise(resolve => setTimeout(resolve, 1000));

            this.outputChannel.appendLine(`连接测试完成: ${dataSource.name}`);
            
            return {
                success: true,
                message: '连接测试成功'
            };

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
     * 添加数据源
     */
    public async addDataSource(dataSource: DataSourceMeta): Promise<void> {
        if (!this.config.dataSources) {
            this.config.dataSources = [];
        }

        // 检查数据源名称是否重复
        const exists = this.config.dataSources.some(ds => ds.name === dataSource.name);
        if (exists) {
            throw new Error(`数据源名称 "${dataSource.name}" 已存在`);
        }

        this.config.dataSources.push(dataSource);
        await this.saveConfig(this.config);
        
        this.outputChannel.appendLine(`添加数据源: ${dataSource.name}`);
    }

    /**
     * 更新数据源
     */
    public async updateDataSource(dataSource: DataSourceMeta): Promise<void> {
        if (!this.config.dataSources) {
            this.config.dataSources = [];
            return;
        }

        const index = this.config.dataSources.findIndex(ds => ds.name === dataSource.name);
        if (index === -1) {
            throw new Error(`数据源 "${dataSource.name}" 不存在`);
        }

        this.config.dataSources[index] = dataSource;
        await this.saveConfig(this.config);
        
        this.outputChannel.appendLine(`更新数据源: ${dataSource.name}`);
    }

    /**
     * 删除数据源
     */
    public async deleteDataSource(dataSourceName: string): Promise<void> {
        if (!this.config.dataSources) {
            return;
        }

        const index = this.config.dataSources.findIndex(ds => ds.name === dataSourceName);
        if (index === -1) {
            throw new Error(`数据源 "${dataSourceName}" 不存在`);
        }

        this.config.dataSources.splice(index, 1);
        
        // 如果删除的是当前选中的数据源，清除选择
        if (this.config.selectedDataSource === dataSourceName) {
            this.config.selectedDataSource = undefined;
        }
        
        // 如果删除的是基准库，清除基准库设置
        if (this.config.baseDatabase === dataSourceName) {
            this.config.baseDatabase = undefined;
        }

        await this.saveConfig(this.config);
        
        this.outputChannel.appendLine(`删除数据源: ${dataSourceName}`);
    }

    /**
     * 设置为开发库
     */
    public async setAsDesignDatabase(dataSourceName: string): Promise<void> {
        if (!this.config.dataSources?.some(ds => ds.name === dataSourceName)) {
            throw new Error(`数据源 "${dataSourceName}" 不存在`);
        }

        this.config.selectedDataSource = dataSourceName;
        await this.saveConfig(this.config);
        
        this.outputChannel.appendLine(`设置开发库: ${dataSourceName}`);
        vscode.window.showInformationMessage(`已设置 "${dataSourceName}" 为开发库`);
    }

    /**
     * 设置基准库
     */
    public async setBaseDatabase(dataSourceName: string): Promise<void> {
        if (!this.config.dataSources?.some(ds => ds.name === dataSourceName)) {
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
     * 释放资源
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
}