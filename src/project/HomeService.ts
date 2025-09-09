import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { NCHomeConfigService } from './NCHomeConfigService';

/**
 * NC HOME服务状态
 */
export enum HomeStatus {
    STOPPED = 'stopped',
    STARTING = 'starting',
    RUNNING = 'running',
    STOPPING = 'stopping',
    ERROR = 'error'
}

/**
 * NC HOME服务管理类
 */
export class HomeService {
    private context: vscode.ExtensionContext;
    private configService: NCHomeConfigService;
    private process: ChildProcess | null = null;
    private status: HomeStatus = HomeStatus.STOPPED;
    private outputChannel: vscode.OutputChannel;
    private isManualStop: boolean = false;
    private startupCheckTimer: NodeJS.Timeout | null = null;

    constructor(context: vscode.ExtensionContext, configService: NCHomeConfigService) {
        this.context = context;
        this.configService = configService;
        this.outputChannel = vscode.window.createOutputChannel('YonBIP NC HOME服务');
    }

    /**
     * 启动NC HOME服务 (对应IDEA插件中的ServerDebugAction)
     */
    public async startHomeService(): Promise<void> {
        if (this.status === HomeStatus.RUNNING || this.status === HomeStatus.STARTING) {
            vscode.window.showWarningMessage('NC HOME服务已在运行中');
            return;
        }

        const config = this.configService.getConfig();
        
        // 检查是否配置了HOME路径
        if (!config.homePath) {
            vscode.window.showErrorMessage('请先配置NC HOME路径');
            return;
        }

        // 检查HOME路径是否存在
        if (!fs.existsSync(config.homePath)) {
            vscode.window.showErrorMessage(`NC HOME路径不存在: ${config.homePath}`);
            return;
        }

        try {
            this.setStatus(HomeStatus.STARTING);
            this.outputChannel.clear();
            this.outputChannel.appendLine('正在启动NC HOME服务...');

            // 确定启动脚本路径 (根据操作系统选择.bat或.sh)
            let startScriptPath = '';
            if (process.platform === 'win32') {
                startScriptPath = path.join(config.homePath, 'bin', 'start.bat');
            } else {
                startScriptPath = path.join(config.homePath, 'bin', 'start.sh');
            }

            // 检查启动脚本是否存在
            if (!fs.existsSync(startScriptPath)) {
                this.setStatus(HomeStatus.ERROR);
                this.outputChannel.appendLine(`启动脚本不存在: ${startScriptPath}`);
                vscode.window.showErrorMessage(`启动脚本不存在: ${startScriptPath}`);
                return;
            }

            this.outputChannel.appendLine(`执行启动脚本: ${startScriptPath}`);

            // 在Unix系统（macOS/Linux）上添加执行权限
            if (process.platform !== 'win32') {
                try {
                    fs.chmodSync(startScriptPath, 0o755);
                    this.outputChannel.appendLine(`已为脚本添加执行权限: ${startScriptPath}`);
                } catch (chmodError: any) {
                    this.outputChannel.appendLine(`添加执行权限失败: ${chmodError.message}`);
                }
            }

            // 启动HOME服务进程
            this.process = spawn(startScriptPath, {
                cwd: path.dirname(startScriptPath),
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false,
                env: {
                    ...process.env,
                    // 设置环境变量
                    HOME_PATH: config.homePath
                }
            });

            if (!this.process.pid) {
                throw new Error('HOME服务进程创建失败，无法获取进程ID');
            }

            this.outputChannel.appendLine(`HOME服务进程已创建，PID: ${this.process.pid}`);

            // 设置启动检查定时器
            this.startupCheckTimer = setTimeout(() => {
                if (this.status === HomeStatus.STARTING) {
                    this.outputChannel.appendLine('⚠️ 启动超时，可能需要更长时间或出现错误');
                    this.outputChannel.appendLine('💡 请检查日志输出以获取更多信息');
                }
            }, 60000); // 60秒超时

            // 处理进程输出
            this.process.stdout?.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(`[STDOUT] ${output}`);
                
                // 检查启动成功标识 - 扩展检测范围
                if (output.includes('Server startup') || 
                    output.includes('服务启动成功') ||
                    output.includes('Started successfully') ||
                    output.includes('Tomcat started') ||
                    output.includes('Started application') ||
                    output.includes('Nacos started') ||
                    output.includes('服务已启动') ||
                    output.includes('startup success') ||
                    output.includes('server started')) {
                    this.outputChannel.appendLine('✓ 检测到NC HOME服务启动成功标识');
                    if (this.startupCheckTimer) {
                        clearTimeout(this.startupCheckTimer);
                        this.startupCheckTimer = null;
                    }
                    this.setStatus(HomeStatus.RUNNING);
                    vscode.window.showInformationMessage('NC HOME服务已启动');
                }
            });

            this.process.stderr?.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(`[STDERR] ${output}`);
                
