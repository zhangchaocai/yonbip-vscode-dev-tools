import * as vscode from 'vscode';
import { NCHomeConfigService } from './NCHomeConfigService';
import { NCHomeConfig, DataSourceMeta, DATABASE_TYPES, DRIVER_INFO_MAP } from './NCHomeConfigTypes';

/**
 * NC Home配置Webview提供者
 */
export class NCHomeConfigWebviewProvider implements vscode.Disposable {
    private context: vscode.ExtensionContext;
    private service: NCHomeConfigService;
    private panel: vscode.WebviewPanel | undefined;

    constructor(context: vscode.ExtensionContext, service: NCHomeConfigService) {
        this.context = context;
        this.service = service;
    }

    /**
     * 创建或显示webview
     */
    public async createOrShow(): Promise<void> {
        if (this.panel) {
            // 如果面板已存在，直接刷新数据
            this.refresh();
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'ncHomeConfig',
            'NC Home 配置',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [this.context.extensionUri],
                retainContextWhenHidden: true
            }
        );

        this.setupMessageHandlers();

        // 初始化时加载配置数据
        this.handleGetConfig();

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    /**
     * 刷新webview内容
     */
    public refresh(): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'configUpdated',
                config: this.service.getConfig()
            });
        }
    }

    /**
     * 设置消息处理器
     */
    private setupMessageHandlers(): void {
        if (!this.panel) return;

        this.panel.webview.onDidReceiveMessage(async (message) => {
            try {
                // 处理消息
                switch (message.type) {
                    case 'getConfig':
                        this.handleGetConfig();
                        break;
                    case 'saveConfig':
                        this.handleSaveConfig(message.config);
                        break;
                    case 'selectHomeDirectory':
                        this.handleSelectHomeDirectory();
                        break;
                    case 'openHomeDirectory':
                        this.handleOpenHomeDirectory();
                        break;
                    case 'openSysConfig':
                        this.handleOpenSysConfig();
                        break;
                    case 'testConnection':
                        this.handleTestConnection(message.dataSource);
                        break;
                    case 'parseConnectionString':
                        this.handleParseConnectionString(message.connectionString);
                        break;
                    case 'addDataSource':
                        this.handleAddDataSource(message.dataSource);
                        break;
                    case 'updateDataSource':
                        this.handleUpdateDataSource(message.dataSource);
                        break;
                    case 'deleteDataSource':
                        this.handleDeleteDataSource(message.dataSourceName);
                        break;
                    case 'setDesignDatabase':
                        this.handleSetDesignDatabase(message.dataSourceName);
                        break;
                    case 'setBaseDatabase':
                        this.handleSetBaseDatabase(message.dataSourceName);
                        break;
                    case 'checkSystemConfig':
                        this.handleCheckSystemConfig();
                        break;
                }
            } catch (error: any) {
                this.panel?.webview.postMessage({
                    type: 'error',
                    message: error.message
                });
            }
        });
    }

    /**
     * 处理获取配置
     */
    private async handleGetConfig(): Promise<void> {
        const config = this.service.getConfig();

        // 如果homePath已配置，尝试从prop.xml中获取端口信息和数据源信息
        if (config.homePath) {
            const portsAndDataSourcesFromProp = this.service.getPortFromPropXml();
            if (portsAndDataSourcesFromProp.port !== null) {
                config.port = portsAndDataSourcesFromProp.port;
            }
            if (portsAndDataSourcesFromProp.wsPort !== null) {
                config.wsPort = portsAndDataSourcesFromProp.wsPort;
            }

            // 如果prop.xml中有数据源信息，更新到配置中
            if (portsAndDataSourcesFromProp.dataSources.length > 0) {
                // 合并数据源信息，避免重复
                const existingDataSources = config.dataSources || [];
                const newDataSources = portsAndDataSourcesFromProp.dataSources;

                // 创建一个映射来跟踪已存在的数据源
                const existingDataSourceNames = new Set(existingDataSources.map(ds => ds.name));

                // 添加新的数据源（不覆盖已存在的）
                for (const newDataSource of newDataSources) {
                    if (!existingDataSourceNames.has(newDataSource.name)) {
                        existingDataSources.push(newDataSource);
                        existingDataSourceNames.add(newDataSource.name);
                    }
                }

                config.dataSources = existingDataSources;
            }
        }

        this.panel?.webview.postMessage({
            type: 'configLoaded',
            config: config
        });
    }

    /**
     * 处理保存配置
     */
    private async handleSaveConfig(config: NCHomeConfig): Promise<void> {
        await this.service.saveConfig(config);
        this.panel?.webview.postMessage({
            type: 'configSaved'
        });
    }

    /**
     * 处理选择Home目录
     */
    private async handleSelectHomeDirectory(): Promise<void> {
        const homePath = await this.service.selectHomeDirectory();
        this.panel?.webview.postMessage({
            type: 'homeDirectorySelected',
            homePath
        });
    }

    /**
     * 处理打开Home目录
     */
    private async handleOpenHomeDirectory(): Promise<void> {
        await this.service.openHomeDirectory();
    }

    /**
     * 处理打开SysConfig
     */
    private async handleOpenSysConfig(): Promise<void> {
        await this.service.openSysConfig();
    }

    /**
     * 处理测试连接
     */
    private async handleTestConnection(dataSource: DataSourceMeta): Promise<void> {
        const result = await this.service.testConnection(dataSource);
        this.panel?.webview.postMessage({
            type: 'connectionTestResult',
            result
        });
    }

    /**
     * 处理解析连接字符串
     */
    private async handleParseConnectionString(connectionString: string): Promise<void> {
        const result = this.service.parseConnectionString(connectionString);
        this.panel?.webview.postMessage({
            type: 'connectionStringParsed',
            result
        });
    }

    /**
     * 处理添加数据源
     */
    private async handleAddDataSource(dataSource: DataSourceMeta): Promise<void> {
        await this.service.addDataSource(dataSource);
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'dataSourceAdded',
            config
        });
    }

    /**
     * 处理更新数据源
     */
    private async handleUpdateDataSource(dataSource: DataSourceMeta): Promise<void> {
        await this.service.updateDataSource(dataSource);
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'dataSourceUpdated',
            config
        });
    }

    /**
     * 处理设置为开发库
     */
    private async handleSetDesignDatabase(dataSourceName: string): Promise<void> {
        try {
            await this.service.setAsDesignDatabase(dataSourceName);
            const config = this.service.getConfig();
            this.panel?.webview.postMessage({
                type: 'designDatabaseSet',
                config
            });
        } catch (error: any) {
            this.panel?.webview.postMessage({
                type: 'error',
                message: error.message
            });
        }
    }

    /**
     * 处理设置为基准库
     */
    private async handleSetBaseDatabase(dataSourceName: string): Promise<void> {
        try {
            await this.service.setBaseDatabase(dataSourceName);
            const config = this.service.getConfig();
            this.panel?.webview.postMessage({
                type: 'baseDatabaseSet',
                config
            });
        } catch (error: any) {
            this.panel?.webview.postMessage({
                type: 'error',
                message: error.message
            });
        }
    }

    /**
     * 处理删除数据源
     */
    private async handleDeleteDataSource(dataSourceName: string): Promise<void> {
        await this.service.deleteDataSource(dataSourceName);
        const config = this.service.getConfig();
        this.panel?.webview.postMessage({
            type: 'dataSourceDeleted',
            config
        });
    }


    /**
     * 处理系统配置检查
     */
    private async handleCheckSystemConfig(): Promise<void> {
        try {
            const result = this.service.checkSystemConfig();
            this.panel?.webview.postMessage({
                type: 'systemConfigCheckResult',
                result
            });
        } catch (error: any) {
            this.panel?.webview.postMessage({
                type: 'systemConfigCheckResult',
                result: {
                    valid: false,
                    message: `检查系统配置失败: ${error.message}`
                }
            });
        }
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
    }
}