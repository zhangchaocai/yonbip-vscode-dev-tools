import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LibraryService } from '../library/LibraryService';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';
import { HomeService } from '../nc-home/HomeService';
import { ProjectService } from './ProjectService';
import { ClasspathService } from '../library/ClasspathService';

// 添加一个静态属性来存储context
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * 项目上下文菜单命令
 */
export class ProjectContextCommands {

    // 添加静态属性来存储装饰器实例
    private static decorationProvider: any = null;

    /**
     * 设置扩展上下文
     * @param context 扩展上下文
     */
    public static setExtensionContext(context: vscode.ExtensionContext): void {
        extensionContext = context;
    }

    /**
     * 设置装饰器提供者实例
     * @param provider 装饰器提供者实例
     */
    public static setDecorationProvider(provider: any): void {
        console.log('设置装饰器提供者:', provider ? '成功' : '失败');
        this.decorationProvider = provider;
    }

    /**
     * 注册所有项目上下文菜单相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext, configService: NCHomeConfigService): void {
        // 设置扩展上下文
        this.setExtensionContext(context);

        const libraryService = new LibraryService(context, configService);
        const classpathService = new ClasspathService();

        // 初始化项目目录命令（右键菜单）
        const initProjectContextCommand = vscode.commands.registerCommand(
            'yonbip.project.initContext',
            async (uri: vscode.Uri) => {
                await this.handleInitProjectContext(uri, libraryService, configService);
            }
        );

        // 添加所有源码路径到.classpath命令（右键菜单）
        const addAllSourcePathsCommand = vscode.commands.registerCommand(
            'yonbip.project.addAllSourcePaths',
            async (uri: vscode.Uri) => {
                await this.handleAddAllSourcePaths(uri, classpathService);
            }
        );

        context.subscriptions.push(initProjectContextCommand);
        context.subscriptions.push(addAllSourcePathsCommand);
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

            console.log(`用户选择的初始化目录: ${selectedPath}`);

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
                await this.createProjectStructure(selectedPath);
            });

            // 强制重新加载配置以确保获取最新配置
            configService.reloadConfig();
            // 获取HOME路径配置 - 使用NCHomeConfigService获取工作区特定的配置
            const config = configService.getConfig();
            let homePath = config.homePath;

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

            // 初始化库（移除了数据库驱动选择功能）
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                // 移除了needDbLibrary和driverLibPath参数
                await libraryService.initLibrary(homePath!, false, undefined, selectedPath);
            });

            // 添加项目目录标识
            console.log(`准备标记目录为已初始化: ${selectedPath}`);
            if (this.decorationProvider) {
                console.log('装饰器提供者存在，开始标记');
                this.decorationProvider.markAsInitialized(selectedPath);
                console.log('目录标记完成');
            } else {
                console.log('装饰器提供者不存在');
            }

            // 询问用户是否立即启动HOME服务
            const startService = await vscode.window.showInformationMessage(
                `项目初始化完成！是否立即在目录 ${selectedPath} 中启动HOME服务？`,
                '启动',
                '取消'
            );

            if (startService === '启动') {
                // 启动HOME服务
                if (extensionContext) {
                    const homeService = new HomeService(extensionContext, configService);
                    await homeService.startHomeService(selectedPath);
                } else {
                    vscode.window.showErrorMessage('无法启动HOME服务：扩展上下文未初始化');
                }
            }

            vscode.window.showInformationMessage('项目初始化完成！');
        } catch (error: any) {
            console.error('项目初始化失败:', error);
            vscode.window.showErrorMessage(`项目初始化失败: ${error.message}`);
        }
    }

    /**
     * 在指定目录下创建符合项目结构的目录
     */
    private static async createProjectStructure(basePath: string): Promise<void> {
        try {
            // 修复：确保正确创建相对于选定目录的build/classes路径
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');

            // 检查并创建build目录
            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }

            // 检查并创建classes目录
            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }

            // 创建META-INF目录和module.xml文件
            const metaInfPath = path.join(basePath, 'META-INF');
            if (!fs.existsSync(metaInfPath)) {
                fs.mkdirSync(metaInfPath, { recursive: true });
            }

            // 获取目录名称作为模块名称
            const dirName = path.basename(basePath);
            const moduleXmlPath = path.join(metaInfPath, 'module.xml');

            // 只有当module.xml文件不存在时才创建
            if (!fs.existsSync(moduleXmlPath)) {
                const moduleXmlContent = `<?xml version="1.0" encoding="gb2312"?>
<module name="${dirName}">
    <public></public>
    <private></private>
</module>`;
                fs.writeFileSync(moduleXmlPath, moduleXmlContent, 'utf-8');
            }
        } catch (error) {
            console.error('Failed to create project directories:', error);
            throw new Error(`创建目录失败: ${error}`);
        }
    }


    /**
     * 处理添加所有源码路径到.classpath
     */
    private static async handleAddAllSourcePaths(
        uri: vscode.Uri | undefined,
        classpathService: ClasspathService
    ): Promise<void> {
        try {
            // 如果没有提供URI，则提示用户选择目录
            let selectedPath: string;
            if (!uri) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择要扫描的目录'
                });

                if (!result || result.length === 0) {
                    return;
                }

                selectedPath = result[0].fsPath;
            } else {
                selectedPath = uri.fsPath;
            }

            console.log(`用户选择的扫描目录: ${selectedPath}`);

            // 调用ClasspathService处理添加源码路径
            await classpathService.addAllSourcePaths(selectedPath);

        } catch (error: any) {
            console.error('添加源码路径失败:', error);
            vscode.window.showErrorMessage(`添加源码路径失败: ${error.message}`);
        }
    }
}