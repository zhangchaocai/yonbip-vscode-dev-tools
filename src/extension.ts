// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// 扩展组件
import { McpCommands } from './mcp/McpCommands';
import { DatabaseCommands } from './database/DatabaseCommands';
import { ProjectCommands } from './project/ProjectCommands';
import { McpProvider } from './mcp/McpProvider';
import { DatabaseProvider } from './database/DatabaseProvider';
import { NCHomeConfigProvider } from './project/NCHomeConfigProvider';
import { OpenApiProvider } from './openapi/OpenApiProvider';
import { NCHomeConfigService } from './project/NCHomeConfigService';
import { HomeCommands } from './project/HomeCommands';
import { NCHomeConfigCommands } from './project/NCHomeConfigCommands';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// 注册MCP命令
	const mcpCommands = McpCommands.registerCommands(context);
	
	// 注册MCP界面
	const mcpProvider = new McpProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			McpProvider.viewType,
			mcpProvider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			}
		)
	);
	
	// 注册数据库界面
	const databaseProvider = new DatabaseProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			DatabaseProvider.viewType,
			databaseProvider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			}
		)
	);
	
	// 注册NC Home配置界面和命令
	const ncHomeConfigService = new NCHomeConfigService(context);
	const ncHomeConfigCommands = new NCHomeConfigCommands(context);
	// NCHomeConfigCommands类没有实现dispose方法，因此不能添加到context.subscriptions中
	
	// 注册HOME服务命令
	HomeCommands.registerCommands(context, ncHomeConfigService);
	
	// 注册NC Home配置界面
	const ncHomeConfigProvider = new NCHomeConfigProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			NCHomeConfigProvider.viewType,
			ncHomeConfigProvider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			}
		)
	);
	
	// 注册OpenAPI测试界面
	const openApiProvider = new OpenApiProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			OpenApiProvider.viewType,
			openApiProvider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			}
		)
	);


	 // 注册命令
    let disposable = vscode.commands.registerCommand('myExtension.showHelloWorld', () => {
        // 创建 Webview 面板
        const panel = vscode.window.createWebviewPanel(
            'helloWorld', // viewType
            'Hello World', // 标题
            vscode.ViewColumn.One, // 显示在编辑器区域
            {
                enableScripts: true // 允许在 Webview 中执行脚本
            }
        );

        // 设置 Webview HTML 内容
        panel.webview.html = getWebviewContent();

        // (可选) 处理来自 Webview 的消息
        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        return;
                }
            },
            undefined,
            context.subscriptions
        );
    });

	context.subscriptions.push(disposable);

}

function getWebviewContent() {
    // 简单的 HTML 内容
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hello World Webview</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 10px 20px; cursor: pointer; }
        button:hover { background-color: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <h1>你好, VS Code Webview!</h1>
    <p>这是一个使用 Webview API 创建的简单视图。</p>
    <button id="alertButton">发送消息到插件</button>

    <script>
        const vscode = acquireVsCodeApi(); // 获取 VS Code API

        document.getElementById('alertButton').addEventListener('click', () => {
            // 发送消息到插件
            vscode.postMessage({
                command: 'alert',
                text: '这是从 Webview 发送的消息!'
            });
        });
    </script>
</body>
</html>`;
}

// this method is called when your extension is deactivated
export function deactivate() {
	console.log('YonBIP高级版开发者工具已停用');
}