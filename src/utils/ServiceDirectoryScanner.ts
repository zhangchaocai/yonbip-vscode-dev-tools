import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 服务目录扫描类，用于查找有.project和.classpath的上级目录
 */
export class ServiceDirectoryScanner {
    /**
     * 扫描工作区，查找所有包含.project和.classpath文件的目录
     * @returns Promise<string[]> 包含服务目录的数组
     */
    public static async scanServiceDirectories(): Promise<string[]> {
        const serviceDirectories: string[] = [];
        
        // 获取当前工作区的根目录
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('请先打开一个工作区文件夹');
            return serviceDirectories;
        }
        
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            await this.scanDirectoryRecursive(folderPath, serviceDirectories);
        }
        
        return serviceDirectories;
    }
    
    /**
     * 递归扫描目录，查找包含.project和.classpath文件的目录
     * @param dirPath 当前扫描的目录路径
     * @param serviceDirectories 存储服务目录的数组
     */
    private static async scanDirectoryRecursive(dirPath: string, serviceDirectories: string[]): Promise<void> {
        try {
            // 检查当前目录是否包含.project和.classpath文件
            const hasProjectFile = fs.existsSync(path.join(dirPath, '.project'));
            const hasClasspathFile = fs.existsSync(path.join(dirPath, '.classpath'));
            
            if (hasProjectFile && hasClasspathFile) {
                // 直接使用当前目录作为服务目录
                if (!serviceDirectories.includes(dirPath)) {
                    serviceDirectories.push(dirPath);
                }
            }
            
            // 读取目录内容
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            
            // 递归扫描子目录
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const childDirPath = path.join(dirPath, entry.name);
                    await this.scanDirectoryRecursive(childDirPath, serviceDirectories);
                }
            }
        } catch (error: any) {
            console.error(`扫描目录${dirPath}时出错:`, error);
            // 显示更详细的错误信息给用户
            vscode.window.showErrorMessage(`扫描目录时出错: ${error.message || '未知错误'}`);
        }
    }
    
    /**
     * 获取目录的显示名称（使用最后一个目录名）
     * @param dirPath 目录路径
     * @returns string 目录显示名称
     */
    public static getDirectoryDisplayName(dirPath: string): string {
        return path.basename(dirPath);
    }
}