                // 检查错误标识
                if (output.includes('ERROR') || 
                    output.includes('Exception') ||
                    output.includes('错误') ||
                    output.includes('Failed') ||
                    output.includes('failed')) {
                    this.outputChannel.appendLine('❌ 检测到错误信息');
                }
            });

            // 处理进程退出
            this.process.on('close', (code) => {
                this.outputChannel.appendLine(`HOME服务进程已退出，退出码: ${code}`);
                if (this.startupCheckTimer) {
                    clearTimeout(this.startupCheckTimer);
                    this.startupCheckTimer = null;
                }
                if (!this.isManualStop && this.status !== HomeStatus.STOPPING) {
                    this.setStatus(HomeStatus.STOPPED);
                    if (code !== 0) {
                        vscode.window.showErrorMessage(`NC HOME服务异常退出，退出码: ${code}`);
                    } else {
                        vscode.window.showInformationMessage('NC HOME服务已停止');
                    }
                } else {
                    this.setStatus(HomeStatus.STOPPED);
                }
                this.isManualStop = false;
            });

            // 处理进程错误
            this.process.on('error', (error) => {
                this.outputChannel.appendLine(`HOME服务进程启动失败: ${error.message}`);
                if (this.startupCheckTimer) {
                    clearTimeout(this.startupCheckTimer);
                    this.startupCheckTimer = null;
                }
                this.setStatus(HomeStatus.ERROR);
                vscode.window.showErrorMessage(`启动NC HOME服务失败: ${error.message}`);
            });

            // 显示输出面板
            this.outputChannel.show();

        } catch (error: any) {
            this.outputChannel.appendLine(`启动NC HOME服务失败: ${error.message}`);
            if (this.startupCheckTimer) {
                clearTimeout(this.startupCheckTimer);
                this.startupCheckTimer = null;
            }
            this.setStatus(HomeStatus.ERROR);
            vscode.window.showErrorMessage(`启动NC HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 停止NC HOME服务
     */
    public async stopHomeService(): Promise<void> {
        if (this.status !== HomeStatus.RUNNING && this.status !== HomeStatus.STARTING) {
            vscode.window.showWarningMessage('NC HOME服务未在运行');
            return;
        }

        try {
            this.setStatus(HomeStatus.STOPPING);
            this.isManualStop = true;
            this.outputChannel.appendLine('正在停止NC HOME服务...');

            const config = this.configService.getConfig();
            
            // 确定停止脚本路径
            let stopScriptPath = '';
            if (process.platform === 'win32') {
                stopScriptPath = path.join(config.homePath, 'bin', 'stop.bat');
            } else {
                stopScriptPath = path.join(config.homePath, 'bin', 'stop.sh');
            }

            // 检查停止脚本是否存在
            if (fs.existsSync(stopScriptPath)) {
                // 在Unix系统（macOS/Linux）上添加执行权限
                if (process.platform !== 'win32') {
                    try {
                        fs.chmodSync(stopScriptPath, 0o755);
                        this.outputChannel.appendLine(`已为脚本添加执行权限: ${stopScriptPath}`);
                    } catch (chmodError: any) {
                        this.outputChannel.appendLine(`添加执行权限失败: ${chmodError.message}`);
                    }
                }
                
                // 执行停止脚本
                const stopProcess = spawn(stopScriptPath, {
                    cwd: path.dirname(stopScriptPath),
                    stdio: ['pipe', 'pipe', 'pipe'],
                    detached: false
                });

                stopProcess.on('close', (code) => {
                    this.outputChannel.appendLine(`停止脚本执行完成，退出码: ${code}`);
                });

                stopProcess.on('error', (error) => {
                    this.outputChannel.appendLine(`执行停止脚本失败: ${error.message}`);
                    // 如果脚本执行失败，则强制终止进程
                    this.killProcess();
                });
            } else {
                // 如果没有停止脚本，则直接终止进程
                this.outputChannel.appendLine(`停止脚本不存在: ${stopScriptPath}，直接终止进程`);
                this.killProcess();
            }

            // 设置超时，如果一段时间后进程仍未停止则强制终止
            setTimeout(() => {
                if (this.status === HomeStatus.STOPPING) {
                    this.outputChannel.appendLine('停止服务超时，强制终止进程');
                    this.killProcess();
                }
            }, 10000); // 10秒超时

        } catch (error: any) {
            this.outputChannel.appendLine(`停止NC HOME服务失败: ${error.message}`);
            this.setStatus(HomeStatus.ERROR);
            this.isManualStop = false;
            vscode.window.showErrorMessage(`停止NC HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 强制终止进程
     */
    private killProcess(): void {
        if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
        }
        this.setStatus(HomeStatus.STOPPED);
        this.isManualStop = false;
    }

    /**
     * 获取服务状态
     */
    public getStatus(): HomeStatus {
        return this.status;
    }

    /**
     * 设置服务状态
     */
    private setStatus(status: HomeStatus): void {
        this.status = status;
    }

    /**
     * 显示服务日志
     */
    public showLogs(): void {
        this.outputChannel.show();
    }
}