import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { HomeService } from './HomeService';
import { HomeDebugService } from './HomeDebugService';
import { NCHomeConfigService } from './config/NCHomeConfigService';

/**
 * HOME服务命令类
 */
export class HomeCommands {
    private homeService: HomeService;
    private homeDebugService: HomeDebugService;
    private configService: NCHomeConfigService;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, configService: NCHomeConfigService) {
        this.context = context;
        this.configService = configService;
        this.homeService = new HomeService(context, configService);
        this.homeDebugService = new HomeDebugService(context, configService, this.homeService);
    }

    /**
     * 注册HOME服务相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext, configService: NCHomeConfigService): void {
        const homeCommands = new HomeCommands(context, configService);

        // 注册启动HOME服务命令
        const startCommand = vscode.commands.registerCommand('yonbip.home.start', (uri: vscode.Uri) => {
            homeCommands.startHomeService(uri?.fsPath);
        });

        // 注册调试启动HOME服务命令
        const debugCommand = vscode.commands.registerCommand('yonbip.home.debug', (uri: vscode.Uri) => {
            homeCommands.debugHomeService(uri?.fsPath);
        });

        // 注册停止HOME服务命令
        const stopCommand = vscode.commands.registerCommand('yonbip.home.stop', () => {
            homeCommands.stopHomeService();
        });

        // 注册查看HOME服务状态命令
        const statusCommand = vscode.commands.registerCommand('yonbip.home.status', () => {
            homeCommands.showStatus();
        });

        // 注册查看HOME服务日志命令
        const logsCommand = vscode.commands.registerCommand('yonbip.home.logs', () => {
            homeCommands.showLogs();
        });

        // 注册从指定目录启动HOME服务命令
        const startFromDirectoryCommand = vscode.commands.registerCommand(
            'yonbip.home.startFromDirectory',
            (uri: vscode.Uri) => {
                homeCommands.startHomeServiceFromDirectory(uri);
            }
        );

        // 注册从工具栏启动HOME服务命令
        const startFromToolbarCommand = vscode.commands.registerCommand(
            'yonbip.home.startFromToolbar',
            (uri: vscode.Uri) => {
                homeCommands.startHomeServiceFromToolbar(uri);
            }
        );

        context.subscriptions.push(
            startCommand,
            debugCommand,
            stopCommand,
            statusCommand,
            logsCommand,
            startFromDirectoryCommand,
            startFromToolbarCommand
        );
    }

    /**
     * 启动HOME服务
     */
    public async startHomeService(selectedPath?: string): Promise<void> {
        try {
            // 重新加载配置以确保使用当前工作区的配置
            this.configService.reloadConfig();
            
            // 检查是否已配置Home目录
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            
            await this.homeService.startHomeService(selectedPath);
        } catch (error: any) {
            vscode.window.showErrorMessage(`启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 从指定目录启动HOME服务
     */
    public async startHomeServiceFromDirectory(uri: vscode.Uri): Promise<void> {
        try {
            let selectedPath: string;
            if (!uri) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择项目目录'
                });

                if (!result || result.length === 0) {
                    return;
                }

                selectedPath = result[0].fsPath;
            } else {
                selectedPath = uri.fsPath;
            }

            // 检查目录是否包含.project标记文件
            const markerFilePath = path.join(selectedPath, '.project');
            if (!fs.existsSync(markerFilePath)) {
                vscode.window.showErrorMessage('只有已初始化的YonBIP项目目录才能启动中间件服务。请先使用"🚀 YONBIP 工程初始化"命令初始化项目或者创建YonBIP项目进行启动。');
                return;
            }

            // 重新加载配置以确保使用当前工作区的配置
            this.configService.reloadConfig();
            
            // 检查是否已配置Home目录
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            
            await this.homeService.startHomeService(selectedPath);
        } catch (error: any) {
            vscode.window.showErrorMessage(`从指定目录启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 从工具栏启动HOME服务（自动查找第一个.project文件的父级目录）
     */
    public async startHomeServiceFromToolbar(uri?: vscode.Uri): Promise<void> {
        try {
            let projectDir: string;
            
            if (uri) {
                // 如果传入了URI，检查是否为.project文件
                if (path.basename(uri.fsPath) === '.project') {
                    projectDir = path.dirname(uri.fsPath);
                } else {
                    projectDir = uri.fsPath;
                }
            } else {
                // 自动查找第一个.project文件的父级目录
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    vscode.window.showWarningMessage('请先打开一个工作区文件夹');
                    return;
                }

                const foundProjectDir = this.findFirstProjectDirectory(workspaceFolders[0].uri.fsPath);
                if (!foundProjectDir) {
                    vscode.window.showErrorMessage('未找到.project文件，请先初始化YonBIP项目');
                    return;
                }
                projectDir = foundProjectDir;
            }

            // 检查目录是否包含.project标记文件
            const markerFilePath = path.join(projectDir, '.project');
            if (!fs.existsSync(markerFilePath)) {
                vscode.window.showErrorMessage('只有已初始化的YonBIP项目目录才能启动中间件服务。请先使用"🚀 YONBIP 工程初始化"命令初始化项目或者创建YonBIP项目进行启动。');
                return;
            }

            // 重新加载配置以确保使用当前工作区的配置
            this.configService.reloadConfig();
            
            // 检查是否已配置Home目录
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            
            await this.homeService.startHomeService(projectDir);
        } catch (error: any) {
            vscode.window.showErrorMessage(`从工具栏启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 查找第一个.project文件的父级目录
     */
    private findFirstProjectDirectory(rootPath: string): string | null {
        const findProjectFile = (dir: string): string | null => {
            try {
                const items = fs.readdirSync(dir);
                
                // 首先检查当前目录是否有.project文件
                if (items.includes('.project')) {
                    return dir;
                }
                
                // 递归查找子目录
                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stat = fs.statSync(itemPath);
                    
                    if (stat.isDirectory() && !item.startsWith('.')) {
                        const result = findProjectFile(itemPath);
                        if (result) {
                            return result;
                        }
                    }
                }
                
                return null;
            } catch (error) {
                return null;
            }
        };
        
        return findProjectFile(rootPath);
    }

    /**
     * 调试启动HOME服务
     */
    public async debugHomeService(selectedPath?: string): Promise<void> {
        try {
            // 重新加载配置以确保使用当前工作区的配置
            this.configService.reloadConfig();
            
            // 检查是否已配置Home目录
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            
            await this.homeDebugService.debugHomeService(selectedPath);
        } catch (error: any) {
            vscode.window.showErrorMessage(`调试启动HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 停止HOME服务
     */
    public async stopHomeService(): Promise<void> {
        try {
            // 检查是否已配置Home目录
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC Home路径');
                return;
            }
            
            await this.homeService.stopHomeService();
        } catch (error: any) {
            vscode.window.showErrorMessage(`停止HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 显示HOME服务状态
     */
    public showStatus(): void {
        const status = this.homeService.getStatus();
        let statusText = '';

        switch (status) {
            case 'stopped':
                statusText = '已停止';
                break;
            case 'starting':
                statusText = '启动中';
                break;
            case 'running':
                statusText = '运行中';
                break;
            case 'stopping':
                statusText = '停止中';
                break;
            case 'error':
                statusText = '错误';
                break;
            default:
                statusText = '未知';
        }

        vscode.window.showInformationMessage(`NC HOME服务状态: ${statusText}`);
    }

    /**
     * 显示HOME服务日志
     */
    public showLogs(): void {
        this.homeService.showLogs();
    }
}