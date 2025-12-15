"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpService = exports.McpStatus = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const NCHomeConfigService_1 = require("../project/nc-home/config/NCHomeConfigService");
const PasswordEncryptor_1 = require("../utils/PasswordEncryptor");
const StatisticsService_1 = require("../utils/StatisticsService");
var McpStatus;
(function (McpStatus) {
    McpStatus["STOPPED"] = "stopped";
    McpStatus["STARTING"] = "starting";
    McpStatus["RUNNING"] = "running";
    McpStatus["STOPPING"] = "stopping";
    McpStatus["ERROR"] = "error";
})(McpStatus || (exports.McpStatus = McpStatus = {}));
class McpService {
    context;
    static outputChannelInstance = null;
    process = null;
    status = McpStatus.STOPPED;
    config;
    isManualStop = false;
    healthCheckInterval = null;
    isHealthCheckRunning = false;
    outputChannel;
    constructor(context) {
        this.context = context;
        this.config = this.loadConfig();
        if (!McpService.outputChannelInstance) {
            McpService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP MCP服务');
        }
        this.outputChannel = McpService.outputChannelInstance;
        this.initializeBuiltinJar();
    }
    async initializeBuiltinJar() {
        const builtinJarPath = path.join(this.context.extensionPath, 'resources', 'yonyou-mcp.jar');
        if (fs.existsSync(builtinJarPath)) {
            if (!this.config.jarPath || !fs.existsSync(this.config.jarPath)) {
                this.config.jarPath = builtinJarPath;
                await this.saveConfig(this.config);
                this.outputChannel.appendLine(`自动设置内置MCP JAR路径: ${builtinJarPath}`);
            }
        }
        else {
            this.outputChannel.appendLine('警告: 未找到内置MCP JAR文件，请检查插件安装');
        }
    }
    loadConfig() {
        const config = this.context.globalState.get('mcp.config');
        return {
            port: (config && config.port) || 9000,
            jarPath: (config && config.jarPath) || '',
            javaPath: (config && config.javaPath) || 'java',
            maxMemory: (config && config.maxMemory) || '512m'
        };
    }
    getDefaultConfig() {
        return {
            port: 9000,
            jarPath: '',
            javaPath: 'java',
            maxMemory: '512m'
        };
    }
    async saveConfig(config) {
        const configWithDefaults = {
            port: config.port || 9000,
            jarPath: config.jarPath || '',
            javaPath: config.javaPath || 'java',
            maxMemory: config.maxMemory || '512m'
        };
        this.config = configWithDefaults;
        await this.context.globalState.update('mcp.config', configWithDefaults);
    }
    getConfig() {
        return {
            port: this.config.port || 9000,
            jarPath: this.config.jarPath || '',
            javaPath: this.config.javaPath || 'java',
            maxMemory: this.config.maxMemory || '512m'
        };
    }
    getStatus() {
        return this.status;
    }
    async isServiceAlive() {
        try {
            const httpAlive = await this.checkHttpServiceAvailability();
            if (httpAlive)
                return true;
        }
        catch (e) {
        }
        return this.isProcessAlive();
    }
    isProcessAlive() {
        const cp = this.process;
        if (!cp || !cp.pid)
            return false;
        try {
            process.kill(cp.pid, 0);
            return true;
        }
        catch {
            return false;
        }
    }
    async start() {
        if (this.status === McpStatus.RUNNING || this.status === McpStatus.STARTING) {
            vscode.window.showWarningMessage('MCP服务已在运行中');
            return;
        }
        try {
            this.setStatus(McpStatus.STARTING);
            this.outputChannel.clear();
            this.outputChannel.appendLine('🚀 正在启动MCP服务...');
            this.outputChannel.appendLine(`📅 启动时间: ${new Date().toLocaleString()}`);
            this.outputChannel.show();
            this.startHealthCheck();
            this.outputChannel.appendLine('🔍 正在获取design数据源信息...');
            const dataSourceInfo = this.getDesignDataSourceInfo();
            if (dataSourceInfo) {
                this.outputChannel.appendLine(`🔗 连接数据源信息:`);
                this.outputChannel.appendLine(`   URL: ${dataSourceInfo.url}`);
                this.outputChannel.appendLine(`   用户名: ${dataSourceInfo.username}`);
                this.outputChannel.appendLine(`   驱动: ${dataSourceInfo.driver}`);
                this.outputChannel.appendLine(`✅ 数据源信息获取成功`);
            }
            else {
                this.outputChannel.appendLine('⚠️ 未找到design数据源配置');
                this.outputChannel.appendLine('💡 提示: 请确保在NC HOME配置中设置了名为"design"的数据源');
            }
            this.outputChannel.appendLine('📋 执行启动前预检查...');
            const preCheckPassed = await this.preStartCheck();
            if (!preCheckPassed) {
                this.outputChannel.appendLine('❌ 启动前预检查失败');
                this.setStatus(McpStatus.ERROR);
                return;
            }
            this.outputChannel.appendLine('✅ 启动前预检查通过');
            this.outputChannel.appendLine('🔍 验证MCP服务配置...');
            await this.validateConfig();
            this.outputChannel.appendLine('✅ MCP服务配置验证通过');
            this.outputChannel.appendLine('🔨 构建命令行参数...');
            const args = this.buildCommandArgs();
            this.outputChannel.appendLine('✅ 命令行参数构建完成');
            this.outputChannel.appendLine(`🚀 执行命令: ${this.config.javaPath} ${args.join(' ')}`);
            this.outputChannel.appendLine('🏃 正在创建Java进程...');
            const env = {
                ...process.env,
                JAVA_OPTS: '-Dfile.encoding=UTF-8',
                ELECTRON_RUN_AS_NODE: undefined
            };
            this.process = (0, child_process_1.spawn)(this.config.javaPath, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: true,
                env: env,
                cwd: path.dirname(this.config.jarPath)
            });
            if (!this.process.pid) {
                throw new Error('Java进程创建失败，无法获取进程ID');
            }
            this.outputChannel.appendLine(`✅ Java进程已创建，PID: ${this.process.pid}`);
            this.process.on('spawn', () => {
                this.outputChannel.appendLine('🔄 Java进程spawn事件触发');
            });
            this.process.stdout?.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(`[STDOUT] ${output}`);
                if (output.includes('yonyou-mcp应用启动成功') ||
                    output.includes('Server started') ||
                    output.includes('访问: http://') ||
                    output.includes('Tomcat started on port') ||
                    output.includes('Started Application') ||
                    output.includes('MCP服务启动完成') ||
                    output.includes('Started YonBipMcpApplication')) {
                    this.outputChannel.appendLine('🎉 检测到MCP服务启动成功标识');
                    setTimeout(async () => {
                        const isAvailable = await this.checkHttpServiceAvailability();
                        if (isAvailable) {
                            this.setStatus(McpStatus.RUNNING);
                            const dataSourceInfo = this.getDesignDataSourceInfo();
                            if (dataSourceInfo) {
                                vscode.window.showInformationMessage(`MCP服务已启动，端口: ${this.config.port}\n` +
                                    `数据源: ${dataSourceInfo.username}@${this.extractHostFromUrl(dataSourceInfo.url)}`);
                            }
                            else {
                                vscode.window.showInformationMessage(`MCP服务已启动，端口: ${this.config.port}`);
                            }
                            vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
                            StatisticsService_1.StatisticsService.incrementCount(StatisticsService_1.StatisticsService.MCP_START_COUNT);
                        }
                        else {
                            this.outputChannel.appendLine('❌ 虽然检测到启动成功标识，但服务健康检查失败');
                            this.setStatus(McpStatus.ERROR);
                        }
                    }, 2000);
                }
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
                if (code === 143 || (code === null && signal === 'SIGTERM')) {
                    this.outputChannel.appendLine('⏹️ 进程被SIGTERM信号正常终止');
                }
                else if (code === 1) {
                    this.outputChannel.appendLine('❌ 退出码1表示一般性错误，请检查Java环境和JAR文件');
                    this.outputChannel.appendLine('💡 可能原因: JAR文件损坏、Java版本不兼容、缺少依赖');
                }
                else if (code === 127) {
                    this.outputChannel.appendLine('❌ 退出码127表示命令未找到，请检查Java路径配置');
                }
                else if (code === 130) {
                    this.outputChannel.appendLine('⏹️ 退出码130表示进程被SIGINT信号中断（Ctrl+C）');
                }
                else if (code === null && signal === 'SIGKILL') {
                    this.outputChannel.appendLine('⏹️ 进程被SIGKILL信号强制终止');
                }
                this.setStatus(McpStatus.STOPPED);
                this.process = null;
                if (code !== 0 && code !== null && code !== 143 && !this.isManualStop) {
                    vscode.window.showErrorMessage(`MCP服务异常退出，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);
                }
                this.isManualStop = false;
            });
            this.process.on('error', (error) => {
                this.outputChannel.appendLine(`💥 进程启动失败: ${error.message}`);
                this.setStatus(McpStatus.ERROR);
                vscode.window.showErrorMessage(`MCP服务启动失败: ${error.message}`);
            });
            setTimeout(() => {
                if (this.status === McpStatus.STARTING) {
                    if (this.process && !this.process.killed) {
                        this.outputChannel.appendLine('⏰ MCP服务启动超时，但进程仍在运行，检查是否启动成功');
                        this.checkProcessAliveAndSetStatus();
                    }
                    else {
                        this.outputChannel.appendLine('⏰ MCP服务启动超时');
                        this.stop();
                        vscode.window.showErrorMessage('MCP服务启动超时，请检查配置和日志');
                    }
                }
            }, 60000);
        }
        catch (error) {
            this.setStatus(McpStatus.ERROR);
            const message = `启动MCP服务失败: ${error.message}`;
            this.outputChannel.appendLine(`💥 ${message}`);
            this.outputChannel.appendLine(`堆栈信息: ${error.stack}`);
            vscode.window.showErrorMessage(message);
        }
    }
    extractHostFromUrl(url) {
        try {
            if (url.startsWith('jdbc:oracle:')) {
                const match = url.match(/@([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            }
            else if (url.startsWith('jdbc:mysql:')) {
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            }
            else if (url.startsWith('jdbc:sqlserver:')) {
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            }
            else if (url.startsWith('jdbc:postgresql:')) {
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            }
            else if (url.startsWith('jdbc:dm:')) {
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            }
            else if (url.startsWith('jdbc:kingbase8:')) {
                const match = url.match(/\/\/([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            }
            else {
                const match = url.match(/\/\/([^:]+):(\d+)/) || url.match(/@([^:]+):(\d+)/);
                if (match) {
                    return match[1];
                }
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`提取主机名失败: ${error.message}`);
        }
        return url.substring(0, 30) + (url.length > 30 ? '...' : '');
    }
    async checkProcessAliveAndSetStatus() {
        try {
            const isAvailable = await this.checkHttpServiceAvailability();
            if (isAvailable) {
                this.outputChannel.appendLine('✓ 检测到MCP服务HTTP接口可用，设置为运行状态');
                this.setStatus(McpStatus.RUNNING);
                const dataSourceInfo = this.getDesignDataSourceInfo();
                if (dataSourceInfo) {
                    vscode.window.showInformationMessage(`MCP服务已启动，端口: ${this.config.port}\n` +
                        `数据源: ${dataSourceInfo.username}@${this.extractHostFromUrl(dataSourceInfo.url)}`);
                }
                else {
                    vscode.window.showInformationMessage(`MCP服务已启动，端口: ${this.config.port}`);
                }
                vscode.commands.executeCommand('workbench.view.extension.yonbip-view');
            }
            else {
                this.outputChannel.appendLine('❌ MCP服务HTTP接口不可用，设置为错误状态');
                this.setStatus(McpStatus.ERROR);
                this.stop();
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`检查进程状态失败: ${error.message}`);
            this.setStatus(McpStatus.ERROR);
        }
    }
    startHealthCheck() {
        this.stopHealthCheck();
        this.isHealthCheckRunning = true;
        this.outputChannel.appendLine('✅ 健康检查已启动（功能已禁用）');
    }
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        this.isHealthCheckRunning = false;
        this.outputChannel.appendLine('⏹️ 健康检查已停止（功能已禁用）');
    }
    async checkHttpServiceAvailability() {
        if (this.status === McpStatus.STOPPED || this.status === McpStatus.STOPPING) {
            return false;
        }
        return true;
    }
    async stop() {
        if (this.status === McpStatus.STOPPED || this.status === McpStatus.STOPPING) {
            this.outputChannel.appendLine('MCP服务已处于停止状态，跳过停止操作');
            return;
        }
        this.stopHealthCheck();
        this.isManualStop = true;
        this.setStatus(McpStatus.STOPPING);
        this.outputChannel.appendLine('正在停止MCP服务...');
        this.outputChannel.show();
        if (this.process) {
            return new Promise((resolve) => {
                if (!this.process) {
                    this.setStatus(McpStatus.STOPPED);
                    vscode.window.showInformationMessage('MCP服务已停止');
                    resolve();
                    return;
                }
                this.process.removeAllListeners('close');
                this.process.removeAllListeners('exit');
                this.process.removeAllListeners('error');
                const onProcessEnd = () => {
                    this.outputChannel.appendLine('MCP进程已结束');
                    this.process = null;
                    this.setStatus(McpStatus.STOPPED);
                    this.isManualStop = false;
                    vscode.window.showInformationMessage('MCP服务已停止');
                    resolve();
                };
                this.process.once('close', onProcessEnd);
                this.process.once('exit', onProcessEnd);
                this.outputChannel.appendLine('发送SIGTERM信号...');
                this.process.kill('SIGTERM');
                const forceKillTimeout = setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        this.outputChannel.appendLine('优雅关闭超时，强制终止进程...');
                        this.process.kill('SIGKILL');
                        setTimeout(() => {
                            if (this.process) {
                                this.outputChannel.appendLine('强制终止完成');
                                onProcessEnd();
                            }
                        }, 2000);
                    }
                }, 5000);
                const totalTimeout = setTimeout(() => {
                    this.outputChannel.appendLine('停止操作超时，强制设置为停止状态');
                    clearTimeout(forceKillTimeout);
                    this.process = null;
                    this.setStatus(McpStatus.STOPPED);
                    this.isManualStop = false;
                    vscode.window.showWarningMessage('MCP服务停止超时，已强制设置为停止状态');
                    resolve();
                }, 10000);
                this.process.once('close', () => {
                    clearTimeout(forceKillTimeout);
                    clearTimeout(totalTimeout);
                });
            });
        }
        else {
            this.outputChannel.appendLine('没有发现运行中的MCP进程');
            this.setStatus(McpStatus.STOPPED);
            this.isManualStop = false;
            vscode.window.showInformationMessage('MCP服务已停止');
        }
    }
    async validateConfig() {
        this.outputChannel.appendLine('开始验证MCP服务配置...');
        if (!this.config.javaPath) {
            throw new Error('Java路径未配置');
        }
        if (this.config.javaPath === 'java') {
            try {
                const { exec } = require('child_process');
                const javaPath = await new Promise((resolve, reject) => {
                    exec('which java', (error, stdout) => {
                        if (error) {
                            reject(new Error(`无法找到Java可执行文件: ${error.message}`));
                        }
                        else {
                            const path = stdout.trim();
                            this.outputChannel.appendLine(`发现Java路径: ${path}`);
                            resolve(path);
                        }
                    });
                });
                if (javaPath && fs.existsSync(javaPath)) {
                    this.config.javaPath = javaPath;
                    await this.saveConfig(this.config);
                }
            }
            catch (error) {
                this.outputChannel.appendLine(`警告: 无法解析Java路径，使用默认命令: ${error.message}`);
            }
        }
        else if (!fs.existsSync(this.config.javaPath)) {
            throw new Error(`Java可执行文件不存在: ${this.config.javaPath}`);
        }
        try {
            const { exec } = require('child_process');
            await new Promise((resolve, reject) => {
                exec(`"${this.config.javaPath}" -version`, (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(`Java版本检查失败: ${error.message}`));
                    }
                    else {
                        const version = stderr || stdout;
                        this.outputChannel.appendLine(`Java版本: ${version.split('\n')[0]}`);
                        resolve(version);
                    }
                });
            });
        }
        catch (error) {
            throw new Error(`Java环境验证失败: ${error.message}`);
        }
        if (!this.config.jarPath) {
            const builtinJarPath = path.join(this.context.extensionPath, 'resources', 'yonyou-mcp.jar');
            if (fs.existsSync(builtinJarPath)) {
                this.config.jarPath = builtinJarPath;
                await this.saveConfig(this.config);
                this.outputChannel.appendLine(`使用内置JAR文件: ${builtinJarPath}`);
            }
            else {
                throw new Error('MCP JAR文件未找到，请检查插件安装是否完整');
            }
        }
        if (!fs.existsSync(this.config.jarPath)) {
            const builtinJarPath = path.join(this.context.extensionPath, 'resources', 'yonyou-mcp.jar');
            if (fs.existsSync(builtinJarPath)) {
                this.config.jarPath = builtinJarPath;
                await this.saveConfig(this.config);
                this.outputChannel.appendLine(`配置的JAR不存在，切换到内置JAR: ${builtinJarPath}`);
            }
            else {
                throw new Error(`MCP JAR文件不存在: ${this.config.jarPath}`);
            }
        }
        this.outputChannel.appendLine(`检查JAR文件: ${this.config.jarPath}`);
        const jarStats = fs.statSync(this.config.jarPath);
        this.outputChannel.appendLine(`JAR文件大小: ${(jarStats.size / 1024 / 1024).toFixed(2)} MB`);
        try {
            fs.accessSync(this.config.jarPath, fs.constants.R_OK);
            this.outputChannel.appendLine('JAR文件权限检查通过✓');
        }
        catch (error) {
            throw new Error(`JAR文件无法读取: ${error.message}`);
        }
        this.outputChannel.appendLine(`检查端口: ${this.config.port}`);
        if (this.config.port < 1024 || this.config.port > 65535) {
            throw new Error('端口号必须在1024-65535之间');
        }
        const isPortAvailable = await this.isPortAvailable(this.config.port);
        if (!isPortAvailable) {
            this.outputChannel.appendLine(`警告: 端口 ${this.config.port} 已被占用`);
            try {
                const { exec } = require('child_process');
                const result = await new Promise((resolve) => {
                    exec(`lsof -ti:${this.config.port}`, (error, stdout) => {
                        if (error) {
                            resolve('');
                        }
                        else {
                            resolve(stdout.trim());
                        }
                    });
                });
                if (result) {
                    this.outputChannel.appendLine(`发现占用端口的进程PID: ${result}`);
                    const choice = await vscode.window.showWarningMessage(`端口${this.config.port}被进程${result}占用，需要先停止该进程`, '自动停止', '取消');
                    if (choice === '自动停止') {
                        await new Promise((resolve, reject) => {
                            exec(`kill -TERM ${result}`, (error) => {
                                if (error) {
                                    this.outputChannel.appendLine(`停止进程失败: ${error.message}`);
                                    reject(error);
                                }
                                else {
                                    this.outputChannel.appendLine(`已停止占用端口的进程: ${result}`);
                                    resolve();
                                }
                            });
                        });
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    else {
                        throw new Error(`端口${this.config.port}已被占用，请更换端口或停止占用进程`);
                    }
                }
            }
            catch (error) {
                this.outputChannel.appendLine(`检查端口占用失败: ${error.message}`);
            }
        }
        try {
            const { exec } = require('child_process');
            await new Promise((resolve, reject) => {
                exec('java -Xmx1m -version', (error) => {
                    if (error && error.message.includes('OutOfMemoryError')) {
                        this.outputChannel.appendLine('警告: 系统内存可能不足');
                    }
                    resolve(null);
                });
            });
        }
        catch (error) {
            this.outputChannel.appendLine(`系统资源检查失败: ${error.message}`);
        }
        this.outputChannel.appendLine('配置验证完成✓');
    }
    buildCommandArgs() {
        const args = [
            `-Xmx${this.config.maxMemory}`,
            '-Dfile.encoding=UTF-8'
        ];
        args.push('-jar', this.config.jarPath, '--server.port=' + this.config.port, '--solon.env=prod');
        const homePath = this.getHomePath();
        if (homePath) {
            args.push('--homepath=' + homePath);
        }
        const dataSourceInfo = this.getDesignDataSourceInfo();
        if (dataSourceInfo) {
            args.push('--db.url=' + dataSourceInfo.url);
            args.push('--db.username=' + dataSourceInfo.username);
            args.push('--db.password=' + dataSourceInfo.password);
            args.push('--db.driver=' + dataSourceInfo.driver);
            this.outputChannel.appendLine('✅ 数据源参数已添加到命令行:');
            this.outputChannel.appendLine(`   URL: ${dataSourceInfo.url}`);
            this.outputChannel.appendLine(`   Username: ${dataSourceInfo.username}`);
            this.outputChannel.appendLine(`   Driver: ${dataSourceInfo.driver}`);
        }
        else {
            this.outputChannel.appendLine('⚠️ 未找到有效的数据源配置，将不传递数据源参数');
        }
        return args;
    }
    getDesignDataSourceInfo() {
        try {
            const configService = new NCHomeConfigService_1.NCHomeConfigService(this.context);
            const config = configService.getConfig();
            this.outputChannel.appendLine(`🔍 检查数据源配置...`);
            if (config.dataSources && config.dataSources.length > 0) {
                this.outputChannel.appendLine(`📊 找到 ${config.dataSources.length} 个数据源配置`);
                config.dataSources.forEach((ds, index) => {
                    this.outputChannel.appendLine(`   数据源 ${index + 1}: ${ds.name} (${ds.databaseType})`);
                });
                const designDataSource = config.dataSources.find(ds => ds.name.toLowerCase() === 'design');
                if (designDataSource) {
                    this.outputChannel.appendLine(`✅ 找到design数据源: ${designDataSource.name}`);
                    let url = '';
                    let driver = '';
                    if (designDataSource.url && designDataSource.url.trim() !== '') {
                        url = designDataSource.url;
                    }
                    else {
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
                    let decryptedPassword = designDataSource.password || '';
                    if (decryptedPassword) {
                        try {
                            if (PasswordEncryptor_1.PasswordEncryptor.isEncrypted(config.homePath, decryptedPassword)) {
                                decryptedPassword = PasswordEncryptor_1.PasswordEncryptor.getSecurePassword(config.homePath, decryptedPassword);
                            }
                        }
                        catch (decryptError) {
                            this.outputChannel.appendLine(`⚠️ 密码解密失败: ${decryptError.message}`);
                        }
                    }
                    if (typeof decryptedPassword !== 'string') {
                        decryptedPassword = String(decryptedPassword || '');
                    }
                    return {
                        url: url,
                        username: designDataSource.username,
                        password: decryptedPassword,
                        driver: driver
                    };
                }
                else {
                    this.outputChannel.appendLine(`❌ 未找到名为 'design' 的数据源`);
                    const possibleDesignSources = config.dataSources.filter(ds => ds.name.toLowerCase().includes('design') ||
                        ds.name.toLowerCase().includes('开发'));
                    if (possibleDesignSources.length > 0) {
                        this.outputChannel.appendLine(`💡 找到可能的design数据源候选:`);
                        possibleDesignSources.forEach(ds => {
                            this.outputChannel.appendLine(`   - ${ds.name}`);
                        });
                    }
                }
            }
            else {
                this.outputChannel.appendLine(`⚠️ 未配置任何数据源`);
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`获取design数据源信息失败: ${error.message}`);
            this.outputChannel.appendLine(`堆栈信息: ${error.stack}`);
        }
        return null;
    }
    getHomePath() {
        const homeConfig = this.context.globalState.get('nchome.config');
        if (homeConfig && homeConfig.homePath) {
            return homeConfig.homePath;
        }
        const config = vscode.workspace.getConfiguration('yonbip');
        const homePath = config.get('homePath');
        if (homePath) {
            return homePath;
        }
        return null;
    }
    setStatus(status) {
        const oldStatus = this.status;
        this.status = status;
        if ((oldStatus === McpStatus.RUNNING || oldStatus === McpStatus.STARTING) &&
            (status === McpStatus.STOPPED || status === McpStatus.ERROR)) {
            this.stopHealthCheck();
        }
        if ((oldStatus === McpStatus.STOPPED || oldStatus === McpStatus.ERROR) &&
            (status === McpStatus.STARTING || status === McpStatus.RUNNING)) {
            this.startHealthCheck();
        }
    }
    async isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = require('net').createServer();
            server.listen(port, () => {
                server.once('close', () => resolve(true));
                server.close();
            });
            server.on('error', () => resolve(false));
        });
    }
    getContext() {
        return this.context;
    }
    showOutput() {
        this.outputChannel.show();
    }
    async preStartCheck() {
        this.outputChannel.appendLine('────────────────────────────────────────────────────────');
        this.outputChannel.appendLine('🧰 MCP 服务启动前预检查');
        this.outputChannel.appendLine('────────────────────────────────────────────────────────');
        let hasError = false;
        const portAvailable = await this.isPortAvailable(this.config.port);
        if (!portAvailable) {
            this.outputChannel.appendLine(`❌ 端口${this.config.port}不可用`);
            try {
                const { exec } = require('child_process');
                const pids = await new Promise((resolve) => {
                    exec(`lsof -ti:${this.config.port}`, (error, stdout) => {
                        resolve(error ? '' : stdout.trim());
                    });
                });
                if (pids) {
                    this.outputChannel.appendLine(`发现占用端口的进程: ${pids}`);
                    const choice = await vscode.window.showWarningMessage(`端口${this.config.port}被进程${pids}占用，是否自动清理？`, '清理', '更换端口', '取消');
                    if (choice === '清理') {
                        await new Promise((resolve, reject) => {
                            exec(`kill -TERM ${pids}`, (error) => {
                                if (error) {
                                    this.outputChannel.appendLine(`清理失败: ${error.message}`);
                                    reject(error);
                                }
                                else {
                                    this.outputChannel.appendLine('✓ 端口清理成功');
                                    resolve();
                                }
                            });
                        });
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        const nowAvailable = await this.isPortAvailable(this.config.port);
                        if (nowAvailable) {
                            this.outputChannel.appendLine('✓ 端口现在可用');
                        }
                        else {
                            this.outputChannel.appendLine('❌ 端口仍然不可用');
                            hasError = true;
                        }
                    }
                    else if (choice === '更换端口') {
                        this.config.port = this.config.port + 1;
                        await this.saveConfig(this.config);
                        this.outputChannel.appendLine(`✓ 端口已更换为: ${this.config.port}`);
                    }
                    else {
                        hasError = true;
                    }
                }
                else {
                    hasError = true;
                }
            }
            catch (error) {
                this.outputChannel.appendLine(`端口检查失败: ${error.message}`);
            }
        }
        else {
            this.outputChannel.appendLine(`✓ 端口${this.config.port}可用`);
        }
        try {
            const { exec } = require('child_process');
            const memInfo = await new Promise((resolve) => {
                exec('vm_stat', (error, stdout) => {
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
            const diskInfo = await new Promise((resolve) => {
                exec('df -h .', (error, stdout) => {
                    resolve(error ? '无法获取磁盘信息' : stdout);
                });
            });
            this.outputChannel.appendLine('磁盘空间状态:');
            this.outputChannel.appendLine(diskInfo.split('\n')[1] || '无法获取磁盘信息');
        }
        catch (error) {
            this.outputChannel.appendLine(`系统资源检查失败: ${error.message}`);
        }
        this.outputChannel.appendLine('================================');
        if (hasError) {
            this.outputChannel.appendLine('❌ 预检查失败，请解决上述问题后重试');
            return false;
        }
        else {
            this.outputChannel.appendLine('✓ 预检查通过，可以启动MCP服务');
            return true;
        }
    }
    dispose() {
        this.stop();
        this.stopHealthCheck();
        if (McpService.outputChannelInstance) {
            McpService.outputChannelInstance.dispose();
            McpService.outputChannelInstance = null;
        }
    }
}
exports.McpService = McpService;
//# sourceMappingURL=McpService.js.map