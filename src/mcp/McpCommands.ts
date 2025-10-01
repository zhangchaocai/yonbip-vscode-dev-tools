import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { McpService, McpConfig, McpStatus } from './McpService';

/**
 * MCP命令类
 */
export class McpCommands {
    private mcpService: McpService;

    constructor(context: vscode.ExtensionContext, mcpService: McpService) {
        this.mcpService = mcpService;
    }

    /**
     * 注册所有MCP相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext, mcpService: McpService): McpCommands {
        const mcpCommands = new McpCommands(context, mcpService);

        // 注册启动命令
        const startCommand = vscode.commands.registerCommand('yonbip.mcp.start', () => {
            mcpCommands.startMcp();
        });

        // 注册停止命令
        const stopCommand = vscode.commands.registerCommand('yonbip.mcp.stop', () => {
            mcpCommands.stopMcp();
        });

        // 注册配置命令
        const configCommand = vscode.commands.registerCommand('yonbip.mcp.config', () => {
            mcpCommands.showConfigDialog();
        });

        // 注册状态查看命令
        const statusCommand = vscode.commands.registerCommand('yonbip.mcp.status', () => {
            mcpCommands.showStatus();
        });

        // 注册日志查看命令
        const logsCommand = vscode.commands.registerCommand('yonbip.mcp.logs', () => {
            mcpCommands.showLogs();
        });

        context.subscriptions.push(
            startCommand,
            stopCommand,
            configCommand,
            statusCommand,
            logsCommand
        );

        return mcpCommands;
    }

    /**
     * 启动MCP服务
     */
    public async startMcp(): Promise<void> {
        try {
            await this.mcpService.start();
            // 启动成功后自动切换到MCP服务面板
            vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
        } catch (error: any) {
            vscode.window.showErrorMessage(`启动MCP服务失败: ${error.message}`);
        }
    }

    /**
     * 停止MCP服务
     */
    public async stopMcp(): Promise<void> {
        try {
            await this.mcpService.stop();
        } catch (error: any) {
            vscode.window.showErrorMessage(`停止MCP服务失败: ${error.message}`);
        }
    }



    /**
     * 显示配置对话框
     */
    public async showConfigDialog(): Promise<void> {
        const config = this.mcpService.getConfig();
        const builtinJarPath = path.join(this.mcpService.getContext().extensionPath, 'resources', 'yonyou-mcp.jar');
        const isUsingBuiltin = config.jarPath === builtinJarPath;

        // 创建QuickPick选择配置项
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = 'MCP服务配置';
        quickPick.items = [
            { label: '$(gear) 端口配置', description: `当前: ${config.port}`, detail: '配置MCP服务端口' },
            {
                label: '$(file-binary) JAR文件路径',
                description: isUsingBuiltin ? '内置JAR (推荐)' : (config.jarPath || '未配置'),
                detail: '配置MCP JAR文件路径'
            },
            { label: '$(terminal) Java路径', description: config.javaPath, detail: '配置Java可执行文件路径' },
            { label: '$(memory) 最大内存', description: config.maxMemory, detail: '配置JVM最大内存' },
            { label: '$(bug) 调试模式', description: config.enableDebug ? '已启用' : '已禁用', detail: '启用/禁用调试模式' }
        ];

        quickPick.onDidChangeSelection(async (selection) => {
            if (selection.length > 0) {
                const selected = selection[0];
                quickPick.hide();

                switch (selected.label) {
                    case '$(gear) 端口配置':
                        await this.configurePort();
                        break;
                    case '$(file-binary) JAR文件路径':
                        await this.configureJarPath();
                        break;
                    case '$(terminal) Java路径':
                        await this.configureJavaPath();
                        break;
                    case '$(memory) 最大内存':
                        await this.configureMaxMemory();
                        break;
                    case '$(bug) 调试模式':
                        await this.toggleDebugMode();
                        break;
                }
            }
        });

        quickPick.show();
    }

    /**
     * 配置端口
     */
    private async configurePort(): Promise<void> {
        const config = this.mcpService.getConfig();
        const portStr = await vscode.window.showInputBox({
            prompt: '请输入MCP服务端口',
            value: config.port.toString(),
            validateInput: (value) => {
                const port = parseInt(value);
                if (isNaN(port) || port < 1024 || port > 65535) {
                    return '端口号必须在1024-65535之间';
                }
                return null;
            }
        });

        if (portStr) {
            config.port = parseInt(portStr);
            await this.mcpService.saveConfig(config);
            vscode.window.showInformationMessage(`端口已设置为: ${config.port}`);
        }
    }

