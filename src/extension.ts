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
import { LibraryService } from './project/LibraryService';

/**
 * 在项目根目录下创建 build/classes 目录
 */
function createBuildDirectories(): void {
	try {
		const rootPath = vscode.workspace.rootPath;
		if (rootPath) {
			const buildPath = path.join(rootPath, 'build');
			const classesPath = path.join(buildPath, 'classes');
			
			if (!fs.existsSync(buildPath)) {
				fs.mkdirSync(buildPath, { recursive: true });
			}
			
			if (!fs.existsSync(classesPath)) {
				fs.mkdirSync(classesPath, { recursive: true });
			}
		}
	} catch (error) {
		console.error('Failed to create build/classes directory:', error);
	}
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	// 创建 build/classes 目录
	createBuildDirectories();
	
	// 显示插件加载成功的提示信息
	vscode.window.showInformationMessage('🚀 YonBIP高级版开发者工具加载成功', '了解更多')
		.then(selection => {
			if (selection === '了解更多') {
				// 这里可以打开文档或更多信息页面
				vscode.env.openExternal(vscode.Uri.parse('https://community.yonyou.com'));
			}
		});
	
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
	
	// 自动初始化库（如果配置了HOME路径）
	const libraryService = new LibraryService(context);
	setTimeout(() => {
		libraryService.autoInitLibrary();
	}, 2000); // 延迟2秒执行，确保配置已加载
	
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