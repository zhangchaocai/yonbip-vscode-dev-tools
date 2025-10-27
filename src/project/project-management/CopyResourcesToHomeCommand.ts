import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';

/**
 * 复制资源到HOME命令类
 */
export class CopyResourcesToHomeCommand {
    private configService: NCHomeConfigService;

    constructor(configService: NCHomeConfigService) {
        this.configService = configService;
    }

    /**
     * 注册复制资源到HOME命令
     */
    public static registerCommand(context: vscode.ExtensionContext, configService: NCHomeConfigService): void {
        const command = new CopyResourcesToHomeCommand(configService);
        
        const copyCommand = vscode.commands.registerCommand(
            'yonbip.project.copyResourcesToHome',
            async (uri: vscode.Uri) => {
                await command.copyResourcesToHome(uri);
            }
        );

        context.subscriptions.push(copyCommand);
    }

    /**
     * 复制资源到HOME目录
     */
    public async copyResourcesToHome(uri: vscode.Uri | undefined): Promise<void> {
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

            // 提前获取配置以避免变量作用域问题
            const config = this.configService.getConfig();
            const homePath = config.homePath;

            // 检查HOME路径配置
            if (!homePath) {
                vscode.window.showWarningMessage('请先配置NC HOME路径');
                return;
            }

            // 确认操作 - 使用平台相关的换行符
            const eol = os.EOL;
            const confirm = await vscode.window.showWarningMessage(
                `将复制项目资源到${eol}HOME目录：${homePath}${eol}源目录为：${selectedPath}${eol}是否继续？`,
                '继续',
                '取消'
            );

            if (confirm !== '继续') {
                return;
            }

            // 执行复制操作
            let copyInfo: { targetPaths: string[]; copiedFiles: string[] } = { targetPaths: [], copiedFiles: [] };
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在复制资源到HOME目录...',
                cancellable: false
            }, async () => {
                copyInfo = await this.copyResources(selectedPath, homePath);
            });

            // 显示复制完成信息，包括目标路径和复制的文件
            let message = '资源复制完成！';
            if (copyInfo.targetPaths.length > 0) {
                message += `\n目标路径: ${copyInfo.targetPaths.join(', ')}`;
            }
            if (copyInfo.copiedFiles.length > 0) {
                message += `\n复制的文件: ${copyInfo.copiedFiles.join(', ')}`;
            }
            if (copyInfo.copiedFiles.length > 0) {
                vscode.window.showInformationMessage(message);
            }
        } catch (error: any) {
            console.error('复制资源失败:', error);
            vscode.window.showErrorMessage(`复制资源失败: ${error.message}`);
        }
    }

    /**
     * 复制资源文件
     */
    private async copyResources(sourcePath: string, homePath: string): Promise<{ targetPaths: string[]; copiedFiles: string[] }> {
        const targetPaths: string[] = [];
        const copiedFiles: string[] = [];
        
        // 查找选中文件夹下的META-INF目录
        const metaInfPaths = this.findMetaInfPaths(sourcePath);
        
        if (metaInfPaths.length === 0) {
            vscode.window.showWarningMessage('未找到META-INF目录');
            return { targetPaths, copiedFiles };
        }

        // 复制每个META-INF目录到HOME的对应模块目录
        for (const metaInfPath of metaInfPaths) {
            // 获取模块名称（从META-INF同级目录下的module.xml获取）
            const projectPath = path.dirname(metaInfPath); // META-INF的父目录
            const moduleInfo = this.getModuleNameFromModuleXml(projectPath);
            
            if (moduleInfo) {
                const targetPath = path.join(homePath, 'modules', moduleInfo.name, 'META-INF');
                targetPaths.push(targetPath);
                
                // 确保目标META-INF目录存在
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                
                // 仅复制META-INF下的.rest和.upm文件
                const files = fs.readdirSync(metaInfPath);
                for (const file of files) {
                    if (file.endsWith('.rest') || file.endsWith('.upm')) {
                        const sourceFilePath = path.join(metaInfPath, file);
                        const targetFilePath = path.join(targetPath, file);
                        fs.copyFileSync(sourceFilePath, targetFilePath);
                        copiedFiles.push(file);
                    }
                }
            } else {
                vscode.window.showWarningMessage(`在 ${projectPath} 中未找到有效的module.xml文件`);
            }
        }

        // 查找项目中的yyconfig目录并复制到HOME的hotwebs/nccloud/WEB-INF/extend/yyconfig目录
        const yyconfigPaths = this.findYyconfigPaths(sourcePath);
        for (const yyconfigPath of yyconfigPaths) {
            const targetPath = path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF', 'extend', 'yyconfig');
            targetPaths.push(targetPath);
            // 收集复制的文件信息
            const files = this.collectFilesInDirectory(yyconfigPath);
            copiedFiles.push(...files.map(file => path.basename(file)));
            await this.copyDirectory(yyconfigPath, targetPath);
        }
        
        return { targetPaths, copiedFiles };
    }

    /**
     * 查找选中文件夹下的META-INF目录
     */
    private findMetaInfPaths(selectedPath: string): string[] {
        const metaInfPaths: string[] = [];
        
        // 检查选中路径下是否有META-INF目录
        const metaInfDir = path.join(selectedPath, 'META-INF');
        if (fs.existsSync(metaInfDir) && fs.statSync(metaInfDir).isDirectory()) {
            metaInfPaths.push(metaInfDir);
        }
        
        // 无论是否在当前目录找到META-INF，都继续递归查找子目录中的META-INF（最多5层）
        if (fs.existsSync(selectedPath) && fs.statSync(selectedPath).isDirectory()) {
            this.findMetaInfInSubdirectoriesWithDepth(selectedPath, metaInfPaths, 5);
        }
        
        return metaInfPaths;
    }

    /**
     * 递归查找子目录中的META-INF目录，限制最大深度
     */
    private findMetaInfInSubdirectoriesWithDepth(dirPath: string, metaInfPaths: string[], maxDepth: number): void {
        if (maxDepth <= 0) {
            return;
        }
        
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                // 跳过一些不需要递归的目录
                if (item === 'node_modules' || item === '.git' || item === 'target') {
                    continue;
                }
                
                if (fs.statSync(fullPath).isDirectory()) {
                    const metaInfDir = path.join(fullPath, 'META-INF');
                    if (fs.existsSync(metaInfDir) && fs.statSync(metaInfDir).isDirectory()) {
                        metaInfPaths.push(metaInfDir);
                    } else {
                        // 继续递归查找，深度减1
                        this.findMetaInfInSubdirectoriesWithDepth(fullPath, metaInfPaths, maxDepth - 1);
                    }
                }
            }
        } catch (error) {
            // 忽略无法访问的目录
            console.warn(`无法访问目录: ${dirPath}`, error);
        }
    }

    /**
     * 查找项目中的yyconfig目录
     */
    private findYyconfigPaths(projectPath: string): string[] {
        const yyconfigPaths: string[] = [];
        this.findYyconfigRecursively(projectPath, yyconfigPaths);
        return yyconfigPaths;
    }

    /**
     * 递归查找yyconfig目录
     */
    private findYyconfigRecursively(dirPath: string, yyconfigPaths: string[]): void {
        // 检查当前目录下是否有yyconfig目录
        const yyconfigDir = path.join(dirPath, 'src', 'client', 'yyconfig');
        if (fs.existsSync(yyconfigDir) && fs.statSync(yyconfigDir).isDirectory()) {
            yyconfigPaths.push(yyconfigDir);
        }

        // 递归检查子目录
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                // 跳过一些不需要递归的目录
                if (item === 'node_modules' || item === '.git' || item === 'target') {
                    continue;
                }
                if (fs.statSync(fullPath).isDirectory()) {
                    this.findYyconfigRecursively(fullPath, yyconfigPaths);
                }
            }
        } catch (error) {
            // 忽略无法访问的目录
        }
    }

    /**
     * 从module.xml获取模块名称
     */
    private getModuleNameFromModuleXml(projectPath: string): { name: string } | null {
        // 首先尝试在当前目录的META-INF中查找module.xml
        let moduleXmlPath = path.join(projectPath, 'META-INF', 'module.xml');
        if (fs.existsSync(moduleXmlPath)) {
            return this.parseModuleXml(moduleXmlPath);
        }

        // 向下递归查找，最多5层
        let currentPaths: string[] = [projectPath];
        for (let i = 0; i < 5; i++) {
            const nextLevelPaths: string[] = [];
            for (const currentPath of currentPaths) {
                const subDirs = this.getSubDirectories(currentPath);
                for (const subDir of subDirs) {
                    const subModuleXmlPath = path.join(subDir, 'META-INF', 'module.xml');
                    if (fs.existsSync(subModuleXmlPath)) {
                        return this.parseModuleXml(subModuleXmlPath);
                    }
                    nextLevelPaths.push(subDir);
                }
            }
            currentPaths = nextLevelPaths;
            if (currentPaths.length === 0) {
                break;
            }
        }

        // 向上递归查找，最多5层
        let parentPath = projectPath;
        for (let i = 0; i < 5; i++) {
            parentPath = path.dirname(parentPath);
            if (parentPath === projectPath) {
                break; // 防止无限循环
            }
            
            const parentModuleXmlPath = path.join(parentPath, 'META-INF', 'module.xml');
            if (fs.existsSync(parentModuleXmlPath)) {
                return this.parseModuleXml(parentModuleXmlPath);
            }
        }

        return null;
    }

    /**
     * 解析module.xml文件获取模块名称
     */
    private parseModuleXml(moduleXmlPath: string): { name: string } | null {
        try {
            const content = fs.readFileSync(moduleXmlPath, 'utf-8');
            // 简单解析XML获取name属性
            const nameMatch = content.match(/<module[^>]*name=["']([^"']*)["']/);
            if (nameMatch && nameMatch[1]) {
                return { name: nameMatch[1] };
            }
        } catch (error) {
            // 忽略解析错误
        }
        return null;
    }

    /**
     * 获取指定目录下的所有子目录
     */
    private getSubDirectories(dirPath: string): string[] {
        const subDirs: string[] = [];
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                // 跳过一些不需要递归的目录
                if (item === 'node_modules' || item === '.git' || item === 'target') {
                    continue;
                }
                
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    subDirs.push(fullPath);
                }
            }
        } catch (error) {
            // 忽略无法访问的目录
            console.warn(`无法访问目录: ${dirPath}`, error);
        }
        return subDirs;
    }

    /**
     * 获取指定目录下所有层级的子目录（用于向下递归查找）
     */
    private getAllSubDirectories(dirPath: string): string[] {
        const allSubDirs: string[] = [];
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                // 跳过一些不需要递归的目录
                if (item === 'node_modules' || item === '.git' || item === 'target') {
                    continue;
                }
                
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    allSubDirs.push(fullPath);
                    // 递归获取更深层的子目录
                    allSubDirs.push(...this.getAllSubDirectories(fullPath));
                }
            }
        } catch (error) {
            // 忽略无法访问的目录
            console.warn(`无法访问目录: ${dirPath}`, error);
        }
        return allSubDirs;
    }

    /**
     * 复制目录
     */
    private async copyDirectory(sourceDir: string, targetDir: string): Promise<void> {
        // 确保目标目录存在
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // 递归复制目录内容
        this.copyDirectoryRecursive(sourceDir, targetDir);
    }

    /**
     * 递归复制目录内容
     */
    private copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
        if (!fs.existsSync(sourceDir)) {
            return;
        }

        const items = fs.readdirSync(sourceDir);
        for (const item of items) {
            const sourcePath = path.join(sourceDir, item);
            const targetPath = path.join(targetDir, item);

            const stat = fs.statSync(sourcePath);
            if (stat.isDirectory()) {
                // 递归复制子目录
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                this.copyDirectoryRecursive(sourcePath, targetPath);
            } else {
                // 复制文件
                fs.copyFileSync(sourcePath, targetPath);
            }
        }
    }

    /**
     * 收集目录中的所有文件
     */
    private collectFilesInDirectory(dirPath: string): string[] {
        const files: string[] = [];
        
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                const stat = fs.statSync(fullPath);
                
                if (stat.isDirectory()) {
                    files.push(...this.collectFilesInDirectory(fullPath));
                } else {
                    files.push(fullPath);
                }
            }
        } catch (error) {
            console.warn(`无法访问目录: ${dirPath}`, error);
        }
        
        return files;
    }
}