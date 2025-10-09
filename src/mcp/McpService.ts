import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * MCP服务配置
 */
export interface McpConfig {
    port: number;
    jarPath: string;
    javaPath: string;
    maxMemory: string;
}

/**
 * MCP服务状态
 */
export enum McpStatus {
    STOPPED = 'stopped',
    STARTING = 'starting',
    RUNNING = 'running',
    STOPPING = 'stopping',
    ERROR = 'error'
}

/**
 * MCP服务管理类
 */
export class McpService {
    private context: vscode.ExtensionContext;
    private static outputChannelInstance: vscode.OutputChannel | null = null;
    private process: ChildProcess | null = null;
    private status: McpStatus = McpStatus.STOPPED;
    private config: McpConfig;
    private isManualStop: boolean = false; // 标记是否为手动停止
    // private statusBarItem: vscode.StatusBarItem;  // 注释掉状态栏，由WebView显示
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();
        // 确保outputChannel只初始化一次
        if (!McpService.outputChannelInstance) {
            McpService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP MCP服务');
        }
        this.outputChannel = McpService.outputChannelInstance;

        // 初始化时自动设置内置JAR路径
        this.initializeBuiltinJar();

        // 注释掉状态栏显示，避免与WebView面板重复
        // this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        // this.updateStatusBar();
        // this.statusBarItem.show();
    }

    /**
     * 初始化内置JAR文件路径
     */
    private async initializeBuiltinJar(): Promise<void> {
        const builtinJarPath = path.join(this.context.extensionPath, 'resources', 'yonyou-mcp.jar');

        // 检查内置JAR文件是否存在
        if (fs.existsSync(builtinJarPath)) {
            // 如果未配置JAR路径或配置的路径不存在，则使用内置JAR
            if (!this.config.jarPath || !fs.existsSync(this.config.jarPath)) {
                this.config.jarPath = builtinJarPath;
                await this.saveConfig(this.config);
                this.outputChannel.appendLine(`自动设置内置MCP JAR路径: ${builtinJarPath}`);
            }
        } else {
            this.outputChannel.appendLine('警告: 未找到内置MCP JAR文件，请检查插件安装');
        }
    }

    /**
     * 加载配置
     */
    private loadConfig(): McpConfig {
        const config = this.context.globalState.get<McpConfig>('mcp.config');
        return config || {
            port: 9000,
            jarPath: '',
            javaPath: 'java',
            maxMemory: '512m'
        };
    }

    /**
     * 获取默认配置
     */
    public getDefaultConfig(): McpConfig {
        return {
            port: 9000,
            jarPath: '',
            javaPath: 'java',
            maxMemory: '512m'
        };
    }

    /**
     * 保存配置
     */
    public async saveConfig(config: McpConfig): Promise<void> {
        this.config = config;
        await this.context.globalState.update('mcp.config', config);
    }

    /**
     * 获取配置
     */
    public getConfig(): McpConfig {
        return { ...this.config };
    }

    /**
     * 获取状态
     */
    public getStatus(): McpStatus {
        return this.status;
    }

    /**
     * 启动MCP服务
     */
    public async start(): Promise<void> {
        if (this.status === McpStatus.RUNNING || this.status === McpStatus.STARTING) {
            vscode.window.showWarningMessage('MCP服务已在运行中');
            return;
        }

        try {
            this.setStatus(McpStatus.STARTING);
            this.outputChannel.clear();
            this.outputChannel.appendLine('正在启动MCP服务...');

            // 预检查
            const preCheckPassed = await this.preStartCheck();
            if (!preCheckPassed) {
                this.setStatus(McpStatus.ERROR);
                return;
            }

            // 验证配置
            await this.validateConfig();

            // 构建命令行参数
            const args = this.buildCommandArgs();

            this.outputChannel.appendLine(`执行命令: ${this.config.javaPath} ${args.join(' ')}`);

            // 启动Java进程
            this.outputChannel.appendLine('正在创建Java进程...');

            // 添加环境变量确保Java进程独立运行
            const env = {
                ...process.env,
                JAVA_OPTS: '-Dfile.encoding=UTF-8',
                // 避免Java进程继承VSCode的一些环境变量
                ELECTRON_RUN_AS_NODE: undefined
            };

            // 确保在独立的会话中运行进程
            this.process = spawn(this.config.javaPath, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: true, // 独立进程
                env: env,
                cwd: path.dirname(this.config.jarPath) // 设置工作目录为JAR文件所在目录
            });

            if (!this.process.pid) {
                throw new Error('Java进程创建失败，无法获取进程ID');
            }

            this.outputChannel.appendLine(`Java进程已创建，PID: ${this.process.pid}`);

            // 监听进程创建失败
            this.process.on('spawn', () => {
                this.outputChannel.appendLine('Java进程spawn事件触发');
            });

            // 处理进程输出
            this.process.stdout?.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(`[STDOUT] ${output}`);

                // 检查启动成功标识（更准确的匹配）
                if (output.includes('yonyou-mcp应用启动成功') ||
                    output.includes('Server started') ||
                    output.includes('访问: http://') ||
                    output.includes('Tomcat started on port')) {
                    this.outputChannel.appendLine('✓ 检测到MCP服务启动成功标识');
                    this.setStatus(McpStatus.RUNNING);
                    vscode.window.showInformationMessage(`MCP服务已启动，端口: ${this.config.port}`);

                    // 启动成功后自动切换到MCP服务面板
                    vscode.commands.executeCommand('workbench.view.extension.yonbip-view');

                }

                // 检查常见错误模式
                if (output.includes('Address already in use') ||
                    output.includes('端口已被占用') ||
                    output.includes('BindException')) {
                    this.outputChannel.appendLine('❌ 检测到端口占用错误');
                    this.setStatus(McpStatus.ERROR);
                }
            });

            this.process.stderr?.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(`[STDERR] ${output}`);

                if (output.includes('Error') || output.includes('Exception')) {
                    this.setStatus(McpStatus.ERROR);
                }
            });

            this.process.on('close', (code, signal) => {
                this.outputChannel.appendLine(`MCP服务进程结束，退出码: ${code}, 信号: ${signal}`);

                // 详细的退出码分析 - 正常停止不显示错误
                if (code === 143 || (code === null && signal === 'SIGTERM')) {
                    // 退出码143是正常的SIGTERM终止，不显示异常提示
                    this.outputChannel.appendLine('进程被SIGTERM信号正常终止');
                } else if (code === 1) {
                    this.outputChannel.appendLine('退出码1表示一般性错误，请检查Java环境和JAR文件');
                    this.outputChannel.appendLine('可能原因: JAR文件损坏、Java版本不兼容、缺少依赖');
                } else if (code === 127) {
                    this.outputChannel.appendLine('退出码127表示命令未找到，请检查Java路径配置');
                } else if (code === 130) {
                    this.outputChannel.appendLine('退出码130表示进程被SIGINT信号中断（Ctrl+C）');
                } else if (code === null && signal === 'SIGKILL') {
                    this.outputChannel.appendLine('进程被SIGKILL信号强制终止');
                }

                this.setStatus(McpStatus.STOPPED);
                this.process = null;

                // 只有在非正常停止时才显示错误消息
                if (code !== 0 && code !== null && code !== 143 && !this.isManualStop) {
                    vscode.window.showErrorMessage(`MCP服务异常退出，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);
                }

                // 重置手动停止标记
                this.isManualStop = false;
            });

            this.process.on('error', (error) => {
                this.outputChannel.appendLine(`进程启动失败: ${error.message}`);
                this.setStatus(McpStatus.ERROR);
                vscode.window.showErrorMessage(`MCP服务启动失败: ${error.message}`);
            });

            // 设置启动超时
            setTimeout(() => {
                if (this.status === McpStatus.STARTING) {
                    // 检查进程是否仍在运行
                    if (this.process && !this.process.killed) {
                        this.outputChannel.appendLine('MCP服务启动超时，但进程仍在运行，检查是否启动成功');
                        // 进程仍在运行，可能是启动成功但未输出启动成功标识
                        this.checkProcessAliveAndSetStatus();
                    } else {
                        this.outputChannel.appendLine('MCP服务启动超时');
                        this.stop();
                        vscode.window.showErrorMessage('MCP服务启动超时，请检查配置和日志');
                    }
                }
            }, 60000); // 增加超时时间到60秒

        } catch (error: any) {
            this.setStatus(McpStatus.ERROR);
            const message = `启动MCP服务失败: ${error.message}`;
            this.outputChannel.appendLine(message);
            vscode.window.showErrorMessage(message);
        }
    }

    /**
     * 检查进程是否存活并设置状态
     */
    private async checkProcessAliveAndSetStatus(): Promise<void> {
        try {
            // 检查HTTP服务是否可用
            const isAvailable = await this.checkHttpServiceAvailability();
            if (isAvailable) {
                this.outputChannel.appendLine('✓ 检测到MCP服务HTTP接口可用，设置为运行状态');
                this.setStatus(McpStatus.RUNNING);
                vscode.window.showInformationMessage(`MCP服务已启动，端口: ${this.config.port}`);

                // 启动成功后自动切换到MCP服务面板
                vscode.commands.executeCommand('workbench.view.extension.yonbip-view');

            } else {
                this.outputChannel.appendLine('❌ MCP服务HTTP接口不可用，设置为错误状态');
                this.setStatus(McpStatus.ERROR);
                this.stop();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`检查进程状态失败: ${error.message}`);
            this.setStatus(McpStatus.ERROR);
        }
    }

    /**
     * 检查HTTP服务是否可用
     */
    private async checkHttpServiceAvailability(): Promise<boolean> {
        return new Promise((resolve) => {
            const http = require('http');
            const options = {
                hostname: 'localhost',
                port: this.config.port,
                path: '/tool/stats', // 健康检查端点
                timeout: 5000
            };

            const req = http.get(options, (res: any) => {
                // 如果能收到响应，说明服务可用
                resolve(res.statusCode >= 200 && res.statusCode < 500);
            });

            req.on('error', () => {
                // 连接失败，服务不可用
                resolve(false);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    /**
     * 停止MCP服务
     */
    public async stop(): Promise<void> {
        if (this.status === McpStatus.STOPPED || this.status === McpStatus.STOPPING) {
            this.outputChannel.appendLine('MCP服务已处于停止状态，跳过停止操作');
            return;
        }

        this.isManualStop = true; // 标记为手动停止
        this.setStatus(McpStatus.STOPPING);
        this.outputChannel.appendLine('正在停止MCP服务...');

        if (this.process) {
            return new Promise<void>((resolve) => {
                if (!this.process) {
                    this.setStatus(McpStatus.STOPPED);
                    vscode.window.showInformationMessage('MCP服务已停止');
                    resolve();
                    return;
                }

                // 移除之前的事件监听器，避免重复触发
                this.process.removeAllListeners('close');
                this.process.removeAllListeners('exit');
                this.process.removeAllListeners('error');

                // 监听进程结束事件
                const onProcessEnd = () => {
                    this.outputChannel.appendLine('MCP进程已结束');
                    this.process = null;
                    this.setStatus(McpStatus.STOPPED);
                    this.isManualStop = false; // 重置标记
                    vscode.window.showInformationMessage('MCP服务已停止');
                    resolve();
                };

                // 添加一次性监听器
                this.process.once('close', onProcessEnd);
                this.process.once('exit', onProcessEnd);

                // 优雅关闭
                this.outputChannel.appendLine('发送SIGTERM信号...');
                this.process.kill('SIGTERM');

                // 设置强制杀死的超时
                const forceKillTimeout = setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        this.outputChannel.appendLine('优雅关闭超时，强制终止进程...');
                        this.process.kill('SIGKILL');

                        // 如果强制终止也没用，手动触发结束
                        setTimeout(() => {
                            if (this.process) {
                                this.outputChannel.appendLine('强制终止完成');
                                onProcessEnd();
                            }
                        }, 2000);
                    }
                }, 5000);

                // 设置总体超时
                const totalTimeout = setTimeout(() => {
                    this.outputChannel.appendLine('停止操作超时，强制设置为停止状态');
                    clearTimeout(forceKillTimeout);
                    this.process = null;
                    this.setStatus(McpStatus.STOPPED);
                    this.isManualStop = false; // 重置标记
                    vscode.window.showWarningMessage('MCP服务停止超时，已强制设置为停止状态');
                    resolve();
                }, 10000);

                // 成功停止时清理超时
                this.process.once('close', () => {
                    clearTimeout(forceKillTimeout);
                    clearTimeout(totalTimeout);
                });
            });
        } else {
            // 没有进程在运行
            this.outputChannel.appendLine('没有发现运行中的MCP进程');
            this.setStatus(McpStatus.STOPPED);
            this.isManualStop = false; // 重置标记
            vscode.window.showInformationMessage('MCP服务已停止');
        }
    }



    /**
     * 验证配置
     */
    private async validateConfig(): Promise<void> {
        this.outputChannel.appendLine('开始验证MCP服务配置...');

        // 检查Java路径
        if (!this.config.javaPath) {
            throw new Error('Java路径未配置');
        }

        // 如果是系统默认java命令，尝试查找完整路径
        if (this.config.javaPath === 'java') {
            try {
                const { exec } = require('child_process');
                const javaPath = await new Promise<string>((resolve, reject) => {
                    exec('which java', (error: any, stdout: string) => {
                        if (error) {
                            reject(new Error(`无法找到Java可执行文件: ${error.message}`));
                        } else {
                            const path = stdout.trim();
                            this.outputChannel.appendLine(`发现Java路径: ${path}`);
                            resolve(path);
                        }
                    });
                });

                // 更新配置为完整路径
                if (javaPath && fs.existsSync(javaPath)) {
                    this.config.javaPath = javaPath;
                    await this.saveConfig(this.config);
                }
            } catch (error: any) {
                this.outputChannel.appendLine(`警告: 无法解析Java路径，使用默认命令: ${error.message}`);
            }
        } else if (!fs.existsSync(this.config.javaPath)) {
            throw new Error(`Java可执行文件不存在: ${this.config.javaPath}`);
        }

        // 检查Java版本
        try {
            const { exec } = require('child_process');
            await new Promise((resolve, reject) => {
                exec(`"${this.config.javaPath}" -version`, (error: any, stdout: string, stderr: string) => {
                    if (error) {
                        reject(new Error(`Java版本检查失败: ${error.message}`));
                    } else {
                        const version = stderr || stdout;
                        this.outputChannel.appendLine(`Java版本: ${version.split('\n')[0]}`);
                        resolve(version);
                    }
                });
            });
        } catch (error: any) {
            throw new Error(`Java环境验证失败: ${error.message}`);
        }

        // 检查JAR文件，优先使用内置JAR
        if (!this.config.jarPath) {
            // 使用内置JAR文件
            const builtinJarPath = path.join(this.context.extensionPath, 'resources', 'yonyou-mcp.jar');

            if (fs.existsSync(builtinJarPath)) {
                this.config.jarPath = builtinJarPath;
                await this.saveConfig(this.config);
                this.outputChannel.appendLine(`使用内置JAR文件: ${builtinJarPath}`);
            } else {
                throw new Error('MCP JAR文件未找到，请检查插件安装是否完整');
            }
        }

        if (!fs.existsSync(this.config.jarPath)) {
            // 如果配置的JAR不存在，尝试使用内置JAR
            const builtinJarPath = path.join(this.context.extensionPath, 'resources', 'yonyou-mcp.jar');
            if (fs.existsSync(builtinJarPath)) {
                this.config.jarPath = builtinJarPath;
                await this.saveConfig(this.config);
                this.outputChannel.appendLine(`配置的JAR不存在，切换到内置JAR: ${builtinJarPath}`);
            } else {
                throw new Error(`MCP JAR文件不存在: ${this.config.jarPath}`);
            }
        }

        // 检查JAR文件权限
        this.outputChannel.appendLine(`检查JAR文件: ${this.config.jarPath}`);
        const jarStats = fs.statSync(this.config.jarPath);
        this.outputChannel.appendLine(`JAR文件大小: ${(jarStats.size / 1024 / 1024).toFixed(2)} MB`);

        try {
            // 检查文件读取权限
            fs.accessSync(this.config.jarPath, fs.constants.R_OK);
            this.outputChannel.appendLine('JAR文件权限检查通过✓');
        } catch (error: any) {
            throw new Error(`JAR文件无法读取: ${error.message}`);
        }

        // 检查端口是否可用
        this.outputChannel.appendLine(`检查端口: ${this.config.port}`);
        if (this.config.port < 1024 || this.config.port > 65535) {
            throw new Error('端口号必须在1024-65535之间');
        }

        // 检查端口是否被占用
        const isPortAvailable = await this.isPortAvailable(this.config.port);
        if (!isPortAvailable) {
            this.outputChannel.appendLine(`警告: 端口 ${this.config.port} 已被占用`);

            // 尝试找到并杀死占用端口的进程
            try {
                const { exec } = require('child_process');
                const result = await new Promise<string>((resolve, reject) => {
                    exec(`lsof -ti:${this.config.port}`, (error: any, stdout: string) => {
                        if (error) {
                            resolve('');
                        } else {
                            resolve(stdout.trim());
                        }
                    });
                });

                if (result) {
                    this.outputChannel.appendLine(`发现占用端口的进程PID: ${result}`);
                    const choice = await vscode.window.showWarningMessage(
                        `端口${this.config.port}被进程${result}占用，需要先停止该进程`,
                        '自动停止', '取消'
                    );

                    if (choice === '自动停止') {
                        await new Promise<void>((resolve, reject) => {
                            exec(`kill -TERM ${result}`, (error: any) => {
                                if (error) {
                                    this.outputChannel.appendLine(`停止进程失败: ${error.message}`);
                                    reject(error);
                                } else {
                                    this.outputChannel.appendLine(`已停止占用端口的进程: ${result}`);
                                    resolve();
                                }
                            });
                        });

                        // 等待进程完全停止
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        throw new Error(`端口${this.config.port}已被占用，请更换端口或停止占用进程`);
                    }
                }
            } catch (error: any) {
                this.outputChannel.appendLine(`检查端口占用失败: ${error.message}`);
                // 不抛出错误，继续尝试启动
            }
        }

        // 检查系统资源
        try {
            const { exec } = require('child_process');
            await new Promise((resolve, reject) => {
                exec('java -Xmx1m -version', (error: any) => {
                    if (error && error.message.includes('OutOfMemoryError')) {
                        this.outputChannel.appendLine('警告: 系统内存可能不足');
                    }
                    resolve(null);
                });
            });
        } catch (error: any) {
            this.outputChannel.appendLine(`系统资源检查失败: ${error.message}`);
        }

        this.outputChannel.appendLine('配置验证完成✓');
    }

    /**
     * 构建命令行参数
     */
    private buildCommandArgs(): string[] {
        const args = [
            `-Xmx${this.config.maxMemory}`,
            '-Dfile.encoding=UTF-8'
        ];

        args.push(
            '-jar',
            this.config.jarPath,
            '--server.port=' + this.config.port,
            '--solon.env=prod'
        );

        // 添加home路径参数（参考IDEA插件实现）
        const homePath = this.getHomePath();
        if (homePath) {
            args.push('--homepath=' + homePath);
        }

        return args;
    }

    /**
     * 获取HOME路径
     */
    private getHomePath(): string | null {
        // 尝试从全局状态获取HOME路径
        const homeConfig = this.context.globalState.get<any>('nchome.config');
        if (homeConfig && homeConfig.homePath) {
            return homeConfig.homePath;
        }

        // 尝试从配置中获取
        const config = vscode.workspace.getConfiguration('yonbip');
        const homePath = config.get<string>('homePath');
        if (homePath) {
            return homePath;
        }

        return null;
    }

    /**
     * 设置状态
     */
    private setStatus(status: McpStatus): void {
        this.status = status;
        // this.updateStatusBar();  // 注释掉状态栏更新，避免重复显示
    }



    /**
     * 检查端口是否可用
     */
    public async isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = require('net').createServer();
            server.listen(port, () => {
                server.once('close', () => resolve(true));
                server.close();
            });
            server.on('error', () => resolve(false));
        });
    }

    /**
     * 获取扩展上下文
     */
    public getContext(): vscode.ExtensionContext {
        return this.context;
    }

    /**
     * 显示输出通道
     */
    public showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * 启动前预检查
     */
    private async preStartCheck(): Promise<boolean> {
        this.outputChannel.appendLine('====== MCP服务启动前预检查 ======');

        let hasError = false;

        // 检查端口可用性
        const portAvailable = await this.isPortAvailable(this.config.port);
        if (!portAvailable) {
            this.outputChannel.appendLine(`❌ 端口${this.config.port}不可用`);

            // 尝试找到并清理占用端口的进程
            try {
                const { exec } = require('child_process');
                const pids = await new Promise<string>((resolve) => {
                    exec(`lsof -ti:${this.config.port}`, (error: any, stdout: string) => {
                        resolve(error ? '' : stdout.trim());
                    });
                });

                if (pids) {
                    this.outputChannel.appendLine(`发现占用端口的进程: ${pids}`);
                    const choice = await vscode.window.showWarningMessage(
                        `端口${this.config.port}被进程${pids}占用，是否自动清理？`,
                        '清理', '更换端口', '取消'
                    );

                    if (choice === '清理') {
                        await new Promise<void>((resolve, reject) => {
                            exec(`kill -TERM ${pids}`, (error: any) => {
                                if (error) {
                                    this.outputChannel.appendLine(`清理失败: ${error.message}`);
                                    reject(error);
                                } else {
                                    this.outputChannel.appendLine('✓ 端口清理成功');
                                    resolve();
                                }
                            });
                        });

                        // 等待端口释放
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        const nowAvailable = await this.isPortAvailable(this.config.port);
                        if (nowAvailable) {
                            this.outputChannel.appendLine('✓ 端口现在可用');
                        } else {
                            this.outputChannel.appendLine('❌ 端口仍然不可用');
                            hasError = true;
                        }
                    } else if (choice === '更换端口') {
                        this.config.port = this.config.port + 1;
                        await this.saveConfig(this.config);
                        this.outputChannel.appendLine(`✓ 端口已更换为: ${this.config.port}`);
                    } else {
                        hasError = true;
                    }
                } else {
                    hasError = true;
                }
            } catch (error: any) {
                this.outputChannel.appendLine(`端口检查失败: ${error.message}`);
                // 不设置错误标志，继续尝试启动
            }
        } else {
            this.outputChannel.appendLine(`✓ 端口${this.config.port}可用`);
        }

        // 检查系统资源
        try {
            const { exec } = require('child_process');

            // 检查内存
            const memInfo = await new Promise<string>((resolve) => {
                exec('vm_stat', (error: any, stdout: string) => {
                    resolve(error ? '无法获取内存信息' : stdout);
                });
            });

            this.outputChannel.appendLine('系统内存状态:');
            if (memInfo.includes('Pages free')) {
                const freePages = memInfo.match(/Pages free:\s+(\d+)/)?.[1];
                if (freePages) {
                    const freeMB = Math.round(parseInt(freePages) * 4096 / 1024 / 1024);
                    this.outputChannel.appendLine(`可用内存: ${freeMB} MB`);
                    if (freeMB < 100) {
                        this.outputChannel.appendLine('⚠️ 系统内存不足，可能影响MCP服务启动');
                    }
                }
            }

            // 检查磁盘空间
            const diskInfo = await new Promise<string>((resolve) => {
                exec('df -h .', (error: any, stdout: string) => {
                    resolve(error ? '无法获取磁盘信息' : stdout);
                });
            });

            this.outputChannel.appendLine('磁盘空间状态:');
            this.outputChannel.appendLine(diskInfo.split('\n')[1] || '无法获取磁盘信息');

        } catch (error: any) {
            this.outputChannel.appendLine(`系统资源检查失败: ${error.message}`);
        }

        this.outputChannel.appendLine('================================');

        if (hasError) {
            this.outputChannel.appendLine('❌ 预检查失败，请解决上述问题后重试');
            return false;
        } else {
            this.outputChannel.appendLine('✓ 预检查通过，可以启动MCP服务');
            return true;
        }
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.stop();
        // this.statusBarItem.dispose();  // 注释掉状态栏资源释放
        if (McpService.outputChannelInstance) {
            McpService.outputChannelInstance.dispose();
            McpService.outputChannelInstance = null;
        }
    }
}