    /**
     * 配置JAR文件路径
     */
    private async configureJarPath(): Promise<void> {
        const config = this.mcpService.getConfig();
        const builtinJarPath = path.join(this.mcpService.getContext().extensionPath, 'resources', 'yonyou-mcp.jar');
        const isUsingBuiltin = config.jarPath === builtinJarPath;

        const choice = await vscode.window.showQuickPick([
            {
                label: '使用内置JAR文件',
                description: builtinJarPath,
                detail: isUsingBuiltin ? '当前正在使用' : '推荐选项，插件内置',
                isBuiltin: true
            },
            {
                label: '选择自定义JAR文件',
                description: '浏览选择JAR文件',
                detail: '使用自定义的JAR文件路径',
                isBuiltin: false
            }
        ], {
            placeHolder: '选择MCP JAR文件来源'
        });

        if (!choice) return;

        if ((choice as any).isBuiltin) {
            // 使用内置JAR
            if (fs.existsSync(builtinJarPath)) {
                config.jarPath = builtinJarPath;
                await this.mcpService.saveConfig(config);
                vscode.window.showInformationMessage(`已设置为内置JAR文件: ${builtinJarPath}`);
            } else {
                vscode.window.showErrorMessage('内置JAR文件不存在，请检查插件安装');
            }
        } else {
            // 选择自定义JAR
            const jarFiles = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'JAR文件': ['jar']
                },
                title: '选择MCP JAR文件'
            });

            if (jarFiles && jarFiles.length > 0) {
                config.jarPath = jarFiles[0].fsPath;
                await this.mcpService.saveConfig(config);
                vscode.window.showInformationMessage(`JAR文件路径已设置为: ${config.jarPath}`);
            }
        }
    }

    /**
     * 配置Java路径
     */
    private async configureJavaPath(): Promise<void> {
        const config = this.mcpService.getConfig();
        const javaPath = await vscode.window.showInputBox({
            prompt: '请输入Java可执行文件路径',
            value: config.javaPath,
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Java路径不能为空';
                }
                return null;
            }
        });

        if (javaPath) {
            config.javaPath = javaPath;
            await this.mcpService.saveConfig(config);
            vscode.window.showInformationMessage(`Java路径已设置为: ${config.javaPath}`);
        }
    }

    /**
     * 配置最大内存
     */
    private async configureMaxMemory(): Promise<void> {
        const config = this.mcpService.getConfig();
        const memory = await vscode.window.showQuickPick([
            { label: '256m', description: '256MB' },
            { label: '512m', description: '512MB' },
            { label: '1g', description: '1GB' },
            { label: '2g', description: '2GB' },
            { label: '4g', description: '4GB' },
            { label: '自定义', description: '输入自定义值' }
        ], {
            placeHolder: '选择JVM最大内存大小'
        });

        if (memory) {
            if (memory.label === '自定义') {
                const customMemory = await vscode.window.showInputBox({
                    prompt: '请输入内存大小 (如: 1g, 512m)',
                    value: config.maxMemory,
                    validateInput: (value) => {
                        if (!/^\d+[mg]$/i.test(value)) {
                            return '格式错误，请输入如 512m 或 1g 的格式';
                        }
                        return null;
                    }
                });
                if (customMemory) {
                    config.maxMemory = customMemory;
                }
            } else {
                config.maxMemory = memory.label;
            }

            await this.mcpService.saveConfig(config);
            vscode.window.showInformationMessage(`最大内存已设置为: ${config.maxMemory}`);
        }
    }

    /**
     * 切换调试模式
     */
    private async toggleDebugMode(): Promise<void> {
        const config = this.mcpService.getConfig();
        config.enableDebug = !config.enableDebug;
        await this.mcpService.saveConfig(config);

        const status = config.enableDebug ? '已启用' : '已禁用';
        vscode.window.showInformationMessage(`调试模式${status}`);

        if (config.enableDebug) {
            vscode.window.showInformationMessage(
                '调试模式已启用，调试端口: 5005',
                '了解更多'
            ).then(selection => {
                if (selection === '了解更多') {
                    vscode.env.openExternal(vscode.Uri.parse(
                        'https://docs.oracle.com/javase/8/docs/technotes/guides/jpda/conninv.html'
                    ));
                }
            });
        }
    }



    /**
     * 显示状态
     */
    public showStatus(): void {
        const status = this.mcpService.getStatus();
        const config = this.mcpService.getConfig();
        const builtinJarPath = path.join(this.mcpService.getContext().extensionPath, 'resources', 'yonyou-mcp.jar');
        const isUsingBuiltin = config.jarPath === builtinJarPath;

        const statusMap = {
            [McpStatus.STOPPED]: '已停止',
            [McpStatus.STARTING]: '启动中',
            [McpStatus.RUNNING]: '运行中',
            [McpStatus.STOPPING]: '停止中',
            [McpStatus.ERROR]: '错误'
        };

        const jarInfo = isUsingBuiltin ? '内置JAR (推荐)' : path.basename(config.jarPath || '未配置');

        const message = `MCP服务状态: ${statusMap[status]}\n` +
            `端口: ${config.port}\n` +
            `Java: ${config.javaPath}\n` +
            `JAR: ${jarInfo}\n` +
            `内存: ${config.maxMemory}\n` +
            `调试: ${config.enableDebug ? '已启用' : '已禁用'}`;

        vscode.window.showInformationMessage(message);
    }

    /**
     * 显示日志
     */
    public showLogs(): void {
        this.mcpService.showOutput();
    }

    /**
     * 获取MCP服务实例
     */
    public getMcpService(): McpService {
        return this.mcpService;
    }
}