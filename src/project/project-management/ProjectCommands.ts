import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as StreamZip from 'node-stream-zip';
import { ProjectService } from './ProjectService';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';
import { LibraryService } from '../library/LibraryService';
import { getHomeVersion } from '../../utils/HomeVersionUtils';

/**
 * 项目相关命令类
 */
export class ProjectCommands {
    private projectService: ProjectService;
    private configService: NCHomeConfigService;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, projectService: ProjectService, configService: NCHomeConfigService) {
        this.projectService = projectService;
        this.configService = configService;  // 使用传入的配置服务实例
        this.context = context;
    }

    /**
     * 注册所有项目相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext, projectService: ProjectService, configService: NCHomeConfigService): void {
        const projectCommands = new ProjectCommands(context, projectService, configService);

        // 注册创建项目命令
        const createCommand = vscode.commands.registerCommand('yonbip.project.create', (uri: vscode.Uri) => {
            projectCommands.createProject(uri?.fsPath);
        });

        // 注册创建多模块项目命令
        const createMultiModuleCommand = vscode.commands.registerCommand('yonbip.project.createMultiModule', (uri: vscode.Uri) => {
            projectCommands.createMultiModuleProject(uri?.fsPath);
        });

        // 注册创建业务组件命令
        const createComponentCommand = vscode.commands.registerCommand('yonbip.project.createComponent', (uri: vscode.Uri) => {
            projectCommands.createComponent(uri?.fsPath);
        });

        // 注册导出补丁命令
        const exportPatchCommand = vscode.commands.registerCommand('yonbip.project.exportPatch', (uri: vscode.Uri) => {
            projectCommands.exportPatch(uri?.fsPath);
        });

        // 注册下载脚手架命令
        const downloadScaffoldCommand = vscode.commands.registerCommand('yonbip.scaffold.download', (uri: vscode.Uri) => {
            projectCommands.downloadScaffold(uri?.fsPath);
        });

        context.subscriptions.push(
            createCommand,
            createMultiModuleCommand,
            createComponentCommand,
            exportPatchCommand,
            downloadScaffoldCommand
        );
    }

    /**
     * 创建项目
     */
    public async createProject(projectPath?: string): Promise<void> {
        // 获取当前工作区文件夹
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('请先打开一个工作区文件夹');
            return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;

        // 确定项目的创建路径
        // 如果提供了projectPath（来自右键菜单），则使用该路径作为父目录
        // 否则使用工作区根目录
        let parentPath = workspacePath;
        if (projectPath) {
            // 检查提供的路径是否是目录
            try {
                const stat = fs.statSync(projectPath);
                if (stat.isDirectory()) {
                    parentPath = projectPath;
                }
            } catch (error) {
                // 如果路径不存在或无法访问，使用工作区路径
                parentPath = workspacePath;
            }
        }

        // 检查是否在多模块项目下创建模块项目
        const isMultiModuleProject = this.isMultiModuleProject(parentPath);
        const isModuleProject = this.isModuleProject(parentPath);
        const isInMultiModuleRoot = this.isMultiModuleProject(workspacePath) && parentPath === workspacePath;

        // 如果是在模块项目下创建项目，提示不允许
        if (isModuleProject) {
            vscode.window.showErrorMessage('模块项目下不允许再创建项目');
            return;
        }

        // 如果是在多模块项目下（不是根目录），允许创建模块项目
        // 如果是在多模块项目根目录下，可以创建模块项目
        // 如果是在普通项目下，可以创建普通项目

        // 让用户输入文件夹名称
        const folderName = await vscode.window.showInputBox({
            prompt: isMultiModuleProject || isInMultiModuleRoot ? '请输入要创建的模块项目文件夹名称' : '请输入要创建的项目文件夹名称',
            value: isMultiModuleProject || isInMultiModuleRoot ? 'new-yonbip-module' : 'new-yonbip-project',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '文件夹名称不能为空';
                }
                // 检查是否包含非法字符
                if (/[<>:"/\\|?*\x00-\x1F]/.test(value)) {
                    return '文件夹名称包含非法字符';
                }
                // 检查文件夹是否已存在
                const targetPath = path.join(parentPath, value.trim());
                if (fs.existsSync(targetPath)) {
                    return '该文件夹已存在，请输入其他名称';
                }
                return null;
            }
        });

        if (!folderName) {
            // 用户取消了操作
            return;
        }

        const selectedPath = path.join(parentPath, folderName.trim());

        // 确认操作
        const confirm = await vscode.window.showWarningMessage(
            isMultiModuleProject || isInMultiModuleRoot ?
                `将在多模块项目下创建模块项目文件夹：${folderName}\n\n完整路径：${selectedPath}\n这将创建build/classes目录并初始化Java项目库。是否继续？` :
                `将在以下目录创建项目文件夹：${folderName}\n\n完整路径：${selectedPath}\n这将创建build/classes目录并初始化Java项目库。是否继续？`,
            '继续',
            '取消'
        );

        if (confirm !== '继续') {
            return;
        }

        try {
            // 创建项目结构
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: isMultiModuleProject || isInMultiModuleRoot ? '正在创建模块项目目录...' : '正在创建项目目录...',
                cancellable: false
            }, async () => {
                // 如果是在多模块项目下创建，使用模块项目结构创建方法
                if (isMultiModuleProject || isInMultiModuleRoot) {
                    await this.createModuleProjectStructure(selectedPath);
                } else {
                    await this.createProjectStructure(selectedPath);
                }
            });

            // 强制重新加载配置以确保获取最新配置
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            const homePath = config.homePath;

            // 检查HOME路径配置
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

            // 初始化库（使用LibraryService的逻辑）
            const libraryService = new LibraryService(this.context, this.configService);
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                // 使用LibraryService的初始化逻辑，传入选定的路径
                await libraryService.initLibrary(homePath, false, undefined, selectedPath);
            });

            // 创建标记文件来标识已初始化的项目
            // const markerFilePath = path.join(selectedPath, '.project');
            // try {
            //     fs.writeFileSync(markerFilePath, 'This directory is initialized as a YonBIP Premium Project.');
            // } catch (error) {
            //     console.error('创建标记文件失败:', error);
            // }

            vscode.window.showInformationMessage(isMultiModuleProject || isInMultiModuleRoot ?
                `YonBIP模块项目 "${folderName}" 创建完成！` :
                `YonBIP项目 "${folderName}" 创建完成！`);
        } catch (error: any) {
            console.error('项目初始化失败:', error);
            vscode.window.showErrorMessage(`项目初始化失败: ${error.message}`);
        }
    }

    /**
     * 创建多模块项目
     */
    public async createMultiModuleProject(projectPath?: string): Promise<void> {
        // 获取当前工作区文件夹
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('请先打开一个工作区文件夹');
            return;
        }

        const workspacePath = workspaceFolder.uri.fsPath;

        // 多模块项目只能创建到工作区根目录下
        if (projectPath && projectPath !== workspacePath) {
            vscode.window.showErrorMessage('多模块项目只能创建到工作区根目录下');
            return;
        }

        // 让用户输入文件夹名称
        const folderName = await vscode.window.showInputBox({
            prompt: '请输入要创建的多模块项目文件夹名称',
            value: 'new-yonbip-multimodule-project',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '文件夹名称不能为空';
                }
                // 检查是否包含非法字符
                if (/[<>:"/\\|?*\x00-\x1F]/.test(value)) {
                    return '文件夹名称包含非法字符';
                }
                // 检查文件夹是否已存在
                const targetPath = path.join(workspacePath, value.trim());
                if (fs.existsSync(targetPath)) {
                    return '该文件夹已存在，请输入其他名称';
                }
                return null;
            }
        });

        if (!folderName) {
            // 用户取消了操作
            return;
        }

        const selectedPath = path.join(workspacePath, folderName.trim());

        // 确认操作
        const confirm = await vscode.window.showWarningMessage(
            `将在工作区下创建多模块项目文件夹：${folderName}\n\n完整路径：${selectedPath}\n这将创建build/classes目录。是否继续？`,
            '继续',
            '取消'
        );

        if (confirm !== '继续') {
            return;
        }

        try {
            // 创建项目结构（不包含META-INF和module.xml）
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在创建多模块项目目录...',
                cancellable: false
            }, async () => {
                await this.createMultiModuleProjectStructure(selectedPath);
            });

            // 强制重新加载配置以确保获取最新配置
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            const homePath = config.homePath;

            // 检查HOME路径配置
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

            // 初始化库（使用LibraryService的逻辑）
            const libraryService = new LibraryService(this.context, this.configService);
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                // 使用LibraryService的初始化逻辑
                await libraryService.initLibrary(homePath, false, undefined, selectedPath);
            });

            vscode.window.showInformationMessage(`YonBIP多模块项目 "${folderName}" 创建完成！`);
        } catch (error: any) {
            console.error('多模块项目初始化失败:', error);
            vscode.window.showErrorMessage(`多模块项目初始化失败: ${error.message}`);
        }
    }

    /**
     * 创建业务组件
     */
    public async createComponent(componentPath?: string): Promise<void> {
        // 如果没有提供路径，则提示用户选择目录
        let selectedPath: string;
        if (!componentPath) {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: '选择要创建业务组件的目录'
            });

            if (!result || result.length === 0) {
                return;
            }

            selectedPath = result[0].fsPath;
        } else {
            selectedPath = componentPath;
        }

        // 检查目录是否包含.project标记文件（即是否为已初始化的YonBIP项目）
        const markerFilePath = path.join(selectedPath, '.project');
        if (!fs.existsSync(markerFilePath)) {
            vscode.window.showErrorMessage('只有已初始化的YonBIP项目目录才能创建业务组件。请先使用"🚀 YONBIP 工程初始化"命令初始化项目。');
            return;
        }

        // 检查NC Home配置
        this.configService.reloadConfig();
        const config = this.configService.getConfig();
        if (!config.homePath) {
            vscode.window.showWarningMessage('请先配置NC HOME路径');
            return;
        }

        // 让用户输入业务组件名称
        const componentName = await vscode.window.showInputBox({
            prompt: '请输入业务组件名称',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '业务组件名称不能为空';
                }
                // 检查是否包含非法字符
                if (/[<>:"/\\|?*\x00-\x1F]/.test(value)) {
                    return '业务组件名称包含非法字符';
                }
                // 检查业务组件是否已存在
                const targetPath = path.join(selectedPath, value.trim());
                if (fs.existsSync(targetPath)) {
                    return '该业务组件已存在，请输入其他名称';
                }
                return null;
            }
        });

        if (!componentName) {
            // 用户取消了操作
            return;
        }

        const targetPath = path.join(selectedPath, componentName.trim());

        // 确认操作
        const confirm = await vscode.window.showWarningMessage(
            `将在以下目录创建业务组件：${targetPath}\n\n是否继续？`,
            '继续',
            '取消'
        );

        if (confirm !== '继续') {
            return;
        }

        try {
            // 创建业务组件目录结构
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在创建业务组件目录...',
                cancellable: false
            }, async () => {
                await this.createComponentStructure(targetPath, componentName.trim());
            });

            vscode.window.showInformationMessage(`业务组件 "${componentName}" 创建完成！`);
        } catch (error: any) {
            console.error('创建业务组件失败:', error);
            vscode.window.showErrorMessage(`创建业务组件失败: ${error.message}`);
        }
    }

    /**
     * 创建业务组件目录结构
     */
    private async createComponentStructure(componentPath: string, componentName: string): Promise<void> {
        try {
            // 创建业务组件目录
            fs.mkdirSync(componentPath, { recursive: true });

            // 创建子目录
            const srcPath = path.join(componentPath, 'src');
            const resourcesPath = path.join(componentPath, 'resources');
            const scriptPath = path.join(componentPath, 'script');
            const metadataPath = path.join(componentPath, 'METADATA');
            const metaInfPath = path.join(componentPath, 'META-INF');

            fs.mkdirSync(srcPath, { recursive: true });
            fs.mkdirSync(resourcesPath, { recursive: true });
            fs.mkdirSync(scriptPath, { recursive: true });
            fs.mkdirSync(metadataPath, { recursive: true });
            fs.mkdirSync(metaInfPath, { recursive: true });

            // 在src目录下创建子目录
            const publicPath = path.join(srcPath, 'public');
            const privatePath = path.join(srcPath, 'private');
            const clientPath = path.join(srcPath, 'client');

            fs.mkdirSync(publicPath, { recursive: true });
            fs.mkdirSync(privatePath, { recursive: true });
            fs.mkdirSync(clientPath, { recursive: true });

            // 创建component.xml文件
            const componentXmlPath = path.join(componentPath, 'component.xml');
            const componentXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<module name="${componentName}" displayname="${componentName}">
    <dependencies>
    </dependencies>
</module>`;
            fs.writeFileSync(componentXmlPath, componentXmlContent, 'utf-8');

            // 在src/client下创建测试类
            const comPath = path.join(clientPath, 'com', 'yonyou');
            fs.mkdirSync(comPath, { recursive: true });
            
            const classPath = path.join(comPath, 'Application.java');
            const classContent = `package com.yonyou;
/**
* Hello world! 
**/
public class Application{
    public static void main(String[] args) {
        System.out.println("Hello world!");
    }
}`;
            fs.writeFileSync(classPath, classContent, 'utf-8');

        } catch (error) {
            console.error('创建业务组件目录结构失败:', error);
            throw new Error(`创建业务组件目录结构失败: ${error}`);
        }
    }

    /**
     * 导出补丁
     */
    public async exportPatch(selectedPath?: string): Promise<void> {
        // 检查NC Home配置
        this.configService.reloadConfig();
        const config = this.configService.getConfig();
        if (!config.homePath) {
            vscode.window.showWarningMessage('请先配置NC HOME路径');
            return;
        }

        // 将选择的路径存储到工作区状态中
        if (selectedPath) {
            this.context.workspaceState.update('selectedExportPath', selectedPath);
        } else {
            this.context.workspaceState.update('selectedExportPath', undefined);
        }

        // 显示补丁导出配置界面
        await vscode.commands.executeCommand('yonbip.patchExportConfig.focus');

        // 触发文件列表刷新
        setTimeout(() => {
            vscode.commands.executeCommand('yonbip.patchExportConfig.refresh');
        }, 500);
    }

    /**
     * 下载YonBIP脚手架
     */
    public async downloadScaffold(selectedPath?: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('请先打开一个工作空间');
                return;
            }

            const targetPath = selectedPath || workspaceFolder.uri.fsPath;

            // 检查NC Home配置
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC HOME路径');
                return;
            }

            // 显示进度条
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "下载YonBIP脚手架",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: "开始复制文件..." });

                // 获取HOME路径
                const homePath = config.homePath;

                // 根据HOME版本选择对应的脚手架文件
                let scaffoldFileName = 'ncc-cli-v1903-v1909-v2005.zip'; // 默认脚手架文件

                if (homePath) {
                    // 获取HOME版本
                    const homeVersion = getHomeVersion(homePath);

                    // 根据版本选择脚手架文件
                    if (homeVersion) {
                        const versionNum = parseInt(homeVersion, 10);
                        if (!isNaN(versionNum)) {
                            if (versionNum >= 2105) {
                                scaffoldFileName = 'ncc-cli-v2105-vlatest.zip';
                            } else if (versionNum < 2015) {
                                scaffoldFileName = 'ncc-cli-v1903-v1909-v2005.zip';
                            } else {
                                // 2015-2104版本使用默认脚手架
                                scaffoldFileName = 'ncc-cli-v1903-v1909-v2005.zip';
                            }
                        }
                    }
                }

                // 从插件资源目录获取压缩包
                const extensionPath = this.context.extensionPath;
                const sourceZipPath = path.join(extensionPath, 'resources', 'ncc-front', scaffoldFileName);
                const zipFilePath = path.join(targetPath, 'ncc-cli-scaffold.zip');

                progress.report({ increment: 30, message: `正在复制压缩包: ${scaffoldFileName}...` });

                // 复制本地文件而不是下载
                await this.copyFile(sourceZipPath, zipFilePath);

                progress.report({ increment: 60, message: "正在解压文件..." });

                // 解压文件
                await this.extractZip(zipFilePath, targetPath);

                progress.report({ increment: 90, message: "清理临时文件..." });

                // 删除复制的zip文件
                if (fs.existsSync(zipFilePath)) {
                    fs.unlinkSync(zipFilePath);
                }

                progress.report({ increment: 100, message: "完成!" });
            });

            vscode.window.showInformationMessage('YonBIP脚手架下载完成！');

        } catch (error) {
            console.error('下载脚手架失败:', error);
            vscode.window.showErrorMessage(`下载脚手架失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }



    /**
     * 下载文件
     */
    private async downloadFile(url: string, filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(filePath);

            https.get(url, (response) => {
                if (response.statusCode === 200) {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                } else if (response.statusCode === 302 || response.statusCode === 301) {
                    // 处理重定向
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        this.downloadFile(redirectUrl, filePath).then(resolve).catch(reject);
                    } else {
                        reject(new Error('重定向但没有提供新的URL'));
                    }
                } else {
                    reject(new Error(`下载失败，状态码: ${response.statusCode}`));
                }
            }).on('error', (error) => {
                fs.unlink(filePath, () => { }); // 删除部分下载的文件
                reject(error);
            });
        });
    }

    /**
     * 解压ZIP文件
     */
    private async extractZip(zipFilePath: string, extractPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const zip = new StreamZip.async({ file: zipFilePath });

            zip.extract(null, extractPath)
                .then(() => {
                    zip.close();
                    resolve();
                })
                .catch((error) => {
                    zip.close();
                    reject(error);
                });
        });
    }

    /**
     * 打开NC Home配置
     */
    public async openNCHomeConfig(): Promise<void> {
        try {
            // 通过命令方式调用，避免直接访问私有属性
            await vscode.commands.executeCommand('yonbip.nchome.config');
        } catch (error: any) {
            vscode.window.showErrorMessage(`打开NC Home配置失败: ${error.message}`);
        }
    }

    /**
     * 配置项目
     */
    public async configureProject(): Promise<void> {
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = '项目配置';
        quickPick.items = [
            {
                label: '$(folder-opened) 创建YonBIP项目',
                description: '创建新的YonBIP高级版项目',
                detail: '生成标准的YonBIP项目结构和配置文件'
            },
            {
                label: '$(home) NC Home配置',
                description: '配置YonBIP NC Home路径和数据库连接',
                detail: '设置Home目录、数据源和开发环境参数'
            },
            {
                label: '$(package) 导出补丁包',
                description: '将当前项目打包为补丁',
                detail: '选择文件并生成补丁包'
            },
            {
                label: '$(list-tree) 查看项目结构',
                description: '显示当前项目的目录结构',
                detail: '分析项目文件组织'
            },
            {
                label: '$(gear) 项目设置',
                description: '配置项目相关设置',
                detail: '修改项目配置参数'
            }
        ];

        quickPick.onDidChangeSelection(async (selection) => {
            if (selection.length > 0) {
                const selected = selection[0];
                quickPick.hide();

                switch (selected.label) {
                    case '$(folder-opened) 创建YonBIP项目':
                        await this.createProject();
                        break;
                    case '$(home) NC Home配置':
                        await this.openNCHomeConfig();
                        break;
                    case '$(package) 导出补丁包':
                        await this.exportPatch();
                        break;
                    case '$(list-tree) 查看项目结构':
                        await this.showProjectStructure();
                        break;
                    case '$(gear) 项目设置':
                        await this.showProjectSettings();
                        break;
                }
            }
        });

        quickPick.show();
    }

    /**
     * 显示项目结构
     */
    public async showProjectStructure(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('请先打开一个工作区');
            return;
        }

        try {
            const structure = await this.analyzeProjectStructure(workspaceFolder.uri.fsPath);

            // 创建文档显示项目结构
            const document = await vscode.workspace.openTextDocument({
                content: structure,
                language: 'text'
            });

            await vscode.window.showTextDocument(document);

        } catch (error: any) {
            vscode.window.showErrorMessage(`分析项目结构失败: ${error.message}`);
        }
    }

    /**
     * 分析项目结构
     */
    private async analyzeProjectStructure(projectPath: string): Promise<string> {
        const fs = require('fs');
        const path = require('path');

        const result: string[] = [];
        result.push(`项目结构分析`);
        result.push(`项目路径: ${projectPath}`);
        result.push(`分析时间: ${new Date().toLocaleString()}`);
        result.push('');

        const analyzeDirectory = (dirPath: string, level: number = 0): void => {
            if (level > 5) return; // 限制深度

            try {
                const items = fs.readdirSync(dirPath);
                const indent = '  '.repeat(level);

                for (const item of items) {
                    // 跳过隐藏文件和一些目录
                    if (item.startsWith('.') || item === 'node_modules' || item === 'target') {
                        continue;
                    }

                    const fullPath = path.join(dirPath, item);
                    const stat = fs.statSync(fullPath);

                    if (stat.isDirectory()) {
                        result.push(`${indent}📁 ${item}/`);
                        analyzeDirectory(fullPath, level + 1);
                    } else {
                        const ext = path.extname(item).toLowerCase();
                        const icon = this.getFileIcon(ext);
                        const size = this.formatFileSize(stat.size);
                        result.push(`${indent}${icon} ${item} (${size})`);
                    }
                }
            } catch (error) {
                const indent = '  '.repeat(level);
                result.push(`${indent}❌ 无法读取目录: ${error}`);
            }
        };

        analyzeDirectory(projectPath);

        // 添加统计信息
        result.push('');
        result.push('='.repeat(50));
        result.push('统计信息:');

        const stats = this.getProjectStats(projectPath);
        result.push(`总文件数: ${stats.fileCount}`);
        result.push(`总目录数: ${stats.dirCount}`);
        result.push(`Java文件: ${stats.javaFiles}`);
        result.push(`XML文件: ${stats.xmlFiles}`);
        result.push(`总大小: ${this.formatFileSize(stats.totalSize)}`);

        return result.join('\n');
    }

    /**
     * 获取文件图标
     */
    private getFileIcon(extension: string): string {
        const iconMap: Record<string, string> = {
            '.java': '☕',
            '.xml': '📄',
            '.json': '🔧',
            '.properties': '⚙️',
            '.md': '📝',
            '.txt': '📄',
            '.yml': '🔧',
            '.yaml': '🔧',
            '.js': '💛',
            '.ts': '💙',
            '.html': '🌐',
            '.css': '🎨',
            '.sql': '🗃️'
        };

        return iconMap[extension] || '📄';
    }

    /**
     * 格式化文件大小
     */
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * 获取项目统计信息
     */
    private getProjectStats(projectPath: string): any {
        const fs = require('fs');
        const path = require('path');

        const stats = {
            fileCount: 0,
            dirCount: 0,
            javaFiles: 0,
            xmlFiles: 0,
            totalSize: 0
        };

        const scanDirectory = (dirPath: string): void => {
            try {
                const items = fs.readdirSync(dirPath);

                for (const item of items) {
                    if (item.startsWith('.') || item === 'node_modules' || item === 'target') {
                        continue;
                    }

                    const fullPath = path.join(dirPath, item);
                    const stat = fs.statSync(fullPath);

                    if (stat.isDirectory()) {
                        stats.dirCount++;
                        scanDirectory(fullPath);
                    } else {
                        stats.fileCount++;
                        stats.totalSize += stat.size;

                        const ext = path.extname(item).toLowerCase();
                        if (ext === '.java') stats.javaFiles++;
                        if (ext === '.xml') stats.xmlFiles++;
                    }
                }
            } catch (error) {
                // 忽略无法访问的目录
            }
        };

        scanDirectory(projectPath);
        return stats;
    }

    /**
     * 显示项目设置
     */
    private async showProjectSettings(): Promise<void> {
        const settings = await vscode.window.showQuickPick([
            {
                label: '$(gear) 默认项目类型',
                description: 'YonBIP项目',
                detail: '设置创建项目时的默认类型'
            },
            {
                label: '$(person) 默认作者',
                description: process.env.USER || 'Developer',
                detail: '设置项目文件中的默认作者'
            },
            {
                label: '$(package) 补丁输出目录',
                description: './patches',
                detail: '设置补丁包的默认输出目录'
            },
            {
                label: '$(file-zip) 补丁包含文件类型',
                description: '源码、资源文件',
                detail: '配置补丁包默认包含的文件类型'
            }
        ], {
            placeHolder: '选择要配置的项目设置'
        });

        if (settings) {
            switch (settings.label) {
                case '$(gear) 默认项目类型':
                    await this.configureDefaultProjectType();
                    break;
                case '$(person) 默认作者':
                    await this.configureDefaultAuthor();
                    break;
                case '$(package) 补丁输出目录':
                    await this.configurePatchOutputDir();
                    break;
                case '$(file-zip) 补丁包含文件类型':
                    await this.configurePatchFileTypes();
                    break;
            }
        }
    }

    /**
     * 配置默认项目类型
     */
    private async configureDefaultProjectType(): Promise<void> {
        const type = await vscode.window.showQuickPick([
            { label: 'yonbip', description: 'YonBIP高级版项目' },
            { label: 'standard', description: '标准Java项目' }
        ], {
            placeHolder: '选择默认项目类型'
        });

        if (type) {
            await vscode.workspace.getConfiguration('yonbip').update('defaultProjectType', type.label, true);
            vscode.window.showInformationMessage(`默认项目类型已设置为: ${type.description}`);
        }
    }

    /**
     * 配置默认作者
     */
    private async configureDefaultAuthor(): Promise<void> {
        const author = await vscode.window.showInputBox({
            prompt: '请输入默认作者名称',
            value: vscode.workspace.getConfiguration('yonbip').get('defaultAuthor') || process.env.USER || 'Developer'
        });

        if (author) {
            await vscode.workspace.getConfiguration('yonbip').update('defaultAuthor', author, true);
            vscode.window.showInformationMessage(`默认作者已设置为: ${author}`);
        }
    }

    /**
     * 配置补丁输出目录
     */
    private async configurePatchOutputDir(): Promise<void> {
        const dir = await vscode.window.showInputBox({
            prompt: '请输入补丁输出目录路径',
            value: vscode.workspace.getConfiguration('yonbip').get('patchOutputDir') || './patches'
        });

        if (dir) {
            await vscode.workspace.getConfiguration('yonbip').update('patchOutputDir', dir, true);
            vscode.window.showInformationMessage(`补丁输出目录已设置为: ${dir}`);
        }
    }

    /**
     * 配置补丁文件类型
     */
    private async configurePatchFileTypes(): Promise<void> {
        const fileTypes = await vscode.window.showQuickPick([
            { label: '源码文件', description: '.java, .js, .ts', picked: true },
            { label: '资源文件', description: '.xml, .properties, .json', picked: true },
            { label: '配置文件', description: '.yml, .yaml, .conf', picked: false },
            { label: '文档文件', description: '.md, .txt', picked: false }
        ], {
            placeHolder: '选择补丁包默认包含的文件类型',
            canPickMany: true
        });

        if (fileTypes) {
            const selectedTypes = fileTypes.map(ft => ft.label);
            await vscode.workspace.getConfiguration('yonbip').update('patchFileTypes', selectedTypes, true);
            vscode.window.showInformationMessage(`补丁文件类型已更新: ${selectedTypes.join(', ')}`);
        }
    }

    /**
     * 复制文件
     */
    private async copyFile(sourcePath: string, targetPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // 检查源文件是否存在
            if (!fs.existsSync(sourcePath)) {
                reject(new Error(`源文件不存在: ${sourcePath}`));
                return;
            }

            const readStream = fs.createReadStream(sourcePath);
            const writeStream = fs.createWriteStream(targetPath);

            readStream.on('error', (error: any) => {
                reject(error);
            });

            writeStream.on('error', (error: any) => {
                reject(error);
            });

            writeStream.on('close', () => {
                resolve();
            });

            readStream.pipe(writeStream);
        });
    }

    /**
     * 在指定目录下创建符合项目结构的目录
     */
    private async createProjectStructure(basePath: string): Promise<void> {
        try {
            // 创建build/classes目录
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');

            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }

            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }

            // 创建src目录结构
            // const srcPrivatePath = path.join(basePath, 'src', 'private');
            // const srcPublicPath = path.join(basePath, 'src', 'public');
            // const srcClientPath = path.join(basePath, 'src', 'client');
            // if (!fs.existsSync(srcPrivatePath)) {
            //     fs.mkdirSync(srcPrivatePath, { recursive: true });
            // }
            // if (!fs.existsSync(srcPublicPath)) {
            //     fs.mkdirSync(srcPublicPath, { recursive: true });
            // }
            // if (!fs.existsSync(srcClientPath)) {
            //     fs.mkdirSync(srcClientPath, { recursive: true });
            // }

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
     * 创建多模块项目结构（不包含META-INF和module.xml）
     */
    private async createMultiModuleProjectStructure(basePath: string): Promise<void> {
        try {
            // 创建build/classes目录
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');

            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }

            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }

            // 注意：不创建META-INF目录和module.xml文件
        } catch (error) {
            console.error('Failed to create multi-module project directories:', error);
            throw new Error(`创建多模块项目目录失败: ${error}`);
        }
    }

    /**
     * 检查是否为多模块项目
     */
    private isMultiModuleProject(projectPath: string): boolean {
        // 检查目录是否包含.project标记文件且不包含META-INF目录
        const markerFilePath = path.join(projectPath, '.project');
        const metaInfPath = path.join(projectPath, 'META-INF');

        return fs.existsSync(markerFilePath) && !fs.existsSync(metaInfPath);
    }

    /**
     * 检查是否为模块项目
     */
    private isModuleProject(projectPath: string): boolean {
        // 检查目录是否包含.project标记文件且包含META-INF目录
        const markerFilePath = path.join(projectPath, '.project');
        const metaInfPath = path.join(projectPath, 'META-INF');

        return fs.existsSync(markerFilePath) && fs.existsSync(metaInfPath);
    }

    /**
     * 创建模块项目结构（用于多模块项目下的模块）
     */
    private async createModuleProjectStructure(basePath: string): Promise<void> {
        try {
            // 创建build/classes目录
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');

            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }

            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }

            // 创建src目录结构
            const srcPrivatePath = path.join(basePath, 'src', 'private');
            const srcPublicPath = path.join(basePath, 'src', 'public');
            const srcClientPath = path.join(basePath, 'src', 'client');
            if (!fs.existsSync(srcPrivatePath)) {
                fs.mkdirSync(srcPrivatePath, { recursive: true });
            }
            if (!fs.existsSync(srcPublicPath)) {
                fs.mkdirSync(srcPublicPath, { recursive: true });
            }
            if (!fs.existsSync(srcClientPath)) {
                fs.mkdirSync(srcClientPath, { recursive: true });
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
            console.error('Failed to create module project directories:', error);
            throw new Error(`创建模块项目目录失败: ${error}`);
        }
    }

    /**
     * 获取项目服务实例
     */
    public getProjectService(): ProjectService {
        return this.projectService;
    }
}