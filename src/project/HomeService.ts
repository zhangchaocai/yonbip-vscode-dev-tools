import * as vscode from 'vscode';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
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
     * 检测字符串是否包含乱码字符
     * @param str 待检测的字符串
     * @returns 如果包含乱码返回true，否则返回false
     */
    private containsGarbledCharacters(str: string): boolean {
        // 检查是否包含典型的乱码字符模式
        const garbledPatterns = [
            '??',           // 问号替代字符
            '? ?',          // 间隔问号
            'Warning: setSecurityManager',
            '9',          // 月份乱码
            '',          // 其他乱码字符
            '',         // 多字符乱码
            '涓嶅厑璁',     // XML错误信息乱码特征
            '搴旂敤宸ュ巶', // 应用工厂乱码特征
            '鎻掍欢鎵弿'  // 插件扫描乱码特征
        ];

        // 检查是否包含中文字符（正常中文应该能正确显示）
        const hasChinese = /[\u4e00-\u9fa5]/.test(str);

        // 检查是否包含大量乱码字符
        const hasManyUnknownChars = (str.match(/[^\x00-\x7F]/g) || []).length > str.length * 0.3;

        // 检查是否有乱码字符
        const hasGarbledPattern = garbledPatterns.some(pattern => {
            return str.includes(pattern);
        });

        // 如果包含中文但也有乱码特征，则认为有乱码
        if (hasChinese && hasGarbledPattern) {
            return true;
        }

        // 如果不包含中文，但包含大量非ASCII字符或有乱码模式，可能有乱码
        if (!hasChinese && (hasManyUnknownChars || hasGarbledPattern)) {
            return true;
        }

        // 特殊处理：如果包含月份乱码，则认为有乱码
        if (str.includes('9') && !str.includes('9月')) {
            return true;
        }

        // 检查是否包含XML错误信息的乱码特征
        if (str.includes('涓嶅厑璁') && str.includes('鐨勫鐞嗘寚浠ょ洰鏍囥')) {
            return true;
        }

        return false;
    }

    /**
     * 尝试多种编码方式解码数据
     * @param data 原始数据
     * @returns 解码后的字符串
     */
    private decodeDataWithMultipleEncodings(data: Buffer): string {
        // 尝试的编码列表，按优先级排序
        const encodings = ['utf-8', 'gbk', 'gb2312'];

        // 保存原始字符串用于比较
        const originalString = data.toString();

        for (const encoding of encodings) {
            try {
                const decoded = iconv.decode(data, encoding);
                // 检查解码后是否还有乱码
                if (!this.containsGarbledCharacters(decoded)) {
                    return decoded;
                }
                // 特殊处理：如果原始字符串包含大量问号，但当前编码解码后没有问号，可能是正确编码
                if (originalString.includes('???') && !decoded.includes('???')) {
                    return decoded;
                }
                // 特殊处理：如果原始字符串包含月份乱码，但当前编码解码后是正常月份，可能是正确编码
                if ((originalString.includes('9') || originalString.includes('')) && decoded.includes('9月')) {
                    return decoded;
                }
                // 特殊处理：如果原始字符串包含"应用工厂"乱码，但当前编码解码后是正常中文，可能是正确编码
                if (originalString.includes('') && decoded.includes('应用工厂')) {
                    return decoded;
                }
                // 特殊处理：如果原始字符串包含XML错误信息乱码，但当前编码解码后是正常中文，可能是正确编码
                if (originalString.includes('涓嶅厑璁') && decoded.includes('不允许有匹配')) {
                    return decoded;
                }
            } catch (e) {
                // 继续尝试下一个编码
                continue;
            }
        }

        // 最后尝试使用gbk解码（因为这是最可能的中文编码）
        try {
            return iconv.decode(data, 'gbk');
        } catch (e) {
            // 最后回退到原始字符串
            return originalString;
        }
    }

    /**
     * 编译项目源代码
     */
    private async compileProject(workspaceFolder: string): Promise<boolean> {
        return new Promise((resolve) => {
            this.outputChannel.appendLine('🔍 检查项目是否需要编译...');

            // 检查是否存在src目录
            const srcPath = path.join(workspaceFolder, 'src');
            if (!fs.existsSync(srcPath)) {
                this.outputChannel.appendLine('✅ 项目中没有源代码需要编译');
                resolve(true);
                return;
            }

            // 检查是否是Maven项目
            const pomPath = path.join(workspaceFolder, 'pom.xml');
            if (fs.existsSync(pomPath)) {
                this.outputChannel.appendLine('🔨 检测到Maven项目，正在编译...');
                this.outputChannel.appendLine('🔧 执行命令: mvn clean compile');

                const compileProcess = spawn('mvn', ['clean', 'compile'], {
                    cwd: workspaceFolder,
                    env: {
                        ...process.env,
                        JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8'
                    }
                });

                compileProcess.stdout?.on('data', (data: any) => {
                    const output = data.toString().replace(/\u001b\[.*?m/g, ''); // 移除ANSI转义序列
                    this.outputChannel.appendLine(`[STDOUT] ${output}`);
                });

                compileProcess.stderr?.on('data', (data: any) => {
                    const output = data.toString().replace(/\u001b\[.*?m/g, ''); // 移除ANSI转义序列
                    this.outputChannel.appendLine(`[STDERR] ${output}`);
                });

                compileProcess.on('close', (code: any) => {
                    if (code === 0) {
                        this.outputChannel.appendLine('✅ Maven编译成功');
                        resolve(true);
                    } else {
                        this.outputChannel.appendLine(`❌ Maven编译失败，退出码: ${code}`);
                        resolve(false);
                    }
                });

                compileProcess.on('error', (error: any) => {
                    this.outputChannel.appendLine(`❌ Maven编译出错: ${error.message}`);
                    resolve(false);
                });

                return;
            }

            // 检查是否是Gradle项目
            const gradlePath = path.join(workspaceFolder, 'build.gradle');
            const gradleKtsPath = path.join(workspaceFolder, 'build.gradle.kts');
            if (fs.existsSync(gradlePath) || fs.existsSync(gradleKtsPath)) {
                this.outputChannel.appendLine('🔨 检测到Gradle项目，正在编译...');
                this.outputChannel.appendLine('🔧 执行命令: gradle clean compileJava');

                const compileProcess = spawn('gradle', ['clean', 'compileJava'], {
                    cwd: workspaceFolder,
                    env: {
                        ...process.env,
                        JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8'
                    }
                });

                compileProcess.stdout?.on('data', (data: any) => {
                    const output = data.toString().replace(/\u001b\[.*?m/g, ''); // 移除ANSI转义序列
                    this.outputChannel.appendLine(`[STDOUT] ${output}`);
                });

                compileProcess.stderr?.on('data', (data: any) => {
                    const output = data.toString().replace(/\u001b\[.*?m/g, ''); // 移除ANSI转义序列
                    this.outputChannel.appendLine(`[STDERR] ${output}`);
                });

                compileProcess.on('close', (code: any) => {
                    if (code === 0) {
                        this.outputChannel.appendLine('✅ Gradle编译成功');
                        resolve(true);
                    } else {
                        this.outputChannel.appendLine(`❌ Gradle编译失败，退出码: ${code}`);
                        resolve(false);
                    }
                });

                compileProcess.on('error', (error: any) => {
                    this.outputChannel.appendLine(`❌ Gradle编译出错: ${error.message}`);
                    resolve(false);
                });

                return;
            }

            // 检查是否是标准Java项目（存在src目录且包含Java文件）
            if (fs.existsSync(srcPath)) {
                const hasJavaFiles = this.hasJavaFiles(srcPath);
                if (hasJavaFiles) {
                    this.outputChannel.appendLine('🔨 检测到标准Java项目，正在编译...');
                    this.outputChannel.appendLine('🔧 请确保项目已正确配置编译环境');
                    // 对于标准Java项目，我们不执行编译，因为可能没有Maven或Gradle配置
                    resolve(true);
                    return;
                }
            }

            this.outputChannel.appendLine('⚠️ 未识别的项目类型，跳过编译步骤');
            resolve(true);
        });
    }

    /**
     * 检查目录中是否包含Java文件
     */
    private hasJavaFiles(dirPath: string): boolean {
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);

                if (stat.isDirectory()) {
                    if (this.hasJavaFiles(itemPath)) {
                        return true;
                    }
                } else if (item.endsWith('.java')) {
                    return true;
                }
            }
            return false;
        } catch (error) {
            return false;
        }
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

        // 提前获取配置以避免变量作用域问题
        const config = this.configService.getConfig();

        // 获取当前工作区根目录
        let workspaceFolder = '';
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.outputChannel.appendLine(`📂 当前工作区: ${workspaceFolder}`);

            // 编译项目源代码
            const compileSuccess = await this.compileProject(workspaceFolder);
            if (!compileSuccess) {
                vscode.window.showErrorMessage('项目编译失败，请检查代码错误');
                return;
            }

        } else {
            this.outputChannel.appendLine('⚠️ 未检测到工作区，跳过项目编译和resources目录复制步骤');
        }

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

            // 添加控制台乱码补丁逻辑
            await this.applyConsoleEncodingPatch(config.homePath);

            // 检查端口占用情况
            const portsFromProp = this.configService.getPortFromPropXml();
            const serverPort = portsFromProp.port || config.port || 8077;
            const wsPort = portsFromProp.wsPort || config.wsPort || 8080;

            this.outputChannel.appendLine(`🔍 检查端口占用情况...`);
            await this.checkAndKillPortProcesses(serverPort, wsPort);

            // 确保必要的配置文件存在
            await this.ensureDesignDataSource(config);

            // 检查并确定core.jar路径
            const coreJarPath = this.getCoreJarPath(config.homePath);
            if (!coreJarPath) {
                vscode.window.showErrorMessage('未找到core.jar文件，请检查NC HOME配置');
                this.setStatus(HomeStatus.ERROR);
                return;
            }

            this.outputChannel.appendLine(`📦 找到core.jar: ${coreJarPath}`);

            // 确定主类 (与IDEA插件保持一致)
            let mainClass = 'ufmiddle.start.tomcat.StartDirectServer';

            // 检查core.jar中是否包含wj相关类，如果包含则使用wj的启动类
            if (this.containsWJClasses(coreJarPath)) {
                mainClass = 'ufmiddle.start.wj.StartDirectServer';
                this.outputChannel.appendLine('🔧 检测到WJ相关类，使用WJ启动类');
            }

            // 构建类路径
            const classpath = this.buildClasspath(config, coreJarPath, workspaceFolder);

            // 检查必要的配置文件
            const propDir = path.join(config.homePath, 'ierp', 'bin');
            const propFile = path.join(propDir, 'prop.xml');

            if (!fs.existsSync(propFile)) {
                this.outputChannel.appendLine(`❌ 严重错误: 系统配置文件不存在: ${propFile}`);
                this.outputChannel.appendLine('请确保正确配置了NC HOME目录，并且包含必要的配置文件');
                this.setStatus(HomeStatus.ERROR);
                vscode.window.showErrorMessage(`系统配置文件不存在: ${propFile}，请检查NC HOME配置`);
                return;
            } else {
                this.outputChannel.appendLine(`✅ 系统配置文件存在: ${propFile}`);

                // 检查是否有数据源配置
                try {
                    const propContent = fs.readFileSync(propFile, 'utf-8');
                    if (propContent.includes('<dataSource>') || propContent.includes('<dataSources>')) {
                        this.outputChannel.appendLine('✅ 配置文件中包含数据源配置');
                    } else {
                        this.outputChannel.appendLine('⚠️ 配置文件中未找到数据源配置');
                    }
                } catch (error: any) {
                    this.outputChannel.appendLine(`⚠️ 无法读取配置文件: ${error.message}`);
                }
            }

            // 检查数据源配置
            const dataSourceDir = path.join(config.homePath, 'ierp', 'bin');
            if (fs.existsSync(dataSourceDir)) {
                const dataSourceFiles = fs.readdirSync(dataSourceDir);
                const dsConfigs = dataSourceFiles.filter(file =>
                    file.startsWith('datasource') && (file.endsWith('.ini') || file.endsWith('.properties')));
                if (dsConfigs.length > 0) {
                    this.outputChannel.appendLine(`✅ 找到 ${dsConfigs.length} 个数据源配置文件`);
                    dsConfigs.forEach(file => {
                        this.outputChannel.appendLine(`   - ${file}`);
                    });
                } else {
                    this.outputChannel.appendLine('⚠️ 未找到数据源配置文件，可能导致启动失败');
                }
            } else {
                this.outputChannel.appendLine('⚠️ 未找到数据源配置目录，可能导致启动失败');
            }

            // 构建环境变量
            const env = this.buildEnvironment(config);

            // 构建JVM参数 (使用与IDEA插件一致的参数)
            const vmParameters = this.buildVMParameters(config, serverPort, wsPort);

            // 确定Java可执行文件路径
            let javaExecutable = this.getJavaExecutable(config);

            this.outputChannel.appendLine('✅ 准备启动NC HOME服务...');
            this.outputChannel.appendLine(`☕ Java可执行文件: ${javaExecutable}`);
            this.outputChannel.appendLine(`🖥️  主类: ${mainClass}`);
            this.outputChannel.appendLine(`📦 类路径包含 ${classpath.split(path.delimiter).length} 个条目`);
            this.outputChannel.appendLine(`🏠 HOME路径: ${config.homePath}`);
            this.outputChannel.appendLine(`⚙️  JVM参数: ${vmParameters.join(' ')}`);

            // 构建Java命令参数
            const javaArgs = [
                ...vmParameters,
                '-cp',
                classpath,
                mainClass
            ];

            // this.outputChannel.appendLine('🚀 启动命令:');
            // this.outputChannel.appendLine([javaExecutable, ...javaArgs].join(' '));
            // this.outputChannel.appendLine('💡 如果服务启动失败，可在终端中手动运行上述命令以获取详细错误信息');

            // 执行启动命令
            this.process = spawn(javaExecutable, javaArgs, {
                cwd: config.homePath,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...env,
                    JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8',
                    LANG: 'zh_CN.UTF-8',
                    LC_ALL: 'zh_CN.UTF-8',
                    LC_CTYPE: 'zh_CN.UTF-8',
                    JAVA_OPTS: '-Dfile.encoding=UTF-8 -Dconsole.encoding=UTF-8',
                }
            });

            // 监听标准输出
            this.process.stdout?.on('data', (data: Buffer) => {
                let output = data.toString();
                // 检测并处理可能的编码问题
                if (this.containsGarbledCharacters(output)) {
                    output = this.decodeDataWithMultipleEncodings(data);
                }
                // 移除ANSI转义序列
                output = output.replace(/\u001b\[.*?m/g, '');
                // 移除其他控制字符
                output = output.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');

                if (!output.includes('[Fatal Error]')) {
                    this.outputChannel.appendLine(`[STDOUT] ${output}`);
                }
                // 检查是否启动成功
                if (output.includes('Server startup in') ||
                    output.includes('服务启动成功') ||
                    output.includes('Started ServerConnector') ||
                    output.includes('Tomcat started on port')) {
                    this.setStatus(HomeStatus.RUNNING);
                    vscode.window.showInformationMessage('NC HOME服务启动成功!');
                }
            });

            // 监听标准错误输出
            this.process.stderr?.on('data', (data: Buffer) => {
                let stderrOutput = data.toString();
                // 检测并处理可能的编码问题
                if (this.containsGarbledCharacters(stderrOutput)) {
                    stderrOutput = this.decodeDataWithMultipleEncodings(data);
                }
                // 移除ANSI转义序列
                stderrOutput = stderrOutput.replace(/\u001b\[.*?m/g, '');
                // 移除其他控制字符
                stderrOutput = stderrOutput.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
                this.outputChannel.appendLine(`[STDERR] ${stderrOutput}`);

                // 检查错误信息
                // 移除其他控制字符
                stderrOutput = stderrOutput.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
                this.outputChannel.appendLine(`[STDERR] ${stderrOutput}`);

                // 检查错误信息
                if (stderrOutput.includes('ERROR') || stderrOutput.includes('Exception')) {
                    this.outputChannel.appendLine('❌ 检测到错误信息');
                }

                // 即使没有明显的错误标识，也要提醒用户关注stderr信息
                if (!stderrOutput.includes('Exception') &&
                    !stderrOutput.includes('Error') &&
                    !stderrOutput.includes('Caused by')) {
                    this.outputChannel.appendLine('⚠️ 请特别关注以上STDERR输出，它可能包含导致启动失败的重要信息');
                }
            });

            // 监听进程退出事件
            this.process.on('exit', (code: any, signal: any) => {
                this.outputChannel.appendLine(`\nNC HOME服务进程已退出，退出码: ${code}`);
                if (code === 255) {
                    this.outputChannel.appendLine('❌ 退出码255表示服务启动过程中发生严重错误:');
                    this.outputChannel.appendLine('   1. 可能是由于Java Security Manager配置问题');
                    this.outputChannel.appendLine('   2. 可能是缺少必要的系统属性配置');
                    this.outputChannel.appendLine('   3. 可能是类路径配置不正确导致关键类无法加载');
                    this.outputChannel.appendLine('   4. 可能是端口绑定失败');
                    this.outputChannel.appendLine('   5. 可能是Java版本兼容性问题（如使用了不支持的JDK版本）');
                    this.outputChannel.appendLine('💡 建议检查完整的日志输出，特别是STDERR中的错误信息');
                    this.outputChannel.appendLine('💡 尝试在终端中手动运行以下命令来获取更详细的错误信息:');
                    this.outputChannel.appendLine(`   java ${vmParameters.join(' ')} -cp "[类路径]" ${mainClass}`);
                } else if (code !== 0 && !this.isManualStop) {
                    this.outputChannel.appendLine(`❌ 服务异常退出，退出码: ${code}`);
                    this.outputChannel.appendLine('💡 建议检查完整的日志输出，特别是STDERR中的错误信息');
                } else if (this.isManualStop) {
                    this.outputChannel.appendLine('✅ 服务已正常停止');
                    this.isManualStop = false;
                } else {
                    this.outputChannel.appendLine('✅ 服务已正常退出');
                }

                this.process = null;
                this.setStatus(HomeStatus.STOPPED);
            });

            // 监听进程错误事件
            this.process.on('error', (err) => {
                console.error('进程启动失败:', err);
                this.outputChannel.appendLine(`❌ 启动服务时发生错误: ${err.message}`);
                this.setStatus(HomeStatus.ERROR);
                this.process = null;
            });

            // 监听进程关闭事件
            this.process.on('close', (code, signal) => {
                console.log(`进程关闭，退出码: ${code}, 信号: ${signal}`);
                this.outputChannel.appendLine(`\nHOME服务进程已关闭，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);

                if (code !== 0 && code !== null) {
                    this.outputChannel.appendLine('⚠️ 服务异常退出，请检查日志文件或终端手动启动输出！');
                    if (code === 255) {
                        this.outputChannel.appendLine('💡 退出码255通常与以下问题有关:');
                        this.outputChannel.appendLine('   - Java Security Manager配置问题');
                        this.outputChannel.appendLine('   - JDK版本兼容性问题');
                        this.outputChannel.appendLine('   - 必要的系统属性未正确设置');
                    }
                }

                this.process = null;
                this.setStatus(HomeStatus.STOPPED);
            });

            // 启动检查定时器
            this.startupCheckTimer = setTimeout(() => {
                if (this.status === HomeStatus.STARTING) {
                    this.outputChannel.appendLine('⚠️ 服务启动可能需要更长时间，请耐心等待...');
                    // 延长检查时间
                    this.startupCheckTimer = setTimeout(() => {
                        if (this.status === HomeStatus.STARTING) {
                            this.outputChannel.appendLine('❌ 服务启动超时，请检查日志');
                            this.setStatus(HomeStatus.ERROR);
                        }
                    }, 60000); // 增加1分钟等待时间
                }
            }, 60000); // 增加到1分钟等待时间

        } catch (error: any) {
            this.outputChannel.appendLine(`❌ 启动过程中出现异常: ${error.message}`);
            this.outputChannel.appendLine(error.stack);
            this.setStatus(HomeStatus.ERROR);
            vscode.window.showErrorMessage(`启动NC HOME服务时出现异常: ${error.message}`);
        }
    }

    /**
     * 获取core.jar路径
     */
    private getCoreJarPath(homePath: string): string | null {
        // 按优先级检查不同位置的core.jar
        const possiblePaths = [
            path.join(homePath, 'ierp', 'bin', 'core.jar'),
            path.join(homePath, 'middleware', 'core.jar'),
            path.join(homePath, 'lib', 'core.jar')
        ];

        for (const jarPath of possiblePaths) {
            if (fs.existsSync(jarPath)) {
                return jarPath;
            }
        }

        return null;
    }

    /**
     * 检查core.jar中是否包含wj相关类
     */
    private containsWJClasses(coreJarPath: string): boolean {
        try {
            // 检查文件名是否包含wj或WJ
            const filename = path.basename(coreJarPath);
            if (filename.toLowerCase().includes('wj')) {
                return true;
            }

            // 检查HOME路径是否包含特定标识
            return coreJarPath.includes('wj') || coreJarPath.includes('WJ');
        } catch (error) {
            return false;
        }
    }

    /**
     * 构建完整的类路径 (解决ClassNotFoundException问题)
     */
    private buildClasspath(config: any, coreJarPath: string, workspaceFolder: string): string {
        const classpathEntries: string[] = [coreJarPath];

        // 特别添加可能包含ws相关类的目录
        const wsRelatedDirs = [
            path.join(config.homePath, 'webapps', 'uapws'),
            path.join(config.homePath, 'webapps', 'uapws', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'webapps', 'webservice'),
            path.join(config.homePath, 'webapps', 'webservice', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'hotwebs', 'uapws', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'hotwebs', 'webservice', 'WEB-INF', 'classes')
        ];

        // 优先添加这些目录，以确保ws相关类能被正确加载
        for (const wsDir of wsRelatedDirs) {
            if (fs.existsSync(wsDir)) {
                classpathEntries.push(wsDir);
                this.outputChannel.appendLine(`🚨 优先添加WS相关目录: ${wsDir}`);
            }
        }

        // 首先添加工作区编译输出目录
        if (workspaceFolder) {
            const targetClasses = path.join(workspaceFolder, 'target', 'classes'); // Maven项目
            const buildClasses = path.join(workspaceFolder, 'build', 'classes'); // Gradle项目
            const binClasses = path.join(workspaceFolder, 'bin'); // 普通项目
            if (fs.existsSync(targetClasses)) {
                classpathEntries.push(targetClasses);
                this.outputChannel.appendLine(`📁 添加Maven编译输出目录: ${targetClasses}`);
            }

            if (fs.existsSync(buildClasses)) {
                classpathEntries.push(buildClasses);
                this.outputChannel.appendLine(`📁 添加Gradle编译输出目录: ${buildClasses}`);
            }
            if (fs.existsSync(binClasses)) {
                classpathEntries.push(binClasses);
                this.outputChannel.appendLine(`📁 添加普通Java编译输出目录: ${binClasses}`);
            }
        }

        // 添加预处理后的external目录 (解决ClassNotFoundException的关键步骤)
        const externalLibDir = path.join(config.homePath, 'external', 'lib');
        const externalClassesDir = path.join(config.homePath, 'external', 'classes');

        if (fs.existsSync(externalLibDir)) {
            const jarFiles = fs.readdirSync(externalLibDir).filter(file => file.endsWith('.jar'));
            const jars = jarFiles.map(file => path.join(externalLibDir, file));
            classpathEntries.push(...jars);
            this.outputChannel.appendLine(`📁 添加预处理后的external/lib目录，共包含 ${jarFiles.length} 个jar文件`);
        }

        if (fs.existsSync(externalClassesDir)) {
            classpathEntries.push(externalClassesDir);
            this.outputChannel.appendLine(`📁 添加预处理后的external/classes目录`);
        }

        // 需要扫描的目录列表 (基于IDEA插件的实现，并扩展)
        const libDirs = [
            path.join(config.homePath, 'middleware'),
            path.join(config.homePath, 'lib'),
            path.join(config.homePath, 'external', 'lib'),
            path.join(config.homePath, 'ierp', 'bin'),
            path.join(config.homePath, 'license'), // 添加许可证目录
            path.join(config.homePath, 'modules'), // 添加modules目录
            path.join(config.homePath, 'webapps'), // 添加webapps目录
            path.join(config.homePath, 'webapps', 'nccloud', 'WEB-INF', 'lib'), // 添加nccloud webapp lib目录
            path.join(config.homePath, 'webapps', 'uapws', 'WEB-INF', 'lib'), // 添加uapws webapp lib目录
            path.join(config.homePath, 'webapps', 'console', 'WEB-INF', 'lib'), // 添加console webapp lib目录
            path.join(config.homePath, 'webapps', 'fs', 'WEB-INF', 'lib'), // 添加fs webapp lib目录
            path.join(config.homePath, 'webapps', 'ncchr', 'WEB-INF', 'lib'), // 添加ncchr webapp lib目录
            path.join(config.homePath, 'webapps', 'portal', 'WEB-INF', 'lib'), // 添加portal webapp lib目录
            path.join(config.homePath, 'webapps', 'mobile', 'WEB-INF', 'lib'), // 添加mobile webapp lib目录
            path.join(config.homePath, 'webapps', 'hrhi', 'WEB-INF', 'lib'), // 添加hrhi webapp lib目录
            path.join(config.homePath, 'webapps', 'einvoice', 'WEB-INF', 'lib'), // 添加einvoice webapp lib目录
            path.join(config.homePath, 'webapps', 'cm', 'WEB-INF', 'lib'), // 添加cm webapp lib目录
            path.join(config.homePath, 'webapps', 'fin', 'WEB-INF', 'lib'), // 添加fin webapp lib目录
            path.join(config.homePath, 'webapps', 'fip', 'WEB-INF', 'lib'), // 添加fip webapp lib目录
            path.join(config.homePath, 'webapps', 'pm', 'WEB-INF', 'lib'), // 添加pm webapp lib目录
            path.join(config.homePath, 'webapps', 'sm', 'WEB-INF', 'lib'), // 添加sm webapp lib目录
            path.join(config.homePath, 'webapps', 'edm', 'WEB-INF', 'lib'), // 添加edm webapp lib目录
            path.join(config.homePath, 'webapps', 'bcm', 'WEB-INF', 'lib'), // 添加bcm webapp lib目录
            path.join(config.homePath, 'webapps', 'pub', 'WEB-INF', 'lib'), // 添加pub webapp lib目录
            path.join(config.homePath, 'adapter'), // 添加 adapter 目录
            path.join(config.homePath, 'platform'), // 添加platform目录
            path.join(config.homePath, 'langlib'), // 添加langlib目录
            path.join(config.homePath, 'middleware', 'lib'), // 添加middleware/lib目录
            path.join(config.homePath, 'framework'), // 添加framework目录
            // 特别添加可能包含ws相关类的目录
            path.join(config.homePath, 'webapps', 'uapws', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'webapps', 'webservice', 'WEB-INF', 'lib'),
            path.join(config.homePath, 'webapps', 'webservice', 'WEB-INF', 'classes')
        ];

        this.outputChannel.appendLine('开始构建类路径...');

        // 遍历所有目录，添加其中的jar包到类路径
        for (const dir of libDirs) {
            if (fs.existsSync(dir)) {
                try {
                    const files = fs.readdirSync(dir);
                    const jars = files.filter(file => file.endsWith('.jar'))
                        .map(file => path.join(dir, file));
                    classpathEntries.push(...jars);
                } catch (err: any) {
                    this.outputChannel.appendLine(`⚠️ 读取目录失败: ${dir}, 错误: ${err}`);
                }
            } else {
                // 只对特定目录输出警告
                if (dir.includes('ierp') || dir.includes('hotweb')) {
                    this.outputChannel.appendLine(`目录不存在: ${dir}`);
                }
            }
        }

        // 特别处理modules目录，扫描每个子目录下的lib目录
        const modulesDir = path.join(config.homePath, 'modules');
        if (fs.existsSync(modulesDir)) {
            try {
                const moduleDirs = fs.readdirSync(modulesDir);
                //this.outputChannel.appendLine(`📁 发现modules目录: ${modulesDir}，包含 ${moduleDirs.length} 个模块`);

                for (const moduleDir of moduleDirs) {
                    const moduleLibDir = path.join(modulesDir, moduleDir, 'lib');
                    if (fs.existsSync(moduleLibDir)) {
                        const files = fs.readdirSync(moduleLibDir);
                        const jars = files.filter(file => file.endsWith('.jar'))
                            .map(file => path.join(moduleLibDir, file));
                        classpathEntries.push(...jars);
                        //this.outputChannel.appendLine(`📁 添加模块 ${moduleDir} 的lib目录: ${moduleLibDir} (${jars.length} 个jar包)`);
                    }
                }
            } catch (err: any) {
                this.outputChannel.appendLine(`⚠️ 读取modules目录失败: ${err}`);
            }
        }

        // 特别检查并添加与web服务相关的jar包
        this.checkAndAddWSJars(config.homePath, classpathEntries);

        // 在所有jar包添加完成后，保守地添加resources目录（避免类加载冲突）
        const resourcesDir = path.join(config.homePath, 'resources');
        if (fs.existsSync(resourcesDir)) {
            // 只添加resources主目录和conf子目录，不递归添加所有子目录
            classpathEntries.push(resourcesDir);
            this.outputChannel.appendLine(`📁 添加resources目录: ${resourcesDir}`);

            // 特别添加conf目录，确保配置文件能被加载
            const confDir = path.join(resourcesDir, 'conf');
            if (fs.existsSync(confDir)) {
                classpathEntries.push(confDir);
                this.outputChannel.appendLine(`📁 特别添加resources/conf目录: ${confDir}`);
            }
        } else {
            this.outputChannel.appendLine(`⚠️ resources目录不存在: ${resourcesDir}`);
        }

        // 去除重复项并构建类路径
        const uniqueClasspathEntries = [...new Set(classpathEntries)];
        this.outputChannel.appendLine(`类路径构建完成，共包含 ${uniqueClasspathEntries.length} 个条目`);

        // 特别检查resources和conf目录是否被正确添加
        const resourcesEntries = uniqueClasspathEntries.filter(entry => entry.includes('resources'));
        if (resourcesEntries.length > 0) {
            this.outputChannel.appendLine(`✅ 类路径中包含resources相关目录 ${resourcesEntries.length} 个:`);
            resourcesEntries.forEach(entry => {
                this.outputChannel.appendLine(`   - ${entry}`);
            });
        } else {
            this.outputChannel.appendLine(`❌ 警告: 类路径中未找到resources目录！`);
        }

        // 确保所有类路径条目都是有效的文件系统路径，而不是URI
        const validatedClasspathEntries = uniqueClasspathEntries.filter(entry => {
            try {
                // 检查是否为有效的文件系统路径
                if (fs.existsSync(entry)) {
                    return true;
                }
                // 检查是否为有效的目录或文件路径（即使当前不存在）
                // 但排除看起来像jar中资源的URI
                if (entry.includes("!/")) {
                    this.outputChannel.appendLine(`⚠️ 跳过无效类路径条目(可能是jar中资源): ${entry}`);
                    return false;
                }
                return true;
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ 检查类路径条目时出错: ${entry}, 错误: ${error}`);
                return false;
            }
        });

        return validatedClasspathEntries.join(path.delimiter);
    }

    /**
     * 特别检查并添加与web服务相关的jar包
     * 用于解决nc.uap.ws.page.security.FilterChars等WS相关类找不到的问题
     */
    private checkAndAddWSJars(homePath: string, classpathEntries: string[]): void {
        // 搜索并添加可能包含ws相关类的jar包
        const wsJarKeywords = ['ws', 'webservice', 'uapws', 'web-service'];
        const wsJarPaths: string[] = [];

        // 搜索并添加可能包含Granite相关类的jar包
        const graniteJarKeywords = ['granite', 'flex', 'blazeds', 'amf'];
        const graniteJarPaths: string[] = [];

        // 搜索middleware/lib目录
        const middlewareLibDir = path.join(homePath, 'middleware', 'lib');
        if (fs.existsSync(middlewareLibDir)) {
            this.searchAndAddWSJars(middlewareLibDir, wsJarKeywords, wsJarPaths);
        }

        // 搜索lib目录
        const libDir = path.join(homePath, 'lib');
        if (fs.existsSync(libDir)) {
            this.searchAndAddWSJars(libDir, wsJarKeywords, wsJarPaths);
        }

        // 搜索external/lib目录
        const externalLibDir = path.join(homePath, 'external', 'lib');
        if (fs.existsSync(externalLibDir)) {
            this.searchAndAddWSJars(externalLibDir, wsJarKeywords, wsJarPaths);
        }

        // 搜索webapps/uapws/WEB-INF/lib目录
        const uapwsLibDir = path.join(homePath, 'webapps', 'uapws', 'WEB-INF', 'lib');
        if (fs.existsSync(uapwsLibDir)) {
            this.searchAndAddWSJars(uapwsLibDir, wsJarKeywords, wsJarPaths);
        }

        // 搜索webapps/webservice/WEB-INF/lib目录
        const webserviceLibDir = path.join(homePath, 'webapps', 'webservice', 'WEB-INF', 'lib');
        if (fs.existsSync(webserviceLibDir)) {
            this.searchAndAddWSJars(webserviceLibDir, wsJarKeywords, wsJarPaths);
            this.searchAndAddWSJars(webserviceLibDir, graniteJarKeywords, graniteJarPaths);
        }

        // 搜索Granite相关目录
        const graniteLibDir = path.join(homePath, 'middleware', 'granite', 'lib');
        if (fs.existsSync(graniteLibDir)) {
            this.searchAndAddWSJars(graniteLibDir, graniteJarKeywords, graniteJarPaths);
        }

        // 搜索flex相关目录
        const flexLibDir = path.join(homePath, 'middleware', 'flex', 'lib');
        if (fs.existsSync(flexLibDir)) {
            this.searchAndAddWSJars(flexLibDir, graniteJarKeywords, graniteJarPaths);
        }

        // 将找到的ws相关jar包添加到类路径
        for (const wsJarPath of wsJarPaths) {
            if (!classpathEntries.includes(wsJarPath)) {
                classpathEntries.push(wsJarPath);
                this.outputChannel.appendLine(`🚨 特别添加WS相关jar包: ${path.basename(wsJarPath)}`);
            }
        }

        // 将找到的Granite相关jar包添加到类路径
        for (const graniteJarPath of graniteJarPaths) {
            if (!classpathEntries.includes(graniteJarPath)) {
                classpathEntries.push(graniteJarPath);
                this.outputChannel.appendLine(`🚨 特别添加Granite相关jar包: ${path.basename(graniteJarPath)}`);
            }
        }
    }

    /**
     * 在指定目录中搜索并添加包含关键词的jar包
     */
    private searchAndAddWSJars(dir: string, keywords: string[], jarPaths: string[]): void {
        try {
            const files = fs.readdirSync(dir);
            const jars = files.filter(file => file.endsWith('.jar'));

            for (const jar of jars) {
                const jarPath = path.join(dir, jar);
                const jarName = jar.toLowerCase();

                for (const keyword of keywords) {
                    if (jarName.includes(keyword.toLowerCase())) {
                        jarPaths.push(jarPath);
                        break;
                    }
                }
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`⚠️ 读取目录失败: ${dir}, 错误: ${error.message}`);
        }
    }

    /**
     * 构建环境变量 (与IDEA插件保持一致)
     */
    private buildEnvironment(config: any): NodeJS.ProcessEnv {
        const env = { ...process.env };

        // 设置与IDEA插件一致的环境变量
        env.FIELD_NC_HOME = config.homePath;
        env.FIELD_HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        env.FIELD_EX_MODULES = config.exModules || '';

        // 兼容IDEA插件的变量命名
        env.IDEA_FIELD_NC_HOME = config.homePath;
        env.IDEA_FIELD_HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        env.IDEA_FIELD_EX_MODULES = config.exModules || '';

        // 添加数据源配置目录到环境变量
        const propDir = path.join(config.homePath, 'ierp', 'bin');
        env.NC_PROP_DIR = propDir;
        env.PROP_DIR = propDir;

        this.outputChannel.appendLine(`设置环境变量: FIELD_NC_HOME=${env.FIELD_NC_HOME}`);
        this.outputChannel.appendLine(`设置环境变量: FIELD_HOTWEBS=${env.FIELD_HOTWEBS}`);
        this.outputChannel.appendLine(`设置环境变量: NC_PROP_DIR=${env.NC_PROP_DIR}`);

        return env;
    }

    /**
     * 构建JVM参数 (与IDEA插件保持一致)
     */
    private buildVMParameters(config: any, serverPort: number, wsPort: number): string[] {
        const vmParameters: string[] = [];

        // 添加IDEA插件中的默认VM参数 (与IDEA插件保持一致)
        // 使用path.resolve确保所有路径都是绝对路径，避免URI格式问题
        vmParameters.push('-Dnc.exclude.modules=' + (config.exModules || ''));
        vmParameters.push('-Dnc.runMode=develop');
        vmParameters.push('-Dnc.server.location=' + path.resolve(config.homePath));
        vmParameters.push('-DEJBConfigDir=' + path.resolve(config.homePath, 'ejbXMLs'));
        vmParameters.push('-Dorg.owasp.esapi.resources=' + path.resolve(config.homePath, 'ierp', 'bin', 'esapi'));
        vmParameters.push('-DExtServiceConfigDir=' + path.resolve(config.homePath, 'ejbXMLs'));
        vmParameters.push('-Duap.hotwebs=' + (config.hotwebs || 'nccloud,fs,yonbip'));
        vmParameters.push('-Duap.disable.codescan=false');
        vmParameters.push('-Xmx1024m');
        vmParameters.push('-Dfile.encoding=UTF-8');
        vmParameters.push('-Duser.timezone=GMT+8');
        vmParameters.push('-Dnc.log.console=true');      // 强制输出日志到控制台
        vmParameters.push('-Dnc.debug=true');            // 开启调试模式
        vmParameters.push('-Dnc.log.level=DEBUG');       // 设置日志级别为 DEBUG
        vmParameters.push('-Dnc.startup.trace=true');    // 启动跟踪

        // 添加数据源配置目录参数 - 与IDEA插件保持一致
        const propDir = path.resolve(config.homePath, 'ierp', 'bin');
        vmParameters.push('-Dnc.prop.dir=' + propDir);
        vmParameters.push('-Dprop.dir=' + propDir);

        // 检查prop.xml文件是否存在
        const propFile = path.join(propDir, 'prop.xml');
        if (fs.existsSync(propFile)) {
            this.outputChannel.appendLine(`✅ 找到系统配置文件: ${propFile}`);
        } else {
            this.outputChannel.appendLine(`❌ 未找到系统配置文件: ${propFile}`);
        }

        // 添加默认数据源配置参数
        if (config.selectedDataSource) {
            vmParameters.push('-Dnc.datasource.default=' + config.selectedDataSource);
        }

        // 默认JVM参数
        vmParameters.push('-Xms256m');
        vmParameters.push('-Xmx1024m');

        // 检测Java版本，决定是否添加MaxPermSize参数
        // MaxPermSize参数在Java 9+版本中已被移除
        let javaVersion = 0;
        try {
            const { execSync } = require('child_process');
            const versionOutput = execSync('java -version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const versionMatch = (versionOutput || '').match(/version\s+"(\d+)/i);
            if (versionMatch && versionMatch[1]) {
                javaVersion = parseInt(versionMatch[1]);
                this.outputChannel.appendLine(`检测到Java版本: ${javaVersion}`);
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`警告: 无法检测Java版本，将假设使用Java 8+: ${error.message}`);
        }

        // 仅在Java 8及以下版本添加MaxPermSize参数
        if (javaVersion < 9 && javaVersion !== 0) {
            vmParameters.push('-XX:MaxPermSize=512m');
            this.outputChannel.appendLine('添加MaxPermSize参数');
        } else {
            this.outputChannel.appendLine('Java版本 >= 9，不添加MaxPermSize参数');
        }

        vmParameters.push('-XX:+HeapDumpOnOutOfMemoryError');
        vmParameters.push('-XX:HeapDumpPath=' + path.join(config.homePath, 'logs', 'nc_heapdump.hprof'));

        // 添加系统属性
        vmParameters.push('-Dnc.server.home=' + path.resolve(config.homePath));
        vmParameters.push('-Dnc.home=' + path.resolve(config.homePath));
        vmParameters.push('-Dnc.idesupport=true');
        vmParameters.push('-Dnc.scan=true');
        vmParameters.push('-Dnc.server.port=' + serverPort);

        // 特别添加与web服务相关的系统属性
        vmParameters.push('-Dws.server=true');
        vmParameters.push('-Dws.port=' + (wsPort || 8080));

        // 添加编码参数
        vmParameters.push('-Dfile.encoding=UTF-8');
        vmParameters.push('-Dconsole.encoding=UTF-8');
        vmParameters.push('-Dsun.jnu.encoding=UTF-8');
        vmParameters.push('-Dclient.encoding.override=UTF-8');

        // 添加XML解析器配置
        vmParameters.push('-Djavax.xml.parsers.DocumentBuilderFactory=com.sun.org.apache.xerces.internal.jaxp.DocumentBuilderFactoryImpl');
        vmParameters.push('-Djavax.xml.parsers.SAXParserFactory=com.sun.org.apache.xerces.internal.jaxp.SAXParserFactoryImpl');
        vmParameters.push('-Djavax.xml.transform.TransformerFactory=com.sun.org.apache.xalan.internal.xsltc.trax.TransformerFactoryImpl');

        // 添加Java 17兼容性参数 (如果Java版本 >= 17)
        if (javaVersion >= 17) {
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

        // 添加对java.lang包的开放访问权限，解决InaccessibleObjectException问题
        vmParameters.push('--add-opens=java.base/java.lang=ALL-UNNAMED');

        // macOS参数
        if (process.platform === 'darwin') {
            vmParameters.push('-Dapple.awt.UIElement=true');
        }

        // 调试模式参数
        if (config.debugMode) {
            vmParameters.push('-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=8888');
        }

        // 添加project.dir作为系统属性
        if (config.projectDir) {
            vmParameters.push('-Dproject.dir=' + config.projectDir);
        }

        // 自定义JVM参数
        if (config.vmParameters && config.vmParameters.length > 0) {
            vmParameters.push(...config.vmParameters);
        }

        return vmParameters;
    }

    /**
     * 获取Java可执行文件路径
     */
    private getJavaExecutable(config: any): string {
        // 首先尝试使用配置的Java路径
        if (config.javaHome) {
            const javaPath = path.join(config.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
            if (fs.existsSync(javaPath)) {
                this.outputChannel.appendLine(`✅ 使用配置的Java路径: ${javaPath}`);
                return javaPath;
            }
        }

        // 尝试从VS Code的java.configuration.runtimes配置中获取Java路径
        try {
            const javaConfig = vscode.workspace.getConfiguration('java.configuration');
            const runtimes = javaConfig.get<any[]>('runtimes', []);

            // 查找默认的Java运行时
            const defaultRuntime = runtimes.find(runtime => runtime.default === true);
            if (defaultRuntime && defaultRuntime.path) {
                const javaPath = path.join(defaultRuntime.path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                if (fs.existsSync(javaPath)) {
                    this.outputChannel.appendLine(`✅ 使用VS Code配置的默认Java运行时: ${javaPath}`);
                    return javaPath;
                }
            }

            // 如果没有默认运行时，尝试使用第一个配置的运行时
            if (runtimes.length > 0 && runtimes[0].path) {
                const javaPath = path.join(runtimes[0].path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                if (fs.existsSync(javaPath)) {
                    this.outputChannel.appendLine(`✅ 使用VS Code配置的第一个Java运行时: ${javaPath}`);
                    return javaPath;
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ 读取VS Code Java配置时出错: ${error}`);
        }

        // 回退到内置的ufjdk
        const ufjdkPath = path.join(config.homePath, 'ufjdk');
        const ufjdkBinPath = path.join(ufjdkPath, 'bin');

        // 根据操作系统确定可执行文件名
        const javaExeName = process.platform === 'win32' ? 'java.exe' : 'java';
        const javaBinPath = path.join(ufjdkBinPath, javaExeName);

        // 检查是否存在且可执行
        if (fs.existsSync(javaBinPath)) {
            try {
                // 在Unix系统上检查可执行权限
                if (process.platform !== 'win32') {
                    fs.accessSync(javaBinPath, fs.constants.X_OK);
                }

                // 验证这是一个有效的Java可执行文件
                const versionResult = spawnSync(javaBinPath, ['-version'], {
                    encoding: 'utf8',
                    timeout: 5000
                });

                if (versionResult.status === 0) {
                    this.outputChannel.appendLine(`✅ 使用NC内置JDK: ${javaBinPath}`);
                    return javaBinPath;
                } else {
                    this.outputChannel.appendLine(`⚠️  NC内置JDK验证失败，使用系统Java`);
                }
            } catch (error) {
                this.outputChannel.appendLine(`⚠️  NC内置JDK不可用: ${error}`);
            }
        } else {
            this.outputChannel.appendLine(`⚠️  未找到NC内置JDK: ${javaBinPath}`);
        }

        // 检查是否为Windows JDK在macOS/Linux上
        const wrongPlatformJava = path.join(ufjdkBinPath, process.platform === 'win32' ? 'java' : 'java.exe');
        if (fs.existsSync(wrongPlatformJava)) {
            this.outputChannel.appendLine(`⚠️  检测到不匹配的JDK平台，使用系统Java`);
        }

        // 使用系统Java
        try {
            const systemJavaResult = spawnSync('java', ['-version'], {
                encoding: 'utf8',
                timeout: 5000
            });

            if (systemJavaResult.status === 0) {
                this.outputChannel.appendLine(`✅ 使用系统Java: java`);
                return 'java';
            }
        } catch (error) {
            // 继续尝试其他路径
        }

        // 尝试常见Java路径
        const commonJavaPaths = [
            '/usr/bin/java',
            '/usr/local/bin/java',
            '/opt/homebrew/bin/java'
        ];

        for (const javaPath of commonJavaPaths) {
            if (fs.existsSync(javaPath)) {
                try {
                    const result = spawnSync(javaPath, ['-version'], {
                        encoding: 'utf8',
                        timeout: 5000
                    });

                    if (result.status === 0) {
                        this.outputChannel.appendLine(`✅ 使用系统Java: ${javaPath}`);
                        return javaPath;
                    }
                } catch (error) {
                    continue;
                }
            }
        }

        // 最后的回退方案
        this.outputChannel.appendLine(`❌ 未找到可用的Java可执行文件，使用默认java命令`);
        return 'java';
    }

    /**
     * 停止NC HOME服务
     */
    public async stopHomeService(): Promise<void> {
        this.outputChannel.show();
        // 清空控制台
        this.outputChannel.clear();
        this.outputChannel.appendLine('正在停止NC HOME服务...');

        if (this.status === HomeStatus.STOPPED || this.status === HomeStatus.STOPPING) {
            vscode.window.showWarningMessage('NC HOME服务未在运行');
            this.outputChannel.appendLine('⚠️ NC HOME服务未在运行');
            return;
        }

        try {
            this.setStatus(HomeStatus.STOPPING);
            this.isManualStop = true;

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

                stopProcess.on('close', (code: any) => {
                    this.outputChannel.appendLine(`停止脚本执行完成，退出码: ${code}`);
                    if (code === 0) {
                        this.setStatus(HomeStatus.STOPPED);
                        this.isManualStop = false;
                        this.outputChannel.appendLine('✅ HOME服务已成功停止');
                    } else {
                        this.outputChannel.appendLine(`⚠️ 停止脚本执行完成，但退出码为: ${code}`);
                        // 脚本执行失败，强制终止进程
                        this.killProcess();
                    }
                });

                stopProcess.on('error', (error: any) => {
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
            }, 15000); // 15秒超时

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
    /**
     * 强制终止进程
     */
    private killProcess(): void {
        if (this.process && !this.process.killed) {
            try {
                this.outputChannel.appendLine('正在强制终止HOME服务进程...');

                // 首先尝试正常终止
                this.process.kill('SIGTERM');

                // 如果进程在2秒内没有终止，则强制杀死
                setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        this.process.kill('SIGKILL');
                        this.outputChannel.appendLine('已发送强制终止信号');
                    }
                }, 2000);
            } catch (error: any) {
                this.outputChannel.appendLine(`终止进程失败: ${error.message}`);
            }
        } else {
            this.outputChannel.appendLine('没有正在运行的HOME服务进程');
        }

        // 设置状态为已停止
        this.setStatus(HomeStatus.STOPPED);
        this.isManualStop = false;
        this.outputChannel.appendLine('✅ HOME服务已停止');
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

    /**
     * 确保design数据源配置存在
     * 如果不存在，则根据配置创建一个默认的design数据源
     */
    private async ensureDesignDataSource(config: any): Promise<void> {
        const binDir = path.join(config.homePath, 'ierp', 'bin');
        const dataSourceIniPath = path.join(binDir, 'datasource.ini');
        const dataSourcePropertiesPath = path.join(binDir, 'datasource.properties');
        const propXmlPath = path.join(binDir, 'prop.xml');

        // 确保目录存在
        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
        }

        // 检查是否已存在数据源配置文件
        if (fs.existsSync(dataSourceIniPath) || fs.existsSync(dataSourcePropertiesPath)) {
            this.outputChannel.appendLine('✅ 数据源配置已存在');
        } else {
            // 如果配置中有数据源信息，则创建design数据源配置
            if (config.dataSources && config.dataSources.length > 0) {
                // 查找被标记为design的数据源
                let designDataSource = config.dataSources.find((ds: any) => ds.name === config.selectedDataSource);

                // 如果没有找到明确指定的design数据源，则使用第一个数据源
                if (!designDataSource && config.dataSources.length > 0) {
                    designDataSource = config.dataSources[0];
                    this.outputChannel.appendLine(`⚠️ 未找到明确指定的design数据源，使用第一个数据源: ${designDataSource.name}`);
                }

                if (designDataSource) {
                    this.outputChannel.appendLine(`🔧 创建design数据源配置: ${designDataSource.name}`);

                    // 构建数据源配置内容
                    const dataSourceContent = this.buildDataSourceConfig(designDataSource);

                    // 写入配置文件
                    fs.writeFileSync(dataSourceIniPath, dataSourceContent, 'utf-8');
                    this.outputChannel.appendLine(`✅ 已创建数据源配置文件: ${dataSourceIniPath}`);
                }
            } else {
                // 如果没有配置数据源，则创建一个默认的MySQL数据源配置
                this.outputChannel.appendLine('⚠️ 未配置数据源，创建默认的MySQL design数据源配置');
                const defaultDataSourceContent = `<?xml version="1.0" encoding="UTF-8"?>
<DataSourceMeta>
    <dataSourceName>design</dataSourceName>
    <databaseType>MySQL</databaseType>
    <driverClassName>com.mysql.cj.jdbc.Driver</driverClassName>
    <databaseUrl>jdbc:mysql://localhost:3306/nc6x?useSSL=false&amp;serverTimezone=UTC</databaseUrl>
    <user>root</user>
    <password>root</password>
    <maxCon>20</maxCon>
    <minCon>5</minCon>
</DataSourceMeta>`;

                fs.writeFileSync(dataSourceIniPath, defaultDataSourceContent, 'utf-8');
                this.outputChannel.appendLine(`✅ 已创建默认数据源配置文件: ${dataSourceIniPath}`);
            }
        }

        // 如果prop.xml不存在，也创建一个基础的prop.xml文件
        if (!fs.existsSync(propXmlPath)) {
            this.createBasicPropXml(config, null, propXmlPath);
        }
    }

    /**
     * 创建基础的prop.xml文件
     * @param config 配置信息
     * @param dataSource 数据源信息
     * @param propXmlPath prop.xml文件路径
     */
    private createBasicPropXml(config: any, dataSource: any, propXmlPath: string): void {
        // 确保配置目录存在
        const propDir = path.dirname(propXmlPath);
        if (!fs.existsSync(propDir)) {
            fs.mkdirSync(propDir, { recursive: true });
        }

        const propXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<config>
    <domain>
        <name>develop</name>
    </domain>
    <isEncode>false</isEncode>
    <enableHotDeploy>true</enableHotDeploy>
    <securityDataSource>design</securityDataSource>
    <dataSource>
        <dataSourceName>design</dataSourceName>
        <databaseType>MySQL</databaseType>
        <driverClassName>com.mysql.cj.jdbc.Driver</driverClassName>
        <databaseUrl>jdbc:mysql://localhost:3306/nc6x?useSSL=false&amp;serverTimezone=UTC</databaseUrl>
        <user>root</user>
        <password>root</password>
        <maxCon>20</maxCon>
        <minCon>5</minCon>
    </dataSource>
</config>`;

        fs.writeFileSync(propXmlPath, propXmlContent, 'utf-8');
        this.outputChannel.appendLine(`✅ 已创建基础prop.xml配置文件: ${propXmlPath}`);
    }

    /**
     * 构建数据源配置内容
     * @param dataSource 数据源配置信息
     */
    private buildDataSourceConfig(dataSource: any): string {
        // 根据数据库类型生成URL
        let databaseUrl = dataSource.url;
        if (!databaseUrl) {
            switch (dataSource.databaseType.toLowerCase()) {
                case 'mysql':
                    databaseUrl = `jdbc:mysql://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}?useSSL=false&serverTimezone=UTC`;
                    break;
                case 'oracle':
                    databaseUrl = `jdbc:oracle:thin:@${dataSource.host}:${dataSource.port}:${dataSource.databaseName}`;
                    break;
                case 'sqlserver':
                    databaseUrl = `jdbc:sqlserver://${dataSource.host}:${dataSource.port};database=${dataSource.databaseName}`;
                    break;
                case 'postgresql':
                    databaseUrl = `jdbc:postgresql://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
                    break;
                default:
                    databaseUrl = `jdbc:${dataSource.databaseType.toLowerCase()}://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
            }
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<DataSourceMeta>
    <dataSourceName>design</dataSourceName>
    <databaseType>${dataSource.databaseType}</databaseType>
    <driverClassName>${dataSource.driverClassName || this.getDriverClassName(dataSource.databaseType)}</driverClassName>
    <databaseUrl>${databaseUrl}</databaseUrl>
    <user>${dataSource.username}</user>
    <password>${dataSource.password}</password>
    <maxCon>20</maxCon>
    <minCon>5</minCon>
</DataSourceMeta>`;
    }

    /**
     * 根据数据库类型获取驱动类名
     * @param databaseType 数据库类型
     */
    private getDriverClassName(databaseType: string): string {
        // 处理空值或未定义的情况
        if (!databaseType) {
            this.outputChannel.appendLine('⚠️ 数据库类型未指定，使用默认MySQL驱动');
            return 'com.mysql.cj.jdbc.Driver';
        }

        switch (databaseType.toLowerCase().trim()) {
            case 'mysql':
            case 'mysql5':
            case 'mysql8':
                return 'com.mysql.cj.jdbc.Driver';
            case 'oracle':
            case 'oracle11g':
            case 'oracle12c':
                return 'oracle.jdbc.OracleDriver';
            case 'sqlserver':
            case 'mssql':
            case 'microsoft sql server':
                return 'com.microsoft.sqlserver.jdbc.SQLServerDriver';
            case 'postgresql':
            case 'pg':
                return 'org.postgresql.Driver';
            case 'db2':
                return 'com.ibm.db2.jcc.DB2Driver';
            case 'sybase':
                return 'com.sybase.jdbc4.jdbc.SybDriver';
            default:
                this.outputChannel.appendLine(`⚠️ 未知数据库类型: ${databaseType}，使用默认MySQL驱动`);
                return 'com.mysql.cj.jdbc.Driver';
        }
    }

    /**
     * 检查端口占用并终止占用进程
     * @param serverPort 服务端口
     * @param wsPort WebService端口
     */
    private async checkAndKillPortProcesses(serverPort: number, wsPort: number): Promise<void> {
        return new Promise((resolve) => {
            this.outputChannel.appendLine(`🔍 检查HOME服务端口 ${serverPort} 和 WAS端口 ${wsPort} 是否被占用...`);

            // 根据不同平台使用不同命令
            let command: string;
            let args: string[];

            if (process.platform === 'win32') {
                // Windows平台使用netstat命令
                command = 'netstat';
                args = ['-a', '-n', '-o'];
            } else {
                // Unix-like平台使用lsof命令
                command = 'lsof';
                args = ['-i', `:${serverPort}`, '-t'];
            }

            const processList = spawn(command, args);
            let output = '';
            let errorOutput = '';

            processList.stdout?.on('data', (data) => {
                output += data.toString();
            });

            processList.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });

            processList.on('close', async (code) => {
                if (code !== 0 && errorOutput) {
                    this.outputChannel.appendLine(`⚠️ 检查端口时出现错误: ${errorOutput}`);
                    resolve();
                    return;
                }

                const processesToKill: number[] = [];

                if (process.platform === 'win32') {
                    // Windows平台处理
                    const lines = output.split('\n');
                    for (const line of lines) {
                        // 查找TCP连接中包含指定端口且状态为LISTENING的行
                        const serverPortRegex = new RegExp(`TCP\\s+[^:]+:${serverPort}\\s+[^:]+:\\d+\\s+LISTENING\\s+(\\d+)`);
                        const wsPortRegex = new RegExp(`TCP\\s+[^:]+:${wsPort}\\s+[^:]+:\\d+\\s+LISTENING\\s+(\\d+)`);

                        const serverMatch = line.match(serverPortRegex);
                        const wsMatch = line.match(wsPortRegex);

                        if (serverMatch) {
                            const pid = parseInt(serverMatch[1]);
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${serverPort} 被进程 ${pid} 占用`);
                            }
                        }

                        if (wsMatch) {
                            const pid = parseInt(wsMatch[1]);
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${wsPort} 被进程 ${pid} 占用`);
                            }
                        }
                    }
                } else {
                    // Unix-like平台处理
                    const lines = output.split('\n').filter(line => line.trim() !== '');
                    if (lines.length > 0) {
                        for (const line of lines) {
                            const pid = parseInt(line.trim());
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${serverPort} 被进程 ${pid} 占用`);
                            }
                        }

                        // 检查wsPort
                        try {
                            const wsProcessList = spawn('lsof', ['-i', `:${wsPort}`, '-t']);
                            let wsOutput = '';

                            wsProcessList.stdout?.on('data', (data) => {
                                wsOutput += data.toString();
                            });

                            wsProcessList.on('close', (wsCode) => {
                                if (wsCode === 0) {
                                    const wsLines = wsOutput.split('\n').filter(line => line.trim() !== '');
                                    for (const line of wsLines) {
                                        const pid = parseInt(line.trim());
                                        if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                            processesToKill.push(pid);
                                            this.outputChannel.appendLine(`🔍 发现端口 ${wsPort} 被进程 ${pid} 占用`);
                                        }
                                    }
                                }
                            });
                        } catch (error) {
                            this.outputChannel.appendLine(`⚠️ 检查ws端口时出现错误: ${error}`);
                        }
                    }
                }

                // 终止占用端口的进程
                if (processesToKill.length > 0) {
                    this.outputChannel.appendLine(`🚫 发现 ${processesToKill.length} 个进程占用端口，准备终止...`);

                    for (const pid of processesToKill) {
                        try {
                            this.outputChannel.appendLine(`⏳ 正在终止进程 ${pid}...`);
                            process.kill(pid, 'SIGTERM');

                            // 等待一段时间让进程正常退出
                            await new Promise(r => setTimeout(r, 1000));

                            // 检查进程是否仍然存在，如果存在则强制杀死
                            try {
                                process.kill(pid, 0); // 检查进程是否存在
                                this.outputChannel.appendLine(`⚠️ 进程 ${pid} 未正常退出，强制终止...`);
                                process.kill(pid, 'SIGKILL');
                            } catch (error) {
                                // 进程已经退出
                                this.outputChannel.appendLine(`✅ 进程 ${pid} 已终止`);
                            }
                        } catch (error: any) {
                            if (error.code === 'ESRCH') {
                                this.outputChannel.appendLine(`✅ 进程 ${pid} 已经退出`);
                            } else {
                                this.outputChannel.appendLine(`❌ 终止进程 ${pid} 失败: ${error.message}`);
                                vscode.window.showErrorMessage(`终止进程 ${pid} 失败: ${error.message}`);
                            }
                        }
                    }

                    // 等待一段时间确保端口已释放
                    this.outputChannel.appendLine('⏳ 等待端口释放...');
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    this.outputChannel.appendLine('✅ 未发现端口冲突');
                }

                resolve();
            });
        });
    }

    /**
     * 应用控制台编码补丁
     * @param homePath NC HOME路径
     */
    private async applyConsoleEncodingPatch(homePath: string): Promise<void> {
        return new Promise((resolve) => {
            this.outputChannel.appendLine('🔧 应用控制台编码补丁...');

            try {
                // 检查JDK版本并应用DirectJDKLog补丁
                const jdkVersion = this.getJDKVersion(homePath);
                this.outputChannel.appendLine(`🔍 检测到JDK版本: ${jdkVersion}`);

                if (jdkVersion >= 50) {
                    this.outputChannel.appendLine('🔧 JDK版本 >= 50，应用DirectJDKLog补丁...');

                    // 目标文件路径
                    const targetFile = path.join(
                        homePath,
                        'middleware',
                        'classes',
                        'org',
                        'apache',
                        'juli',
                        'logging',
                        'DirectJDKLog.class'
                    );

                    // 检查目标文件是否已存在
                    if (!fs.existsSync(targetFile)) {
                        // 确保目标目录存在
                        const targetDir = path.dirname(targetFile);
                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }

                        // 尝试从resources目录获取补丁文件
                        const patchFile = path.join(
                            __dirname,
                            '..',
                            '..',
                            'resources',
                            'replacement',
                            'DirectJDKLog.class'
                        );

                        if (fs.existsSync(patchFile)) {
                            // 复制补丁文件到目标位置
                            fs.copyFileSync(patchFile, targetFile);
                            this.outputChannel.appendLine(`✅ DirectJDKLog补丁已应用: ${targetFile}`);
                        } else {
                            this.outputChannel.appendLine(`⚠️ 未找到DirectJDKLog补丁文件: ${patchFile}`);
                        }
                    } else {
                        this.outputChannel.appendLine('✅ DirectJDKLog补丁已存在，无需重复应用');
                    }
                } else {
                    this.outputChannel.appendLine('✅ JDK版本 < 50，无需应用DirectJDKLog补丁');
                }

                this.outputChannel.appendLine('✅ 控制台编码补丁应用完成');
                resolve();
            } catch (error: any) {
                this.outputChannel.appendLine(`⚠️ 应用控制台编码补丁时出现错误: ${error.message}`);
                // 不要让补丁应用失败阻止服务启动
                resolve();
            }
        });
    }

    /**
     * 获取JDK版本
     * @param homePath NC HOME路径
     */
    private getJDKVersion(homePath: string): number {
        try {
            // 获取Java可执行文件路径
            let javaExecutable = 'java';
            const ufjdkPath = path.join(homePath, 'ufjdk');
            const ufjdkBinPath = path.join(ufjdkPath, 'bin');

            if (process.platform === 'win32') {
                const javaExe = path.join(ufjdkBinPath, 'java.exe');
                if (fs.existsSync(javaExe)) {
                    javaExecutable = javaExe;
                }
            } else {
                const javaBin = path.join(ufjdkBinPath, 'java');
                if (fs.existsSync(javaBin)) {
                    javaExecutable = javaBin;
                }
            }

            // 执行Java版本命令
            const result = spawnSync(javaExecutable, ['-version'], {
                encoding: 'utf8',
                timeout: 10000
            });

            if (result.status === 0) {
                const versionOutput = result.stderr || result.stdout;
                // 解析Java版本，例如 "java version \"1.8.0_261\"" 或 "openjdk version \"11.0.8\""
                const versionMatch = versionOutput.match(/version\s+["']([^"']+)["']/i);
                if (versionMatch && versionMatch[1]) {
                    const versionStr = versionMatch[1];
                    // 提取主版本号
                    let version: number;
                    if (versionStr.startsWith('1.')) {
                        // Java 8及以下版本格式 "1.8.0_261"
                        version = parseInt(versionStr.split('.')[1]);
                    } else {
                        // Java 9及以上版本格式 "11.0.8"
                        version = parseInt(versionStr.split('.')[0]);
                    }
                    return version * 10; // 乘以10以匹配IDEA插件中的逻辑
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ 获取JDK版本时出错: ${error}`);
        }

        // 默认返回一个较低的版本号
        return 0;
    }

}