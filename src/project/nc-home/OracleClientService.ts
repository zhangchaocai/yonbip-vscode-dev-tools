import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Oracle Instant Client服务
 * 用于检测和安装Oracle Instant Client
 */
export class OracleClientService {
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('Oracle Instant Client');
    }

    /**
     * 检查Oracle Instant Client是否已安装
     */
    public async checkOracleClientInstalled(): Promise<{ installed: boolean; path?: string }> {
        this.outputChannel.appendLine('🔍 检查Oracle Instant Client是否已安装...');

        // 1. 检查环境变量
        const envPaths = this.getOracleClientPathsFromEnv();
        for (const envPath of envPaths) {
            if (this.isOracleClientPathValid(envPath)) {
                this.outputChannel.appendLine(`✅ 在环境变量中找到有效的Oracle客户端: ${envPath}`);
                return { installed: true, path: envPath };
            }
        }

        // 2. 检查常见安装路径
        const commonPaths = this.getCommonOracleClientPaths();
        for (const commonPath of commonPaths) {
            if (this.isOracleClientPathValid(commonPath)) {
                this.outputChannel.appendLine(`✅ 在常见路径中找到有效的Oracle客户端: ${commonPath}`);
                return { installed: true, path: commonPath };
            }
        }

        // 3. 检查系统库路径
        const systemLibPaths = this.getSystemLibraryPaths();
        for (const libPath of systemLibPaths) {
            if (this.isOracleClientPathValid(libPath)) {
                this.outputChannel.appendLine(`✅ 在系统库路径中找到有效的Oracle客户端: ${libPath}`);
                return { installed: true, path: libPath };
            }
        }

        this.outputChannel.appendLine('❌ 未找到有效的Oracle客户端');
        return { installed: false };
    }

    /**
     * 从环境变量获取Oracle客户端路径
     */
    private getOracleClientPathsFromEnv(): string[] {
        const paths: string[] = [];
        
        // 检查ORACLE_HOME
        if (process.env.ORACLE_HOME) {
            paths.push(process.env.ORACLE_HOME);
        }
        
        // 检查ORACLE_BASE
        if (process.env.ORACLE_BASE) {
            paths.push(path.join(process.env.ORACLE_BASE, 'instantclient'));
        }
        
        // 检查LD_LIBRARY_PATH (Linux)
        if (process.env.LD_LIBRARY_PATH) {
            const ldPaths = process.env.LD_LIBRARY_PATH.split(':');
            paths.push(...ldPaths);
        }
        
        // 检查DYLD_LIBRARY_PATH (macOS)
        if (process.env.DYLD_LIBRARY_PATH) {
            const dyldPaths = process.env.DYLD_LIBRARY_PATH.split(':');
            paths.push(...dyldPaths);
        }
        
        // 检查PATH
        if (process.env.PATH) {
            const pathDirs = process.env.PATH.split(path.delimiter);
            paths.push(...pathDirs);
        }
        
        return paths;
    }

    /**
     * 获取常见的Oracle客户端安装路径
     */
    private getCommonOracleClientPaths(): string[] {
        const paths: string[] = [];
        
        if (process.platform === 'darwin') {
            // macOS常见路径
            paths.push('/opt/oracle/instantclient_23_3');
            paths.push('/opt/oracle/instantclient_21_8');
            paths.push('/opt/oracle/instantclient_19_17');
            paths.push('/usr/local/oracle/instantclient_23_3');
            paths.push('/usr/local/oracle/instantclient_21_8');
            paths.push('/usr/local/oracle/instantclient_19_17');
            paths.push('/opt/homebrew/lib');
        } else if (process.platform === 'win32') {
            // Windows常见路径
            paths.push('C:\\oracle\\instantclient_23_3');
            paths.push('C:\\oracle\\instantclient_21_8');
            paths.push('C:\\oracle\\instantclient_19_17');
            paths.push('C:\\Program Files\\Oracle\\instantclient_23_3');
            paths.push('C:\\Program Files\\Oracle\\instantclient_21_8');
            paths.push('C:\\Program Files\\Oracle\\instantclient_19_17');
        } else {
            // Linux常见路径
            paths.push('/opt/oracle/instantclient_23_3');
            paths.push('/opt/oracle/instantclient_21_8');
            paths.push('/opt/oracle/instantclient_19_17');
            paths.push('/usr/lib/oracle/instantclient_23_3');
            paths.push('/usr/lib/oracle/instantclient_21_8');
            paths.push('/usr/lib/oracle/instantclient_19_17');
        }
        
        return paths;
    }

    /**
     * 获取系统库路径
     */
    private getSystemLibraryPaths(): string[] {
        const paths: string[] = [];
        
        if (process.platform === 'darwin') {
            paths.push('/usr/lib');
            paths.push('/usr/local/lib');
            paths.push('/opt/homebrew/lib');
        } else if (process.platform === 'win32') {
            // Windows系统库路径
            paths.push('C:\\Windows\\System32');
        } else {
            // Linux系统库路径
            paths.push('/usr/lib');
            paths.push('/usr/lib64');
            paths.push('/lib');
            paths.push('/lib64');
        }
        
        return paths;
    }

    /**
     * 检查指定路径是否为有效的Oracle客户端路径
     */
    private isOracleClientPathValid(clientPath: string): boolean {
        if (!clientPath || !fs.existsSync(clientPath)) {
            return false;
        }

        try {
            const files = fs.readdirSync(clientPath);
            
            if (process.platform === 'darwin') {
                // macOS需要libclntsh.dylib
                return files.some(file => file.startsWith('libclntsh.dylib'));
            } else if (process.platform === 'win32') {
                // Windows需要oci.dll
                return files.includes('oci.dll');
            } else {
                // Linux需要libclntsh.so
                return files.some(file => file.startsWith('libclntsh.so'));
            }
        } catch (error) {
            return false;
        }
    }

    /**
     * 提示用户安装Oracle Instant Client
     */
    public async promptInstallOracleClient(): Promise<boolean> {
        const result = await vscode.window.showInformationMessage(
            '检测到您尚未安装Oracle Instant Client，这将影响Oracle数据库连接功能。是否现在安装？',
            '安装', '取消'
        );

        if (result === '安装') {
            return await this.installOracleClient();
        }

        return false;
    }

    /**
     * 安装Oracle Instant Client
     */
    private async installOracleClient(): Promise<boolean> {
        this.outputChannel.show();
        this.outputChannel.appendLine('🚀 开始安装Oracle Instant Client...');

        try {
            // 显示安装指南
            const installGuide = this.getInstallGuide();
            this.outputChannel.appendLine(installGuide);

            // 提供下载链接
            const downloadUrl = this.getDownloadUrl();
            this.outputChannel.appendLine(`📥 下载地址: ${downloadUrl}`);

            // 在浏览器中打开下载页面
            vscode.env.openExternal(vscode.Uri.parse(downloadUrl));

            // 提示用户手动安装
            vscode.window.showInformationMessage(
                '请根据上述指南下载并安装Oracle Instant Client，安装完成后请重启VS Code。',
                '查看指南', '关闭'
            ).then(selection => {
                if (selection === '查看指南') {
                    this.outputChannel.show();
                }
            });

            return true;
        } catch (error: any) {
            this.outputChannel.appendLine(`❌ 安装过程中出现错误: ${error.message}`);
            vscode.window.showErrorMessage(`安装失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 获取安装指南
     */
    private getInstallGuide(): string {
        let guide = '\n📋 Oracle Instant Client 安装指南\n';
        guide += '===============================\n\n';

        if (process.platform === 'darwin') {
            guide += '🍎 macOS 安装步骤:\n';
            guide += '1. 访问Oracle官网下载页面\n';
            guide += '2. 下载适用于macOS的Instant Client Basic包\n';
            guide += '3. 解压到目录，例如: /opt/oracle/instantclient_21_8\n';
            guide += '4. 创建符号链接:\n';
            guide += '   cd /opt/oracle/instantclient_21_8\n';
            guide += '   ln -s libclntsh.dylib.* libclntsh.dylib\n';
            guide += '5. 设置环境变量:\n';
            guide += '   export DYLD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$DYLD_LIBRARY_PATH\n\n';
        } else if (process.platform === 'win32') {
            guide += '🪟 Windows 安装步骤:\n';
            guide += '1. 访问Oracle官网下载页面\n';
            guide += '2. 下载适用于Windows的Instant Client Basic包\n';
            guide += '3. 解压到目录，例如: C:\\oracle\\instantclient_21_8\n';
            guide += '4. 将该目录添加到系统PATH环境变量中\n\n';
        } else {
            guide += '🐧 Linux 安装步骤:\n';
            guide += '1. 访问Oracle官网下载页面\n';
            guide += '2. 下载适用于Linux的Instant Client Basic包\n';
            guide += '3. 解压到目录，例如: /opt/oracle/instantclient_21_8\n';
            guide += '4. 设置环境变量:\n';
            guide += '   export LD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$LD_LIBRARY_PATH\n\n';
        }

        guide += '🔗 安装完成后，建议重启VS Code以确保环境变量生效。\n';
        return guide;
    }

    /**
     * 获取下载URL
     */
    private getDownloadUrl(): string {
        return 'https://www.oracle.com/database/technologies/instant-client.html';
    }

    /**
     * 显示输出通道
     */
    public showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
}