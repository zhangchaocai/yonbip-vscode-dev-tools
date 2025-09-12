import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
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
            
            this.outputChannel.appendLine('⚠️ 未识别的项目类型，跳过编译步骤');
            resolve(true);
        });
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
            this.outputChannel.appendLine('⚠️ 未检测到工作区，跳过项目编译步骤');
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

        this.outputChannel.show();
        this.outputChannel.appendLine('🚀 开始启动NC HOME服务...');
        this.outputChannel.appendLine(`📂 NC HOME路径: ${config.homePath}`);
        this.setStatus(HomeStatus.STARTING);

        try {
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
            
            // 构建JVM参数 (使用与IDEA插件一致的参数)
            const vmParameters = this.buildVMParameters(config);
            
            // 构建完整命令
            const command = [
                'java',
                ...vmParameters,
                '-cp',
                `"${classpath}"`,
                mainClass
            ].join(' ');

            this.outputChannel.appendLine('✅ 准备启动NC HOME服务...');
            this.outputChannel.appendLine(`🖥️  主类: ${mainClass}`);
            this.outputChannel.appendLine(`📦 类路径包含 ${classpath.split(path.delimiter).length} 个条目`);
            this.outputChannel.appendLine(`🏠 HOME路径: ${config.homePath}`);
            this.outputChannel.appendLine(`⚙️  JVM参数: ${vmParameters.join(' ')}`);
            this.outputChannel.appendLine(`🔧 完整启动命令: java ${vmParameters.join(' ')} -cp "[类路径]" ${mainClass}`);
            this.outputChannel.appendLine('💡 如果服务启动失败，可在终端中手动运行上述命令以获取详细错误信息');

            // 执行启动命令
            // 注意：这里需要将类路径字符串拆分为数组，因为spawn需要参数数组
            const cpArgs = ['-cp', classpath];
            this.process = spawn('java', [...vmParameters, ...cpArgs, mainClass], {
                cwd: config.homePath,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    JAVA_TOOL_OPTIONS: '-Dfile.encoding=GBK',
                    LANG: 'zh_CN.GBK',
                    LC_ALL: 'zh_CN.GBK',
                    LC_CTYPE: 'zh_CN.GBK',
                    JAVA_OPTS: '-Dfile.encoding=GBK -Dconsole.encoding=GBK',
                    // 添加IDEA插件使用的环境变量
                    FIELD_NC_HOME: config.homePath,
                    IDEA_FIELD_NC_HOME: config.homePath,
                    // 添加hotwebs环境变量
                    FIELD_HOTWEBS: path.join(config.homePath, 'hotwebs'),
                    uap_hotwebs: path.join(config.homePath, 'hotwebs')
                }
            });

            // 监听标准输出
            this.process.stdout?.on('data', (data: any) => {
                let output = data.toString();
                // 尝试处理可能的编码问题
                if (output.includes('') || output.includes('?')) {
                    try {
                        // 如果包含乱码字符，尝试用iconv-lite进行GBK解码
                        output = iconv.decode(data, 'gbk');
                    } catch (e) {
                        // 如果转换失败，尝试使用gb2312
                        try {
                            output = iconv.decode(data, 'gb2312');
                        } catch (e2) {
                            // 如果还是失败，保留原始输出
                        }
                    }
                }
                // 移除ANSI转义序列
                output = output.replace(/\u001b\[.*?m/g, '');
                // 移除其他控制字符
                output = output.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
                this.outputChannel.appendLine(`[STDOUT] ${output}`);
            });

            // 监听标准错误输出
            this.process.stderr?.on('data', (data: any) => {
                let stderrOutput = data.toString();
                // 尝试处理可能的编码问题
                if (stderrOutput.includes('') || stderrOutput.includes('?')) {
                    try {
                        // 如果包含乱码字符，尝试用iconv-lite进行GBK解码
                        stderrOutput = iconv.decode(data, 'gbk');
                    } catch (e) {
                        // 如果转换失败，尝试使用gb2312
                        try {
                            stderrOutput = iconv.decode(data, 'gb2312');
                        } catch (e2) {
                            // 如果还是失败，保留原始输出
                        }
                    }
                }
                // 移除ANSI转义序列
                stderrOutput = stderrOutput.replace(/\u001b\[.*?m/g, '');
                // 移除其他控制字符
                stderrOutput = stderrOutput.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
                this.outputChannel.appendLine(`[STDERR] ${stderrOutput}`);
                
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
            this.process.on('error', (error: any) => {
                this.outputChannel.appendLine(`❌ 启动服务时发生错误: ${error.message}`);
                this.setStatus(HomeStatus.ERROR);
                this.process = null;
            });

            // 检查进程是否成功启动
            if (!this.process.pid) {
                this.outputChannel.appendLine('❌ 无法启动NC HOME服务进程');
                this.setStatus(HomeStatus.ERROR);
                this.process = null;
                return;
            }
            
            this.outputChannel.appendLine(`NC HOME服务进程已创建，PID: ${this.process.pid}`);
            this.setStatus(HomeStatus.RUNNING);

            // 启动后检查服务是否正常运行
            this.startupCheckTimer = setTimeout(() => {
                this.checkServiceStatus(config);
            }, 5000); // 5秒后检查

        } catch (error: any) {
            this.outputChannel.appendLine(`❌ 启动NC HOME服务失败: ${error.message}`);
            this.setStatus(HomeStatus.ERROR);
            vscode.window.showErrorMessage(`启动NC HOME服务失败: ${error.message}`);
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
        
        // 添加工作区编译输出目录
        if (workspaceFolder) {
            const targetClasses = path.join(workspaceFolder, 'target', 'classes'); // Maven项目
            const buildClasses = path.join(workspaceFolder, 'build', 'classes'); // Gradle项目
            
            if (fs.existsSync(targetClasses)) {
                classpathEntries.push(targetClasses);
                this.outputChannel.appendLine(`📁 添加Maven编译输出目录: ${targetClasses}`);
            }
            
            if (fs.existsSync(buildClasses)) {
                classpathEntries.push(buildClasses);
                this.outputChannel.appendLine(`📁 添加Gradle编译输出目录: ${buildClasses}`);
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
            path.join(config.homePath, 'resources'), // 添加resources目录
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
        
        // 去除重复项并构建类路径
        const uniqueClasspathEntries = [...new Set(classpathEntries)];
        this.outputChannel.appendLine(`类路径构建完成，共包含 ${uniqueClasspathEntries.length} 个条目`);
        
        return uniqueClasspathEntries.join(path.delimiter);
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
     * 构建JVM参数 (与IDEA插件保持一致)
     */
    private buildVMParameters(config: any): string[] {
        const vmParameters: string[] = [];
        
        // 添加IDEA插件中的默认VM参数 (与IDEA插件保持一致)
        vmParameters.push('-Dnc.exclude.modules=' + (config.exModules || ''));
        //vmParameters.push('-Dnc.runMode=develop');
        vmParameters.push('-Dnc.server.location=' + config.homePath);
        vmParameters.push('-DEJBConfigDir=' + path.join(config.homePath, 'ejbXMLs'));
        vmParameters.push('-Dorg.owasp.esapi.resources=' + path.join(config.homePath, 'ierp', 'bin', 'esapi'));
        vmParameters.push('-DExtServiceConfigDir=' + path.join(config.homePath, 'ejbXMLs'));
        vmParameters.push('-Duap.hotwebs=' + (config.hotwebs || 'nccloud,fs,yonbip'));
        vmParameters.push('-Duap.disable.codescan=false');
        vmParameters.push('-Xmx1024m');
        vmParameters.push('-Dfile.encoding=UTF-8');
        vmParameters.push('-Duser.timezone=GMT+8');
        
        // 添加数据源配置目录参数 - 与IDEA插件保持一致
        vmParameters.push('-Dnc.prop.dir=' + path.join(config.homePath, 'ierp', 'bin'));
        vmParameters.push('-Dprop.dir=' + path.join(config.homePath, 'ierp', 'bin'));
        
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
        vmParameters.push('-XX:HeapDumpPath=${HOME}/nc_heapdump.hprof');
        
        // 添加系统属性
        vmParameters.push('-Dnc.server.home=' + config.homePath);
        vmParameters.push('-Dnc.home=' + config.homePath);
        vmParameters.push('-Dnc.idesupport=true');
        vmParameters.push('-Dnc.scan=true');
        vmParameters.push('-Dnc.server.port=' + (config.port || 9999));
        
        // 特别添加与web服务相关的系统属性
        vmParameters.push('-Dws.server=true');
        vmParameters.push('-Dws.port=' + (config.wsPort || 8080));
        vmParameters.push('-Dws.context.path=/uapws');
        
        // 添加编码参数
        vmParameters.push('-Dfile.encoding=GBK');
        vmParameters.push('-Dconsole.encoding=GBK');
        
        // 添加XML解析器配置
        vmParameters.push('-Djavax.xml.parsers.DocumentBuilderFactory=com.sun.org.apache.xerces.internal.jaxp.DocumentBuilderFactoryImpl');
        vmParameters.push('-Djavax.xml.parsers.SAXParserFactory=com.sun.org.apache.xerces.internal.jaxp.SAXParserFactoryImpl');
        vmParameters.push('-Djavax.xml.transform.TransformerFactory=com.sun.org.apache.xalan.internal.xsltc.trax.TransformerFactoryImpl');
        
        // Java 17兼容参数
        if (javaVersion >= 17) {
            vmParameters.push('--add-opens=java.base/java.lang=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.io=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.util=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.util.concurrent=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.rmi/sun.rmi.transport=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.lang.reflect=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.net=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.xml/javax.xml=ALL-UNNAMED');
            vmParameters.push('--add-opens=java.xml/javax.xml.stream=ALL-UNNAMED');
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
        
        // macOS参数
        if (process.platform === 'darwin') {
            vmParameters.push('-Dapple.awt.UIElement=true');
        }
        
        // 调试模式参数
        if (config.debugMode) {
            vmParameters.push('-Xdebug');
            vmParameters.push('-Xrunjdwp:transport=dt_socket,server=y,suspend=n,address=8888');
        }
        
        // 自定义JVM参数
        if (config.vmParameters && config.vmParameters.length > 0) {
            vmParameters.push(...config.vmParameters);
        }
        
        return vmParameters;
    }

    /**
     * 检查服务状态
     */
    private checkServiceStatus(config: any): void {
        // 这里可以添加服务状态检查逻辑
        // 比如检查特定端口是否已监听等
        this.outputChannel.appendLine('✅ 服务启动检查完成');
    }

    /**
     * 停止NC HOME服务
     */
    public async stopHomeService(): Promise<void> {
        if (this.status === HomeStatus.STOPPED || this.status === HomeStatus.STOPPING) {
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

                stopProcess.on('close', (code: any) => {
                    this.outputChannel.appendLine(`停止脚本执行完成，退出码: ${code}`);
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