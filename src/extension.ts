// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 扩展组件
import { McpCommands } from './mcp/McpCommands';
import { McpProvider } from './mcp/McpProvider';
import { NCHomeConfigProvider } from './project/NCHomeConfigProvider';
import { OpenApiProvider } from './openapi/OpenApiProvider';
import { NCHomeConfigService } from './project/NCHomeConfigService';
import { HomeCommands } from './project/HomeCommands';
import { NCHomeConfigCommands } from './project/NCHomeConfigCommands';
import { LibraryCommands } from './project/LibraryCommands';
import { ProjectContextCommands } from './project/ProjectContextCommands';

// 导入项目装饰器提供者
import { ProjectDecorationProvider } from './project/ProjectDecorationProvider';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
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