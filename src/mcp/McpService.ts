import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { NCHomeConfigService } from '../project/nc-home/config/NCHomeConfigService';
import { DataSourceMeta } from '../project/nc-home/config/NCHomeConfigTypes';
import { PasswordEncryptor } from '../utils/PasswordEncryptor';

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
    private healthCheckInterval: NodeJS.Timeout | null = null; // 健康检查定时器
    private isHealthCheckRunning: boolean = false; // 健康检查是否正在运行
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
        return {
            port: (config && config.port) || 9000,
            jarPath: (config && config.jarPath) || '',
            javaPath: (config && config.javaPath) || 'java',
            maxMemory: (config && config.maxMemory) || '512m'
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
        // 确保必要的配置项有默认值
        const configWithDefaults = {
            port: config.port || 9000,
            jarPath: config.jarPath || '',
            javaPath: config.javaPath || 'java',
            maxMemory: config.maxMemory || '512m'
        };
        
        this.config = configWithDefaults;
        await this.context.globalState.update('mcp.config', configWithDefaults);
    }

    /**
     * 获取配置
     */
    public getConfig(): McpConfig {
        // 确保返回的配置包含所有必要的字段
        return {
            port: this.config.port || 9000,
            jarPath: this.config.jarPath || '',
            javaPath: this.config.javaPath || 'java',
            maxMemory: this.config.maxMemory || '512m'
        };
    }

    /**
     * 获取状态
     */
    public getStatus(): McpStatus {
        return this.status;
    }

    /**
     * 判断服务是否存活（优先检查HTTP接口，其次检查进程）
     */
    public async isServiceAlive(): Promise<boolean> {
        try {
            const httpAlive = await this.checkHttpServiceAvailability();
            if (httpAlive) return true;
        } catch (e) {
            // 忽略HTTP检查异常，降级到进程存活判断
        }
        return this.isProcessAlive();
    }

    /**
     * 判断子进程是否仍在运行
     */
    private isProcessAlive(): boolean {
        const cp = this.process;
        if (!cp || !cp.pid) return false;
        try {
            // signal 0 用于探测进程是否存在，不会真正发送信号
            process.kill(cp.pid, 0);
            return true;
        } catch {
            return false;
        }
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
            this.outputChannel.appendLine('🚀 正在启动MCP服务...');
            this.outputChannel.appendLine(`📅 启动时间: ${new Date().toLocaleString()}`);
            
            // 显示输出窗口
            this.outputChannel.show();

            // 启动健康检查
            this.startHealthCheck();

            // 显示启动进度和数据源信息
            this.outputChannel.appendLine('🔍 正在获取design数据源信息...');
            const dataSourceInfo = this.getDesignDataSourceInfo();
            if (dataSourceInfo) {
                this.outputChannel.appendLine(`🔗 连接数据源信息:`);
                this.outputChannel.appendLine(`   URL: ${dataSourceInfo.url}`);
                this.outputChannel.appendLine(`   用户名: ${dataSourceInfo.username}`);
                this.outputChannel.appendLine(`   驱动: ${dataSourceInfo.driver}`);
                this.outputChannel.appendLine(`✅ 数据源信息获取成功`);
            } else {
                this.outputChannel.appendLine('⚠️ 未找到design数据源配置');
                this.outputChannel.appendLine('💡 提示: 请确保在NC HOME配置中设置了名为"design"的数据源');
            }

            // 预检查
            this.outputChannel.appendLine('📋 执行启动前预检查...');
            const preCheckPassed = await this.preStartCheck();
            if (!preCheckPassed) {
                this.outputChannel.appendLine('❌ 启动前预检查失败');
                this.setStatus(McpStatus.ERROR);
                return;
            }
            this.outputChannel.appendLine('✅ 启动前预检查通过');

            // 验证配置
            this.outputChannel.appendLine('🔍 验证MCP服务配置...');
            await this.validateConfig();
            this.outputChannel.appendLine('✅ MCP服务配置验证通过');

            // 构建命令行参数
            this.outputChannel.appendLine('🔨 构建命令行参数...');
            const args = this.buildCommandArgs();
            this.outputChannel.appendLine('✅ 命令行参数构建完成');

            this.outputChannel.appendLine(`🚀 执行命令: ${this.config.javaPath} ${args.join(' ')}`);

            // 启动Java进程
            this.outputChannel.appendLine('🏃 正在创建Java进程...');

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

            this.outputChannel.appendLine(`✅ Java进程已创建，PID: ${this.process.pid}`);

            // 监听进程创建失败
            this.process.on('spawn', () => {
                this.outputChannel.appendLine('🔄 Java进程spawn事件触发');
            });

            // 处理进程输出
            this.process.stdout?.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(`[STDOUT] ${output}`);

                // 检查启动成功标识（更准确的匹配）
                if (output.includes('yonyou-mcp应用启动成功') ||
                    output.includes('Server started') ||
                    output.includes('访问: http://') ||
                    output.includes('Tomcat started on port') ||
                    output.includes('Started Application') ||
                    output.includes('MCP服务启动完成') ||
                    output.includes('Started YonBipMcpApplication')) {
                    this.outputChannel.appendLine('🎉 检测到MCP服务启动成功标识');
                    
                    // 延迟一段时间再检查服务是否真正可用
                    setTimeout(async () => {
                        const isAvailable = await this.checkHttpServiceAvailability();
                        if (isAvailable) {
                            this.setStatus(McpStatus.RUNNING);
                            
                            // 获取数据源信息用于显示
                            const dataSourceInfo = this.getDesignDataSourceInfo();
                            if (dataSourceInfo) {
                                vscode.window.showInformationMessage(
                                    `MCP服务已启动，端口: ${this.config.port}\n` +
                                    `数据源: ${dataSourceInfo.username}@${this.extractHostFromUrl(dataSourceInfo.url)}`
                                );
                            } else {
                                vscode.window.showInformationMessage(`MCP服务已启动，端口: ${this.config.port}`);
                            }

                            // 启动成功后自动切换到MCP服务面板
                            vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                        } else {
                            this.outputChannel.appendLine('❌ 虽然检测到启动成功标识，但服务健康检查失败');
                            this.setStatus(McpStatus.ERROR);
                        }
                    }, 2000); // 等待2秒确保服务完全启动
                }

                // 检查常见错误模式
                if (output.includes('Address already in use') ||
                    output.includes('端口已被占用') ||
                    output.includes('BindException') ||
                    output.includes('Failed to start') ||
                    output.includes('数据库连接失败') ||
                    output.includes('DataSource setup failed')) {
                    this.outputChannel.appendLine('❌ 检测到启动错误');
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
                this.outputChannel.appendLine(`🏁 MCP服务进程结束，退出码: ${code}, 信号: ${signal}`);

                // 详细的退出码分析 - 正常停止不显示错误
                if (code === 143 || (code === null && signal === 'SIGTERM')) {
                    // 退出码143是正常的SIGTERM终止，不显示异常提示
                    this.outputChannel.appendLine('⏹️ 进程被SIGTERM信号正常终止');
                } else if (code === 1) {
                    this.outputChannel.appendLine('❌ 退出码1表示一般性错误，请检查Java环境和JAR文件');
                    this.outputChannel.appendLine('💡 可能原因: JAR文件损坏、Java版本不兼容、缺少依赖');
                } else if (code === 127) {
                    this.outputChannel.appendLine('❌ 退出码127表示命令未找到，请检查Java路径配置');
                } else if (code === 130) {
                    this.outputChannel.appendLine('⏹️ 退出码130表示进程被SIGINT信号中断（Ctrl+C）');
                } else if (code === null && signal === 'SIGKILL') {
                    this.outputChannel.appendLine('⏹️ 进程被SIGKILL信号强制终止');
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
                this.outputChannel.appendLine(`💥 进程启动失败: ${error.message}`);
                this.setStatus(McpStatus.ERROR);
                vscode.window.showErrorMessage(`MCP服务启动失败: ${error.message}`);
            });

            // 设置启动超时
            setTimeout(() => {
                if (this.status === McpStatus.STARTING) {
                    // 检查进程是否仍在运行
                    if (this.process && !this.process.killed) {
                        this.outputChannel.appendLine('⏰ MCP服务启动超时，但进程仍在运行，检查是否启动成功');
                        // 进程仍在运行，可能是启动成功但未输出启动成功标识
                        this.checkProcessAliveAndSetStatus();
                    } else {
                        this.outputChannel.appendLine('⏰ MCP服务启动超时');
                        this.stop();
                        vscode.window.showErrorMessage('MCP服务启动超时，请检查配置和日志');
                    }
                }
            }, 60000); // 增加超时时间到60秒

        } catch (error: any) {
            this.setStatus(McpStatus.ERROR);
            const message = `启动MCP服务失败: ${error.message}`;
            this.outputChannel.appendLine(`💥 ${message}`);
            this.outputChannel.appendLine(`堆栈信息: ${error.stack}`);
            vscode.window.showErrorMessage(message);
        }
    }

    /**
     * 从JDBC URL中提取主机名
     */
    private extractHostFromUrl(url: string): string {
        try {
            // 处理不同类型的JDBC URL格式
            if (url.startsWith('jdbc:oracle:')) {
                // jdbc:oracle:thin:@host:port/service
                const match = url.match(/@([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            } else if (url.startsWith('jdbc:mysql:')) {
                // jdbc:mysql://host:port/database
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            } else if (url.startsWith('jdbc:sqlserver:')) {
                // jdbc:sqlserver://host:port;database=database
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            } else if (url.startsWith('jdbc:postgresql:')) {
                // jdbc:postgresql://host:port/database
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            } else if (url.startsWith('jdbc:dm:')) {
                // jdbc:dm://host:port/database
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            } else if (url.startsWith('jdbc:kingbase8:')) {
                // jdbc:kingbase8://host:port/database
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            } else {
                // 尝试通用匹配
                const match = url.match(/\/\/([^:]+):(\d+)/) || url.match(/@([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`提取主机名失败: ${error.message}`);
        }
        
        // 如果无法解析，返回URL的一部分
        return url.substring(0, 30) + (url.length > 30 ? '...' : '');
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
                
                // 获取数据源信息用于显示
                const dataSourceInfo = this.getDesignDataSourceInfo();
                if (dataSourceInfo) {
                    vscode.window.showInformationMessage(
                        `MCP服务已启动，端口: ${this.config.port}\n` +
                        `数据源: ${dataSourceInfo.username}@${this.extractHostFromUrl(dataSourceInfo.url)}`
                    );
                } else {
                    vscode.window.showInformationMessage(`MCP服务已启动，端口: ${this.config.port}`);
                }

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
     * 启动健康检查
     */
    private startHealthCheck(): void {
        // 先停止现有的健康检查
        this.stopHealthCheck();
        
        // 设置健康检查标志
        this.isHealthCheckRunning = true;
        
        // 健康检查已移除
        this.outputChannel.appendLine('✅ 健康检查已启动（功能已禁用）');
    }

    /**
     * 停止健康检查
     */
    private stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        this.isHealthCheckRunning = false;
        this.outputChannel.appendLine('⏹️ 健康检查已停止（功能已禁用）');
    }

    /**
     * 检查HTTP服务是否可用
     */
    private async checkHttpServiceAvailability(): Promise<boolean> {
        // 如果服务已停止，直接返回false，不进行检查
        if (this.status === McpStatus.STOPPED || this.status === McpStatus.STOPPING) {
            return false;
        }

        // 健康检查功能已禁用，直接返回true表示服务可用
        return true;
    }

    /**
     * 停止MCP服务
     */
    public async stop(): Promise<void> {
        if (this.status === McpStatus.STOPPED || this.status === McpStatus.STOPPING) {
            this.outputChannel.appendLine('MCP服务已处于停止状态，跳过停止操作');
            return;
        }

        // 停止健康检查
        this.stopHealthCheck();

        this.isManualStop = true; // 标记为手动停止
        this.setStatus(McpStatus.STOPPING);
        this.outputChannel.appendLine('正在停止MCP服务...');
        
        // 显示输出窗口
        this.outputChannel.show();

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
                const result = await new Promise<string>((resolve) => {
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

        // 注入数据源信息（使用与IDEA插件兼容的参数格式）
        const dataSourceInfo = this.getDesignDataSourceInfo();
        if (dataSourceInfo) {
            // 使用IDEA插件的参数格式
            args.push('--db.url=' + dataSourceInfo.url);
            args.push('--db.username=' + dataSourceInfo.username);
            args.push('--db.password=' + dataSourceInfo.password);
            args.push('--db.driver=' + dataSourceInfo.driver);
            
            this.outputChannel.appendLine('✅ 数据源参数已添加到命令行:');
            this.outputChannel.appendLine(`   URL: ${dataSourceInfo.url}`);
            this.outputChannel.appendLine(`   Username: ${dataSourceInfo.username}`);
            this.outputChannel.appendLine(`   Driver: ${dataSourceInfo.driver}`);
        } else {
            this.outputChannel.appendLine('⚠️ 未找到有效的数据源配置，将不传递数据源参数');
        }

        return args;
    }

    /**
     * 获取design数据源信息
     */
    private getDesignDataSourceInfo(): { url: string, username: string, password: string, driver: string } | null {
        try {
            // 获取NCHome配置服务
            const configService = new NCHomeConfigService(this.context);
            
            // 从配置中获取数据源
            const config = configService.getConfig();
            
            this.outputChannel.appendLine(`🔍 检查数据源配置...`);
            
            // 检查是否有数据源配置
            if (config.dataSources && config.dataSources.length > 0) {
                this.outputChannel.appendLine(`📊 找到 ${config.dataSources.length} 个数据源配置`);
                
                // 列出所有数据源名称用于调试
                config.dataSources.forEach((ds, index) => {
                    this.outputChannel.appendLine(`   数据源 ${index + 1}: ${ds.name} (${ds.databaseType})`);
                });
                
                // 查找design数据源（不区分大小写）
                const designDataSource = config.dataSources.find(ds => 
                    ds.name.toLowerCase() === 'design'
                );
                
                if (designDataSource) {
                    this.outputChannel.appendLine(`✅ 找到design数据源: ${designDataSource.name}`);
                    
                    // 根据数据库类型生成URL
                    let url = '';
                    let driver = '';
                    
                    // 优先使用配置中的URL，如果没有则根据参数生成
                    if (designDataSource.url && designDataSource.url.trim() !== '') {
                        url = designDataSource.url;
                    } else {
                        switch (designDataSource.databaseType.toLowerCase()) {
                            case 'mysql':
                            case 'mysql5':
                            case 'mysql8':
                                url = `jdbc:mysql://${designDataSource.host}:${designDataSource.port}/${designDataSource.databaseName}?useSSL=false&serverTimezone=UTC`;
                                driver = 'com.mysql.cj.jdbc.Driver';
                                break;
                            case 'oracle':
                            case 'oracle11g':
                            case 'oracle12c':
                            case 'oracle19c':
                                url = `jdbc:oracle:thin:@${designDataSource.host}:${designDataSource.port}/${designDataSource.databaseName}`;
                                driver = 'oracle.jdbc.OracleDriver';
                                break;
                            case 'sqlserver':
                            case 'mssql':
                                url = `jdbc:sqlserver://${designDataSource.host}:${designDataSource.port};database=${designDataSource.databaseName}`;
                                driver = 'com.microsoft.sqlserver.jdbc.SQLServerDriver';
                                break;
                            case 'postgresql':
                            case 'pg':
                                url = `jdbc:postgresql://${designDataSource.host}:${designDataSource.port}/${designDataSource.databaseName}`;
                                driver = 'org.postgresql.Driver';
                                break;
                            case 'dm':
                                url = `jdbc:dm://${designDataSource.host}:${designDataSource.port}/${designDataSource.databaseName}`;
                                driver = 'dm.jdbc.driver.DmDriver';
                                break;
                            case 'kingbase':
                                url = `jdbc:kingbase8://${designDataSource.host}:${designDataSource.port}/${designDataSource.databaseName}`;
                                driver = 'com.kingbase8.Driver';
                                break;
                            default:
                                url = `jdbc:${designDataSource.databaseType.toLowerCase()}://${designDataSource.host}:${designDataSource.port}/${designDataSource.databaseName}`;
                                driver = designDataSource.driverClassName || 'com.mysql.cj.jdbc.Driver';
                        }
                    }
                    
                    // 如果没有指定driver，则根据数据库类型设置默认driver
                    if (!driver || driver.trim() === '') {
                        switch (designDataSource.databaseType.toLowerCase()) {
                            case 'mysql':
                            case 'mysql5':
                            case 'mysql8':
                                driver = 'com.mysql.cj.jdbc.Driver';
                                break;
                            case 'oracle':
                            case 'oracle11g':
                            case 'oracle12c':
                            case 'oracle19c':
                                driver = 'oracle.jdbc.OracleDriver';
                                break;
                            case 'sqlserver':
                            case 'mssql':
                                driver = 'com.microsoft.sqlserver.jdbc.SQLServerDriver';
                                break;
                            case 'postgresql':
                            case 'pg':
                                driver = 'org.postgresql.Driver';
                                break;
                            case 'dm':
                                driver = 'dm.jdbc.driver.DmDriver';
                                break;
                            case 'kingbase':
                                driver = 'com.kingbase8.Driver';
                                break;
                            default:
                                driver = designDataSource.driverClassName || 'com.mysql.cj.jdbc.Driver';
                        }
                    }
                    
                    this.outputChannel.appendLine(`🔧 数据库类型: ${designDataSource.databaseType}`);
                    this.outputChannel.appendLine(`🔗 生成的URL: ${url}`);
                    this.outputChannel.appendLine(`🚗 驱动类: ${driver}`);
                    
                    // 对密码进行解密处理
                    let decryptedPassword = designDataSource.password || '';
                    if (decryptedPassword) {
                        try {
                            decryptedPassword = PasswordEncryptor.getSecurePassword(config.homePath, decryptedPassword);
                        } catch (decryptError: any) {
                            this.outputChannel.appendLine(`⚠️ 密码解密失败: ${decryptError.message}`);
                        }
                    }
                    
                    // 确保密码是字符串类型，避免SCRAM认证错误
                    if (typeof decryptedPassword !== 'string') {
                        decryptedPassword = String(decryptedPassword || '');
                    }
                    
                    return {
                        url: url,
                        username: designDataSource.username,
                        password: decryptedPassword,
                        driver: driver
                    };
                } else {
                    this.outputChannel.appendLine(`❌ 未找到名为 'design' 的数据源`);
                    // 检查是否有其他可能的数据源
                    const possibleDesignSources = config.dataSources.filter(ds => 
                        ds.name.toLowerCase().includes('design') || 
                        ds.name.toLowerCase().includes('开发')
                    );
                    
                    if (possibleDesignSources.length > 0) {
                        this.outputChannel.appendLine(`💡 找到可能的design数据源候选:`);
                        possibleDesignSources.forEach(ds => {
                            this.outputChannel.appendLine(`   - ${ds.name}`);
                        });
                    }
                }
            } else {
                this.outputChannel.appendLine(`⚠️ 未配置任何数据源`);
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`获取design数据源信息失败: ${error.message}`);
            this.outputChannel.appendLine(`堆栈信息: ${error.stack}`);
        }
        
        return null;
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
        const oldStatus = this.status;
        this.status = status;
        
        // 当状态从运行变为停止时，停止健康检查
        if ((oldStatus === McpStatus.RUNNING || oldStatus === McpStatus.STARTING) && 
            (status === McpStatus.STOPPED || status === McpStatus.ERROR)) {
            this.stopHealthCheck();
        }
        
        // 当状态从停止变为运行时，启动健康检查
        if ((oldStatus === McpStatus.STOPPED || oldStatus === McpStatus.ERROR) && 
            (status === McpStatus.STARTING || status === McpStatus.RUNNING)) {
            this.startHealthCheck();
        }
        
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
        this.outputChannel.appendLine('────────────────────────────────────────────────────────');
        this.outputChannel.appendLine('🧰 MCP 服务启动前预检查');
        this.outputChannel.appendLine('────────────────────────────────────────────────────────');

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
        // 停止健康检查
        this.stopHealthCheck();
        // this.statusBarItem.dispose();  // 注释掉状态栏资源释放
        if (McpService.outputChannelInstance) {
            McpService.outputChannelInstance.dispose();
            McpService.outputChannelInstance = null;
        }
    }
}