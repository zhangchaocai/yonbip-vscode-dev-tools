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
     * 修改为直接运行jar包的方式，而不是执行脚本
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
            
            // 检查Java环境
            this.outputChannel.appendLine('检查Java环境...');
            try {
                const javaCheck = spawn('java', ['-version'], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                javaCheck.on('error', (error) => {
                    this.outputChannel.appendLine(`❌ Java环境检查失败: ${error.message}`);
                    this.outputChannel.appendLine('💡 请确保Java已正确安装并配置在系统PATH环境变量中');
                });
                
                javaCheck.stderr?.on('data', (data) => {
                    const output = data.toString();
                    this.outputChannel.appendLine(`Java版本信息: ${output.trim()}`);
                });
                
                javaCheck.on('close', (code) => {
                    if (code === 0) {
                        this.outputChannel.appendLine('✅ Java环境检查通过');
                    } else {
                        this.outputChannel.appendLine(`❌ Java环境检查失败，退出码: ${code}`);
                    }
                });
            } catch (javaError: any) {
                this.outputChannel.appendLine(`❌ Java环境检查异常: ${javaError.message}`);
                this.outputChannel.appendLine('💡 请确保Java已正确安装并配置在系统PATH环境变量中');
            }

            // 确定核心jar包路径
            const coreJarPath = path.join(config.homePath, 'middleware', 'core.jar');
            
            // 检查核心jar包是否存在
            if (!fs.existsSync(coreJarPath)) {
                this.setStatus(HomeStatus.ERROR);
                this.outputChannel.appendLine(`❌ 核心jar包不存在: ${coreJarPath}`);
                this.outputChannel.appendLine('💡 请检查NC HOME路径配置是否正确');
                vscode.window.showErrorMessage(`核心jar包不存在: ${coreJarPath}`);
                return;
            }
            
            this.outputChannel.appendLine(`✅ 核心jar包存在: ${coreJarPath}`);

            // 确定主类名
            let mainClass = 'ufmiddle.start.tomcat.StartDirectServer';
            
            // 检查是否是wj版本
            try {
                const StreamZip = require('node-stream-zip');
                const jarFile = new StreamZip.async({ file: coreJarPath });
                const entries = await jarFile.entries();
                for (const entry of Object.values(entries)) {
                    const name = (entry as any).name;
                    if (name.indexOf('ufmiddle') === 0 && name.includes('StartDirectServer.class')) {
                        if (name.includes('wj')) {
                            mainClass = 'ufmiddle.start.wj.StartDirectServer';
                            break;
                        }
                    }
                }
                await jarFile.close();
            } catch (err) {
                this.outputChannel.appendLine(`⚠️ 检查jar包内容失败: ${err}`);
                this.outputChannel.appendLine('💡 将使用默认主类: ufmiddle.start.tomcat.StartDirectServer');
            }

            this.outputChannel.appendLine(`主类: ${mainClass}`);

            // 构建JVM参数
            const vmParameters = this.buildVMParameters(config);

            // 构建环境变量
            const envs = this.buildEnvironmentVariables(config);

            // 构建完整的命令行参数
            const args = [
                ...vmParameters,
                '-cp',
                coreJarPath,
                mainClass
            ];

            this.outputChannel.appendLine(`JVM参数: ${vmParameters.join(' ')}`);
            this.outputChannel.appendLine(`执行命令: java ${args.join(' ')}`);
            this.outputChannel.appendLine(`工作目录: ${config.homePath}`);

            // 启动HOME服务进程
            this.process = spawn('java', args, {
                cwd: config.homePath,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false,
                env: {
                    ...process.env,
                    ...envs
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
                    this.outputChannel.appendLine('💡 可能的原因:');
                    this.outputChannel.appendLine('   1. 端口被占用');
                    this.outputChannel.appendLine('   2. 数据库连接配置错误');
                    this.outputChannel.appendLine('   3. 内存不足');
                    this.outputChannel.appendLine('   4. NC HOME配置不正确');
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
                    output.includes('server started') ||
                    output.includes('Connector started') ||
                    output.includes('Started Tomcat') ||
                    output.includes('Tomcat start') ||
                    output.includes('Application started')) {
                    this.outputChannel.appendLine('✓ 检测到NC HOME服务启动成功标识');
                    if (this.startupCheckTimer) {
                        clearTimeout(this.startupCheckTimer);
                        this.startupCheckTimer = null;
                    }
                    this.setStatus(HomeStatus.RUNNING);
                    vscode.window.showInformationMessage('NC HOME服务已启动');
                }
                
                // 检查启动失败标识
                if (output.includes('FAILED') || 
                    output.includes('启动失败') ||
                    output.includes('Startup failed') ||
                    output.includes('Failed to start') ||
                    output.includes('Exception') ||
                    output.includes('ERROR') ||
                    output.includes('错误')) {
                    this.outputChannel.appendLine('❌ 检测到NC HOME服务启动失败标识');
                    this.outputChannel.appendLine('💡 请检查上面的日志输出以获取详细错误信息');
                    if (this.startupCheckTimer) {
                        clearTimeout(this.startupCheckTimer);
                        this.startupCheckTimer = null;
                    }
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
                    output.includes('failed') ||
                    output.includes('Caused by') ||
                    output.includes('Exception in thread')) {
                    this.outputChannel.appendLine('❌ 检测到错误信息');
                    this.outputChannel.appendLine('💡 请仔细检查以上错误信息');
                }
            });

            // 处理进程退出
            this.process.on('close', (code, signal) => {
                this.outputChannel.appendLine(`HOME服务进程已退出，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);
                
                // 详细的退出码分析
                if (code === 1) {
                    this.outputChannel.appendLine('❌ 退出码1表示一般性错误，请检查以下可能原因:');
                    this.outputChannel.appendLine('   1. Java环境配置不正确');
                    this.outputChannel.appendLine('   2. NC HOME路径配置错误');
                    this.outputChannel.appendLine('   3. 核心jar包损坏或不兼容');
                    this.outputChannel.appendLine('   4. 端口被占用');
                    this.outputChannel.appendLine('   5. 缺少必要的系统权限');
                    this.outputChannel.appendLine('💡 建议检查Java版本是否符合要求(建议使用JDK 8或JDK 17)');
                } else if (code === 127) {
                    this.outputChannel.appendLine('❌ 退出码127表示命令未找到，请检查Java是否正确安装并配置在PATH环境变量中');
                } else if (code === 130) {
                    this.outputChannel.appendLine('⚠️ 退出码130表示进程被SIGINT信号中断(Ctrl+C)');
                } else if (code === 143) {
                    this.outputChannel.appendLine('ℹ️ 退出码143表示进程被SIGTERM信号正常终止');
                } else if (code !== 0 && code !== null) {
                    this.outputChannel.appendLine(`❌ 检测到异常退出码: ${code}`);
                    this.outputChannel.appendLine('💡 请检查上面的日志输出以获取更多错误信息');
                }
                
                if (this.startupCheckTimer) {
                    clearTimeout(this.startupCheckTimer);
                    this.startupCheckTimer = null;
                }
                if (!this.isManualStop && this.status !== HomeStatus.STOPPING) {
                    this.setStatus(HomeStatus.STOPPED);
                    if (code !== 0 && code !== null && code !== 143) {
                        vscode.window.showErrorMessage(`NC HOME服务异常退出，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);
                    } else if (code === 0 || code === 143) {
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
                this.outputChannel.appendLine(`详细错误信息: ${JSON.stringify(error)}`);
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
            this.outputChannel.appendLine(`详细错误堆栈: ${error.stack}`);
            if (this.startupCheckTimer) {
                clearTimeout(this.startupCheckTimer);
                this.startupCheckTimer = null;
            }
            this.setStatus(HomeStatus.ERROR);
            vscode.window.showErrorMessage(`启动NC HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 构建JVM参数
     */
    private buildVMParameters(config: any): string[] {
        const vmParameters: string[] = [];
        
        // 默认JVM参数
        vmParameters.push('-Dnc.exclude.modules=' + (config.exModules || ''));
        vmParameters.push('-Dnc.runMode=develop');
        vmParameters.push('-Dnc.server.location=' + config.homePath);
        vmParameters.push('-DEJBConfigDir=' + config.homePath + '/ejbXMLs');
        vmParameters.push('-Dorg.owasp.esapi.resources=' + config.homePath + '/ierp/bin/esapi');
        vmParameters.push('-DExtServiceConfigDir=' + config.homePath + '/ejbXMLs');
        vmParameters.push('-Duap.hotwebs=' + (config.hotwebs || 'nccloud,fs,yonbip'));
        vmParameters.push('-Duap.disable.codescan=false');
        vmParameters.push('-Xmx1024m');
        vmParameters.push('-Dfile.encoding=UTF-8');
        vmParameters.push('-Duser.timezone=GMT+8');
        
        // Java 17 兼容性参数
        if (process.version.startsWith('v17') || process.version.startsWith('v18') || process.version.startsWith('v19')) {
            vmParameters.push('--add-opens=java.base/java.lang=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.lang.reflect=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/jdk.internal.reflect=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.lang.invoke=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.io=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.nio.charset=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.net=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.util.concurrent=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.util=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.xml/javax.xml=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.xml/javax.xml.stream=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.rmi/sun.rmi.transport=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.naming/javax.naming=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.management/javax.management=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.comp=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.model=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.processing=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED');
            vmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.jvm=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.desktop/java.awt.image=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.desktop/sun.awt=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.security=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.lang.ref=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.desktop/javax.swing=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.desktop/javax.accessibility=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.desktop/java.beans=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.desktop/java.awt=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.desktop/sun.swing=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.desktop/java.awt.color=ALL-UNNAMED');
        }
        
        // macOS隐藏Dock图标参数
        if (process.platform === 'darwin') {
            vmParameters.push('-Dapple.awt.UIElement=true');
        }
        
        return vmParameters;
    }

    /**
     * 构建环境变量
     */
    private buildEnvironmentVariables(config: any): any {
        const envs: any = {};
        
        // 兼容旧参数
        envs.FIELD_NC_HOME = config.homePath;
        envs.FIELD_HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        
        // 新参数
        envs.IDEA_FIELD_NC_HOME = config.homePath;
        envs.IDEA_FIELD_HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        envs.IDEA_FIELD_EX_MODULES = config.exModules || '';
        
        // 添加更多环境变量
        envs.NC_HOME = config.homePath;
        envs.HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        envs.EX_MODULES = config.exModules || '';
        
        return envs;
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
            try {
                // 首先尝试正常终止
                this.process.kill('SIGTERM');
                
                // 如果进程在1秒内没有终止，则强制杀死
                setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        this.process.kill('SIGKILL');
                    }
                }, 1000);
            } catch (error: any) {
                this.outputChannel.appendLine(`终止进程失败: ${error.message}`);
            }
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

    /**
     * 重启NC HOME服务
     */
    public async restartHomeService(): Promise<void> {
        this.outputChannel.appendLine('正在重启NC HOME服务...');
        await this.stopHomeService();
        
        // 等待服务完全停止
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 重新启动服务
        await this.startHomeService();
    }

    /**
     * 检查服务是否正在运行
     */
    public isRunning(): boolean {
        return this.status === HomeStatus.RUNNING;
    }

    /**
     * 获取进程ID
     */
    public getProcessId(): number | null {
        return this.process?.pid || null;
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        if (this.startupCheckTimer) {
            clearTimeout(this.startupCheckTimer);
            this.startupCheckTimer = null;
        }
        
        if (this.process && !this.process.killed) {
            this.process.kill();
        }
        
        this.outputChannel.dispose();
    }
}