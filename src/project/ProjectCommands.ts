import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as StreamZip from 'node-stream-zip';
import { ProjectService } from './ProjectService';
import { NCHomeConfigService } from './NCHomeConfigService';

/**
 * 项目相关命令类
 */
export class ProjectCommands {
    private projectService: ProjectService;
    private configService: NCHomeConfigService;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext, projectService: ProjectService) {
        this.projectService = projectService;
        this.configService = new NCHomeConfigService(context);
        this.context = context;
    }

    /**
     * 注册所有项目相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext, projectService: ProjectService): void {
        const projectCommands = new ProjectCommands(context, projectService);

        // 注册创建项目命令
        const createCommand = vscode.commands.registerCommand('yonbip.project.create', () => {
            projectCommands.createProject();
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
            exportPatchCommand,
            downloadScaffoldCommand
        );
    }

    /**
     * 创建项目
     */
    public async createProject(): Promise<void> {
        await this.projectService.createYonBipProject();
    }

    /**
     * 导出补丁
     */
    public async exportPatch(selectedPath?: string): Promise<void> {
        await this.projectService.exportPatch(selectedPath);
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

            // 显示进度条
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "下载YonBIP脚手架",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: "开始复制文件..." });

                // 获取HOME路径
                const config = this.configService.getConfig();
                const homePath = config.homePath;

                // 根据HOME版本选择对应的脚手架文件
                let scaffoldFileName = 'ncc-cli-v1903-v1909-v2005.zip'; // 默认脚手架文件

                if (homePath) {
                    // 获取HOME版本
                    const homeVersion = this.getHomeVersion(homePath);

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
     * 从setup.ini文件中获取HOME版本信息
     * @param homePath NC HOME路径
     * @returns 版本号，如果无法获取则返回null
     */
    private getHomeVersion(homePath: string): string | null {
        try {
            // 构建setup.ini文件路径
            const setupIniPath = path.join(homePath, 'ncscript', 'uapServer', 'setup.ini');

            // 检查文件是否存在
            if (!fs.existsSync(setupIniPath)) {
                return null;
            }

            // 读取文件内容
            const content = fs.readFileSync(setupIniPath, 'utf-8');

            // 解析版本信息
            // 查找version=开头的行
            const versionMatch = content.match(/^version\s*=\s*(.+)$/m);
            if (!versionMatch) {
                return null;
            }

            const versionLine = versionMatch[1];

            // 解析版本字符串 "YonBIP V3 (R2_2311_1 Premium) 20230830171835"
            // 提取其中的 "2311" 部分
            const versionPattern = /R2_(\d+)_\d+/;
            const versionParts = versionLine.match(versionPattern);

            if (versionParts && versionParts[1]) {
                const version = versionParts[1];
                return version;
            } else {
                return null;
            }
        } catch (error) {
            return null;
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
     * 获取项目服务实例
     */
    public getProjectService(): ProjectService {
        return this.projectService;
    }
}