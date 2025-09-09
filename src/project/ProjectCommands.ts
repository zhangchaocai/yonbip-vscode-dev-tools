import * as vscode from 'vscode';
import { ProjectService } from './ProjectService';
import { NCHomeConfigService } from './NCHomeConfigService';
import { NCHomeConfigCommands } from './NCHomeConfigCommands';
import { HomeCommands } from './HomeCommands';

/**
 * 项目相关命令类
 */
export class ProjectCommands {
    private projectService: ProjectService;
    private configService: NCHomeConfigService;
    private configCommands: NCHomeConfigCommands;

    constructor(context: vscode.ExtensionContext) {
        this.projectService = new ProjectService(context);
        this.configService = new NCHomeConfigService(context);
        this.configCommands = new NCHomeConfigCommands(context);
    }

    /**
     * 注册所有项目相关命令
     */
    public static registerCommands(context: vscode.ExtensionContext): void {
        const projectCommands = new ProjectCommands(context);

        // 注册创建项目命令
        const createCommand = vscode.commands.registerCommand('yonbip.project.create', () => {
            projectCommands.createProject();
        });

        // 注册导出补丁命令
        const exportPatchCommand = vscode.commands.registerCommand('yonbip.project.exportPatch', (uri: vscode.Uri) => {
            projectCommands.exportPatch(uri?.fsPath);
        });

        context.subscriptions.push(
            createCommand,
            exportPatchCommand
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
     * 获取项目服务实例
     */
    public getProjectService(): ProjectService {
        return this.projectService;
    }
}