"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpCommands = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const McpService_1 = require("./McpService");
class McpCommands {
    mcpService;
    constructor(context, mcpService) {
        this.mcpService = mcpService;
    }
    static registerCommands(context, mcpService) {
        const mcpCommands = new McpCommands(context, mcpService);
        const startCommand = vscode.commands.registerCommand('yonbip.mcp.start', () => {
            mcpCommands.startMcp();
        });
        const stopCommand = vscode.commands.registerCommand('yonbip.mcp.stop', () => {
            mcpCommands.stopMcp();
        });
        const configCommand = vscode.commands.registerCommand('yonbip.mcp.config', () => {
            mcpCommands.showConfigDialog();
        });
        const statusCommand = vscode.commands.registerCommand('yonbip.mcp.status', () => {
            mcpCommands.showStatus();
        });
        const logsCommand = vscode.commands.registerCommand('yonbip.mcp.logs', () => {
            mcpCommands.showLogs();
        });
        context.subscriptions.push(startCommand, stopCommand, configCommand, statusCommand, logsCommand);
        return mcpCommands;
    }
    async startMcp() {
        try {
            await this.mcpService.start();
            vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
        }
        catch (error) {
            vscode.window.showErrorMessage(`启动MCP服务失败: ${error.message}`);
        }
    }
    async stopMcp() {
        try {
            await this.mcpService.stop();
        }
        catch (error) {
            vscode.window.showErrorMessage(`停止MCP服务失败: ${error.message}`);
        }
    }
    async showConfigDialog() {
        const config = this.mcpService.getConfig();
        const builtinJarPath = path.join(this.mcpService.getContext().extensionPath, 'resources', 'yonyou-mcp.jar');
        const isUsingBuiltin = config.jarPath === builtinJarPath;
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
            { label: '$(memory) 最大内存', description: config.maxMemory, detail: '配置JVM最大内存' }
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
                }
            }
        });
        quickPick.show();
    }
    async configurePort() {
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
    async configureJarPath() {
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
        if (!choice)
            return;
        if (choice.isBuiltin) {
            if (fs.existsSync(builtinJarPath)) {
                config.jarPath = builtinJarPath;
                await this.mcpService.saveConfig(config);
                vscode.window.showInformationMessage(`已设置为内置JAR文件: ${builtinJarPath}`);
            }
            else {
                vscode.window.showErrorMessage('内置JAR文件不存在，请检查插件安装');
            }
        }
        else {
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
    async configureJavaPath() {
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
    async configureMaxMemory() {
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
            }
            else {
                config.maxMemory = memory.label;
            }
            await this.mcpService.saveConfig(config);
            vscode.window.showInformationMessage(`最大内存已设置为: ${config.maxMemory}`);
        }
    }
    showStatus() {
        const status = this.mcpService.getStatus();
        const config = this.mcpService.getConfig();
        const builtinJarPath = path.join(this.mcpService.getContext().extensionPath, 'resources', 'yonyou-mcp.jar');
        const isUsingBuiltin = config.jarPath === builtinJarPath;
        const statusMap = {
            [McpService_1.McpStatus.STOPPED]: '已停止',
            [McpService_1.McpStatus.STARTING]: '启动中',
            [McpService_1.McpStatus.RUNNING]: '运行中',
            [McpService_1.McpStatus.STOPPING]: '停止中',
            [McpService_1.McpStatus.ERROR]: '错误'
        };
        const jarInfo = isUsingBuiltin ? '内置JAR (推荐)' : path.basename(config.jarPath || '未配置');
        const message = `MCP服务状态: ${statusMap[status]}\n` +
            `端口: ${config.port}\n` +
            `Java: ${config.javaPath}\n` +
            `JAR: ${jarInfo}\n` +
            `内存: ${config.maxMemory}\n`;
        vscode.window.showInformationMessage(message);
    }
    showLogs() {
        this.mcpService.showOutput();
    }
    getMcpService() {
        return this.mcpService;
    }
}
exports.McpCommands = McpCommands;
//# sourceMappingURL=McpCommands.js.map