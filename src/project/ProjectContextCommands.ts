import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LibraryService } from './LibraryService';
import { NCHomeConfigService } from './NCHomeConfigService';

/**
 * 项目上下文菜单命令
 */
export class ProjectContextCommands {

    /**
     * 注册所有项目上下文菜单相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext): void {
        const ncHomeConfigService = new NCHomeConfigService(context);
        const libraryService = new LibraryService(context, ncHomeConfigService);

        // 初始化项目目录命令（右键菜单）
        const initProjectContextCommand = vscode.commands.registerCommand(
            'yonbip.project.initContext',
            async (uri: vscode.Uri) => {
                await this.handleInitProjectContext(uri, libraryService, ncHomeConfigService);
            }
        );

        context.subscriptions.push(initProjectContextCommand);
    }

    /**
     * 处理初始化项目上下文菜单
     */
    private static async handleInitProjectContext(
        uri: vscode.Uri | undefined,
        libraryService: LibraryService,
        configService: NCHomeConfigService
    ): Promise<void> {
        try {
            // 如果没有提供URI，则提示用户选择目录
            let selectedPath: string;
            if (!uri) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择项目目录'
                });

                if (!result || result.length === 0) {
                    return;
                }

                selectedPath = result[0].fsPath;
            } else {
                selectedPath = uri.fsPath;
            }

            // 确认操作
            const confirm = await vscode.window.showWarningMessage(
                `将在以下目录初始化项目：${selectedPath}\n\n这将创建build/classes目录并初始化Java项目库。是否继续？`,
                '继续',
                '取消'
            );

            if (confirm !== '继续') {
                return;
            }

            // 创建build/classes目录
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在创建项目目录...',
                cancellable: false
            }, async () => {
                await this.createBuildDirectories(selectedPath);
            });

            // 获取HOME路径配置
            const config = vscode.workspace.getConfiguration('yonbip');
            let homePath = config.get<string>('homePath');

            // 如果未配置HOME路径，提示用户选择
            if (!homePath) {
                const result = await vscode.window.showInformationMessage(
                    '未配置HOME路径，是否现在配置？',
                    '是',
                    '否'
                );

                if (result === '是') {
                    // 打开NC Home配置界面
                    await vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                    return;
                } else {
                    vscode.window.showWarningMessage('请先配置NC HOME路径');
                    return;
                }
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

            // 初始化库
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                await libraryService.initLibrary(homePath!, needDbLibrary, driverLibPath, selectedPath);
            });

            vscode.window.showInformationMessage('项目初始化完成！');
        } catch (error: any) {
            vscode.window.showErrorMessage(`项目初始化失败: ${error.message}`);
        }
    }

    /**
     * 在指定目录下创建 build/classes 目录
     */
    private static async createBuildDirectories(basePath: string): Promise<void> {
        try {
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');

            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }

            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }
        } catch (error) {
            console.error('Failed to create build/classes directory:', error);
            throw new Error(`创建目录失败: ${error}`);
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