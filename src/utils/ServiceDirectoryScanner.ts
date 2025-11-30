import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 服务目录扫描类，用于查找有.project和.classpath的上级目录
 */
export class ServiceDirectoryScanner {
    private static scannedCount = 0;
    private static totalCount = 0;
    private static progressCallback?: (progress: { increment: number; message: string }) => void;

    /**
     * 扫描工作区，查找所有包含.project和.classpath文件的目录
     * @param progressCallback 进度回调函数，用于报告扫描进度
     * @returns Promise<string[]> 包含服务目录的数组
     */
    public static async scanServiceDirectories(progressCallback?: (progress: { increment: number; message: string }) => void): Promise<string[]> {
        // 重置状态
        this.scannedCount = 0;
        this.totalCount = 0;
        this.progressCallback = progressCallback;

        const serviceDirectories: string[] = [];
        
        // 获取当前工作区的根目录
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('请先打开一个工作区文件夹');
            return serviceDirectories;
        }
        
        if (progressCallback) {
            progressCallback({ increment: 0, message: '开始扫描工作区...' });
        }
        
        // 先统计所有需要扫描的目录数量
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            this.totalCount += await this.countDirectories(folderPath);
        }
        
        if (progressCallback) {
            progressCallback({ increment: 10, message: `准备扫描 ${this.totalCount} 个目录...` });
        }
        
        // 执行实际扫描
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            await this.scanDirectoryRecursive(folderPath, serviceDirectories);
        }
        
        if (progressCallback) {
            progressCallback({ increment: 90, message: '扫描完成，正在整理结果...' });
        }
        
        return serviceDirectories;
    }
    
    /**
     * 统计目录数量（包括子目录）
     * @param dirPath 目录路径
     * @returns Promise<number> 目录数量
     */
    private static async countDirectories(dirPath: string): Promise<number> {
        let count = 1; // 当前目录
        
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const childDirPath = path.join(dirPath, entry.name);
                    count += await this.countDirectories(childDirPath);
                }
            }
        } catch (error) {
            // 忽略权限错误等，只统计能访问的目录
        }
        
        return count;
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
            
            // 更新进度
            this.scannedCount++;
            if (this.progressCallback && this.totalCount > 0) {
                const progressPercent = 10 + (this.scannedCount / this.totalCount) * 70; // 10-80%的进度范围
                const dirName = path.basename(dirPath);
                this.progressCallback({ 
                    increment: 0,
                    message: `正在扫描: ${dirName} (${this.scannedCount}/${this.totalCount})`
                });
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
            // 跳过无法访问的目录，继续扫描
            this.scannedCount++;
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