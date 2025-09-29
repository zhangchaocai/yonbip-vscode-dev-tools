import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LibraryService } from './LibraryService';

/**
 * 库管理命令
 */
export class LibraryCommands {

    /**
     * 注册所有库相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext): void {
        const libraryService = new LibraryService(context);

        // 初始化库命令
        const initLibraryCommand = vscode.commands.registerCommand(
            'yonbip.library.init',
            async () => {
                await this.handleInitLibrary(libraryService);
            }
        );

        // 重新初始化库命令
        const reinitLibraryCommand = vscode.commands.registerCommand(
            'yonbip.library.reinit',
            async () => {
                await this.handleReinitLibrary(libraryService);
            }
        );

        // 检查库状态命令
        const checkLibraryCommand = vscode.commands.registerCommand(
            'yonbip.library.check',
            async () => {
                await this.handleCheckLibrary(libraryService);
            }
        );

        // 调试配置命令
        const debugConfigCommand = vscode.commands.registerCommand(
            'yonbip.library.debugConfig',
            async () => {
                const config = vscode.workspace.getConfiguration('yonbip');
                const homePath = config.get<string>('homePath');

                console.log('=== 配置调试信息 ===');
                console.log('yonbip.homePath:', homePath);
                console.log('所有yonbip配置:', config);

                // 检查配置来源
                const inspect = config.inspect('homePath');
                console.log('homePath配置详情:', inspect);

                let message = `当前HOME路径: ${homePath || '未配置'}\n`;
                if (inspect) {
                    message += `全局: ${inspect.globalValue || '未设置'}\n`;
                    message += `工作区: ${inspect.workspaceValue || '未设置'}\n`;
                    message += `工作区文件夹: ${inspect.workspaceFolderValue || '未设置'}`;
                }

                vscode.window.showInformationMessage(message);
            }
        );

        context.subscriptions.push(initLibraryCommand, reinitLibraryCommand, checkLibraryCommand, debugConfigCommand);
    }

    /**
     * 处理初始化库
     */
    private static async handleInitLibrary(libraryService: LibraryService): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('yonbip');
            let homePath = config.get<string>('homePath');

            // 如果未配置HOME路径，提示用户选择
            if (!homePath) {
                const result = await vscode.window.showInformationMessage(
                    '未配置HOME路径，是否现在配置？',
                    '是',
                    '否'
                );

                if (result !== '是') {
                    return;
                }

                // 打开NC Home配置界面
                await vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                return;
            }

            // 确认是否包含数据库驱动
            const needDbLibrary = await vscode.window.showQuickPick(
                ['是', '否'],
                {
                    placeHolder: '是否需要包含数据库驱动库？'
                }
            ) === '是';

            let driverLibPath: string | undefined;
            if (needDbLibrary) {
                driverLibPath = await this.selectDriverLibPath();
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                await libraryService.initLibrary(homePath!, needDbLibrary, driverLibPath);
            });

            // 显示成功消息
            vscode.window.showInformationMessage('Java项目库初始化完成！');

        } catch (error: any) {
            vscode.window.showErrorMessage(`初始化库失败: ${error.message}`);
        }
    }

    /**
     * 处理重新初始化库
     */
    private static async handleReinitLibrary(libraryService: LibraryService): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('yonbip');
            const homePath = config.get<string>('homePath');

            if (!homePath) {
                vscode.window.showWarningMessage('请先配置HOME路径');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                '重新初始化将覆盖现有库配置，是否继续？',
                '继续',
                '取消'
            );

            if (confirm !== '继续') {
                return;
            }

            // 获取当前工作区文件夹路径作为默认路径
            let selectedPath: string | undefined;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                selectedPath = workspaceFolder.uri.fsPath;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在重新初始化Java项目库...',
                cancellable: false
            }, async () => {
                await libraryService.initLibrary(homePath, false, undefined, selectedPath);
            });

            // 显示成功消息
            vscode.window.showInformationMessage('Java项目库重新初始化完成！');

        } catch (error: any) {
            vscode.window.showErrorMessage(`重新初始化库失败: ${error.message}`);
        }
    }

    /**
     * 处理检查库状态
     */
    private static async handleCheckLibrary(libraryService: LibraryService): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showWarningMessage('未找到工作区文件夹');
                return;
            }

            const libDir = path.join(workspaceFolder.uri.fsPath, '.lib');

            if (!fs.existsSync(libDir)) {
                vscode.window.showInformationMessage('库尚未初始化');
                return;
            }

            const files = fs.readdirSync(libDir).filter(file => file.endsWith('.json'));

            if (files.length === 0) {
                vscode.window.showInformationMessage('库配置为空');
                return;
            }

            const message = `已初始化 ${files.length} 个库配置`;
            vscode.window.showInformationMessage(message);

        } catch (error: any) {
            vscode.window.showErrorMessage(`检查库状态失败: ${error.message}`);
        }
    }

    /**
     * 选择数据库驱动库路径
     */
    private static async selectDriverLibPath(): Promise<string | undefined> {
        const result = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            openLabel: '选择数据库驱动JAR文件',
            filters: {
                'JAR文件': ['jar']
            }
        });

        if (result && result.length > 0) {
            return result.map(uri => uri.fsPath).join(',');
        }

        return undefined;
    }
}