// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// 扩展组件
import { McpCommands } from './mcp/McpCommands';
import { McpProvider } from './mcp/McpProvider';
import { ProjectProvider } from './project/project-management/ProjectProvider';
import { NCHomeConfigProvider } from './project/nc-home/config/NCHomeConfigProvider';
import { PatchExportWebviewProvider } from './project/ui/PatchExportWebviewProvider';
import { PrecastExportWebviewProvider } from './project/ui/PrecastExportWebviewProvider';
import { OpenApiProvider } from './openapi/OpenApiProvider';
import { NCHomeConfigService } from './project/nc-home/config/NCHomeConfigService';
import { HomeCommands } from './project/nc-home/HomeCommands';
import { NCHomeConfigCommands } from './project/nc-home/config/NCHomeConfigCommands';
import { LibraryCommands } from './project/library/LibraryCommands';
import { ProjectContextCommands } from './project/project-management/ProjectContextCommands';
import { ProjectCommands } from './project/project-management/ProjectCommands';
import { ProjectService } from './project/project-management/ProjectService';
import { McpService } from './mcp/McpService';
import { LibraryService } from './project/library/LibraryService';
import { HomeService } from './project/nc-home/HomeService';
import { MacHomeConversionService } from './project/mac/MacHomeConversionService';
// 导入密码加密解密工具类
import { PasswordEncryptor } from './utils/PasswordEncryptor';
// 导入功能树提供者
import { FunctionTreeProvider } from './project/ui/FunctionTreeProvider';
// 导入服务目录扫描类
import { ServiceDirectoryScanner } from './utils/ServiceDirectoryScanner';
import { ServiceStateManager } from './utils/ServiceStateManager';
// 导入扩展版本服务
import { ExtensionVersionService } from './utils/ExtensionVersionService';
// 导入图标主题更新服务
import { IconThemeUpdater } from './utils/IconThemeUpdater';

// 全局变量用于在deactivate时释放资源
let ncHomeConfigService: NCHomeConfigService | undefined;
let projectService: ProjectService | undefined;
let mcpService: McpService | undefined;
let libraryService: LibraryService | undefined;
let homeService: HomeService | undefined;
let macHomeConversionService: MacHomeConversionService | undefined;

