import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

/**
 * Classpath管理服务
 * 负责处理.classpath文件的读取、修改和源码路径的管理
 */
export class ClasspathService {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('YonBIP Classpath');
    }

    /**
     * 添加所有源码路径到.classpath文件
     * @param selectedPath 选中的目录路径
     */
    public async addAllSourcePaths(selectedPath: string): Promise<void> {
        try {
            // 1. 校验选中目录是否包含.classpath文件或其上级目录包含
            const classpathFile = this.findClasspathFile(selectedPath);
            if (!classpathFile) {
                vscode.window.showErrorMessage('未找到.classpath文件，请确保选中的目录是包含.classpath文件的项目目录');
                return;
            }

            this.outputChannel.appendLine(`找到.classpath文件: ${classpathFile}`);
            const projectRoot = path.dirname(classpathFile);

            // 2. 递归扫描目录，查找符合条件的源码路径
            const sourcePaths = this.scanForSourcePaths(selectedPath);
            if (sourcePaths.length === 0) {
                vscode.window.showInformationMessage('未找到符合条件的源码目录（src/client、src/public、src/private）');
                return;
            }

            this.outputChannel.appendLine(`找到 ${sourcePaths.length} 个源码路径:`);
            sourcePaths.forEach(p => this.outputChannel.appendLine(`  - ${p}`));

            // 3. 读取并解析.classpath文件
            const classpathContent = await this.readClasspathFile(classpathFile);
            
            // 4. 添加新的源码路径到.classpath
            const updatedContent = await this.addSourcePathsToClasspath(classpathContent, sourcePaths, projectRoot);
            
            // 5. 写回.classpath文件
            await this.writeClasspathFile(classpathFile, updatedContent);

            vscode.window.showInformationMessage(`成功添加 ${sourcePaths.length} 个源码路径到.classpath文件`);
            this.outputChannel.show();

        } catch (error: any) {
            this.outputChannel.appendLine(`添加源码路径失败: ${error.message}`);
            vscode.window.showErrorMessage(`添加源码路径失败: ${error.message}`);
        }
    }

    /**
     * 查找.classpath文件
     * 只检查当前选中目录的直接子目录中是否有.classpath文件
     */
    private findClasspathFile(selectedPath: string): string | null {
        try {
            // 只检查选中目录的直接子目录
            const items = fs.readdirSync(selectedPath, { withFileTypes: true });
            for (const item of items) {
                if (!item.isDirectory() && item.name === '.classpath') {
                    const classpathFile = path.join(selectedPath, '.classpath');
                    if (fs.existsSync(classpathFile)) {
                        return classpathFile;
                    }
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`检查目录时出错: ${error}`);
        }
        
        return null;
    }

    /**
     * 递归扫描目录，查找符合条件的源码路径
     * 查找模式: [path]/src/client, [path]/src/public, [path]/src/private
     */
    private scanForSourcePaths(rootPath: string): string[] {
        const sourcePaths: string[] = [];
        // 使用正斜杠格式的路径模式，以确保跨平台兼容性
        const targetPatterns = ['src/client', 'src/public', 'src/private'];

        const scanDirectory = (dirPath: string, relativePath: string = '') => {
            try {
                const items = fs.readdirSync(dirPath, { withFileTypes: true });
                
                for (const item of items) {
                    if (item.isDirectory()) {
                        const itemPath = path.join(dirPath, item.name);
                        const itemRelativePath = relativePath ? path.join(relativePath, item.name) : item.name;
                        
                        // 标准化路径分隔符为正斜杠，确保在Windows和Unix系统上都能正确匹配
                        const normalizedRelativePath = itemRelativePath.split(path.sep).join('/');
                        
                        // 检查当前路径是否匹配目标模式
                        for (const pattern of targetPatterns) {
                            if (normalizedRelativePath.endsWith(pattern)) {
                                // 保持原始路径格式存储，但使用标准化路径进行匹配
                                sourcePaths.push(itemRelativePath);
                                this.outputChannel.appendLine(`找到匹配路径: ${itemRelativePath}`);
                            }
                        }
                        
                        // 递归扫描子目录
                        scanDirectory(itemPath, itemRelativePath);
                    }
                }
            } catch (error) {
                // 忽略无法访问的目录
                this.outputChannel.appendLine(`跳过无法访问的目录: ${dirPath}`);
            }
        };

        scanDirectory(rootPath);
        return sourcePaths;
    }

    /**
     * 读取.classpath文件内容
     */
    private async readClasspathFile(classpathFile: string): Promise<any> {
        const content = fs.readFileSync(classpathFile, 'utf-8');
        const parser = new xml2js.Parser();
        return await parser.parseStringPromise(content);
    }

    /**
     * 添加源码路径到classpath配置
     */
    private async addSourcePathsToClasspath(classpathData: any, sourcePaths: string[], projectRoot: string): Promise<any> {
        // 确保classpath结构存在
        if (!classpathData.classpath) {
            classpathData.classpath = {};
        }
        if (!classpathData.classpath.classpathentry) {
            classpathData.classpath.classpathentry = [];
        }

        // 获取现有的源码路径
        const existingPaths = new Set<string>();
        const entries = Array.isArray(classpathData.classpath.classpathentry) 
            ? classpathData.classpath.classpathentry 
            : [classpathData.classpath.classpathentry];

        entries.forEach((entry: any) => {
            if (entry.$ && entry.$.kind === 'src' && entry.$.path) {
                existingPaths.add(entry.$.path);
            }
        });

        // 添加新的源码路径
        let addedCount = 0;
        for (const sourcePath of sourcePaths) {
            if (!existingPaths.has(sourcePath)) {
                const newEntry = {
                    $: {
                        kind: 'src',
                        path: sourcePath
                    }
                };
                
                if (Array.isArray(classpathData.classpath.classpathentry)) {
                    classpathData.classpath.classpathentry.push(newEntry);
                } else {
                    classpathData.classpath.classpathentry = [classpathData.classpath.classpathentry, newEntry];
                }
                
                addedCount++;
                this.outputChannel.appendLine(`添加源码路径: ${sourcePath}`);
            } else {
                this.outputChannel.appendLine(`源码路径已存在，跳过: ${sourcePath}`);
            }
        }

        this.outputChannel.appendLine(`实际添加了 ${addedCount} 个新的源码路径`);
        return classpathData;
    }

    /**
     * 写入.classpath文件
     */
    private async writeClasspathFile(classpathFile: string, classpathData: any): Promise<void> {
        const builder = new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true, indent: '\t' }
        });
        
        const xmlContent = builder.buildObject(classpathData);
        fs.writeFileSync(classpathFile, xmlContent, 'utf-8');
        this.outputChannel.appendLine(`已更新.classpath文件: ${classpathFile}`);
    }
}