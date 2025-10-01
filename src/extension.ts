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
import { ProjectService } from './project/ProjectService';
import { McpService } from './mcp/McpService';
import { LibraryService } from './project/LibraryService';

// 导入项目装饰器提供者
import { ProjectDecorationProvider } from './project/ProjectDecorationProvider';

// 导入密码加密解密工具类
import { PasswordEncryptor } from './utils/PasswordEncryptor';

// 全局变量用于在deactivate时释放资源
let ncHomeConfigService: NCHomeConfigService | undefined;
let projectService: ProjectService | undefined;
let mcpService: McpService | undefined;
let libraryService: LibraryService | undefined;

export function activate(context: vscode.ExtensionContext) {


	// 显示插件加载成功的提示信息
	vscode.window.showInformationMessage('🚀 YonBIP高级版开发者工具加载成功', '了解更多')
		.then(selection => {
			if (selection === '了解更多') {
				// 这里可以打开文档或更多信息页面
				vscode.env.openExternal(vscode.Uri.parse('https://community.yonyou.com'));
			}
		});

	// 设置PasswordEncryptor的扩展路径
	PasswordEncryptor.setExtensionPath(context.extensionPath);

	// 注册项目装饰器提供者
	const projectDecorationProvider = new ProjectDecorationProvider(context);
	context.subscriptions.push(projectDecorationProvider);

	// 设置装饰器提供者实例
	ProjectContextCommands.setDecorationProvider(projectDecorationProvider);

	// 设置扩展上下文
	ProjectContextCommands.setExtensionContext(context);

	// 注册MCP命令
	mcpService = new McpService(context);
	const mcpCommands = McpCommands.registerCommands(context, mcpService);

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
	ncHomeConfigService = new NCHomeConfigService(context);
	const ncHomeConfigCommands = new NCHomeConfigCommands(context);
	// NCHomeConfigCommands类没有实现dispose方法，因此不能添加到context.subscriptions中

	// 注册HOME服务命令
	HomeCommands.registerCommands(context, ncHomeConfigService);

	// 注册库管理命令
	LibraryCommands.registerCommands(context);

	// 注册项目上下文菜单命令
	ProjectContextCommands.registerCommands(context);

	// 注册项目管理命令
	projectService = new ProjectService(context);
	ProjectCommands.registerCommands(context, projectService);

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
	// 释放NC Home配置服务资源
	if (ncHomeConfigService) {
		ncHomeConfigService.dispose();
	}

	// 释放项目管理服务资源
	if (projectService) {
		projectService.dispose();
	}

	// 释放MCP服务资源
	if (mcpService) {
		mcpService.dispose();
	}

	// 释放库管理服务资源
	if (libraryService) {
		libraryService.dispose();
	}
}