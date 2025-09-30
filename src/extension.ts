// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 扩展组件
import { McpCommands } from './mcp/McpCommands';
import { McpProvider } from './mcp/McpProvider';
import { ProjectProvider } from './project/ProjectProvider';
import { NCHomeConfigProvider } from './project/NCHomeConfigProvider';
import { NCHomeConfigWebviewProvider } from './project/NCHomeConfigWebviewProvider';
import { OpenApiProvider } from './openapi/OpenApiProvider';
import { NCHomeConfigService } from './project/NCHomeConfigService';
import { HomeCommands } from './project/HomeCommands';
import { NCHomeConfigCommands } from './project/NCHomeConfigCommands';
import { LibraryCommands } from './project/LibraryCommands';
import { ProjectContextCommands } from './project/ProjectContextCommands';
import { ProjectCommands } from './project/ProjectCommands';

// 导入项目装饰器提供者
import { ProjectDecorationProvider } from './project/ProjectDecorationProvider';


export function activate(context: vscode.ExtensionContext) {


	// 显示插件加载成功的提示信息
	vscode.window.showInformationMessage('🚀 YonBIP高级版开发者工具加载成功', '了解更多')
		.then(selection => {
			if (selection === '了解更多') {
				// 这里可以打开文档或更多信息页面
				vscode.env.openExternal(vscode.Uri.parse('https://community.yonyou.com'));
			}
		});

	// 注册项目装饰器提供者
	const projectDecorationProvider = new ProjectDecorationProvider(context);
	context.subscriptions.push(projectDecorationProvider);

	// 设置装饰器提供者实例
	ProjectContextCommands.setDecorationProvider(projectDecorationProvider);

	// 设置扩展上下文
	ProjectContextCommands.setExtensionContext(context);

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

	// 注册项目管理界面
	const projectProvider = new ProjectProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ProjectProvider.viewType,
			projectProvider,
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

	// 注册库管理命令
	LibraryCommands.registerCommands(context);

	// 注册项目上下文菜单命令
	ProjectContextCommands.registerCommands(context);

	// 注册项目管理命令
	ProjectCommands.registerCommands(context);

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

	// 注册测试webview命令
	const testWebviewCommand = vscode.commands.registerCommand('yonbip.test.webview', () => {
		const panel = vscode.window.createWebviewPanel(
			'testWebview',
			'测试Webview',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);
		
		panel.webview.html = `
			<!DOCTYPE html>
			<html lang="zh-CN">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>测试Webview</title>
				<style>
					body {
						font-family: var(--vscode-font-family);
						color: var(--vscode-foreground);
						background-color: var(--vscode-editor-background);
						padding: 20px;
					}
					.test-container {
						text-align: center;
						margin-top: 50px;
					}
					.test-button {
						background-color: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						padding: 10px 20px;
						border-radius: 4px;
						cursor: pointer;
						font-size: 14px;
						margin: 10px;
					}
					.test-button:hover {
						background-color: var(--vscode-button-hoverBackground);
					}
				</style>
			</head>
			<body>
				<div class="test-container">
					<h1>🎉 Webview 测试成功！</h1>
					<p>如果你能看到这个界面，说明webview已经正常工作了。</p>
					<button class="test-button" onclick="testMessage()">发送测试消息</button>
				</div>
				<script>
					const vscode = acquireVsCodeApi();
					
					function testMessage() {
						vscode.postMessage({
							command: 'test',
							text: 'Hello from webview!'
						});
					}
				</script>
			</body>
			</html>
		`;
		
		panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'test':
						vscode.window.showInformationMessage('收到来自webview的消息: ' + message.text);
						return;
				}
			},
			undefined,
			context.subscriptions
		);
	});
	
	context.subscriptions.push(testWebviewCommand);

}

// this method is called when your extension is deactivated
export function deactivate() {
	console.log('YonBIP高级版开发者工具已停用');
}