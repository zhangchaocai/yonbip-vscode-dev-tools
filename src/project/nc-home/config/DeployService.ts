import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { NCHomeConfigService } from './NCHomeConfigService';

/**
 * Deploy服务 - 处理跨平台的本地deploy执行
 */
export class DeployService {
    private context: vscode.ExtensionContext;
    private configService: NCHomeConfigService;
    private outputChannel: vscode.OutputChannel;
    private deployProcess: ChildProcess | null = null;

    constructor(context: vscode.ExtensionContext, configService: NCHomeConfigService) {
        this.context = context;
        this.configService = configService;
        this.outputChannel = vscode.window.createOutputChannel('YonBIP Deploy');
    }

    /**
     * 检查是否可以执行deploy
     */
    public async checkCanDeploy(): Promise<{ canDeploy: boolean; error?: string }> {
        const config = this.configService.getConfig();

        if (!config.homePath) {
            return { canDeploy: false, error: '请先配置NC Home路径' };
        }

        if (!fs.existsSync(config.homePath)) {
            return { canDeploy: false, error: `NC Home目录不存在: ${config.homePath}` };
        }

        // 检查tool.jar是否存在
        const toolJarPath = this.getToolJarPath();
        if (!fs.existsSync(toolJarPath)) {
            return { canDeploy: false, error: `tool.jar不存在: ${toolJarPath}` };
        }

        return { canDeploy: true };
    }

    /**
     * 获取tool.jar的完整路径
     */
    public getToolJarPath(): string {
        return path.join(this.context.extensionPath, 'resources', 'deploy-tools', 'tool.jar');
    }

    /**
     * 获取deploy-tools目录路径（脚本运行目录）
     */
    public getDeployToolsDir(): string {
        return path.join(this.context.extensionPath, 'resources', 'deploy-tools');
    }

