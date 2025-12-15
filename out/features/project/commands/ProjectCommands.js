"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectCommands = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const https = __importStar(require("https"));
const StreamZip = __importStar(require("node-stream-zip"));
const LibraryService_1 = require("../../library/service/LibraryService");
const HomeVersionUtils_1 = require("../../../shared/utils/HomeVersionUtils");
const CopyResourcesToHomeCommand_1 = require("./CopyResourcesToHomeCommand");
const PatchToHomeCommand_1 = require("./PatchToHomeCommand");
class ProjectCommands {
    projectService;
    configService;
    context;
    constructor(context, projectService, configService) {
        this.projectService = projectService;
        this.configService = configService;
        this.context = context;
    }
    static registerCommands(context, projectService, configService) {
        const projectCommands = new ProjectCommands(context, projectService, configService);
        const createCommand = vscode.commands.registerCommand('yonbip.project.create', (uri) => {
            projectCommands.createProject(uri?.fsPath);
        });
        const createMultiModuleCommand = vscode.commands.registerCommand('yonbip.project.createMultiModule', (uri) => {
            projectCommands.createMultiModuleProject(uri?.fsPath);
        });
        const createComponentCommand = vscode.commands.registerCommand('yonbip.project.createComponent', (uri) => {
            projectCommands.createComponent(uri?.fsPath);
        });
        const exportPatchCommand = vscode.commands.registerCommand('yonbip.project.exportPatch', async (...args) => {
            const selectedPaths = [];
            if (args && args.length > 0) {
                args.forEach(arg => {
                    if (arg instanceof vscode.Uri) {
                        selectedPaths.push(arg.fsPath);
                    }
                    else if (Array.isArray(arg)) {
                        arg.forEach(uri => {
                            if (uri instanceof vscode.Uri) {
                                selectedPaths.push(uri.fsPath);
                            }
                        });
                    }
                    else if (arg && typeof arg === 'object' && arg.fsPath) {
                        selectedPaths.push(arg.fsPath);
                    }
                });
            }
            const uniqueSelectedPaths = [...new Set(selectedPaths)];
            console.log('选中的路径:', uniqueSelectedPaths);
            if (uniqueSelectedPaths.length > 0) {
                if (uniqueSelectedPaths.length === 1) {
                    projectCommands.exportPatch(uniqueSelectedPaths[0]);
                }
                else {
                    projectCommands.context.workspaceState.update('selectedExportPaths', uniqueSelectedPaths);
                    projectCommands.context.workspaceState.update('selectedExportPath', undefined);
                    projectCommands.exportPatch(undefined);
                }
            }
            else {
                projectCommands.exportPatch(undefined);
            }
        });
        const exportPrecastScriptCommand = vscode.commands.registerCommand('yonbip.project.exportPrecastScript', async (...args) => {
            const selectedPaths = [];
            if (args && args.length > 0) {
                args.forEach(arg => {
                    if (arg instanceof vscode.Uri) {
                        selectedPaths.push(arg.fsPath);
                    }
                    else if (Array.isArray(arg)) {
                        arg.forEach(uri => {
                            if (uri instanceof vscode.Uri) {
                                selectedPaths.push(uri.fsPath);
                            }
                        });
                    }
                    else if (arg && typeof arg === 'object' && arg.fsPath) {
                        selectedPaths.push(arg.fsPath);
                    }
                });
            }
            const uniqueSelectedPaths = [...new Set(selectedPaths)];
            if (uniqueSelectedPaths.length === 1) {
                const p = uniqueSelectedPaths[0];
                try {
                    const stat = fs.existsSync(p) ? fs.statSync(p) : undefined;
                    const name = path.basename(p).toLowerCase();
                    if (!stat || !stat.isFile() || (name !== 'item.xml' && name !== 'items.xml')) {
                        vscode.window.showWarningMessage('请右键选择 item.xml 文件后再导出');
                        return;
                    }
                    projectCommands.exportPrecastScript(p);
                }
                catch {
                    vscode.window.showWarningMessage('请选择一个有效的 item.xml 文件');
                }
            }
            else {
                vscode.window.showWarningMessage('请只选择一个 item.xml 文件');
            }
        });
        const downloadScaffoldCommand = vscode.commands.registerCommand('yonbip.scaffold.download', (uri) => {
            projectCommands.downloadScaffold(uri?.fsPath);
        });
        CopyResourcesToHomeCommand_1.CopyResourcesToHomeCommand.registerCommand(context, configService);
        PatchToHomeCommand_1.PatchToHomeCommand.registerCommands(context, configService);
        context.subscriptions.push(createCommand, createMultiModuleCommand, createComponentCommand, exportPatchCommand, downloadScaffoldCommand, exportPrecastScriptCommand);
    }
    async createProject(projectPath) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('请先打开一个工作区文件夹');
            return;
        }
        const workspacePath = workspaceFolder.uri.fsPath;
        let parentPath = workspacePath;
        if (projectPath) {
            try {
                const stat = fs.statSync(projectPath);
                if (stat.isDirectory()) {
                    parentPath = projectPath;
                }
            }
            catch (error) {
                parentPath = workspacePath;
            }
        }
        const isMultiModuleProject = this.isMultiModuleProject(parentPath);
        const isModuleProject = this.isModuleProject(parentPath);
        const isInMultiModuleRoot = this.isMultiModuleProject(workspacePath) && parentPath === workspacePath;
        if (isModuleProject) {
            vscode.window.showErrorMessage('模块项目下不允许再创建项目');
            return;
        }
        const folderName = await vscode.window.showInputBox({
            prompt: isMultiModuleProject || isInMultiModuleRoot ? '请输入要创建的模块项目文件夹名称' : '请输入要创建的项目文件夹名称',
            value: isMultiModuleProject || isInMultiModuleRoot ? 'new-yonbip-module' : 'new-yonbip-project',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '文件夹名称不能为空';
                }
                if (/[<>:"/\\|?*\x00-\x1F]/.test(value)) {
                    return '文件夹名称包含非法字符';
                }
                const targetPath = path.join(parentPath, value.trim());
                if (fs.existsSync(targetPath)) {
                    return '该文件夹已存在，请输入其他名称';
                }
                return null;
            }
        });
        if (!folderName) {
            return;
        }
        const selectedPath = path.join(parentPath, folderName.trim());
        const confirm = await vscode.window.showWarningMessage(isMultiModuleProject || isInMultiModuleRoot ?
            `将在多模块项目下创建模块项目文件夹：${folderName}\n\n完整路径：${selectedPath}\n这将创建build/classes目录并初始化Java项目库。是否继续？` :
            `将在以下目录创建项目文件夹：${folderName}\n\n完整路径：${selectedPath}\n这将创建build/classes目录并初始化Java项目库。是否继续？`, '继续', '取消');
        if (confirm !== '继续') {
            return;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: isMultiModuleProject || isInMultiModuleRoot ? '正在创建模块项目目录...' : '正在创建项目目录...',
                cancellable: false
            }, async () => {
                if (isMultiModuleProject || isInMultiModuleRoot) {
                    await this.createModuleProjectStructure(selectedPath);
                }
                else {
                    await this.createProjectStructure(selectedPath);
                }
            });
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            const homePath = config.homePath;
            if (!homePath) {
                const result = await vscode.window.showInformationMessage('未配置HOME路径，是否现在配置？', '是', '否');
                if (result === '是') {
                    await vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                    return;
                }
                else {
                    vscode.window.showWarningMessage('请先配置NC HOME路径');
                    return;
                }
            }
            const libraryService = new LibraryService_1.LibraryService(this.context, this.configService);
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                await libraryService.initLibrary(homePath, false, undefined, selectedPath);
            });
            vscode.window.showInformationMessage(isMultiModuleProject || isInMultiModuleRoot ?
                `YonBIP模块项目 "${folderName}" 创建完成！` :
                `YonBIP项目 "${folderName}" 创建完成！`);
            const createComponentChoice = await vscode.window.showInformationMessage(`是否需要在模块项目 "${folderName}" 中创建业务组件？`, '创建业务组件', '稍后手动创建');
            if (createComponentChoice === '创建业务组件') {
                await vscode.commands.executeCommand('yonbip.project.createComponent', vscode.Uri.file(selectedPath));
            }
        }
        catch (error) {
            console.error('项目初始化失败:', error);
            vscode.window.showErrorMessage(`项目初始化失败: ${error.message}`);
        }
    }
    async createMultiModuleProject(projectPath) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('请先打开一个工作区文件夹');
            return;
        }
        const workspacePath = workspaceFolder.uri.fsPath;
        if (projectPath && projectPath !== workspacePath) {
            vscode.window.showErrorMessage('多模块项目只能创建到工作区根目录下');
            return;
        }
        const folderName = await vscode.window.showInputBox({
            prompt: '请输入要创建的多模块项目文件夹名称',
            value: 'new-yonbip-multimodule-project',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '文件夹名称不能为空';
                }
                if (/[<>:"/\\|?*\x00-\x1F]/.test(value)) {
                    return '文件夹名称包含非法字符';
                }
                const targetPath = path.join(workspacePath, value.trim());
                if (fs.existsSync(targetPath)) {
                    return '该文件夹已存在，请输入其他名称';
                }
                return null;
            }
        });
        if (!folderName) {
            return;
        }
        const selectedPath = path.join(workspacePath, folderName.trim());
        const confirm = await vscode.window.showWarningMessage(`将在工作区下创建多模块项目文件夹：${folderName}\n\n完整路径：${selectedPath}\n这将创建build/classes目录。是否继续？`, '继续', '取消');
        if (confirm !== '继续') {
            return;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在创建多模块项目目录...',
                cancellable: false
            }, async () => {
                await this.createMultiModuleProjectStructure(selectedPath);
            });
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            const homePath = config.homePath;
            if (!homePath) {
                const result = await vscode.window.showInformationMessage('未配置HOME路径，是否现在配置？', '是', '否');
                if (result === '是') {
                    await vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                    return;
                }
                else {
                    vscode.window.showWarningMessage('请先配置NC HOME路径');
                    return;
                }
            }
            const libraryService = new LibraryService_1.LibraryService(this.context, this.configService);
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在初始化Java项目库...',
                cancellable: false
            }, async () => {
                await libraryService.initLibrary(homePath, false, undefined, selectedPath);
            });
            vscode.window.showInformationMessage(`YonBIP多模块项目 "${folderName}" 创建完成！`);
            const createComponentChoice = await vscode.window.showInformationMessage(`是否需要在多模块项目 "${folderName}" 中创建业务组件？`, '创建业务组件', '稍后手动创建');
            if (createComponentChoice === '创建业务组件') {
                await vscode.commands.executeCommand('yonbip.project.createComponent', vscode.Uri.file(selectedPath));
            }
        }
        catch (error) {
            console.error('多模块项目初始化失败:', error);
            vscode.window.showErrorMessage(`多模块项目初始化失败: ${error.message}`);
        }
    }
    async createComponent(componentPath) {
        let selectedPath;
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
        }
        else {
            selectedPath = componentPath;
        }
        const markerFilePath = path.join(selectedPath, '.project');
        if (!fs.existsSync(markerFilePath)) {
            vscode.window.showErrorMessage('只有已初始化的YonBIP项目目录才能创建业务组件。请先使用"🚀 YONBIP 工程初始化"命令初始化项目。');
            return;
        }
        this.configService.reloadConfig();
        const config = this.configService.getConfig();
        if (!config.homePath) {
            vscode.window.showWarningMessage('请先配置NC HOME路径');
            return;
        }
        const componentName = await vscode.window.showInputBox({
            prompt: '请输入业务组件名称',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '业务组件名称不能为空';
                }
                if (/[<>:"/\\|?*\x00-\x1F]/.test(value)) {
                    return '业务组件名称包含非法字符';
                }
                const targetPath = path.join(selectedPath, value.trim());
                if (fs.existsSync(targetPath)) {
                    return '该业务组件已存在，请输入其他名称';
                }
                return null;
            }
        });
        if (!componentName) {
            return;
        }
        const targetPath = path.join(selectedPath, componentName.trim());
        const confirm = await vscode.window.showWarningMessage(`将在以下目录创建业务组件：${targetPath}\n\n是否继续？`, '继续', '取消');
        if (confirm !== '继续') {
            return;
        }
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在创建业务组件目录...',
                cancellable: false
            }, async () => {
                await this.createComponentStructure(targetPath, componentName.trim());
            });
            vscode.window.showInformationMessage(`业务组件 "${componentName}" 创建完成！`);
        }
        catch (error) {
            console.error('创建业务组件失败:', error);
            vscode.window.showErrorMessage(`创建业务组件失败: ${error.message}`);
        }
    }
    async createComponentStructure(componentPath, componentName) {
        try {
            fs.mkdirSync(componentPath, { recursive: true });
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
            const publicPath = path.join(srcPath, 'public');
            const privatePath = path.join(srcPath, 'private');
            const clientPath = path.join(srcPath, 'client');
            fs.mkdirSync(publicPath, { recursive: true });
            fs.mkdirSync(privatePath, { recursive: true });
            fs.mkdirSync(clientPath, { recursive: true });
            const componentXmlPath = path.join(componentPath, 'component.xml');
            const componentXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<module name="${componentName}" displayname="${componentName}">
    <dependencies>
    </dependencies>
</module>`;
            fs.writeFileSync(componentXmlPath, componentXmlContent, 'utf-8');
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
        }
        catch (error) {
            console.error('创建业务组件目录结构失败:', error);
            throw new Error(`创建业务组件目录结构失败: ${error}`);
        }
    }
    async exportPatch(selectedPath) {
        this.configService.reloadConfig();
        const config = this.configService.getConfig();
        if (!config.homePath) {
            vscode.window.showWarningMessage('请先配置NC HOME路径');
            return;
        }
        if (selectedPath) {
            this.context.workspaceState.update('selectedExportPath', selectedPath);
            this.context.workspaceState.update('selectedExportPaths', undefined);
        }
        else {
        }
        await vscode.commands.executeCommand('yonbip.patchExportConfig.focus');
        setTimeout(() => {
            vscode.commands.executeCommand('yonbip.patchExportConfig.refresh');
        }, 500);
    }
    async downloadScaffold(selectedPath) {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('请先打开一个工作空间');
                return;
            }
            const targetPath = selectedPath || workspaceFolder.uri.fsPath;
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showWarningMessage('请先配置NC HOME路径');
                return;
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "下载YonBIP脚手架",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: "开始复制文件..." });
                const homePath = config.homePath;
                let scaffoldFileName = 'ncc-cli-v1903-v1909-v2005.zip';
                if (homePath) {
                    const homeVersion = (0, HomeVersionUtils_1.getHomeVersion)(homePath);
                    if (homeVersion) {
                        const versionNum = parseInt(homeVersion, 10);
                        if (!isNaN(versionNum)) {
                            if (versionNum >= 2105) {
                                scaffoldFileName = 'ncc-cli-v2105-vlatest.zip';
                            }
                            else if (versionNum < 2015) {
                                scaffoldFileName = 'ncc-cli-v1903-v1909-v2005.zip';
                            }
                            else {
                                scaffoldFileName = 'ncc-cli-v1903-v1909-v2005.zip';
                            }
                        }
                    }
                }
                const extensionPath = this.context.extensionPath;
                const sourceZipPath = path.join(extensionPath, 'resources', 'ncc-front', scaffoldFileName);
                const zipFilePath = path.join(targetPath, 'ncc-cli-scaffold.zip');
                progress.report({ increment: 30, message: `正在复制压缩包: ${scaffoldFileName}...` });
                await this.copyFile(sourceZipPath, zipFilePath);
                progress.report({ increment: 60, message: "正在解压文件..." });
                await this.extractZip(zipFilePath, targetPath);
                progress.report({ increment: 90, message: "清理临时文件..." });
                if (fs.existsSync(zipFilePath)) {
                    fs.unlinkSync(zipFilePath);
                }
                progress.report({ increment: 100, message: "完成!" });
            });
            vscode.window.showInformationMessage('YonBIP脚手架下载完成！');
        }
        catch (error) {
            console.error('下载脚手架失败:', error);
            vscode.window.showErrorMessage(`下载脚手架失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }
    async downloadFile(url, filePath) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(filePath);
            https.get(url, (response) => {
                if (response.statusCode === 200) {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }
                else if (response.statusCode === 302 || response.statusCode === 301) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        this.downloadFile(redirectUrl, filePath).then(resolve).catch(reject);
                    }
                    else {
                        reject(new Error('重定向但没有提供新的URL'));
                    }
                }
                else {
                    reject(new Error(`下载失败，状态码: ${response.statusCode}`));
                }
            }).on('error', (error) => {
                fs.unlink(filePath, () => { });
                reject(error);
            });
        });
    }
    async extractZip(zipFilePath, extractPath) {
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
    async openNCHomeConfig() {
        try {
            await vscode.commands.executeCommand('yonbip.nchome.config');
        }
        catch (error) {
            vscode.window.showErrorMessage(`打开NC Home配置失败: ${error.message}`);
        }
    }
    async configureProject() {
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
    async showProjectStructure() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('请先打开一个工作区');
            return;
        }
        try {
            const structure = await this.analyzeProjectStructure(workspaceFolder.uri.fsPath);
            const document = await vscode.workspace.openTextDocument({
                content: structure,
                language: 'text'
            });
            await vscode.window.showTextDocument(document);
        }
        catch (error) {
            vscode.window.showErrorMessage(`分析项目结构失败: ${error.message}`);
        }
    }
    async analyzeProjectStructure(projectPath) {
        const fs = require('fs');
        const path = require('path');
        const result = [];
        result.push(`项目结构分析`);
        result.push(`项目路径: ${projectPath}`);
        result.push(`分析时间: ${new Date().toLocaleString()}`);
        result.push('');
        const analyzeDirectory = (dirPath, level = 0) => {
            if (level > 5)
                return;
            try {
                const items = fs.readdirSync(dirPath);
                const indent = '  '.repeat(level);
                for (const item of items) {
                    if (item.startsWith('.') || item === 'node_modules' || item === 'target') {
                        continue;
                    }
                    const fullPath = path.join(dirPath, item);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        result.push(`${indent}📁 ${item}/`);
                        analyzeDirectory(fullPath, level + 1);
                    }
                    else {
                        const ext = path.extname(item).toLowerCase();
                        const icon = this.getFileIcon(ext);
                        const size = this.formatFileSize(stat.size);
                        result.push(`${indent}${icon} ${item} (${size})`);
                    }
                }
            }
            catch (error) {
                const indent = '  '.repeat(level);
                result.push(`${indent}❌ 无法读取目录: ${error}`);
            }
        };
        analyzeDirectory(projectPath);
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
    getFileIcon(extension) {
        const iconMap = {
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
    formatFileSize(bytes) {
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    getProjectStats(projectPath) {
        const fs = require('fs');
        const path = require('path');
        const stats = {
            fileCount: 0,
            dirCount: 0,
            javaFiles: 0,
            xmlFiles: 0,
            totalSize: 0
        };
        const scanDirectory = (dirPath) => {
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
                    }
                    else {
                        stats.fileCount++;
                        stats.totalSize += stat.size;
                        const ext = path.extname(item).toLowerCase();
                        if (ext === '.java')
                            stats.javaFiles++;
                        if (ext === '.xml')
                            stats.xmlFiles++;
                    }
                }
            }
            catch (error) {
            }
        };
        scanDirectory(projectPath);
        return stats;
    }
    async showProjectSettings() {
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
    async configureDefaultProjectType() {
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
    async configureDefaultAuthor() {
        const author = await vscode.window.showInputBox({
            prompt: '请输入默认作者名称',
            value: vscode.workspace.getConfiguration('yonbip').get('defaultAuthor') || process.env.USER || 'Developer'
        });
        if (author) {
            await vscode.workspace.getConfiguration('yonbip').update('defaultAuthor', author, true);
            vscode.window.showInformationMessage(`默认作者已设置为: ${author}`);
        }
    }
    async configurePatchOutputDir() {
        const dir = await vscode.window.showInputBox({
            prompt: '请输入补丁输出目录路径',
            value: vscode.workspace.getConfiguration('yonbip').get('patchOutputDir') || './patches'
        });
        if (dir) {
            await vscode.workspace.getConfiguration('yonbip').update('patchOutputDir', dir, true);
            vscode.window.showInformationMessage(`补丁输出目录已设置为: ${dir}`);
        }
    }
    async configurePatchFileTypes() {
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
    async copyFile(sourcePath, targetPath) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(sourcePath)) {
                reject(new Error(`源文件不存在: ${sourcePath}`));
                return;
            }
            const readStream = fs.createReadStream(sourcePath);
            const writeStream = fs.createWriteStream(targetPath);
            readStream.on('error', (error) => {
                reject(error);
            });
            writeStream.on('error', (error) => {
                reject(error);
            });
            writeStream.on('close', () => {
                resolve();
            });
            readStream.pipe(writeStream);
        });
    }
    async createProjectStructure(basePath) {
        try {
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');
            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }
            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }
            const metaInfPath = path.join(basePath, 'META-INF');
            if (!fs.existsSync(metaInfPath)) {
                fs.mkdirSync(metaInfPath, { recursive: true });
            }
            const dirName = path.basename(basePath);
            const moduleXmlPath = path.join(metaInfPath, 'module.xml');
            if (!fs.existsSync(moduleXmlPath)) {
                const moduleXmlContent = `<?xml version="1.0" encoding="gb2312"?>
<module name="${dirName}">
    <public></public>
    <private></private>
</module>`;
                fs.writeFileSync(moduleXmlPath, moduleXmlContent, 'utf-8');
            }
        }
        catch (error) {
            console.error('Failed to create project directories:', error);
            throw new Error(`创建目录失败: ${error}`);
        }
    }
    async createMultiModuleProjectStructure(basePath) {
        try {
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');
            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }
            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }
        }
        catch (error) {
            console.error('Failed to create multi-module project directories:', error);
            throw new Error(`创建多模块项目目录失败: ${error}`);
        }
    }
    isMultiModuleProject(projectPath) {
        const markerFilePath = path.join(projectPath, '.project');
        const metaInfPath = path.join(projectPath, 'META-INF');
        return fs.existsSync(markerFilePath) && !fs.existsSync(metaInfPath);
    }
    isModuleProject(projectPath) {
        const markerFilePath = path.join(projectPath, '.project');
        const metaInfPath = path.join(projectPath, 'META-INF');
        return fs.existsSync(markerFilePath) && fs.existsSync(metaInfPath);
    }
    async createModuleProjectStructure(basePath) {
        try {
            const buildPath = path.join(basePath, 'build');
            const classesPath = path.join(buildPath, 'classes');
            if (!fs.existsSync(buildPath)) {
                fs.mkdirSync(buildPath, { recursive: true });
            }
            if (!fs.existsSync(classesPath)) {
                fs.mkdirSync(classesPath, { recursive: true });
            }
            const metaInfPath = path.join(basePath, 'META-INF');
            if (!fs.existsSync(metaInfPath)) {
                fs.mkdirSync(metaInfPath, { recursive: true });
            }
            const dirName = path.basename(basePath);
            const moduleXmlPath = path.join(metaInfPath, 'module.xml');
            if (!fs.existsSync(moduleXmlPath)) {
                const moduleXmlContent = `<?xml version="1.0" encoding="gb2312"?>
<module name="${dirName}">
    <public></public>
    <private></private>
</module>`;
                fs.writeFileSync(moduleXmlPath, moduleXmlContent, 'utf-8');
            }
        }
        catch (error) {
            console.error('Failed to create module project directories:', error);
            throw new Error(`创建模块项目目录失败: ${error}`);
        }
    }
    getProjectService() {
        return this.projectService;
    }
    async exportPrecastScript(selectedPath) {
        this.configService.reloadConfig();
        const config = this.configService.getConfig();
        if (!config.homePath) {
            vscode.window.showWarningMessage('请先配置NC HOME路径');
            return;
        }
        if (!selectedPath) {
            vscode.window.showWarningMessage('请右键选择 item.xml 文件后再导出');
            return;
        }
        try {
            const stat = fs.existsSync(selectedPath) ? fs.statSync(selectedPath) : undefined;
            const name = path.basename(selectedPath).toLowerCase();
            if (!stat || !stat.isFile() || (name !== 'item.xml' && name !== 'items.xml')) {
                vscode.window.showWarningMessage('请选择一个有效的 item.xml 文件');
                return;
            }
        }
        catch {
            vscode.window.showWarningMessage('请选择一个有效的 item.xml 文件');
            return;
        }
        this.context.workspaceState.update('selectedPrecastPath', selectedPath);
        await vscode.commands.executeCommand('yonbip.precastExportConfig.focus');
        setTimeout(() => {
            vscode.commands.executeCommand('yonbip.precastExportConfig.refresh');
        }, 500);
    }
}
exports.ProjectCommands = ProjectCommands;
//# sourceMappingURL=ProjectCommands.js.map