export async function activate(context: vscode.ExtensionContext) {

	// 初始化图标主题更新服务
	await IconThemeUpdater.initialize(context);

	// 显示插件加载成功的提示信息
	vscode.window.showInformationMessage('🚀 YDS Premium Fusion工具加载成功', '了解更多')
		.then(selection => {
			if (selection === '了解更多') {
				// 这里可以打开文档或更多信息页面
				vscode.env.openExternal(vscode.Uri.parse('https://community.yonyou.com/article/detail/10786'));
			}
		});


	// 设置PasswordEncryptor的扩展路径
	PasswordEncryptor.setExtensionPath(context.extensionPath);

	// 设置扩展上下文
	ProjectContextCommands.setExtensionContext(context);

	// 注册MCP命令
	mcpService = new McpService(context);
	const mcpCommands = McpCommands.registerCommands(context, mcpService);

	// 注册MCP界面
	const mcpProvider = new McpProvider(context.extensionUri, context, mcpService);
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
	// 创建全局的MacHomeConversionService实例
	macHomeConversionService = new MacHomeConversionService(ncHomeConfigService);
	const ncHomeConfigCommands = new NCHomeConfigCommands(context, macHomeConversionService);
	// NCHomeConfigCommands类没有实现dispose方法，因此不能添加到context.subscriptions中

	// 注册HOME服务命令
	HomeCommands.registerCommands(context, ncHomeConfigService);
	
	// 初始化工具栏图标状态上下文
	vscode.commands.executeCommand('setContext', 'yonbip.home.stop.enabled', false);

	// 注册库管理命令
	LibraryCommands.registerCommands(context, ncHomeConfigService);

	// 注册项目上下文菜单命令
	ProjectContextCommands.registerCommands(context, ncHomeConfigService);

	// 注册项目管理命令
	projectService = new ProjectService(context);
	ProjectCommands.registerCommands(context, projectService, ncHomeConfigService);

	// 注册NC Home配置界面
	const ncHomeConfigProvider = new NCHomeConfigProvider(context.extensionUri, context, macHomeConversionService);
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

	// 注册补丁导出配置界面
	const patchExportProvider = new PatchExportWebviewProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			PatchExportWebviewProvider.viewType,
			patchExportProvider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			}
		)
	);

	// 注册预置脚本导出配置界面
	const precastExportProvider = new PrecastExportWebviewProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			PrecastExportWebviewProvider.viewType,
			precastExportProvider,
			{
				webviewOptions: {
					retainContextWhenHidden: true,
				},
			}
		)
	);

	// 注册功能树视图
	const functionTreeProvider = new FunctionTreeProvider(context, mcpProvider, ncHomeConfigProvider, openApiProvider, patchExportProvider, precastExportProvider);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('yonbip-function-tree', functionTreeProvider)
	);

	// 注册功能导航命令
	context.subscriptions.push(
		vscode.commands.registerCommand('yonbip.function.showMcp', () => {
			functionTreeProvider.createOrShowWebview('yonbip-mcp', 'MCP服务');
		}),
		vscode.commands.registerCommand('yonbip.function.showHomeConfig', () => {
			functionTreeProvider.createOrShowWebview('yonbip-nchome', 'HOME配置');
		}),
		vscode.commands.registerCommand('yonbip.function.showOpenApi', () => {
			functionTreeProvider.createOrShowWebview('yonbip-openapi', 'OpenAPI测试');
		}),
		vscode.commands.registerCommand('yonbip.function.showPatchExport', () => {
			functionTreeProvider.createOrShowWebview('yonbip.patchExportConfig', '补丁导出配置');
		}),
		vscode.commands.registerCommand('yonbip.function.showPrecastExport', () => {
			functionTreeProvider.createOrShowWebview('yonbip.precastExportConfig', '预置脚本导出');
		}),
		vscode.commands.registerCommand('yonbip.patchExportConfig.focus', () => {
			functionTreeProvider.createOrShowWebview('yonbip.patchExportConfig', '补丁导出配置');
		}),
		vscode.commands.registerCommand('yonbip.precastExportConfig.focus', () => {
			functionTreeProvider.createOrShowWebview('yonbip.precastExportConfig', '预置脚本导出');
		}),
		// 注册终端菜单命令
		vscode.commands.registerCommand('yonbip.terminal.menu', () => {
			// 这个命令只是菜单入口，不需要实际实现
		}),
		// 注册服务目录选择命令
		vscode.commands.registerCommand('yonbip.terminal.selectServiceDirectory', async () => {
			// 显示进度条并执行扫描操作
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: '🔍 扫描YonBIP服务目录',
				cancellable: false
			}, async (progress) => {
				try {
					// 初始化进度
					progress.report({ increment: 0, message: '开始扫描工作区...' });
					
					// 模拟初始进度
					await new Promise(resolve => setTimeout(resolve, 200));
					
					// 扫描服务目录，传入进度回调
					const serviceDirectories = await ServiceDirectoryScanner.scanServiceDirectories((scanProgress) => {
						progress.report(scanProgress);
					});
					
					if (serviceDirectories.length === 0) {
						progress.report({ increment: 100, message: '扫描完成，未找到服务目录' });
						await new Promise(resolve => setTimeout(resolve, 500));
						vscode.window.showInformationMessage('未找到可启动的服务目录。请确保工作区中包含带有.project和.classpath文件的YonBIP项目目录。');
						return;
					}
					
					progress.report({ increment: 90, message: `找到 ${serviceDirectories.length} 个服务目录` });
					await new Promise(resolve => setTimeout(resolve, 200));
					
					// 创建QuickPick选项
					const quickPickItems = serviceDirectories.map(dir => ({
						label: ServiceDirectoryScanner.getDirectoryDisplayName(dir),
						description: dir,
						detail: '包含.project和.classpath文件的服务目录',
						dirPath: dir
					}));
					
					progress.report({ increment: 100, message: '准备选择界面...' });
					await new Promise(resolve => setTimeout(resolve, 200));
					
					// 显示QuickPick下拉面板
					const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
						placeHolder: '选择要启动的服务目录',
						canPickMany: false
					});
					
					if (selectedItem) {
						// 保存选择的服务目录
						await ServiceStateManager.saveSelectedServiceDirectory(selectedItem.dirPath);
						vscode.window.showInformationMessage(`✅ 已选择服务目录: ${selectedItem.label}`);
					}
				} catch (error: any) {
					console.error('选择服务目录时出错:', error);
					vscode.window.showErrorMessage(`选择服务目录时出错: ${error.message || '未知错误'}`);
				}
			});
		})
	);
	
	// 插件激活后默认打开MCP服务界面
	// setTimeout(() => {
	// 	vscode.commands.executeCommand('yonbip.function.showMcp');
	// }, 1000);

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

	// 释放HOME服务资源
	if (homeService) {
		homeService.dispose();
	}

	// 释放Mac HOME转换服务资源
	if (macHomeConversionService) {
		macHomeConversionService.dispose();
	}
	
	// 释放图标主题更新器资源
	IconThemeUpdater.dispose();
}