    /**
     * 执行deploy
     */
    public async executeDeploy(): Promise<{ success: boolean; error?: string }> {
        try {
            // 检查是否可以执行
            const checkResult = await this.checkCanDeploy();
            if (!checkResult.canDeploy) {
                return { success: false, error: checkResult.error };
            }

            const config = this.configService.getConfig();
            const homePath = config.homePath;
            const userHome = this.getUserHome();
            const toolJarPath = this.getToolJarPath();
            const deployToolsDir = this.getDeployToolsDir();

            this.outputChannel.clear();
            this.outputChannel.show();
            this.outputChannel.appendLine('='.repeat(60));
            this.outputChannel.appendLine('开始执行Deploy');
            this.outputChannel.appendLine(`操作系统: ${process.platform}`);
            this.outputChannel.appendLine(`用户HOME目录: ${userHome}`);
            this.outputChannel.appendLine(`NC Home目录: ${homePath}`);
            this.outputChannel.appendLine(`Tool JAR路径: ${toolJarPath}`);
            this.outputChannel.appendLine(`Deploy工具目录: ${deployToolsDir}`);
            this.outputChannel.appendLine('='.repeat(60));

            const platform = process.platform;

            if (platform === 'win32') {
                return await this.executeDeployWindows(homePath, userHome, deployToolsDir);
            } else if (platform === 'darwin') {
                return await this.executeDeployMacLinux(homePath, userHome, deployToolsDir, 'mac');
            } else if (platform === 'linux') {
                return await this.executeDeployMacLinux(homePath, userHome, deployToolsDir, 'linux');
            } else {
                return { success: false, error: `不支持的操作系统: ${platform}` };
            }

        } catch (error: any) {
            this.outputChannel.appendLine(`执行Deploy失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取用户HOME目录
     */
    private getUserHome(): string {
        // 优先使用配置文件中的homePath
        const config = this.configService.getConfig();
        if (config.homePath) {
            // 从homePath提取用户目录
            // homePath通常是 /Users/用户名/... 或 C:\Users\用户名\...
            const homePath = config.homePath;
            if (process.platform === 'win32') {
                // Windows: C:\Users\username\...
                const match = homePath.match(/^([A-Za-z]:\\Users\\[^\\]+)/);
                if (match) {
                    return match[1];
                }
                const match2 = homePath.match(/^([A-Za-z]:\\Documents[^\\]*)/);
                if (match2) {
                    return match2[1].split('\\')[0] + '\\Users\\' + process.env.USERNAME;
                }
            } else {
                // macOS/Linux: /Users/username/... 或 /home/username/...
                const match = homePath.match(/^(\/Users\/[^\/]+)/);
                if (match) {
                    return match[1];
                }
                const match2 = homePath.match(/^(\/home\/[^\/]+)/);
                if (match2) {
                    return match2[1];
                }
            }
        }

        // 回退到环境变量
        return process.env.HOME || process.env.USERPROFILE || os.homedir();
    }

    /**
     * 在Windows上执行deploy
     * 注意：tool.jar使用相对路径（如 ./hotwebs/nccloud/WEB-INF/lib/），
     * 所以必须从HOME目录执行，用绝对路径引用tool.jar
     */
    private async executeDeployWindows(
        homePath: string,
        userHome: string,
        deployToolsDir: string
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            // 构建Windows批处理脚本
            // 关键：先cd到homePath，然后用绝对路径运行tool.jar
            const script = `@echo off
chcp 65001 >nul
echo ========================================
echo YonBIP Deploy 开始执行
echo ========================================
echo.
cd /d "${homePath}"
echo 当前目录: %CD%
echo.
set "PATH=${userHome.replace(/\\/g, '\\\\')}\\ufjdk\\bin;%PATH%"
echo JDK路径: ${userHome}\\ufjdk\\bin
echo.
echo 正在执行: java -jar "${deployToolsDir.replace(/\\/g, '\\\\')}\\tool.jar"
echo.
java -jar "${deployToolsDir.replace(/\\/g, '\\\\')}\\tool.jar"
echo.
echo ========================================
echo Deploy执行完成
echo ========================================
pause
`;

            // 创建临时脚本文件
            const tempDir = path.join(this.context.extensionPath, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const scriptPath = path.join(tempDir, `deploy_${Date.now()}.bat`);
            fs.writeFileSync(scriptPath, script, { encoding: 'gbk' as BufferEncoding });

            this.outputChannel.appendLine('执行Windows批处理脚本...');
            this.outputChannel.appendLine(`HOME目录: ${homePath}`);

            // 使用cmd执行脚本
            this.deployProcess = spawn('cmd.exe', ['/c', scriptPath], {
                cwd: homePath,
                env: { ...process.env, PATH: `${userHome}\\ufjdk\\bin;${process.env.PATH}` },
                detached: false
            });

            this.deployProcess.stdout?.on('data', (data: Buffer) => {
                this.outputChannel.append(data.toString('utf8'));
            });

            this.deployProcess.stderr?.on('data', (data: Buffer) => {
                this.outputChannel.append(data.toString('utf8'));
            });

            this.deployProcess.on('error', (error) => {
                this.outputChannel.appendLine(`执行错误: ${error.message}`);
                resolve({ success: false, error: error.message });
            });

            this.deployProcess.on('close', (code) => {
                this.outputChannel.appendLine(`进程退出，代码: ${code}`);

                // 清理临时脚本
                try {
                    fs.unlinkSync(scriptPath);
                } catch (e) {
                    // 忽略删除错误
                }

                resolve({ success: code === 0, error: code !== 0 ? `进程退出码: ${code}` : undefined });
            });
        });
    }

    /**
     * 在macOS/Linux上执行deploy
     * 注意：tool.jar使用相对路径（如 ./hotwebs/nccloud/WEB-INF/lib/），
     * 所以必须从HOME目录执行，用绝对路径引用tool.jar
     */
    private async executeDeployMacLinux(
        homePath: string,
        userHome: string,
        deployToolsDir: string,
        platformType: 'mac' | 'linux'
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            // 构建Shell脚本
            // 关键：先cd到homePath，然后用绝对路径运行tool.jar
            const script = `#!/bin/bash
echo "========================================"
echo "YonBIP Deploy 开始执行"
echo "========================================"
echo ""
cd "${homePath}"
echo "当前目录: $(pwd)"
echo ""
export PATH="${userHome}/ufjdk/bin:$PATH"
echo "JDK路径: ${userHome}/ufjdk/bin"
echo ""
echo "正在执行: java -jar ${deployToolsDir}/tool.jar"
echo ""
java -jar "${deployToolsDir}/tool.jar"
EXIT_CODE=$?
echo ""
echo "========================================"
echo "Deploy执行完成"
echo "========================================"
read -p "按Enter键退出..."
exit $EXIT_CODE
`;

            // 创建临时脚本文件
            const tempDir = path.join(this.context.extensionPath, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const scriptPath = path.join(tempDir, `deploy_${Date.now()}.sh`);
            fs.writeFileSync(scriptPath, script, { encoding: 'utf8' });

            // 设置执行权限
            fs.chmodSync(scriptPath, '755');

            this.outputChannel.appendLine(`执行${platformType === 'mac' ? 'macOS' : 'Linux'} Shell脚本...`);
            this.outputChannel.appendLine(`HOME目录: ${homePath}`);

            // 使用Terminal执行脚本
            const terminal = vscode.window.createTerminal({
                name: 'YonBIP Deploy',
                cwd: homePath,
                env: { ...process.env, PATH: `${userHome}/ufjdk/bin:${process.env.PATH}` }
            });

            terminal.sendText(`chmod +x "${scriptPath}" && "${scriptPath}"`);
            terminal.show();

            // 等待用户关闭终端后清理脚本
            setTimeout(() => {
                try {
                    if (fs.existsSync(scriptPath)) {
                        fs.unlinkSync(scriptPath);
                    }
                } catch (e) {
                    // 忽略
                }
            }, 10 * 60 * 1000); // 10分钟后清理

            resolve({ success: true });
        });
    }

    /**
     * 停止deploy进程
     */
    public stopDeploy(): void {
        if (this.deployProcess) {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', this.deployProcess.pid!.toString(), '/f', '/t']);
            } else {
                this.deployProcess.kill('SIGTERM');
            }
            this.deployProcess = null;
            this.outputChannel.appendLine('Deploy进程已终止');
        }
    }

    /**
     * 显示输出面板
     */
    public showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.stopDeploy();
        this.outputChannel.dispose();
    }
}
