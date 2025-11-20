import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NCHomeConfigService } from './NCHomeConfigService';
import { DataSourceMeta, NCHomeConfig } from './NCHomeConfigTypes';
import { MacHomeConversionService } from '../../mac/MacHomeConversionService';
import { getHomeVersion, findClosestHomeVersion, HOME_VERSIONS } from '../../../utils/HomeVersionUtils';
import { ConfigurationUtils } from '../../../utils/ConfigurationUtils';
import { ModuleConfigService } from '../../../utils/ModuleConfigService';
import { ModuleInfo } from '../../../utils/ModuleUtils';
/**
 * YonBIP Premium Home配置WebView提供者
 */
export class NCHomeConfigProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip-nchome';

    private _view?: vscode.WebviewView;
    private configService: NCHomeConfigService;
    private macHomeConversionService: MacHomeConversionService;
    private readonly context: vscode.ExtensionContext;
    private moduleConfigService: ModuleConfigService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        macHomeConversionService?: MacHomeConversionService
    ) {
        this.context = context;
        this.configService = new NCHomeConfigService(context);
        // 如果传入了MacHomeConversionService实例，则使用它，否则创建新的实例
        this.macHomeConversionService = macHomeConversionService || new MacHomeConversionService(this.configService);
        this.moduleConfigService = new ModuleConfigService(context);
    }

    /**
     * 检查是否已配置YonBIP Premium Home路径
     * @returns 如果已配置返回true，否则返回false并发送错误消息到WebView
     */
    private checkHomePathConfigured(): boolean {
        const config = this.configService.getConfig();
        if (!config.homePath) {
            // 发送错误消息到WebView，由调用者决定发送什么类型的消息
            return false;
        }
        
        return true;
    }

    /**
     * 自动执行配置更新
     * 包括更新杂项配置文件和prop.xml中的address标签
     */
    private async autoUpdateConfigurations(): Promise<void> {
        try {
            const configUtils = new ConfigurationUtils(this.configService);
            
            // 并行执行所有配置更新操作以提高性能
            const updatePromises = [
                configUtils.updateMiscellaneousConfiguration(),
                configUtils.updatePropXmlAddress(),
                configUtils.authorizeHomeDirectoryPermissions()
            ];
            
            // 等待所有操作完成
            await Promise.all(updatePromises);
            
            console.log('自动配置更新完成');
        } catch (error) {
            console.error('自动配置更新失败:', error);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 处理来自WebView的消息
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'loadConfig':
                    await this.handleLoadConfig();
                    break;
                case 'saveConfig':
                    await this.handleSaveConfig(data.config);
                    break;
                case 'selectHomeDirectory':
                    await this.handleSelectHomeDirectory();
                    break;
                case 'openHomeDirectory':
                    await this.handleOpenHomeDirectory();
                    break;
                case 'openSysConfig':
                    await this.handleOpenSysConfig();
                    break;
                case 'viewLogs':
                    await this.handleViewLogs();
                    break;
                case 'openLogsDirectory':
                    await this.handleOpenLogsDirectory();
                    break;
                // case 'startHomeService':
                //     await this.handleStartHomeService();
                //     break;
                case 'stopHomeService':
                    await this.handleStopHomeService();
                    break;
                case 'testConnection':
                    await this.handleTestConnection(data.dataSource);
                    break;
                case 'addDataSource':
                    await this.handleAddDataSource(data.dataSource);
                    break;
                case 'updateDataSource':
                    await this.handleUpdateDataSource(data.dataSource);
                    break;
                case 'deleteDataSource':
                    await this.handleDeleteDataSource(data.dataSourceName);
                    break;
                case 'requestDeleteConfirmation':
                    await this.handleDeleteConfirmationRequest(data.dataSourceName);
                    break;
                case 'setDesignDatabase':
                    await this.handleSetDesignDatabase(data.dataSourceName);
                    break;
                case 'setBaseDatabase':
                    await this.handleSetBaseDatabase(data.dataSourceName);
                    break;
                case 'checkSystemConfig':
                    await this.handleCheckSystemConfig();
                    break;
                case 'debugHomeService':
                    await this.handleDebugHomeService();
                    break;
                case 'convertToMacHome':
                    await this.handleConvertToMacHome();
                    break;

                case 'confirmResetDefaults':
                    await this.handleConfirmResetDefaults();
                    break;
                case 'saveModuleConfig':
                    await this.handleSaveModuleConfig(data.modules);
                    break;
            }
        });

        // 初始加载配置
        this.handleLoadConfig();
    }

    /**
     * 处理加载配置
     */
    private async handleLoadConfig() {
        // 重新加载配置以确保使用当前工作区的配置
        this.configService = new NCHomeConfigService(this.context);

        const config = this.configService.getConfig();

        // 如果homePath已配置，尝试从prop.xml中获取端口信息和数据源信息
        if (config.homePath) {
            const portsAndDataSourcesFromProp = this.configService.getPortFromPropXml();
            if (portsAndDataSourcesFromProp.port !== null) {
                config.port = portsAndDataSourcesFromProp.port;
            }
            if (portsAndDataSourcesFromProp.wsPort !== null) {
                config.wsPort = portsAndDataSourcesFromProp.wsPort;
            }
            // 确保不从prop.xml中获取JVM参数，始终使用用户在界面中设置的参数
            // if (portsAndDataSourcesFromProp.vmParameters !== undefined) {
            //     config.vmParameters = portsAndDataSourcesFromProp.vmParameters;
            //     console.log('Loaded JVM parameters from prop.xml:', portsAndDataSourcesFromProp.vmParameters);
            // }

            // 从prop.xml中获取数据源信息
            if (portsAndDataSourcesFromProp.dataSources.length > 0) {
                // 直接使用从prop.xml读取的数据源信息
                config.dataSources = portsAndDataSourcesFromProp.dataSources;
            }

            // 如果homeVersion未设置，尝试从HOME目录获取版本信息
            if (!config.homeVersion) {
                const homeVersion = getHomeVersion(config.homePath);
                const closestVersion = findClosestHomeVersion(homeVersion);
                if (closestVersion) {
                    config.homeVersion = closestVersion;
                }
            }
        }

        // 确保所有相关字段正确初始化
        if (!config.dataSources) {
            config.dataSources = [];
        }

        // 确保 selectedDataSource 和 baseDatabase 字段存在
        if (config.selectedDataSource === undefined) {
            config.selectedDataSource = undefined;
        }

        if (config.baseDatabase === undefined) {
            config.baseDatabase = undefined;
        }

        console.log('Sending config to frontend:', config);

        // 加载模块配置
        let modules: ModuleInfo[] = [];
        if (config.homePath) {
            modules = this.moduleConfigService.getModuleInfos(config.homePath);
        }

        this._view?.webview.postMessage({
            type: 'configLoaded',
            config,
            homeVersions: HOME_VERSIONS,
            modules: modules
        });
    }

    /**
     * 处理保存配置
     */
    private async handleSaveConfig(config: NCHomeConfig) {
        try {
            await this.configService.saveConfig(config);
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理选择Home目录
     */
    private async handleSelectHomeDirectory() {
        try {
            // 显示进度条
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "正在处理Home目录选择",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "正在选择Home目录..." });
                
                const homePath = await this.configService.selectHomeDirectory();
                if (homePath) {
                    progress.report({ message: "正在配置Home路径..." });
                    const config = this.configService.getConfig();
                    config.homePath = homePath;

                    // 获取HOME版本并设置默认值
                    const homeVersion = getHomeVersion(homePath);
                    const closestVersion = findClosestHomeVersion(homeVersion);
                    if (closestVersion) {
                        config.homeVersion = closestVersion;
                    }
                    
                    // 保存初始配置（包含homeVersion）
                    await this.configService.saveConfig(config);

                    // 自动执行配置更新（仅在选择HOME目录后执行一次）
                    progress.report({ message: "正在更新配置..." });
                    await this.autoUpdateConfigurations();

                    // 如果是Mac/Linux系统，自动执行Mac HOME转换
                    if (process.platform === 'darwin' || process.platform === 'linux') {
                        // 检查home/bin目录下是否已存在sysConfig.sh文件
                        const sysConfigPath = path.join(homePath, 'bin', 'sysConfig.sh');
                        if (fs.existsSync(sysConfigPath)) {
                            // 如果sysConfig.sh文件已存在，则不再执行MAC HOME转换
                            this.macHomeConversionService['outputChannel'].appendLine('检测到sysConfig.sh文件已存在，跳过MAC HOME转换');
                            vscode.window.showInformationMessage('检测到sysConfig.sh文件已存在，跳过MAC HOME转换');
                        } else {
                            const convert = await vscode.window.showInformationMessage(
                                '检测到您使用的是Mac系统，是否需要自动执行Mac HOME转换？',
                                '是',
                                '否'
                            );

                            if (convert === '是') {
                                progress.report({ message: "正在执行Mac HOME转换..." });
                                await this.macHomeConversionService.convertToMacHome(homePath);
                            }
                        }
                    }

                    // 同步配置信息从prop.xml文件
                    progress.report({ message: "正在同步配置信息..." });
                    this.configService.syncConfigFromPropXml();
                    
                    // 保存同步后的配置
                    await this.configService.saveConfig(this.configService.getConfig());
                    
                    // 重新加载配置以获取新home目录中的数据源信息
                    progress.report({ message: "正在加载配置..." });
                    await this.handleLoadConfig();
                    
                    // 刷新所有相关Webview的数据源显示
                    await this.refreshAllDataSources();
                }
                
                this._view?.webview.postMessage({
                    type: 'homeDirectorySelected',
                    homePath,
                    success: !!homePath
                });
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'homeDirectorySelected',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理打开Home目录
     */
    private async handleOpenHomeDirectory() {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'homeDirectoryOpened',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            await this.configService.openHomeDirectory();
            this._view?.webview.postMessage({
                type: 'homeDirectoryOpened',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'homeDirectoryOpened',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理打开SysConfig
     */
    private async handleOpenSysConfig() {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'sysConfigOpened',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            await this.configService.openSysConfig();
            this._view?.webview.postMessage({
                type: 'sysConfigOpened',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'sysConfigOpened',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理查看日志
     */
    private async handleViewLogs() {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'logsLoaded',
                    logs: [],
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            const logs = await this.configService.getLatestLogs();
            this._view?.webview.postMessage({
                type: 'logsLoaded',
                logs: logs
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'logsLoaded',
                logs: [],
                error: error.message
            });
        }
    }

    /**
     * 处理打开日志文件夹
     */
    private async handleOpenLogsDirectory() {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'logsDirectoryOpened',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }

            const config = this.configService.getConfig();
            const logsPath = path.join(config.homePath, 'nclogs', 'server');
            
            // 检查日志目录是否存在
            if (!fs.existsSync(logsPath)) {
                this._view?.webview.postMessage({
                    type: 'logsDirectoryOpened',
                    success: false,
                    error: `日志目录不存在: ${logsPath}`
                });
                return;
            }
            
            // 使用VS Code API打开文件夹
            const logsUri = vscode.Uri.file(logsPath);
            await vscode.env.openExternal(logsUri);
            
            this._view?.webview.postMessage({
                type: 'logsDirectoryOpened',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'logsDirectoryOpened',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理Mac HOME转换
     */
    private async handleConvertToMacHome() {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'macHomeConversionResult',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            


            const config = this.configService.getConfig();
            const homePath = config.homePath;

            // 检查是否为Mac系统
            if (process.platform !== 'darwin') {
                this._view?.webview.postMessage({
                    type: 'macHomeConversionResult',
                    success: false,
                    error: '当前系统不是Mac系统，无需执行转换'
                });
                return;
            }

            // 执行Mac HOME转换
            const result = await this.macHomeConversionService.convertToMacHome(homePath);
            
            this._view?.webview.postMessage({
                type: 'macHomeConversionResult',
                success: result
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'macHomeConversionResult',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理启动HOME服务
     */
    // private async handleStartHomeService() {
    //     try {
    //         // 执行启动HOME服务的命令
    //         await vscode.commands.executeCommand('yonbip.home.start');
    //         this._view?.webview.postMessage({
    //             type: 'homeServiceStarted',
    //             success: true
    //         });
    //     } catch (error: any) {
    //         this._view?.webview.postMessage({
    //             type: 'homeServiceStarted',
    //             success: false,
    //             error: error.message
    //         });
    //     }
    // }

    /**
     * 处理停止HOME服务
     */
    private async handleStopHomeService() {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'homeServiceStopped',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            // 执行停止HOME服务的命令
            const result = await vscode.commands.executeCommand('yonbip.home.stop');
            this._view?.webview.postMessage({
                type: 'homeServiceStopped',
                success: true,
                result: result
            });
        } catch (error: any) {
            const errorMessage = error.message || error.toString() || '未知错误';
            this._view?.webview.postMessage({
                type: 'homeServiceStopped',
                success: false,
                error: errorMessage
            });
        }
    }

    /**
     * 处理测试连接
     */
    private async handleTestConnection(dataSource: DataSourceMeta) {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'connectionTestResult',
                    result: {
                        success: false,
                        message: '请先配置YonBIP Premium Home路径'
                    }
                });
                return;
            }
            
            // 显示进度条
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "正在测试数据库连接",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "正在连接数据库..." });
                
                const result = await this.configService.testConnection(dataSource);
                this._view?.webview.postMessage({
                    type: 'connectionTestResult',
                    result
                });
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionTestResult',
                result: {
                    success: false,
                    message: `测试连接失败: ${error.message}`
                }
            });
        }
    }

    /**
     * 处理添加数据源
     */
    private async handleAddDataSource(dataSource: DataSourceMeta) {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'dataSourceAdded',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            await this.configService.addDataSource(dataSource);
            // 注意：这里不再重新加载整个配置，只发送成功消息
            this._view?.webview.postMessage({
                type: 'dataSourceAdded',
                success: true
                // 不再传递整个config对象
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'dataSourceAdded',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理更新数据源
     */
    private async handleUpdateDataSource(dataSource: DataSourceMeta) {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'dataSourceUpdated',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            await this.configService.updateDataSource(dataSource);
            // 注意：这里不再重新加载整个配置，只发送成功消息
            this._view?.webview.postMessage({
                type: 'dataSourceUpdated',
                success: true
                // 不再传递整个config对象
            });
        } catch (error: any) {
            // 发送错误消息
            this._view?.webview.postMessage({
                type: 'dataSourceUpdated',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理删除数据源
     */
    private async handleDeleteDataSource(dataSourceName: string) {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'dataSourceDeleted',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            await this.configService.deleteDataSource(dataSourceName);
            // 注意：这里不再重新加载整个配置，只发送成功消息
            this._view?.webview.postMessage({
                type: 'dataSourceDeleted',
                success: true
                // 不再传递整个config对象
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'dataSourceDeleted',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理设置开发库
     */
    private async handleSetDesignDatabase(dataSourceName: string) {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'designDatabaseSet',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            await this.configService.setAsDesignDatabase(dataSourceName);
            // 注意：这里不再传递整个config对象，而是重新加载配置以获取最新的数据源信息
            await this.handleLoadConfig();
            this._view?.webview.postMessage({
                type: 'designDatabaseSet',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'designDatabaseSet',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理设置基准库
     */
    private async handleSetBaseDatabase(dataSourceName: string) {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'baseDatabaseSet',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            await this.configService.setBaseDatabase(dataSourceName);
            // 注意：这里不再传递整个config对象，而是重新加载配置以获取最新的数据源信息
            await this.handleLoadConfig();
            this._view?.webview.postMessage({
                type: 'baseDatabaseSet',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'baseDatabaseSet',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理解析连接字符串
     */
    private async handleParseConnectionString(connectionString: string) {
        try {
            const result = this.configService.parseConnectionString(connectionString);
            this._view?.webview.postMessage({
                type: 'connectionStringParsed',
                result
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionStringParsed',
                result: {
                    valid: false,
                    error: error.message
                }
            });
        }
    }

    /**
     * 处理调试启动HOME服务
     */
    private async handleDebugHomeService() {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'homeServiceDebugged',
                    success: false,
                    error: '请先配置YonBIP Premium Home路径'
                });
                return;
            }
            

            
            // 执行调试启动HOME服务的命令
            await vscode.commands.executeCommand('yonbip.home.debug');
            this._view?.webview.postMessage({
                type: 'homeServiceDebugged',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'homeServiceDebugged',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理系统配置检查
     */
    private async handleCheckSystemConfig() {
        try {
            // 先检查是否已配置Home目录
            if (!this.checkHomePathConfigured()) {
                this._view?.webview.postMessage({
                    type: 'systemConfigCheckResult',
                    result: {
                        valid: false,
                        message: '请先配置YonBIP Premium Home路径'
                    }
                });
                return;
            }
            

            
            const result = this.configService.checkSystemConfig();
            this._view?.webview.postMessage({
                type: 'systemConfigCheckResult',
                result
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'systemConfigCheckResult',
                result: {
                    valid: false,
                    message: `检查系统配置失败: ${error.message}`
                }
            });
        }
    }

    /**
     * 生成WebView HTML内容
     */
    public getHtmlForWebview(webview: vscode.Webview): string {
        return this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // 直接返回内嵌的HTML，避免使用fs和path模块
        // 在生产环境中，Webview中不能使用Node.js内置模块
        return this.getNCHomeConfigHTML();
    }

    /**
     * 获取NC Home配置的HTML内容
     */
    private getNCHomeConfigHTML(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YonBIP Premium Home配置</title>
    <style>
        :root {
            --primary-gradient: linear-gradient(135deg, #007acc 0%, #005a9e 100%);
            --success-gradient: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            --warning-gradient: linear-gradient(135deg, #ffc107 0%, #fd7e14 100%);
            --danger-gradient: linear-gradient(135deg, #dc3545 0%, #e83e8c 100%);
            --card-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            --card-shadow-hover: 0 4px 16px rgba(0, 0, 0, 0.15);
            --border-radius: 12px;
            --border-radius-small: 8px;
            --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, rgba(0, 122, 204, 0.02) 100%);
            padding: 0;
            margin: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        #app {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        
        /* 固定页签区域 */
        .tabs-container {
            position: sticky;
            top: 0;
            z-index: 1000;
            background: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-widget-border);
            padding: 16px 16px 0 16px;
        }
        
        /* 可滚动内容区域 */
        .content-container {
            flex: 1;
            overflow-y: auto;
            padding: 0 16px 16px 16px;
        }
        
        /* 固定底部操作按钮栏 */
        .section:last-child {
            position: sticky;
            bottom: 0;
            background: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-widget-border);
            margin-bottom: 0;
            z-index: 100;
            box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
        }
        
        /* 滚动条样式优化 */
        ::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        
        ::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 6px;
        }
        
        ::-webkit-scrollbar-thumb {
            background: linear-gradient(135deg, var(--vscode-scrollbarSlider-hoverBackground), var(--vscode-scrollbarSlider-activeBackground));
            border-radius: 6px;
            border: 2px solid var(--vscode-scrollbarSlider-background);
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(135deg, var(--vscode-scrollbarSlider-activeBackground), var(--vscode-textLink-foreground));
        }
        
        .section {
            margin-bottom: 16px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: var(--border-radius);
            padding: 20px;
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, rgba(255, 255, 255, 0.02) 100%);
            box-shadow: var(--card-shadow);
            transition: var(--transition);
            position: relative;
            overflow: hidden;
        }
        .section::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--primary-gradient);
            opacity: 0;
            transition: var(--transition);
        }
        
        .section:hover {
            box-shadow: var(--card-shadow-hover);
            transform: translateY(-2px);
            border-color: var(--vscode-focusBorder);
        }
        
        .section:hover::before {
            opacity: 1;
        }
        
        .section-title {
            font-weight: 700;
            margin-bottom: 16px;
            color: var(--vscode-textLink-foreground);
            font-size: 18px;
            border-bottom: 2px solid transparent;
            background: var(--primary-gradient);
            background-clip: text;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            padding-bottom: 10px;
            display: flex;
            align-items: center;
            position: relative;
        }
        
        .section-title::before {
            content: '';
            display: inline-block;
            width: 6px;
            height: 20px;
            background: var(--primary-gradient);
            margin-right: 12px;
            border-radius: 3px;
            box-shadow: 0 2px 4px rgba(0, 122, 204, 0.3);
        }
        
        .section-title::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            width: 60px;
            height: 2px;
            background: var(--primary-gradient);
            border-radius: 1px;
            z-index: 1;
        }
        
        /* 数据源管理头部样式 */
         .section-header {
             display: flex;
             align-items: center;
             justify-content: space-between;
             margin-bottom: 20px;
             padding-bottom: 12px;
             border-bottom: 2px solid transparent;
             position: relative;
         }
         
         .section-header::after {
             content: '';
             position: absolute;
             bottom: 0;
             left: 0;
             width: 60px;
             height: 2px;
             background: var(--primary-gradient);
             border-radius: 1px;
         }
         
         .section-title-text {
             font-weight: 700;
             color: var(--vscode-textLink-foreground);
             font-size: 18px;
             background: var(--primary-gradient);
             background-clip: text;
             -webkit-background-clip: text;
             -webkit-text-fill-color: transparent;
             display: flex;
             align-items: center;
             position: relative;
         }
         
         .section-title-text::before {
             content: '';
             display: inline-block;
             width: 6px;
             height: 20px;
             background: var(--primary-gradient);
             margin-right: 12px;
             border-radius: 3px;
             box-shadow: 0 2px 4px rgba(0, 122, 204, 0.3);
         }
         
         /* 添加数据源按钮特殊样式 */
         .add-datasource-btn {
             margin: 0;
             height: 36px;
             padding: 8px 16px;
             font-size: 14px;
             min-height: auto;
             position: relative;
             z-index: 100;
             background: var(--primary-gradient) !important;
             color: white !important;
             border: none !important;
             border-radius: var(--border-radius-small) !important;
             cursor: pointer !important;
             transition: var(--transition);
             box-shadow: 0 2px 8px rgba(0, 122, 204, 0.3);
             display: inline-flex !important;
             align-items: center !important;
             justify-content: center !important;
             font-weight: 600;
         }
         
         .add-datasource-btn:hover {
             transform: translateY(-1px) !important;
             box-shadow: 0 4px 12px rgba(0, 122, 204, 0.4) !important;
         }
         
         .add-datasource-btn:active {
             transform: translateY(0) !important;
         }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        .form-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            margin-bottom: 12px;
            gap: 8px;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            min-width: 40px;
            color: var(--vscode-editor-foreground);
            font-size: 14px;
            letter-spacing: 0.3px;
        }
        
        .form-row label {
            margin-bottom: 0;
            margin-right: 12px;
        }
        
        .form-row .input-container {
            display: flex;
            flex: 1;
            min-width: 0;
            gap: 12px;
            align-items: flex-start;
            width: 100%;
        }
        
        .form-row .input-container input {
            text-overflow: ellipsis;
            white-space: nowrap;
            overflow: hidden;
        }
        
        @media (max-width: 500px) {
            .form-row {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .form-row .input-container {
                width: 100%;
                margin-bottom: 8px;
            }
            
            .form-row .browse-button {
                width: 100%;
            }
        }
        
        input, select, textarea {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid var(--vscode-input-border);
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, rgba(255, 255, 255, 0.05) 100%);
            color: var(--vscode-input-foreground);
            border-radius: var(--border-radius-small);
            box-sizing: border-box;
            transition: var(--transition);
            font-size: 14px;
            position: relative;
            min-height: 40px;
        }
        
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 3px rgba(0, 122, 204, 0.15);
            transform: translateY(-1px);
        }
        
        /* 密码输入框特殊样式 */
        input[type="password"] {
            font-family: monospace;
            letter-spacing: 3px;
        }
        
        /* JVM参数文本域占满区域 */
        #vmParameters {
            display: block;
            width: 100%;
            height: 20vh;
            min-height: 200px;
            max-height: 50vh;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            line-height: 1.6;
            resize: vertical;
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, rgba(0, 0, 0, 0.02) 100%);
        }
        
        .form-row input {
            flex: 1;
        }
        
        button {
            background: var(--primary-gradient);
            color: white;
            border: none;
            padding: 12px 16px;
            border-radius: var(--border-radius-small);
            cursor: pointer;
            margin-right: 8px;
            margin-bottom: 8px;
            font-size: 14px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: var(--transition);
            min-height: 40px;
            box-shadow: 0 2px 8px rgba(0, 122, 204, 0.3);
            position: relative;
            overflow: hidden;
            min-width: auto;
            width: auto;
        }
        
        button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
        }
        
        button:hover::before {
            left: 100%;
        }
        
        .browse-button {
            height: 40px;
            padding: 12px 12px;
            margin-bottom: 0;
            min-height: auto;
            min-width: auto;
            width: auto;
            align-self: flex-start;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0, 122, 204, 0.4);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        button.secondary {
            background: linear-gradient(135deg, var(--vscode-button-secondaryBackground) 0%, rgba(108, 117, 125, 0.8) 100%);
            color: var(--vscode-button-secondaryForeground);
            box-shadow: 0 2px 8px rgba(108, 117, 125, 0.3);
            padding: 12px 16px;
        }
        
        button.secondary:hover {
            box-shadow: 0 4px 16px rgba(108, 117, 125, 0.4);
        }
        
        .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        
        .tabs {
            display: flex;
            border-bottom: none;
            margin-bottom: 0;
            overflow-x: auto;
            scrollbar-width: thin;
            padding: 4px;
            background: linear-gradient(135deg, rgba(0, 122, 204, 0.05) 0%, rgba(0, 122, 204, 0.02) 100%);
            border-radius: var(--border-radius);
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .tab {
            padding: 14px 20px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            margin-right: 6px;
            border-radius: var(--border-radius-small);
            font-weight: 600;
            position: relative;
            white-space: nowrap;
            transition: var(--transition);
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .tab:hover {
            background: linear-gradient(135deg, rgba(0, 122, 204, 0.1) 0%, rgba(0, 122, 204, 0.05) 100%);
            transform: translateY(-1px);
        }
        
        .tab.active {
            background: var(--primary-gradient);
            color: white;
            box-shadow: 0 4px 12px rgba(0, 122, 204, 0.3);
            transform: translateY(-2px);
        }
        
        .tab.active::after {
            display: none;
        }
        
        .tab-content {
            display: none;
            animation: slideInUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        @keyframes slideInUp {
            from { 
                opacity: 0; 
                transform: translateY(20px);
            }
            to { 
                opacity: 1; 
                transform: translateY(0);
            }
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .tab-content.active {
            display: block;
        }
        
        .status-message {
            padding: 16px 20px;
            border-radius: var(--border-radius-small);
            margin-bottom: 20px;
            text-align: center;
            animation: slideInUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            font-weight: 500;
            position: relative;
            overflow: hidden;
        }
        
        .status-message::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
            animation: shimmer 2s infinite;
        }
        
        @keyframes shimmer {
            0% { left: -100%; }
            100% { left: 100%; }
        }
        
        .status-success {
            background: var(--success-gradient);
            color: white;
            border: 2px solid rgba(40, 167, 69, 0.3);
            box-shadow: 0 4px 16px rgba(40, 167, 69, 0.3);
        }
        
        .status-error {
            background: var(--danger-gradient);
            color: white;
            border: 2px solid rgba(220, 53, 69, 0.3);
            box-shadow: 0 4px 16px rgba(220, 53, 69, 0.3);
        }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            margin-bottom: 16px;
            cursor: pointer;
            padding: 12px 16px;
            border-radius: var(--border-radius-small);
            transition: var(--transition);
            border: 2px solid transparent;
            background: linear-gradient(135deg, rgba(0, 122, 204, 0.02) 0%, rgba(0, 122, 204, 0.01) 100%);
        }
        
        .checkbox-group:hover {
            background: linear-gradient(135deg, rgba(0, 122, 204, 0.08) 0%, rgba(0, 122, 204, 0.04) 100%);
            border-color: rgba(0, 122, 204, 0.2);
            transform: translateY(-1px);
        }
        
        .checkbox-group input[type="checkbox"] {
            width: 20px;
            height: 20px;
            margin-right: 12px;
            cursor: pointer;
            accent-color: var(--vscode-textLink-foreground);
        }
        
        .help-text {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-top: 6px;
            line-height: 1.4;
            padding-left: 4px;
            font-style: italic;
            opacity: 0.8;
        }
        
        /* 卡片样式 */
        .card {
            border: 2px solid var(--vscode-widget-border);
            border-radius: var(--border-radius);
            padding: 20px;
            margin-bottom: 16px;
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, rgba(255, 255, 255, 0.02) 100%);
            transition: var(--transition);
            position: relative;
            overflow: hidden;
        }
        
        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: var(--primary-gradient);
            opacity: 0;
            transition: var(--transition);
        }
        
        .card:hover {
            box-shadow: var(--card-shadow-hover);
            border-color: var(--vscode-focusBorder);
            transform: translateY(-3px);
        }
        
        .card:hover::before {
            opacity: 1;
        }
        
        /* 徽章样式 */
        .badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
            margin-right: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }
        
        .badge-primary {
            background: var(--primary-gradient);
            color: white;
        }
        
        .badge-secondary {
            background: linear-gradient(135deg, var(--vscode-button-secondaryBackground) 0%, rgba(108, 117, 125, 0.8) 100%);
            color: var(--vscode-button-secondaryForeground);
        }
        
        /* 数据源列表特殊样式 */
        #datasourceList .card {
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, rgba(0, 122, 204, 0.02) 100%);
            border-left: 4px solid var(--primary-gradient);
        }
        
        #datasourceList .card:hover {
            border-left-width: 6px;
        }
        
        /* 响应式设计优化 */
        @media (max-width: 768px) {
            body {
                padding: 12px;
            }
            
            .section {
                padding: 16px;
                margin-bottom: 16px;
            }
            
            .section-title {
                font-size: 16px;
            }
            
            .tabs {
                padding: 2px;
            }
            
            .tab {
                padding: 10px 14px;
                font-size: 13px;
            }
            
            .button-group {
                gap: 8px;
            }
            
            button {
                padding: 10px 16px;
                font-size: 13px;
            }
        }
        
        /* 加载动画 */
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .loading {
            animation: pulse 1.5s ease-in-out infinite;
        }
        
        /* 自定义选择框样式 */
        select {
            appearance: none;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 12px center;
            background-size: 16px;
            padding-right: 40px;
        }
        
        /* 输入框组合样式 */
         .input-group {
             position: relative;
             display: flex;
             align-items: center;
             border: 2px solid var(--vscode-input-border);
             border-radius: var(--border-radius-small);
             background: linear-gradient(135deg, var(--vscode-input-background) 0%, rgba(255, 255, 255, 0.05) 100%);
             transition: var(--transition);
             min-height: 40px;
             flex: 1;
             width: 100%;
         }
         
         .input-group:hover {
             border-color: var(--vscode-focusBorder);
             box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
         }
         
         .input-group input {
             padding-right: 50px;
             border: none;
             background: transparent;
             outline: none;
             flex: 1;
         }
         
         /* 当输入框为空时显示提示 */
         .input-group input:placeholder-shown {
             color: var(--vscode-descriptionForeground);
             font-style: italic;
         }
         
         .input-group input::-webkit-input-placeholder {
             color: var(--vscode-descriptionForeground);
             font-style: italic;
         }
         
         .input-group input::-moz-placeholder {
             color: var(--vscode-descriptionForeground);
             font-style: italic;
         }
         
         .input-group .input-icon {
             position: absolute;
             right: 12px;
             color: var(--vscode-descriptionForeground);
             font-size: 16px;
             pointer-events: none;
         }
         
         /* 悬浮提示样式 */
         .tooltip {
             visibility: hidden;
             position: absolute;
             z-index: 10000;
             top: calc(100% + 8px);
             left: 0;
             opacity: 0;
             transition: opacity 0.2s ease-in-out;
             background-color: var(--vscode-editor-background);
             color: var(--vscode-foreground);
             border: 1px solid var(--vscode-widget-border);
             border-radius: 6px;
             padding: 8px 12px;
             font-size: 12px;
             box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
             white-space: normal;
             word-break: break-all;
             max-width: calc(100vw - 48px);
             text-align: left;
             pointer-events: none;
         }
         
         .tooltip::after {
             content: "";
             position: absolute;
             top: -6px;
             left: 16px;
             border-width: 6px;
             border-style: solid;
             border-color: transparent transparent var(--vscode-editor-background) transparent;
         }
         
         .input-group:hover .tooltip {
             visibility: visible;
             opacity: 1;
         }
         
         /* 页签图标和文本样式 */
         .tab-icon {
             font-size: 16px;
             margin-right: 6px;
         }
         
         .tab-text {
             font-size: 14px;
         }
         
         @media (max-width: 600px) {
             .tab-text {
                 display: none;
             }
             
             .tab-icon {
                 margin-right: 0;
                 font-size: 18px;
             }
         }
         
         /* 空状态样式 */
         .empty-state {
             text-align: center;
             padding: 40px 20px;
             color: var(--vscode-descriptionForeground);
             background: linear-gradient(135deg, rgba(0, 122, 204, 0.02) 0%, rgba(0, 122, 204, 0.01) 100%);
             border-radius: var(--border-radius);
             border: 2px dashed var(--vscode-widget-border);
         }
         
         .empty-icon {
             font-size: 48px;
             margin-bottom: 16px;
             opacity: 0.6;
         }
         
         .empty-text {
             font-size: 18px;
             font-weight: 600;
             margin-bottom: 8px;
             color: var(--vscode-foreground);
         }
         
         .empty-subtext {
             font-size: 14px;
             opacity: 0.8;
             line-height: 1.4;
         }
         
         /* 添加数据源按钮特殊样式 */
         .add-datasource-btn {
             margin: 0;
             height: 36px;
             padding: 8px 16px;
             font-size: 14px;
             min-height: auto;
             position: relative;
             z-index: 100;
         }
         
         /* 数据源卡片增强样式 */
         .datasource-card {
             background: linear-gradient(135deg, var(--vscode-input-background) 0%, rgba(0, 122, 204, 0.03) 100%);
             border-left: 4px solid var(--primary-gradient);
             padding: 20px;
             margin-bottom: 16px;
             border-radius: var(--border-radius);
             transition: var(--transition);
             position: relative;
             overflow: hidden;
         }
         
         .datasource-card::before {
             content: '';
             position: absolute;
             top: 0;
             left: 0;
             right: 0;
             height: 2px;
             background: var(--primary-gradient);
             opacity: 0;
             transition: var(--transition);
         }
         
         .datasource-card:hover {
             transform: translateY(-2px);
             box-shadow: var(--card-shadow-hover);
             border-left-width: 6px;
         }
         
         .datasource-card:hover::before {
             opacity: 1;
         }
         
         .datasource-header {
             display: flex;
             justify-content: space-between;
             align-items: center;
             margin-bottom: 12px;
         }
         
         .datasource-name {
             font-weight: 700;
             font-size: 16px;
             color: var(--vscode-textLink-foreground);
         }
         
         .datasource-badges {
             display: flex;
             gap: 8px;
         }
         
         .datasource-info {
             font-size: 13px;
             color: var(--vscode-descriptionForeground);
             margin-bottom: 16px;
             line-height: 1.5;
         }
         
         .datasource-info div {
             margin-bottom: 4px;
         }
         
         .datasource-actions {
             display: flex;
             gap: 8px;
             flex-wrap: wrap;
         }
         
         .datasource-actions button {
             font-size: 12px;
             padding: 6px 12px;
             min-height: 28px;
             margin: 0;
         }

         /* 模块列表样式 */
         .module-list {
             max-height: 400px;
             overflow-y: auto;
             border: 1px solid var(--vscode-widget-border);
             border-radius: var(--border-radius);
             background: var(--vscode-input-background);
         }

         .module-item {
             display: flex;
             align-items: center;
             padding: 12px 16px;
             border-bottom: 1px solid var(--vscode-widget-border);
             transition: var(--transition);
             position: relative;
             gap: 12px;
         }

         .module-item:last-child {
             border-bottom: none;
         }

         .module-item:hover {
             background: rgba(0, 122, 204, 0.05);
         }

         .module-item.required {
             background: linear-gradient(135deg, rgba(40, 167, 69, 0.05) 0%, rgba(32, 201, 151, 0.03) 100%);
         }

         .module-item.required::before {
             content: '';
             position: absolute;
             left: 0;
             top: 0;
             bottom: 0;
             width: 3px;
             background: var(--success-gradient);
         }

         .module-info {
             flex: 1;
             display: flex;
             flex-direction: column;
             min-width: 0;
             margin-right: 12px;
         }

         .module-code {
             font-weight: 600;
             color: var(--vscode-foreground);
             font-size: 14px;
             margin-bottom: 2px;
             word-break: break-all;
         }

         .module-name {
             color: var(--vscode-descriptionForeground);
             font-size: 12px;
             line-height: 1.3;
             word-break: break-all;
         }

         .module-badge {
             padding: 2px 8px;
             border-radius: 12px;
             font-size: 10px;
             font-weight: 600;
             text-transform: uppercase;
             letter-spacing: 0.5px;
             white-space: nowrap;
             flex-shrink: 0;
             margin-right: 8px;
         }

         .module-badge.required {
             background: var(--success-gradient);
             color: white;
         }

         .module-badge.optional {
             background: var(--vscode-button-secondaryBackground);
             color: var(--vscode-button-secondaryForeground);
         }

         .module-checkbox {
             transform: scale(1.2);
             flex-shrink: 0;
             width: 16px;
             height: 16px;
         }

         .module-checkbox:disabled {
             opacity: 0.6;
         }

         .module-actions {
             display: flex;
             gap: 8px;
             align-items: center;
         }

         .module-actions button {
             font-size: 12px;
             padding: 4px 8px;
             min-height: 24px;
         }

         .empty-description {
             font-size: 12px;
             color: var(--vscode-descriptionForeground);
             margin-top: 4px;
         }
    </style>
</head>
<body>
    <div id="app">
        <!-- 固定页签区域 -->
        <div class="tabs-container">
            <div class="tabs">
                <button class="tab active" onclick="switchTab('home')">
                    <span class="tab-icon">🏠</span>
                    <span class="tab-text">Home配置</span>
                </button>
                <button class="tab" onclick="switchTab('datasources')">
                    <span class="tab-icon">🗄️</span>
                    <span class="tab-text">数据源</span>
                </button>
                <button class="tab" onclick="switchTab('advanced')">
                    <span class="tab-icon">⚙️</span>
                    <span class="tab-text">高级设置</span>
                </button>
            </div>
        </div>

        <!-- 可滚动内容区域 -->
        <div class="content-container">
            <!-- Home配置选项卡 -->
            <div id="home-tab" class="tab-content active">
            <div class="section">
                <div class="section-title">
                    <span>YonBIP Premium Home 路径设置</span>
                </div>
                
                <div class="form-group">
                    <div class="form-row">
                        <div class="input-container">
                            <div class="input-group" onclick="selectHomeDirectory()" style="cursor: pointer; position: relative;" id="homePathGroup">
                                <input type="text" id="homePath" aria-label="Home目录" readonly>
                                <span class="input-icon" style="cursor: pointer;">📁</span>
                                <div class="tooltip" id="homePathTooltip">未选择Home目录</div>
                            </div>
                        </div>
                    </div>
                    <div class="help-text">选择YonBIP Premium的安装目录，通常包含bin、lib、modules等文件夹</div>
                </div>
                
                <div class="form-group">
                    <div class="button-group">
                        <button onclick="openHomeDirectory()">
                            <span style="margin-right: 6px;">📂</span> 打开Home目录
                        </button>
                        <button class="secondary" onclick="openSysConfig()">
                            <span style="margin-right: 6px;">🔍</span> 启动SysConfig
                        </button>
                        <button class="secondary" onclick="viewLogs()">
                            <span style="margin-right: 6px;">📋</span> 查看日志
                        </button>
                        <button class="secondary" onclick="openLogsDirectory()">
                            <span style="margin-right: 6px;">📁</span> 打开日志文件夹
                        </button>
                        <button class="secondary" onclick="convertToMacHome()" id="convertToMacHomeBtn" style="display: none;">
                            <span style="margin-right: 6px;">🔄</span> 转换为Mac/Linux HOME
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 数据源选项卡 -->
        <div id="datasources-tab" class="tab-content">
            <div class="section">
                <div class="section-header">
                    <div class="section-title-text">
                        <span>数据源管理</span>
                    </div>
                    <button onclick="showAddDataSourceForm()" class="add-datasource-btn">
                        <span style="margin-right: 6px;">➕</span> 添加数据源
                    </button>
                </div>
                
                <div id="datasourceList">
                    <div class="empty-state">
                        <div class="empty-icon">🗂️</div>
                        <div class="empty-text">暂无数据源配置</div>
                        <div class="empty-subtext">点击"添加数据源"开始配置您的第一个数据源</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 高级设置选项卡 -->
        <div id="advanced-tab" class="tab-content">
            <div class="section">
                <div class="section-title">系统运行配置</div>
                
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="debugMode">
                        <label for="debugMode">调试模式</label>
                    </div>
                    <div class="help-text">启用调试模式以支持远程调试</div>
                </div>
                
                <div class="form-group">
                    <label for="debugPort">调试端口:</label>
                    <div class="form-row">
                        <div class="input-container">
                            <div class="input-group">
                                <input type="number" id="debugPort" placeholder="8888" min="1024" max="65535">
                                <span class="input-icon">🔌</span>
                            </div>
                        </div>
                    </div>
                    <div class="help-text">设置调试模式使用的端口号 (1024-65535)</div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">JVM参数配置</div>
                
                <div class="form-group">
                    <label for="vmParameters">JVM参数:</label>
                    <textarea id="vmParameters" rows="10" placeholder="仅配置调优参数即可,已经有默认的参数,每行输入一个JVM参数，例如：&#10;-Xms512m&#10;-Xmx2048m&#10;-XX:MaxPermSize=512m"></textarea>
                    <div class="help-text">自定义JVM启动参数，每行一个参数</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">模块配置</div>
                
                <div class="form-group">
                    <label for="hotwebs">Hotwebs配置:</label>
                    <div class="input-group">
                        <input type="text" id="hotwebs" placeholder="请输入hotwebs配置，多个用逗号分隔">
                        <span class="input-icon">🔧</span>
                    </div>
                    <div class="help-text">配置hotwebs模块，多个模块用逗号分隔</div>
                </div>

                <div class="form-group">
                    <div class="section-header">
                        <div class="section-title-text">启动模块选择</div>
                        <div class="module-actions">
                            <button class="secondary" onclick="selectAllModules()">
                                <span style="margin-right: 4px;">✅</span> 全选
                            </button>
                            <button class="secondary" onclick="deselectAllModules()">
                                <span style="margin-right: 4px;">❌</span> 全不选
                            </button>
                            <button class="secondary" onclick="resetModuleSelection()">
                                <span style="margin-right: 4px;">🔄</span> 重置
                            </button>
                        </div>
                    </div>
                    <div class="help-text">选择启动时要加载的模块，必选模块无法取消</div>
                    
                    <div class="form-group" style="margin-bottom: 12px;">
                        <div class="input-group">
                            <input type="text" id="moduleSearch" placeholder="搜索模块..." oninput="filterModules()">
                            <span class="input-icon">🔍</span>
                        </div>
                    </div>
                    
                    <div id="moduleList" class="module-list">
                        <div class="empty-state">
                            <div class="empty-icon">📦</div>
                            <div class="empty-text">请先配置YonBIP Premium Home路径</div>
                            <div class="empty-description">配置Home路径后将自动加载可用模块</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">HOME版本配置</div>
                
                <div class="form-group">
                    <label for="homeVersion">HOME版本:</label>
                    <select id="homeVersion">
                        <option value="">请选择HOME版本</option>
                    </select>
                    <div class="help-text">选择YonBIP Premium HOME的版本，用于适配不同版本的配置</div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">操作</div>
                <div class="button-group">
                    <button onclick="saveAdvancedConfig()">
                        <span style="margin-right: 6px;">💾</span> 保存设置
                    </button>
                    <button class="secondary" onclick="resetToDefaults()">
                        <span style="margin-right: 6px;">🔄</span> 重置为默认
                    </button>
                </div>
            </div>
            </div>
        </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentConfig = {};
        
        // 初始化HOME版本下拉框
        function initializeHomeVersionSelect(homeVersions) {
            const select = document.getElementById('homeVersion');
            if (select) {
                // 清空现有选项，但保留默认选项
                select.innerHTML = '<option value="">请选择HOME版本</option>';
                
                // 添加版本选项
                if (homeVersions && Array.isArray(homeVersions)) {
                    homeVersions.forEach(version => {
                        const option = document.createElement('option');
                        option.value = version;
                        option.textContent = version;
                        select.appendChild(option);
                    });
                }
            }
        }

        // 切换选项卡
        function switchTab(tabName) {
            const tabs = document.querySelectorAll('.tab-content');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            document.getElementById(tabName + '-tab').classList.add('active');
            
            // 通过事件对象找到触发的按钮
            const event = window.event;
            if (event && event.target) {
                event.target.classList.add('active');
            }
        }
        
        // 选择Home目录
        function selectHomeDirectory() {
            vscode.postMessage({ type: 'selectHomeDirectory' });
        }
        
        // 打开Home目录
        function openHomeDirectory() {
            vscode.postMessage({ type: 'openHomeDirectory' });
        }
        
        // 打开SysConfig
        function openSysConfig() {
            vscode.postMessage({ type: 'openSysConfig' });
        }
        
        // 查看日志
        function viewLogs() {
            vscode.postMessage({ type: 'viewLogs' });
        }
        
        // 打开日志文件夹
        function openLogsDirectory() {
            vscode.postMessage({ type: 'openLogsDirectory' });
        }
        
        // 转换为Mac/Linux HOME
        function convertToMacHome() {
            vscode.postMessage({ type: 'convertToMacHome' });
        }
        
        // 启动HOME服务
        // function startHomeService() {
        //     vscode.postMessage({ type: 'startHomeService' });
        // }
        // }
        
        // 调试启动HOME服务
        function debugHomeService() {
            vscode.postMessage({ type: 'debugHomeService' });
        }

        // 停止HOME服务
        function stopHomeService() {
            vscode.postMessage({ type: 'stopHomeService' });
        }



        
        // 显示添加数据源表单
        function showAddDataSourceForm() {
            showDataSourceForm('add', null);
        }
        
        // 显示编辑数据源表单
        function showEditDataSourceForm(dataSource) {
            showDataSourceForm('edit', dataSource);
        }
        
        // 显示数据源表单（添加或编辑）
        function showDataSourceForm(mode, dataSource) {
            // 创建模态框
            const modal = document.createElement('div');
            modal.id = 'dataSourceModal';
            modal.style.cssText = \`
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0,0,0,0.5);
                z-index: 1000;
                display: flex;
                justify-content: center;
                align-items: center;
            \`;
            
            const isEditMode = mode === 'edit';
            const title = isEditMode ? '编辑数据源' : '添加数据源';
            const nameField = isEditMode ? 
                '<input type="text" id="dsName" value="' + dataSource.name + '" required readonly>' :
                '<input type="text" id="dsName" value="dataSource1" required>';
            
            modal.innerHTML = \`
                <div style="
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 6px;
                    padding: 20px;
                    width: 500px;
                    max-width: 90%;
                ">
                    <h3 style="margin-top: 0; color: var(--vscode-foreground);">\${title}</h3>
                    <div class="form-group">
                        <label for="dsName">数据源名称<span style="color: red;"> *</span>:</label>
                        \${nameField}
                    </div>
                    <div class="form-group">
                        <label for="dsAlias">别名 (用于区分数据源，仅在界面显示):</label>
                        <input type="text" id="dsAlias" placeholder="可选，支持中文">
                    </div>
                    <div class="form-group">
                        <label for="dsType">数据库类型<span style="color: red;"> *</span>:</label>
                        <select id="dsType">
                            <option value="oracle">Oracle</option>
                            <option value="mysql">MySQL</option>
                            <option value="sqlserver">SQL Server</option>
                            <option value="postgresql">PostgreSQL</option>
                            <option value="db2">DB2</option>
                            <option value="dm">达梦数据库</option>
                            <option value="kingbase">人大金仓</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="dsHost">主机地址<span style="color: red;"> *</span>:</label>
                        <input type="text" id="dsHost" value="localhost">
                    </div>
                    <div class="form-group">
                        <label for="dsPort">端口号<span style="color: red;"> *</span>:</label>
                        <input type="number" id="dsPort" value="1521">
                    </div>
                    <div class="form-group">
                        <label for="dsDatabase">数据库名<span style="color: red;"> *</span>:</label>
                        <input type="text" id="dsDatabase">
                    </div>
                    <div class="form-group">
                        <label for="dsUsername">用户名<span style="color: red;"> *</span>:</label>
                        <input type="text" id="dsUsername">
                    </div>
                    <div class="form-group">
                        <label for="dsPassword">密码<span style="color: red;"> *</span>:</label>
                        <div style="position: relative;">
                            <input type="password" id="dsPassword" style="padding-right: 30px;">
                            <button type="button" id="togglePassword" style="position: absolute; right: 5px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--vscode-foreground);" title="显示/隐藏密码">👁️</button>
                        </div>
                    </div>
                    <div style="text-align: right; margin-top: 20px;">
                        <button class="secondary" onclick="closeModal()">取消</button>
                        <button onclick="saveDataSource('\${mode}')">\${isEditMode ? '更新' : '保存'}</button>
                    </div>
                </div>
            \`;
            
            document.body.appendChild(modal);
            
            // 添加密码显示/隐藏切换功能
            const togglePasswordButton = document.getElementById('togglePassword');
            const passwordInput = document.getElementById('dsPassword');
            
            if (togglePasswordButton && passwordInput) {
                togglePasswordButton.addEventListener('click', function() {
                    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                    passwordInput.setAttribute('type', type);
                    this.textContent = type === 'password' ? '👁️' : '🔒';
                });
            }
            
            // 数据库类型与默认端口、数据库名映射
            const dbConfigMap = {
                'oracle': { port: 1521, database: 'orcl' },
                'mysql': { port: 3306, database: 'mysql' },
                'sqlserver': { port: 1433, database: 'master' },
                'postgresql': { port: 5432, database: 'postgres' },
                'db2': { port: 50000, database: 'sample' },
                'dm': { port: 5236, database: 'DAMENG' },
                'kingbase': { port: 54321, database: 'test' }
            };
            
            // 数据库类型对应的默认前缀
            const dbPrefixMap = {
                'oracle': 'oracle',
                'mysql': 'mysql',
                'sqlserver': 'sqlserver',
                'postgresql': 'postgresql',
                'db2': 'db2',
                'dm': 'dm',
                'kingbase': 'kingbase'
            };
            
            // 添加数据库类型切换事件监听器
            const dsTypeSelect = document.getElementById('dsType');
            const dsPortInput = document.getElementById('dsPort');
            const dsDatabaseInput = document.getElementById('dsDatabase');
            const dsNameInput = document.getElementById('dsName'); // 添加数据源名称输入框引用
            
            // 生成唯一数据源名称的函数
            function generateUniqueDataSourceName(prefix, existingNames) {
                // 如果没有现有的数据源名称，则直接返回前缀
                if (!existingNames || existingNames.length === 0) {
                    return prefix + '1';
                }
                
                // 查找具有相同前缀的名称
                const regex = new RegExp('^' + prefix + '(\\\\d+)$');
                let maxNumber = 0;
                
                for (const name of existingNames) {
                    const match = name.match(regex);
                    if (match) {
                        const num = parseInt(match[1]);
                        if (num > maxNumber) {
                            maxNumber = num;
                        }
                    }
                }
                
                // 返回下一个唯一的名称
                return prefix + (maxNumber + 1);
            }
            
            // 先设置默认值，再处理编辑模式的数据填充
            if (!isEditMode) {
                // 新增模式下，默认选中Oracle并设置默认端口、数据库名和数据源名称
                if (dsTypeSelect) dsTypeSelect.value = 'oracle';
                if (dsPortInput) dsPortInput.value = 1521;
                if (dsDatabaseInput) dsDatabaseInput.value = 'orcl';
                // 修复：在初始化时生成唯一的数据源名称，而不是直接使用固定的名称
                if (dsNameInput) {
                    // 获取当前已存在的数据源名称（从全局配置中）
                    const existingNames = currentConfig.dataSources ? currentConfig.dataSources.map(ds => ds.name) : [];
                    // 生成唯一的Oracle数据源名称
                    const uniqueName = generateUniqueDataSourceName('oracle', existingNames);
                    dsNameInput.value = uniqueName;
                }
                
                // 添加数据库类型切换事件监听器
                if (dsTypeSelect) {
                    dsTypeSelect.addEventListener('change', function() {
                        const selectedType = this.value;
                        if (dbConfigMap[selectedType]) {
                            if (dsPortInput) dsPortInput.value = dbConfigMap[selectedType].port;
                            if (dsDatabaseInput) dsDatabaseInput.value = dbConfigMap[selectedType].database;
                            // 动态生成唯一数据源名称
                            if (dsNameInput) {
                                const prefix = dbPrefixMap[selectedType] || selectedType;
                                // 获取当前已存在的数据源名称（从全局配置中）
                                // 确保排除.nc-home-config.json中已有的数据源名称
                                const existingNames = currentConfig.dataSources ? currentConfig.dataSources.map(ds => ds.name) : [];
                                dsNameInput.value = generateUniqueDataSourceName(prefix, existingNames);
                            }
                        }
                    });
                }
            }
            
            // 如果是编辑模式，填充现有数据
            if (isEditMode) {
                // 数据库类型需要映射到下拉框的值
                const databaseTypeMap = {
                    'ORACLE': 'oracle',
                    'ORACLE11G': 'oracle',
                    'ORACLE12C': 'oracle',
                    'ORACLE19C': 'oracle',
                    'MYSQL': 'mysql',
                    'SQLSERVER': 'sqlserver',
                    'SQLSERVER2016': 'sqlserver',
                    'SQLSERVER2017': 'sqlserver',
                    'SQLSERVER2019': 'sqlserver',
                    'POSTGRESQL': 'postgresql',
                    'DB2': 'db2',
                    'DM': 'dm',
                    'KINGBASE': 'kingbase'
                };
                const selectValue = databaseTypeMap[dataSource.databaseType.toUpperCase()] || dataSource.databaseType.toLowerCase();
                if (dsTypeSelect) dsTypeSelect.value = selectValue;
                if (document.getElementById('dsHost')) document.getElementById('dsHost').value = dataSource.host;
                if (dsPortInput) dsPortInput.value = dataSource.port;
                if (dsDatabaseInput) dsDatabaseInput.value = dataSource.databaseName;
                if (document.getElementById('dsUsername')) document.getElementById('dsUsername').value = dataSource.username;
                // 填充密码字段（如果存在）
                if (dataSource.password && dataSource.password !== '[加密密码-需要重新输入]') {
                    if (document.getElementById('dsPassword')) document.getElementById('dsPassword').value = dataSource.password;
                }
                // 填充别名字段（如果存在）
                if (dataSource.alias) {
                    if (document.getElementById('dsAlias')) document.getElementById('dsAlias').value = dataSource.alias;
                }
                
                // 添加数据库类型切换事件监听器（编辑模式）
                if (dsTypeSelect) {
                    dsTypeSelect.addEventListener('change', function() {
                        const selectedType = this.value;
                        if (dbConfigMap[selectedType]) {
                            if (dsPortInput) dsPortInput.value = dbConfigMap[selectedType].port;
                            if (dsDatabaseInput) dsDatabaseInput.value = dbConfigMap[selectedType].database;
                            // 动态生成唯一数据源名称
                            if (dsNameInput) {
                                const prefix = dbPrefixMap[selectedType] || selectedType;
                                // 获取当前已存在的数据源名称（从全局配置中）
                                // 确保排除.nc-home-config.json中已有的数据源名称
                                const existingNames = currentConfig.dataSources ? currentConfig.dataSources.map(ds => ds.name) : [];
                                dsNameInput.value = generateUniqueDataSourceName(prefix, existingNames);
                            }
                        }
                    });
                }
            }
            
            // 确保端口号根据当前选择的数据库类型正确设置，但保留用户输入的数据库名
            if (dsTypeSelect && dsPortInput && dsDatabaseInput) {
                const currentType = dsTypeSelect.value;
                if (dbConfigMap[currentType]) {
                    // 只有在端口为空或为默认值时才设置默认端口，避免覆盖用户已输入的内容
                    if (!dsPortInput.value) {
                        dsPortInput.value = dbConfigMap[currentType].port;
                    }
                    // 只有在数据库名为空时才设置默认值
                    if (!dsDatabaseInput.value) {
                        dsDatabaseInput.value = dbConfigMap[currentType].database;
                    }
                }
            }
        }
        
        // 关闭模态框
        function closeModal() {
            const modal = document.getElementById('dataSourceModal');
            if (modal) {
                modal.remove();
            }
        }
        
        // 保存数据源
        function saveDataSource(mode) {
            // 防止重复提交
            const saveButton = event.target;
            if (saveButton.disabled) return;
            
            const portValue = document.getElementById('dsPort').value;
            const dataSource = {
                name: document.getElementById('dsName').value,
                databaseType: document.getElementById('dsType').value,
                host: document.getElementById('dsHost').value,
                port: portValue ? parseInt(portValue) : 3306,
                databaseName: document.getElementById('dsDatabase').value,
                username: document.getElementById('dsUsername').value,
                password: document.getElementById('dsPassword').value,
                driverClassName: '' // 这将在后端处理
            };
            
            // 添加别名字段（如果填写了）
            const aliasValue = document.getElementById('dsAlias').value;
            if (aliasValue && aliasValue.trim() !== '') {
                dataSource.alias = aliasValue.trim();
            }
            
            // 完整验证 - 检查所有字段是否已填写
            if (!dataSource.name || dataSource.name.trim() === '') {
                showMessage('请填写数据源名称', 'error');
                return;
            }
            
            // 数据源名称格式校验 - 不能包含中文字符
            if (/[\u4e00-\u9fa5]/.test(dataSource.name)) {
                showMessage('数据源名称不能包含中文字符', 'error');
                return;
            }
            
            // 数据源名称格式校验 - 只能包含英文、数字、下划线和短横线
            const nameRegex = /^[a-zA-Z0-9_-]+$/;

            if (!nameRegex.test(dataSource.name)) {
                showMessage('数据源名称只能包含英文、数字、下划线(_)和短横线(-)', 'error');
                return;
            }
            
            if (!dataSource.databaseType || dataSource.databaseType.trim() === '') {
                showMessage('请选择数据库类型', 'error');
                return;
            }
            
            if (!dataSource.host || dataSource.host.trim() === '') {
                showMessage('请填写主机地址', 'error');
                return;
            }
            
            if (!portValue || portValue.trim() === '' || isNaN(parseInt(portValue)) || parseInt(portValue) <= 0 || parseInt(portValue) > 65535) {
                showMessage('请填写有效的端口号(1-65535)', 'error');
                return;
            }
            
            if (!dataSource.databaseName || dataSource.databaseName.trim() === '') {
                showMessage('请填写数据库名', 'error');
                return;
            }
            
            if (!dataSource.username || dataSource.username.trim() === '') {
                showMessage('请填写用户名', 'error');
                return;
            }
            
            // 密码字段必填校验（新增数据源时必须填写，编辑数据源时如果填写了则更新）
            if (!dataSource.password || dataSource.password.trim() === '') {
                if (mode !== 'edit') {
                    // 新增模式下密码必填
                    showMessage('请填写密码', 'error');
                    return;
                }
                // 编辑模式下如果密码为空，表示不修改密码
            }
            
            const messageType = mode === 'edit' ? 'updateDataSource' : 'addDataSource';
            
            // 禁用保存按钮防止重复提交
            saveButton.disabled = true;
            saveButton.textContent = mode === 'edit' ? '更新中...' : '保存中...';
            
            vscode.postMessage({
                type: messageType,
                dataSource: dataSource
            });
            
            closeModal();
        }
        
        // 显示消息
        function showMessage(message, type = 'info') {
            // 移除现有的消息元素
            const existingMessage = document.getElementById('messageToast');
            if (existingMessage) {
                existingMessage.remove();
            }
            
            const messageEl = document.createElement('div');
            messageEl.id = 'messageToast';
            messageEl.textContent = message;
            messageEl.className = 'status-message';
            
            if (type === 'error') {
                messageEl.classList.add('status-error');
            } else if (type === 'success') {
                messageEl.classList.add('status-success');
            } else {
                messageEl.style.backgroundColor = 'var(--vscode-notificationsInfoIcon-foreground)';
                messageEl.style.color = 'white';
            }
            
            // 添加样式
            messageEl.style.position = 'fixed';
            messageEl.style.bottom = '20px';
            messageEl.style.right = '20px';
            messageEl.style.zIndex = '1001';
            messageEl.style.maxWidth = '400px';
            messageEl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
            
            document.body.appendChild(messageEl);
            
            // 3秒后自动移除
            setTimeout(() => {
                if (messageEl.parentNode) {
                    messageEl.parentNode.removeChild(messageEl);
                }
            }, 3000);
            
            console.log(\`[\${type.toUpperCase()}] \${message}\`);
        }
        
        // 更新配置显示
        function updateConfigDisplay(config) {
            currentConfig = config;
            
            // 更新Home路径
            const homePathInput = document.getElementById('homePath');
            if (homePathInput) {
                // 始终显示homePath，如果没有则显示空字符串
                homePathInput.value = config.homePath || '';
                // 移除placeholder，因为我们总是显示实际值
                homePathInput.placeholder = '';
            }
            // 同步tooltip和容器title为当前homePath
            const homePathTooltip = document.getElementById('homePathTooltip');
            if (homePathTooltip) {
                homePathTooltip.textContent = config.homePath || '未选择Home目录';
            }
            
            // 更新高级设置
            // 移除了standardMode相关的代码
            // 移除了autoClient相关的代码
            document.getElementById('debugMode').checked = config.debugMode !== false;
            document.getElementById('debugPort').value = config.debugPort || 8888;
            if (config.vmParameters !== undefined) {
                document.getElementById('vmParameters').value = config.vmParameters;
                console.log('Displaying JVM parameters:', config.vmParameters);
            }
            if (config.hotwebs !== undefined) {
                document.getElementById('hotwebs').value = config.hotwebs;
            }

            
            // 更新HOME版本选择框
            if (config.homeVersion) {
                const homeVersionSelect = document.getElementById('homeVersion');
                if (homeVersionSelect) {
                    // 检查选项是否已存在，如果不存在则添加
                    let optionExists = false;
                    for (let i = 0; i < homeVersionSelect.options.length; i++) {
                        if (homeVersionSelect.options[i].value === config.homeVersion) {
                            optionExists = true;
                            break;
                        }
                    }
                    
                    // 如果选项不存在，添加它
                    if (!optionExists) {
                        const option = document.createElement('option');
                        option.value = config.homeVersion;
                        option.textContent = config.homeVersion;
                        homeVersionSelect.appendChild(option);
                    }
                    
                    // 设置选中值
                    homeVersionSelect.value = config.homeVersion;
                }
            }
            
            // 更新数据源列表
            updateDataSourceList(config.dataSources || []);
        }
        
        // 更新数据源列表显示
        function updateDataSourceList(dataSources) {
            const dataSourceListElement = document.getElementById('datasourceList');
            
            if (!dataSources || dataSources.length === 0) {
                dataSourceListElement.innerHTML = '<div class="status-message" style="text-align: center; color: var(--vscode-descriptionForeground);">暂无数据源配置</div>';
                return;
            }
            
            // 将design数据源放在第一位
            const sortedDataSources = [...dataSources].sort((a, b) => {
                const isADesign = currentConfig.selectedDataSource === a.name;
                const isBDesign = currentConfig.selectedDataSource === b.name;
                if (isADesign && !isBDesign) return -1;
                if (!isADesign && isBDesign) return 1;
                return 0;
            });
            
            // 如果没有任何数据源被标记为design，将design数据源放在第一位
            if (!currentConfig.selectedDataSource) {
                sortedDataSources.sort((a, b) => {
                    const isADesign = a.name === 'design';
                    const isBDesign = b.name === 'design';
                    if (isADesign && !isBDesign) return -1;
                    if (!isADesign && isBDesign) return 1;
                    return 0;
                });
            }
            
            let html = '<div style="margin-top: 10px;">';
            sortedDataSources.forEach((ds, index) => {
                // 检查是否为当前选中的design数据源
                const isDesignDatabase = currentConfig.selectedDataSource === ds.name;
                const isBaseDatabase = currentConfig.baseDatabase === ds.name;
                
                // 转义特殊字符以避免HTML注入
                const dsJson = JSON.stringify(ds)
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '\\\'');
                
                html += \`
                    <div style="
                        padding: 10px; 
                        border: 1px solid var(--vscode-widget-border); 
                        border-radius: 4px; 
                        margin-bottom: 10px;
                        background-color: var(--vscode-input-background);
                    ">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="font-weight: bold; color: var(--vscode-textLink-foreground);">
                                \${ds.name}
                                \${ds.alias ? '<span style="background-color: var(--vscode-terminal-ansiBlue); color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin-left: 8px;">' + ds.alias + '</span>' : ''}
                            </div>
                            <div>
                                \${isDesignDatabase ? '<span style="background: linear-gradient(135deg, var(--vscode-terminal-ansiGreen) 0%, #27ae60 100%); color: white; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.5px;">DESIGN</span>' : ''}
                                \${isBaseDatabase ? '<span style="background-color: var(--vscode-terminal-ansiBlue); color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px;">BASE</span>' : ''}
                            </div>
                        </div>
                        <div style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 5px;">
                            <div>类型: \${ds.databaseType}</div>
                            <div>主机: \${ds.host}:\${ds.port}</div>
                            <div>数据库: \${ds.databaseName}</div>
                        </div>
                        <div style="margin-top: 8px; display: flex; gap: 5px; flex-wrap: wrap;">
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="edit" data-ds-name="\${ds.name}">编辑</button>
                            \${!isDesignDatabase ? \`<button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="setDesign" data-ds-name="\${ds.name}">设为Design</button>\` : ''}
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="setBase" data-ds-name="\${ds.name}">设为基准库</button>
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="test" data-ds-name="\${ds.name}">测试连接</button>
                            <button class="secondary" style="font-size: 12px; padding: 4px 8px;" data-action="delete" data-ds-name="\${ds.name}">删除</button>
                        </div>
                    </div>
\`;
            });
            html += '</div>';
            
            dataSourceListElement.innerHTML = html;
            
            // 添加事件监听器
            addDataSourceEventListeners();
        }
        
        // 添加数据源事件监听器
        function addDataSourceEventListeners() {
            // 编辑按钮
            document.querySelectorAll('[data-action="edit"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    const dataSource = currentConfig.dataSources.find(ds => ds.name === dataSourceName);
                    if (dataSource) {
                        showEditDataSourceForm(dataSource);
                    }
                });
            });
            
            // 设为Design按钮
            document.querySelectorAll('[data-action="setDesign"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    setAsDesignDatabase(dataSourceName);
                });
            });
            
            // 设为基准库按钮
            document.querySelectorAll('[data-action="setBase"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    setAsBaseDatabase(dataSourceName);
                });
            });
            
            // 测试连接按钮
            document.querySelectorAll('[data-action="test"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    testDataSourceConnection(dataSourceName);
                });
            });
            
            // 删除按钮
            document.querySelectorAll('[data-action="delete"]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const dataSourceName = e.target.getAttribute('data-ds-name');
                    deleteDataSource(dataSourceName);
                });
            });
        }
        
        // 设置为Design数据源
        let isSettingDesign = false; // 防止快速多次点击
        function setAsDesignDatabase(dataSourceName) {
            if (isSettingDesign) {
                console.log('正在设置Design数据源，请稍候...');
                return;
            }
            
            isSettingDesign = true;
            
            // 禁用所有设为Design按钮
            document.querySelectorAll('[data-action="setDesign"]').forEach(button => {
                button.disabled = true;
                button.textContent = '设置中...';
            });
            
            vscode.postMessage({
                type: 'setDesignDatabase',
                dataSourceName: dataSourceName
            });
        }
        
        // 设置为基准库
        function setAsBaseDatabase(dataSourceName) {
            vscode.postMessage({
                type: 'setBaseDatabase',
                dataSourceName: dataSourceName
            });
        }
        
        // 测试数据源连接
        function testDataSourceConnection(dataSourceName) {
            // 从当前配置中获取数据源信息
            const dataSource = currentConfig.dataSources.find(ds => ds.name === dataSourceName);
            if (dataSource) {
                vscode.postMessage({
                    type: 'testConnection',
                    dataSource: dataSource
                });
            } else {
                showMessage('未找到数据源: ' + dataSourceName, 'error');
            }
        }
        
        // 删除数据源
        function deleteDataSource(dataSourceName) {
            // 通过向扩展发送消息来处理确认对话框
            vscode.postMessage({
                type: 'requestDeleteConfirmation',
                dataSourceName: dataSourceName
            });
        }
        
        // 保存高级配置
        function saveAdvancedConfig() {
            const config = {
                ...currentConfig,
                // 移除了standardMode相关的代码
                // 移除了autoClient相关的代码
                debugMode: document.getElementById('debugMode').checked,
                debugPort: parseInt(document.getElementById('debugPort').value) || 8888,
                vmParameters: document.getElementById('vmParameters').value,
                hotwebs: document.getElementById('hotwebs').value,
                homeVersion: document.getElementById('homeVersion').value

            };
            
            // 确保 debugPort 字段存在且为数字类型
            if (typeof config.debugPort !== 'number' || isNaN(config.debugPort)) {
                config.debugPort = 8888;
            }
            
            // 记录JVM参数以便调试
            console.log('Saving JVM parameters:', config.vmParameters);
            
            vscode.postMessage({
                type: 'saveConfig',
                config: config
            });
        }
        
        // 重置为默认配置
        function resetToDefaults() {
            // 请求扩展处理确认对话框
            vscode.postMessage({
                type: 'confirmResetDefaults'
            });
        }

        // 模块管理相关函数
        let currentModules = [];
        let filteredModules = [];

        // 全选模块
        function selectAllModules() {
            const modulesToProcess = filteredModules.length > 0 ? filteredModules : currentModules;
            modulesToProcess.forEach(module => {
                if (!module.must) { // 只处理非必选模块
                    module.enabled = true;
                }
            });
            renderModuleList();
            saveModuleConfig();
        }

        // 全不选模块
        function deselectAllModules() {
            const modulesToProcess = filteredModules.length > 0 ? filteredModules : currentModules;
            modulesToProcess.forEach(module => {
                if (!module.must) { // 必选模块不能取消
                    module.enabled = false;
                }
            });
            renderModuleList();
            saveModuleConfig();
        }

        // 重置模块选择
        function resetModuleSelection() {
            currentModules.forEach(module => {
                module.enabled = true; // 默认全部勾选
            });
            renderModuleList();
            saveModuleConfig();
        }

        // 搜索模块
        function filterModules() {
            const searchTerm = document.getElementById('moduleSearch').value.toLowerCase();
            if (searchTerm.trim() === '') {
                filteredModules = [];
                renderModuleList();
                return;
            }
            
            filteredModules = currentModules.filter(module => 
                module.code.toLowerCase().includes(searchTerm) || 
                (module.name && module.name.toLowerCase().includes(searchTerm))
            );
            
            renderModuleList();
        }

        // 渲染模块列表
         function renderModuleList() {
             const moduleList = document.getElementById('moduleList');
             if (!moduleList) return;

             // 使用过滤后的模块列表，如果没有过滤则使用全部模块
             const modulesToDisplay = filteredModules.length > 0 ? filteredModules : currentModules;

             if (!modulesToDisplay || modulesToDisplay.length === 0) {
                 const isEmptyDueToFilter = filteredModules.length === 0 && currentModules.length > 0;
                 moduleList.innerHTML = \`
                     <div class="empty-state">
                         <div class="empty-icon">\${isEmptyDueToFilter ? '🔍' : '📦'}</div>
                         <div class="empty-text">\${isEmptyDueToFilter ? '未找到匹配的模块' : '请先配置YonBIP Premium Home路径'}</div>
                         <div class="empty-description">\${isEmptyDueToFilter ? '请尝试其他搜索关键词' : '配置Home路径后将自动加载可用模块'}</div>
                     </div>
                 \`;
                 return;
             }

             const moduleItems = modulesToDisplay.map(module => \`
                 <div class="module-item \${module.must ? 'required' : ''}">
                     <div class="module-info">
                         <div class="module-code">\${module.code}</div>
                         <div class="module-name">\${module.name || '未知模块'}</div>
                     </div>
                     <div class="module-badge \${module.must ? 'required' : 'optional'}">
                         \${module.must ? '必选' : '可选'}
                     </div>
                     <input type="checkbox" 
                            class="module-checkbox" 
                            id="module-\${module.code}"
                            \${module.enabled ? 'checked' : ''}
                            \${module.must ? 'disabled' : ''}
                            onchange="toggleModule('\${module.code}')">
                 </div>
             \`).join('');

             moduleList.innerHTML = moduleItems;
         }

        // 切换模块状态
        function toggleModule(moduleCode) {
            const module = currentModules.find(m => m.code === moduleCode);
            if (module && !module.must) {
                module.enabled = !module.enabled;
                saveModuleConfig();
            }
        }

        // 保存模块配置
        function saveModuleConfig() {
            vscode.postMessage({
                type: 'saveModuleConfig',
                modules: currentModules
            });
        }

        // 加载模块配置
        function loadModuleConfig(modules) {
            currentModules = modules || [];
            filteredModules = [];
            // 清空搜索框
            document.getElementById('moduleSearch').value = '';
            renderModuleList();
        }
        
        // 监听消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configLoaded':
                    // 初始化HOME版本下拉框（如果尚未初始化）
                    if (message.homeVersions) {
                        initializeHomeVersionSelect(message.homeVersions);
                    }
                    updateConfigDisplay(message.config);
                    // 加载模块配置
                    if (message.modules) {
                        loadModuleConfig(message.modules);
                    }
                    // 检查是否为Mac系统，如果是则显示转换按钮
                    if (message.config.homePath && navigator.userAgent.includes('Mac')) {
                        document.getElementById('convertToMacHomeBtn').style.display = 'inline-block';
                    }
                    break;
                    
                case 'homeDirectorySelected':
                    if (message.success && message.homePath) {
                        document.getElementById('homePath').value = message.homePath;
                        // 仅更新自定义tooltip
                        const homePathTooltip = document.getElementById('homePathTooltip');
                        if (homePathTooltip) {
                            homePathTooltip.textContent = message.homePath;
                        }
                        showMessage('Home目录选择成功', 'success');
                    } else {
                        // 重置为默认提示（只更新自定义tooltip）
                        const homePathTooltip = document.getElementById('homePathTooltip');
                        if (homePathTooltip) {
                            homePathTooltip.textContent = '未选择Home目录';
                        }
                        showMessage('Home目录选择失败', 'error');
                    }
                    break;
                    
                case 'configSaved':
                    if (message.success) {
                        showMessage('配置保存成功', 'success');
                    } else {
                        showMessage('配置保存失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'homeDirectoryOpened':
                    if (message.success) {
                        showMessage('Home目录已打开', 'success');
                    } else {
                        showMessage('打开Home目录失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'sysConfigOpened':
                    if (message.success) {
                        showMessage('SysConfig已启动', 'success');
                    } else {
                        showMessage('启动SysConfig失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'logsLoaded':
                    if (message.error) {
                        showMessage('获取日志失败: ' + message.error, 'error');
                    } else {
                        showLogs(message.logs);
                    }
                    break;
                    
                case 'logsDirectoryOpened':
                    if (message.success) {
                        showMessage('日志文件夹已打开', 'success');
                    } else {
                        showMessage('打开日志文件夹失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'homeServiceStarted':
                    if (message.success) {
                        showMessage('HOME服务启动成功', 'success');
                    } else {
                        showMessage('启动HOME服务失败: ' + message.error, 'error');
                    }
                    break;
                    break;
                case 'homeServiceStopped':
                    if (message.success) {
                        showMessage('HOME服务停止成功', 'success');
                    } else {
                        showMessage('停止HOME服务失败: ' + message.error, 'error');
                    }
                    break;
                case 'homeServiceDebugged':
                    if (message.success) {
                        showMessage('HOME服务调试启动成功', 'success');
                    } else {
                        showMessage('调试启动HOME服务失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'dataSourceAdded':
                    // 恢复保存按钮状态
                    const saveButtons = document.querySelectorAll('button');
                    saveButtons.forEach(button => {
                        if (button.textContent.includes('保存中') || button.disabled) {
                            button.disabled = false;
                            button.textContent = button.textContent.replace('保存中...', '保存');
                        }
                    });
                    
                    if (message.success) {
                        showMessage('数据源添加成功', 'success');
                        // 注意：这里不再重新加载整个配置，而是刷新数据源列表
                        // 由于我们不再在.nc-home-config.json中保存数据源，需要重新从prop.xml加载
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('数据源添加失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'dataSourceUpdated':
                    // 恢复保存按钮状态
                    const updateButtons = document.querySelectorAll('button');
                    updateButtons.forEach(button => {
                        if (button.textContent.includes('更新中') || button.disabled) {
                            button.disabled = false;
                            button.textContent = button.textContent.replace('更新中...', '更新');
                        }
                    });
                    
                    if (message.success) {
                        showMessage('数据源更新成功', 'success');
                        // 注意：这里不再重新加载整个配置，而是刷新数据源列表
                        // 由于我们不再在.nc-home-config.json中保存数据源，需要重新从prop.xml加载
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('数据源更新失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'connectionTestResult':
                    if (message.result.success) {
                        showMessage('数据源连接测试成功: ' + message.result.message, 'success');
                    } else {
                        showMessage('数据源连接测试失败: ' + message.result.message, 'error');
                    }
                    break;
                    
                case 'dataSourceDeleted':
                    if (message.success) {
                        showMessage('数据源删除成功', 'success');
                        // 注意：这里不再重新加载整个配置，而是刷新数据源列表
                        // 由于我们不再在.nc-home-config.json中保存数据源，需要重新从prop.xml加载
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('数据源删除失败: ' + message.error, 'error');
                    }
                    break; // 添加缺失的break语句
                    
                case 'designDatabaseSet':
                    // 重置设置Design状态
                    isSettingDesign = false;
                    // 重新启用所有设为Design按钮
                    document.querySelectorAll('[data-action="setDesign"]').forEach(button => {
                        button.disabled = false;
                        button.textContent = '设为Design';
                    });
                    
                    if (message.success) {
                        showMessage('已设置为开发库', 'success');
                        // 重新加载配置以获取最新的数据源信息
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('设置开发库失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'macHomeConversionResult':
                    if (message.success) {
                        showMessage('Mac HOME转换成功', 'success');
                    } else {
                        showMessage('Mac HOME转换失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'baseDatabaseSet':
                    if (message.success) {
                        showMessage('已设置为基准库', 'success');
                        // 重新加载配置以获取最新的数据源信息
                        vscode.postMessage({ type: 'loadConfig' });
                    } else {
                        showMessage('设置基准库失败: ' + message.error, 'error');
                    }
                    break;
                    
                case 'defaultsReset':
                    if (message.success) {
                        // 更新配置显示
                        if (message.config) {
                            updateConfigDisplay(message.config);
                        }
                        showMessage('已重置为默认配置', 'success');
                    } else {
                        showMessage('重置默认配置失败: ' + message.error, 'error');
                    }
                    break;
            }
        });
        
        // 显示日志
        function showLogs(logs) {
            // 创建模态框
            const modal = document.createElement('div');
            modal.id = 'logsModal';
            modal.style.cssText = \`
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0,0,0,0.5);
                z-index: 1000;
                display: flex;
                justify-content: center;
                align-items: center;
            \`;
            
            let logsHtml = '<div style="background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 20px; width: 90%; height: 90%; display: flex; flex-direction: column;">';
            logsHtml += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
            logsHtml += '<h3 style="margin: 0; color: var(--vscode-foreground);">应用查看日志</h3>';
            logsHtml += '<button onclick="closeLogsModal()" style="background: none; border: none; color: var(--vscode-foreground); cursor: pointer; font-size: 20px;">×</button>';
            logsHtml += '</div>';
            
            // 创建选项卡
            logsHtml += '<div style="display: flex; border-bottom: 1px solid var(--vscode-widget-border); margin-bottom: 15px; overflow-x: auto;">';
            logs.forEach((log, index) => {
                logsHtml += \`<button class="log-tab \${index === 0 ? 'active' : ''}" onclick="switchLogTab(\${index})" style="padding: 8px 16px; background: \${index === 0 ? 'var(--vscode-tab-activeBackground)' : 'transparent'}; color: var(--vscode-foreground); border: none; cursor: pointer; border-bottom: \${index === 0 ? '2px solid var(--vscode-textLink-foreground)' : 'none'};">\${log.fileName}</button>\`;
            });
            logsHtml += '</div>';
            
            // 创建日志内容区域
            logsHtml += '<div style="flex: 1; overflow: hidden;">';
            logs.forEach((log, index) => {
                // 提取错误信息
                const errorLines = log.content.split('\\n').filter(line => 
                    line.includes('ERROR') || 
                    line.includes('Exception') || 
                    line.includes('错误') || 
                    line.includes('异常') ||
                    line.includes('FATAL') ||
                    line.includes('SEVERE')
                );
                
                logsHtml += \`<div id="log-content-\${index}" class="log-content" style="display: \${index === 0 ? 'block' : 'none'}; height: 100%; overflow: auto;">\`;
                
                if (errorLines.length > 0) {
                    logsHtml += '<div style="margin-bottom: 15px; padding: 10px; background-color: rgba(203, 36, 49, 0.2); border: 1px solid var(--vscode-errorForeground); border-radius: 4px;">';
                    logsHtml += '<h4 style="margin-top: 0; color: var(--vscode-errorForeground);">检测到的错误信息:</h4>';
                    errorLines.forEach(line => {
                        logsHtml += \`<div style="font-family: monospace; font-size: 12px; margin-bottom: 5px;">\${line}</div>\`;
                    });
                    logsHtml += '</div>';
                }
                
                logsHtml += '<div style="font-family: monospace; font-size: 12px; white-space: pre-wrap;">';
                logsHtml += log.content;
                logsHtml += '</div>';
                logsHtml += '</div>';
            });
            logsHtml += '</div>';
            logsHtml += '</div>';
            
            modal.innerHTML = logsHtml;
            document.body.appendChild(modal);
        }
        
        // 关闭日志模态框
        function closeLogsModal() {
            const modal = document.getElementById('logsModal');
            if (modal) {
                modal.remove();
            }
        }
        
        // 切换日志选项卡
        function switchLogTab(index) {
            // 更新选项卡样式
            document.querySelectorAll('.log-tab').forEach((tab, i) => {
                tab.style.background = i === index ? 'var(--vscode-tab-activeBackground)' : 'transparent';
                tab.style.borderBottom = i === index ? '2px solid var(--vscode-textLink-foreground)' : 'none';
            });
            
            // 显示对应的内容
            document.querySelectorAll('.log-content').forEach((content, i) => {
                content.style.display = i === index ? 'block' : 'none';
            });
        }
        
        // 页面加载完成后加载配置
        // initializeHomeVersionSelect将通过configLoaded消息调用
        vscode.postMessage({ type: 'loadConfig' });
    </script>
</body>
</html>`;
    }

    /**
     * 处理删除确认请求
     */
    private async handleDeleteConfirmationRequest(dataSourceName: string) {
        const confirm = await vscode.window.showWarningMessage(
            `确定要删除数据源 "${dataSourceName}" 吗？`,
            { modal: true },
            '确定'
        );

        if (confirm === '确定') {
            // 用户确认删除，执行删除操作
            await this.handleDeleteDataSource(dataSourceName);
        }
        // 如果用户点击取消或关闭对话框，则不执行任何操作
    }

    /**
     * 处理保存模块配置
     */
    private async handleSaveModuleConfig(modules: ModuleInfo[]) {
        try {
            await this.moduleConfigService.saveModuleConfig(modules);
            this._view?.webview.postMessage({
                type: 'moduleConfigSaved',
                success: true
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'moduleConfigSaved',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理确认重置默认值
     */
    private async handleConfirmResetDefaults() {
        const confirm = await vscode.window.showWarningMessage(
            '确定要重置所有配置为默认值吗？',
            { modal: true },
            '确定',
            '取消'
        );

        if (confirm === '确定') {
            try {
                // 获取当前配置
                const config = this.configService.getConfig();

                // 设置默认值
                const defaultConfig = {
                    // 移除了standardMode相关的代码
                    // 移除了autoClient相关的代码
                    debugMode: true,
                    debugPort: 8888,
                    homeVersion: '',

                };

                // 更新配置
                const updatedConfig = {
                    ...config,
                    ...defaultConfig
                };

                // 保存配置
                await this.configService.saveConfig(updatedConfig);

                // 发送成功消息
                this._view?.webview.postMessage({
                    type: 'defaultsReset',
                    success: true,
                    config: updatedConfig
                });
            } catch (error: any) {
                // 发送错误消息
                this._view?.webview.postMessage({
                    type: 'defaultsReset',
                    success: false,
                    error: error.message
                });
            }
        }
    }
    
    /**
     * 刷新所有相关Webview的数据源显示
     * 在Home目录切换后调用此方法确保所有界面都能获取到最新的数据源信息
     */
    private async refreshAllDataSources(): Promise<void> {
        try {
            // 重新加载配置
            this.configService.reloadConfig();
            
            // 从prop.xml获取最新的数据源信息
            const { dataSources } = this.configService.getPortFromPropXml();
            
            // 优先选择design数据源
            let selectedDataSource = dataSources.find(ds => ds.name === 'design');
            if (!selectedDataSource && dataSources.length > 0) {
                // 如果没有design数据源，使用第一个数据源
                selectedDataSource = dataSources[0];
            }
            
            // 向所有相关的Webview发送数据源更新消息
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'dataSourcesUpdated',
                    dataSources: dataSources.map(ds => ({
                        name: ds.name,
                        type: ds.databaseType,
                        host: ds.host,
                        port: ds.port,
                        database: ds.databaseName,
                        user: ds.username
                    }))
                });
            }
            
            // 如果有选中的数据源，也发送当前数据源消息
            if (selectedDataSource) {
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'currentDataSource',
                        dataSource: {
                            name: selectedDataSource.name,
                            type: selectedDataSource.databaseType,
                            host: selectedDataSource.host,
                            port: selectedDataSource.port,
                            database: selectedDataSource.databaseName,
                            user: selectedDataSource.username
                        }
                    });
                }
            }
        } catch (error) {
            console.error('刷新数据源失败:', error);
        }
    }
}