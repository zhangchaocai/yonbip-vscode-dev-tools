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
}

// this method is called when your extension is deactivated
export function deactivate() {
	console.log('YonBIP高级版开发者工具已停用');
}