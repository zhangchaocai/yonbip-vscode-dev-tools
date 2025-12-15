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
exports.HomeService = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const iconv = __importStar(require("iconv-lite"));
const OracleClientService_1 = require("./OracleClientService");
const homeStatus_1 = require("./homeStatus");
const JavaVersionUtils_1 = require("../../shared/utils/JavaVersionUtils");
const ClasspathUtils_1 = require("../../shared/utils/ClasspathUtils");
class HomeService {
    context;
    configService;
    process = null;
    status = homeStatus_1.HomeStatus.STOPPED;
    outputChannel;
    static outputChannelInstance = null;
    isManualStop = false;
    startupCheckTimer = null;
    oracleClientService;
    constructor(context, configService) {
        this.context = context;
        this.configService = configService;
        this.oracleClientService = new OracleClientService_1.OracleClientService(context);
        if (!HomeService.outputChannelInstance) {
            HomeService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP NC HOME服务');
        }
        this.outputChannel = HomeService.outputChannelInstance;
    }
    containsGarbledCharacters(str) {
        const garbledPatterns = [
            '??',
            '? ?',
            'Warning: setSecurityManager',
            '9',
            '',
            '',
            '涓嶅厑璁',
            '搴旂敤宸ュ巶',
            '鎻掍欢鎵弿'
        ];
        const hasChinese = /[\u4e00-\u9fa5]/.test(str);
        const hasManyUnknownChars = (str.match(/[^\x00-\x7F]/g) || []).length > str.length * 0.3;
        const hasGarbledPattern = garbledPatterns.some(pattern => {
            return str.includes(pattern);
        });
        if (hasChinese && hasGarbledPattern) {
            return true;
        }
        if (!hasChinese && (hasManyUnknownChars || hasGarbledPattern)) {
            return true;
        }
        if (str.includes('9') && !str.includes('9月')) {
            return true;
        }
        if (str.includes('涓嶅厑璁') && str.includes('鐨勫鐞嗘寚浠ょ洰鏍囥')) {
            return true;
        }
        return false;
    }
    decodeDataWithMultipleEncodings(data) {
        const encodings = ['utf-8', 'gbk', 'gb2312'];
        const originalString = data.toString();
        for (const encoding of encodings) {
            try {
                const decoded = iconv.decode(data, encoding);
                if (!this.containsGarbledCharacters(decoded)) {
                    return decoded;
                }
                if (originalString.includes('???') && !decoded.includes('???')) {
                    return decoded;
                }
                if ((originalString.includes('9') || originalString.includes('')) && decoded.includes('9月')) {
                    return decoded;
                }
                if (originalString.includes('') && decoded.includes('应用工厂')) {
                    return decoded;
                }
                if (originalString.includes('涓嶅厑璁') && decoded.includes('不允许有匹配')) {
                    return decoded;
                }
            }
            catch (e) {
                continue;
            }
        }
        try {
            return iconv.decode(data, 'gbk');
        }
        catch (e) {
            return originalString;
        }
    }
    async compileProject(workspaceFolder) {
        return new Promise((resolve) => {
            this.outputChannel.appendLine('🔍 检查项目是否需要编译...');
            const srcPaths = this.findSrcDirectories(workspaceFolder);
            if (srcPaths.length === 0) {
                this.outputChannel.appendLine('✅ 项目中没有源代码需要编译');
                resolve(true);
                return;
            }
            let hasJavaProject = false;
            for (const srcPath of srcPaths) {
                if (this.hasJavaFiles(srcPath)) {
                    hasJavaProject = true;
                    break;
                }
            }
            if (hasJavaProject) {
                this.outputChannel.appendLine('🔨 检测到标准Java项目，正在编译...');
                this.outputChannel.appendLine('🔧 请确保项目已正确配置编译环境');
                resolve(true);
                return;
            }
            this.outputChannel.appendLine('⚠️ 未识别的项目类型，跳过编译步骤');
            resolve(true);
        });
    }
    findSrcDirectories(dirPath) {
        const srcPaths = [];
        try {
            const srcPath = path.join(dirPath, 'src');
            if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
                srcPaths.push(srcPath);
            }
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                if (item === 'node_modules' || item === '.git' || item === 'target' || item === 'build' || item === 'bin') {
                    continue;
                }
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    srcPaths.push(...this.findSrcDirectories(itemPath));
                }
            }
        }
        catch (error) {
        }
        return srcPaths;
    }
    hasJavaFiles(dirPath) {
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    if (this.hasJavaFiles(itemPath)) {
                        return true;
                    }
                }
                else if (item.endsWith('.java')) {
                    return true;
                }
            }
            return false;
        }
        catch (error) {
            return false;
        }
    }
    async checkOracleClientIfNeeded(config) {
        if (config.dataSource && config.dataSource.type === 'oracle') {
            await this.checkOracleClientIfNeeded(config);
        }
    }
    async startHomeService(selectedPath) {
        if (this.status === homeStatus_1.HomeStatus.RUNNING || this.status === homeStatus_1.HomeStatus.STARTING) {
            vscode.window.showWarningMessage('NC HOME服务已在运行中');
            return;
        }
        const config = this.configService.getConfig();
        let workspaceFolder = '';
        if (selectedPath) {
            workspaceFolder = selectedPath;
            this.outputChannel.appendLine(`📂 用户选择的初始化目录: ${workspaceFolder}`);
            const compileSuccess = await this.compileProject(workspaceFolder);
            if (!compileSuccess) {
                vscode.window.showErrorMessage('项目编译失败，请检查代码错误');
                return;
            }
        }
        else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.outputChannel.appendLine(`📂 当前工作区: ${workspaceFolder}`);
            const compileSuccess = await this.compileProject(workspaceFolder);
            if (!compileSuccess) {
                vscode.window.showErrorMessage('项目编译失败，请检查代码错误');
                return;
            }
        }
        else {
            this.outputChannel.appendLine('⚠️ 未检测到工作区，跳过项目编译和resources目录复制步骤');
        }
        if (!config.homePath) {
            vscode.window.showErrorMessage('请先配置NC HOME路径');
            return;
        }
        if (!fs.existsSync(config.homePath)) {
            vscode.window.showErrorMessage(`NC HOME路径不存在: ${config.homePath}`);
            return;
        }
        await this.checkOracleClientIfNeeded(config);
        try {
            this.setStatus(homeStatus_1.HomeStatus.STARTING);
            this.outputChannel.clear();
            this.outputChannel.appendLine('正在启动NC HOME服务...');
            this.outputChannel.show();
            await this.applyConsoleEncodingPatch(config.homePath);
            const portsAndDataSourcesFromProp = this.configService.getPortFromPropXml();
            const serverPort = portsAndDataSourcesFromProp.port || config.port || 8077;
            const wsPort = portsAndDataSourcesFromProp.wsPort || config.wsPort || 8080;
            const debugPort = config.debugPort || 8888;
            this.outputChannel.appendLine(`🔍 检查端口占用情况...`);
            await this.checkAndKillPortProcesses(serverPort, wsPort, debugPort);
            await this.ensureDesignDataSource(config);
            const coreJarPath = this.getCoreJarPath(config.homePath);
            if (!coreJarPath) {
                vscode.window.showErrorMessage('未找到core.jar文件，请检查NC HOME配置');
                this.setStatus(homeStatus_1.HomeStatus.ERROR);
                return;
            }
            this.outputChannel.appendLine(`📦 找到core.jar: ${coreJarPath}`);
            let mainClass = 'ufmiddle.start.tomcat.StartDirectServer';
            if (this.containsWJClasses(coreJarPath)) {
                mainClass = 'ufmiddle.start.wj.StartDirectServer';
                this.outputChannel.appendLine('🔧 检测到WJ相关类，使用WJ启动类');
            }
            const classpath = this.buildClasspath(config, coreJarPath, workspaceFolder);
            const propDir = path.join(config.homePath, 'ierp', 'bin');
            const propFile = path.join(propDir, 'prop.xml');
            if (!fs.existsSync(propFile)) {
                this.outputChannel.appendLine(`❌ 严重错误: 系统配置文件不存在: ${propFile}`);
                this.outputChannel.appendLine('请确保正确配置了NC HOME目录，并且包含必要的配置文件');
                this.setStatus(homeStatus_1.HomeStatus.ERROR);
                vscode.window.showErrorMessage(`系统配置文件不存在: ${propFile}，请检查NC HOME配置`);
                return;
            }
            else {
                this.outputChannel.appendLine(`✅ 系统配置文件存在: ${propFile}`);
                try {
                    const propContent = fs.readFileSync(propFile, 'utf-8');
                    if (propContent.includes('<dataSource>') || propContent.includes('<dataSources>')) {
                        this.outputChannel.appendLine('✅ 配置文件中包含数据源配置');
                    }
                    else {
                        this.outputChannel.appendLine('⚠️ 配置文件中未找到数据源配置');
                    }
                }
                catch (error) {
                    this.outputChannel.appendLine(`⚠️ 无法读取配置文件: ${error.message}`);
                }
            }
            const dataSourceDir = path.join(config.homePath, 'ierp', 'bin');
            if (fs.existsSync(dataSourceDir)) {
                const dataSourceFiles = fs.readdirSync(dataSourceDir);
                const dsConfigs = dataSourceFiles.filter(file => file.startsWith('datasource') && (file.endsWith('.ini') || file.endsWith('.properties')));
                if (dsConfigs.length > 0) {
                    this.outputChannel.appendLine(`✅ 找到 ${dsConfigs.length} 个数据源配置文件`);
                    dsConfigs.forEach(file => {
                        this.outputChannel.appendLine(`   - ${file}`);
                    });
                }
                else {
                    this.outputChannel.appendLine('⚠️ 未找到数据源配置文件，可能导致启动失败');
                }
            }
            else {
                this.outputChannel.appendLine('⚠️ 未找到数据源配置目录，可能导致启动失败');
            }
            const env = this.buildEnvironment(config);
            const vmParameters = await this.buildVMParameters(config, serverPort, wsPort);
            let javaExecutable = this.getJavaExecutable(config);
            this.outputChannel.appendLine('✅ 准备启动NC HOME服务...');
            this.outputChannel.appendLine(`☕ Java可执行文件: ${javaExecutable}`);
            this.outputChannel.appendLine(`🖥️  主类: ${mainClass}`);
            this.outputChannel.appendLine(`📦 类路径包含 ${classpath.split(path.delimiter).length} 个条目`);
            this.outputChannel.appendLine(`🏠 HOME路径: ${config.homePath}`);
            this.outputChannel.appendLine(`⚙️  JVM参数: ${vmParameters.join(' ')}`);
            const javaArgs = [
                ...vmParameters,
                '-cp',
                classpath,
                mainClass
            ];
            this.process = (0, child_process_1.spawn)(javaExecutable, javaArgs, {
                cwd: config.homePath,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...env,
                    LANG: 'zh_CN.UTF-8',
                    LC_ALL: 'zh_CN.UTF-8',
                    LC_CTYPE: 'zh_CN.UTF-8',
                }
            });
            this.process.stdout?.on('data', (data) => {
                let output = data.toString();
                if (this.containsGarbledCharacters(output)) {
                    output = this.decodeDataWithMultipleEncodings(data);
                }
                output = output.replace(/\u001b\[.*?m/g, '');
                output = output.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
                if (!output.includes('[Fatal Error]')) {
                    this.outputChannel.appendLine(`[STDOUT] ${output}`);
                }
                if (output.includes('Server startup in') ||
                    output.includes('服务启动成功') ||
                    output.includes('Started ServerConnector') ||
                    output.includes('Tomcat started on port')) {
                    this.setStatus(homeStatus_1.HomeStatus.RUNNING);
                    vscode.window.showInformationMessage('NC HOME服务启动成功!');
                }
            });
            this.process.stderr?.on('data', (data) => {
                let stderrOutput = data.toString();
                if (this.containsGarbledCharacters(stderrOutput)) {
                    stderrOutput = this.decodeDataWithMultipleEncodings(data);
                }
                stderrOutput = stderrOutput.replace(/\u001b\[.*?m/g, '');
                stderrOutput = stderrOutput.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
                this.outputChannel.appendLine(`[STDERR] ${stderrOutput}`);
                stderrOutput = stderrOutput.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
                this.outputChannel.appendLine(`[STDERR] ${stderrOutput}`);
                if (stderrOutput.includes('ERROR') || stderrOutput.includes('Exception')) {
                    this.outputChannel.appendLine('❌ 检测到错误信息');
                }
                if (!stderrOutput.includes('Exception') &&
                    !stderrOutput.includes('Error') &&
                    !stderrOutput.includes('Caused by')) {
                    this.outputChannel.appendLine('⚠️ 请特别关注以上STDERR输出，它可能包含导致启动失败的重要信息');
                }
            });
            this.process.on('exit', (code, signal) => {
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
                }
                else if (code !== 0 && !this.isManualStop) {
                    this.outputChannel.appendLine(`❌ 服务异常退出，退出码: ${code}`);
                    this.outputChannel.appendLine('💡 建议检查完整的日志输出，特别是STDERR中的错误信息');
                }
                else if (this.isManualStop) {
                    this.outputChannel.appendLine('✅ 服务已正常停止');
                    this.isManualStop = false;
                }
                else {
                    this.outputChannel.appendLine('✅ 服务已正常退出');
                }
                this.process = null;
                this.setStatus(homeStatus_1.HomeStatus.STOPPED);
            });
            this.process.on('error', (err) => {
                console.error('进程启动失败:', err);
                this.outputChannel.appendLine(`❌ 启动服务时发生错误: ${err.message}`);
                this.setStatus(homeStatus_1.HomeStatus.ERROR);
                this.process = null;
            });
            this.process.on('close', (code, signal) => {
                console.log(`进程关闭，退出码: ${code}, 信号: ${signal}`);
                this.outputChannel.appendLine(`\nHOME服务进程已关闭，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);
                if (code !== 0 && code !== null && code !== 143 && !this.isManualStop) {
                    this.outputChannel.appendLine('⚠️ 服务异常退出，请检查日志文件或终端手动启动输出！');
                    if (code === 255) {
                        this.outputChannel.appendLine('💡 退出码255通常与以下问题有关:');
                        this.outputChannel.appendLine('   - Java Security Manager配置问题');
                        this.outputChannel.appendLine('   - JDK版本兼容性问题');
                        this.outputChannel.appendLine('   - 必要的系统属性未正确设置');
                    }
                }
                else if (code === 143 || this.isManualStop) {
                    this.outputChannel.appendLine('✅ 服务已正常停止（进程被终止信号关闭）');
                }
                this.process = null;
                this.setStatus(homeStatus_1.HomeStatus.STOPPED);
            });
            this.startupCheckTimer = setTimeout(() => {
                if (this.status === homeStatus_1.HomeStatus.STARTING) {
                    this.outputChannel.appendLine('⚠️ 服务启动可能需要更长时间，请耐心等待...');
                    this.startupCheckTimer = setTimeout(() => {
                        if (this.status === homeStatus_1.HomeStatus.STARTING) {
                            this.outputChannel.appendLine('⚠️ 服务启动可能需要更长时间，请耐心等待...');
                        }
                    }, 60000);
                }
            }, 60000);
        }
        catch (error) {
            this.outputChannel.appendLine(`❌ 启动过程中出现异常: ${error.message}`);
            this.outputChannel.appendLine(error.stack);
            this.setStatus(homeStatus_1.HomeStatus.ERROR);
            vscode.window.showErrorMessage(`启动NC HOME服务时出现异常: ${error.message}`);
        }
    }
    getCoreJarPath(homePath) {
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
    containsWJClasses(coreJarPath) {
        try {
            const filename = path.basename(coreJarPath);
            if (filename.toLowerCase().includes('wj')) {
                return true;
            }
            return coreJarPath.includes('wj') || coreJarPath.includes('WJ');
        }
        catch (error) {
            return false;
        }
    }
    buildClasspath(config, coreJarPath, workspaceFolder) {
        const classpathEntries = [coreJarPath];
        const wsRelatedDirs = [
            path.join(config.homePath, 'webapps', 'uapws'),
            path.join(config.homePath, 'webapps', 'uapws', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'webapps', 'webservice'),
            path.join(config.homePath, 'webapps', 'webservice', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'hotwebs', 'uapws', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'hotwebs', 'webservice', 'WEB-INF', 'classes')
        ];
        for (const wsDir of wsRelatedDirs) {
            if (fs.existsSync(wsDir)) {
                classpathEntries.push(wsDir);
                this.outputChannel.appendLine(`🚨 优先添加WS相关目录: ${wsDir}`);
            }
        }
        if (workspaceFolder) {
            const buildClasses = path.join(workspaceFolder, 'build', 'classes');
            if (fs.existsSync(buildClasses)) {
                classpathEntries.push(buildClasses);
                this.outputChannel.appendLine(`📁 添加YonBIP编译输出目录: ${buildClasses}`);
            }
        }
        const externalLibDir = path.join(config.homePath, 'external', 'lib');
        const externalClassesDir = path.join(config.homePath, 'external', 'classes');
        if (fs.existsSync(externalLibDir)) {
            classpathEntries.push(path.join(externalLibDir, '*'));
        }
        if (fs.existsSync(externalClassesDir)) {
            classpathEntries.push(externalClassesDir);
            this.outputChannel.appendLine(`📁 添加预处理后的external/classes目录`);
        }
        const libDirs = [
            path.join(config.homePath, 'middleware'),
            path.join(config.homePath, 'lib'),
            path.join(config.homePath, 'external', 'lib'),
            path.join(config.homePath, 'ierp', 'bin'),
            path.join(config.homePath, 'license'),
            path.join(config.homePath, 'modules'),
            path.join(config.homePath, 'langlib'),
            path.join(config.homePath, 'middleware', 'lib'),
            path.join(config.homePath, 'framework'),
        ];
        this.outputChannel.appendLine('开始构建类路径...');
        const moduleClassesPaths = ClasspathUtils_1.ClasspathUtils.getAllModuleClassesPaths(config.homePath, this.context);
        classpathEntries.push(...moduleClassesPaths);
        const moduleLibPaths = ClasspathUtils_1.ClasspathUtils.getAllModuleLibPaths(config.homePath, this.context);
        classpathEntries.push(...moduleLibPaths);
        for (const dir of libDirs) {
            if (fs.existsSync(dir)) {
                try {
                    const files = fs.readdirSync(dir);
                    const hasJars = files.some(file => file.endsWith('.jar'));
                    if (hasJars) {
                        classpathEntries.push(path.join(dir, '*'));
                    }
                }
                catch (err) {
                    this.outputChannel.appendLine(`⚠️ 读取目录失败: ${dir}, 错误: ${err}`);
                }
            }
            else {
                if (dir.includes('ierp') || dir.includes('hotweb')) {
                    this.outputChannel.appendLine(`目录不存在: ${dir}`);
                }
            }
        }
        this.checkAndAddWSJars(config.homePath, classpathEntries);
        const resourcesDir = path.join(config.homePath, 'resources');
        if (fs.existsSync(resourcesDir)) {
            classpathEntries.push(resourcesDir);
            this.outputChannel.appendLine(`📁 添加resources目录: ${resourcesDir}`);
            const confDir = path.join(resourcesDir, 'conf');
            if (fs.existsSync(confDir)) {
                classpathEntries.push(confDir);
                this.outputChannel.appendLine(`📁 特别添加resources/conf目录: ${confDir}`);
            }
        }
        else {
            this.outputChannel.appendLine(`⚠️ resources目录不存在: ${resourcesDir}`);
        }
        const uniqueClasspathEntries = [...new Set(classpathEntries)];
        this.outputChannel.appendLine(`类路径构建完成，共包含 ${uniqueClasspathEntries.length} 个条目`);
        const resourcesEntries = uniqueClasspathEntries.filter(entry => entry.includes('resources'));
        if (resourcesEntries.length > 0) {
            this.outputChannel.appendLine(`✅ 类路径中包含resources相关目录 ${resourcesEntries.length} 个:`);
            resourcesEntries.forEach(entry => {
                this.outputChannel.appendLine(`   - ${entry}`);
            });
        }
        else {
            this.outputChannel.appendLine(`❌ 警告: 类路径中未找到resources目录！`);
        }
        const validatedClasspathEntries = uniqueClasspathEntries.filter(entry => {
            try {
                if (fs.existsSync(entry) || entry.endsWith('*')) {
                    return true;
                }
                if (entry.includes("!/")) {
                    this.outputChannel.appendLine(`⚠️ 跳过无效类路径条目(可能是jar中资源): ${entry}`);
                    return false;
                }
                return true;
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️ 检查类路径条目时出错: ${entry}, 错误: ${error}`);
                return false;
            }
        });
        return validatedClasspathEntries.join(path.delimiter);
    }
    checkAndAddWSJars(homePath, classpathEntries) {
        const wsJarKeywords = ['ws', 'webservice', 'uapws', 'web-service'];
        const wsJarPaths = [];
        const graniteJarKeywords = ['granite', 'flex', 'blazeds', 'amf'];
        const graniteJarPaths = [];
        const middlewareLibDir = path.join(homePath, 'middleware', 'lib');
        if (fs.existsSync(middlewareLibDir)) {
            this.searchAndAddWSJars(middlewareLibDir, wsJarKeywords, wsJarPaths);
        }
        const libDir = path.join(homePath, 'lib');
        if (fs.existsSync(libDir)) {
            this.searchAndAddWSJars(libDir, wsJarKeywords, wsJarPaths);
        }
        const externalLibDir = path.join(homePath, 'external', 'lib');
        if (fs.existsSync(externalLibDir)) {
            this.searchAndAddWSJars(externalLibDir, wsJarKeywords, wsJarPaths);
        }
        const uapwsLibDir = path.join(homePath, 'webapps', 'uapws', 'WEB-INF', 'lib');
        if (fs.existsSync(uapwsLibDir)) {
            this.searchAndAddWSJars(uapwsLibDir, wsJarKeywords, wsJarPaths);
        }
        const webserviceLibDir = path.join(homePath, 'webapps', 'webservice', 'WEB-INF', 'lib');
        if (fs.existsSync(webserviceLibDir)) {
            this.searchAndAddWSJars(webserviceLibDir, wsJarKeywords, wsJarPaths);
            this.searchAndAddWSJars(webserviceLibDir, graniteJarKeywords, graniteJarPaths);
        }
        const graniteLibDir = path.join(homePath, 'middleware', 'granite', 'lib');
        if (fs.existsSync(graniteLibDir)) {
            this.searchAndAddWSJars(graniteLibDir, graniteJarKeywords, graniteJarPaths);
        }
        const flexLibDir = path.join(homePath, 'middleware', 'flex', 'lib');
        if (fs.existsSync(flexLibDir)) {
            this.searchAndAddWSJars(flexLibDir, graniteJarKeywords, graniteJarPaths);
        }
        for (const wsJarPath of wsJarPaths) {
            if (!classpathEntries.includes(wsJarPath)) {
                classpathEntries.push(wsJarPath);
            }
        }
        for (const graniteJarPath of graniteJarPaths) {
            if (!classpathEntries.includes(graniteJarPath)) {
                classpathEntries.push(graniteJarPath);
            }
        }
    }
    searchAndAddWSJars(dir, keywords, jarPaths) {
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
        }
        catch (error) {
            this.outputChannel.appendLine(`⚠️ 读取目录失败: ${dir}, 错误: ${error.message}`);
        }
    }
    buildEnvironment(config) {
        const env = { ...process.env };
        env.FIELD_NC_HOME = config.homePath;
        env.FIELD_HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        env.FIELD_EX_MODULES = config.exModules || '';
        env.IDEA_FIELD_NC_HOME = config.homePath;
        env.IDEA_FIELD_HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        env.IDEA_FIELD_EX_MODULES = config.exModules || '';
        const propDir = path.join(config.homePath, 'ierp', 'bin');
        env.NC_PROP_DIR = propDir;
        env.PROP_DIR = propDir;
        this.outputChannel.appendLine(`设置环境变量: FIELD_NC_HOME=${env.FIELD_NC_HOME}`);
        this.outputChannel.appendLine(`设置环境变量: FIELD_HOTWEBS=${env.FIELD_HOTWEBS}`);
        this.outputChannel.appendLine(`设置环境变量: NC_PROP_DIR=${env.NC_PROP_DIR}`);
        return env;
    }
    async buildVMParameters(config, serverPort, wsPort) {
        const defaultVmParameters = [];
        defaultVmParameters.push('-Dnc.exclude.modules=' + (config.exModules || ''));
        defaultVmParameters.push('-Dnc.runMode=develop');
        defaultVmParameters.push('-Dnc.server.location=' + path.resolve(config.homePath));
        defaultVmParameters.push('-DEJBConfigDir=' + path.resolve(config.homePath, 'ejbXMLs'));
        defaultVmParameters.push('-Dorg.owasp.esapi.resources=' + path.resolve(config.homePath, 'ierp', 'bin', 'esapi'));
        defaultVmParameters.push('-DExtServiceConfigDir=' + path.resolve(config.homePath, 'ejbXMLs'));
        defaultVmParameters.push('-Duap.hotwebs=' + (config.hotwebs || 'nccloud,fs,yonbip'));
        defaultVmParameters.push('-Duap.disable.codescan=false');
        defaultVmParameters.push('-Xmx1024m');
        defaultVmParameters.push('-Dfile.encoding=UTF-8');
        defaultVmParameters.push('-Duser.timezone=GMT+8');
        defaultVmParameters.push('-Dnc.log.console=true');
        defaultVmParameters.push('-Dnc.debug=true');
        defaultVmParameters.push('-Dnc.log.level=DEBUG');
        defaultVmParameters.push('-Dnc.startup.trace=true');
        const propDir = path.resolve(config.homePath, 'ierp', 'bin');
        defaultVmParameters.push('-Dnc.prop.dir=' + propDir);
        defaultVmParameters.push('-Dprop.dir=' + propDir);
        if (config.selectedDataSource) {
            defaultVmParameters.push('-Dnc.datasource.default=' + config.selectedDataSource);
        }
        defaultVmParameters.push('-Xms256m');
        let javaVersion = 0;
        try {
            javaVersion = await JavaVersionUtils_1.JavaVersionUtils.getJavaVersion(this.outputChannel);
        }
        catch (error) {
            this.outputChannel.appendLine(`警告: 无法检测Java版本，将假设使用Java 8+: ${error.message}`);
        }
        if (javaVersion < 8 && javaVersion !== 0) {
            defaultVmParameters.push('-XX:MaxPermSize=512m');
            this.outputChannel.appendLine('添加MaxPermSize参数');
        }
        else {
            defaultVmParameters.push('-XX:MetaspaceSize=512m');
            this.outputChannel.appendLine('Java版本 >= 8，添加MetaspaceSize参数');
        }
        defaultVmParameters.push('-XX:+HeapDumpOnOutOfMemoryError');
        defaultVmParameters.push('-XX:HeapDumpPath=' + path.join(config.homePath, 'logs', 'nc_heapdump.hprof'));
        defaultVmParameters.push('-Dnc.server.home=' + path.resolve(config.homePath));
        defaultVmParameters.push('-Dnc.home=' + path.resolve(config.homePath));
        defaultVmParameters.push('-Dnc.idesupport=true');
        defaultVmParameters.push('-Dnc.scan=true');
        defaultVmParameters.push('-Dnc.server.port=' + serverPort);
        defaultVmParameters.push('-Dws.server=true');
        defaultVmParameters.push('-Dws.port=' + (wsPort || 8080));
        defaultVmParameters.push('-Dconsole.encoding=UTF-8');
        defaultVmParameters.push('-Dsun.jnu.encoding=UTF-8');
        defaultVmParameters.push('-Dclient.encoding.override=UTF-8');
        defaultVmParameters.push('-Djavax.xml.parsers.DocumentBuilderFactory=com.sun.org.apache.xerces.internal.jaxp.DocumentBuilderFactoryImpl');
        defaultVmParameters.push('-Djavax.xml.parsers.SAXParserFactory=com.sun.org.apache.xerces.internal.jaxp.SAXParserFactoryImpl');
        defaultVmParameters.push('-Djavax.xml.transform.TransformerFactory=com.sun.org.apache.xalan.internal.xsltc.trax.TransformerFactoryImpl');
        if (javaVersion >= 17) {
            defaultVmParameters.push('--add-opens=java.base/java.lang=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.lang.reflect=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/jdk.internal.reflect=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.lang.invoke=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.io=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.nio.charset=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.net=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.util.concurrent=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.util=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.xml/javax.xml=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.xml/javax.xml.stream=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.rmi/sun.rmi.transport=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.naming/javax.naming=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.management/javax.management=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.comp=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.model=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.processing=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.jvm=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/java.awt.image=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/sun.awt=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.security=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.lang.ref=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/javax.swing=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/javax.accessibility=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/java.beans=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/java.awt=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/sun.swing=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/java.awt.color=ALL-UNNAMED');
        }
        if (process.platform === 'darwin') {
            defaultVmParameters.push('-Dapple.awt.UIElement=true');
        }
        if (config.debugMode) {
            const debugPort = config.debugPort || 8888;
            defaultVmParameters.push(`-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${debugPort}`);
        }
        if (config.projectDir) {
            defaultVmParameters.push('-Dproject.dir=' + config.projectDir);
        }
        let userVmParameters = [];
        if (config.vmParameters && config.vmParameters.length > 0) {
            userVmParameters = config.vmParameters.split('\n').map((param) => param.trim()).filter((param) => param.length > 0);
        }
        const getUserParamKey = (param) => {
            let cleanParam = param;
            while (cleanParam.startsWith('-')) {
                cleanParam = cleanParam.substring(1);
            }
            if (cleanParam.startsWith('Xmx')) {
                return 'Xmx';
            }
            if (cleanParam.startsWith('Xms')) {
                return 'Xms';
            }
            if (cleanParam.startsWith('XX:')) {
                const parts = cleanParam.split(':');
                if (parts.length > 1) {
                    return 'XX:' + parts[1].split('=')[0];
                }
            }
            if (cleanParam.includes('=')) {
                return cleanParam.split('=')[0];
            }
            return cleanParam;
        };
        const userParamMap = new Map();
        for (const param of userVmParameters) {
            const key = getUserParamKey(param);
            userParamMap.set(key, param);
        }
        const filteredDefaultParams = [];
        for (const param of defaultVmParameters) {
            const key = getUserParamKey(param);
            if (!userParamMap.has(key)) {
                filteredDefaultParams.push(param);
            }
        }
        const vmParameters = [...filteredDefaultParams, ...userVmParameters];
        return vmParameters;
    }
    getJavaExecutable(config) {
        if (config.javaHome) {
            const javaPath = path.join(config.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
            if (fs.existsSync(javaPath)) {
                this.outputChannel.appendLine(`✅ 使用配置的Java路径: ${javaPath}`);
                return javaPath;
            }
        }
        try {
            const javaConfig = vscode.workspace.getConfiguration('java.configuration');
            const runtimes = javaConfig.get('runtimes', []);
            const defaultRuntime = runtimes.find(runtime => runtime.default === true);
            if (defaultRuntime && defaultRuntime.path) {
                const javaPath = path.join(defaultRuntime.path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                if (fs.existsSync(javaPath)) {
                    this.outputChannel.appendLine(`✅ 使用VS Code配置的默认Java运行时: ${javaPath}`);
                    return javaPath;
                }
            }
            if (runtimes.length > 0 && runtimes[0].path) {
                const javaPath = path.join(runtimes[0].path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                if (fs.existsSync(javaPath)) {
                    this.outputChannel.appendLine(`✅ 使用VS Code配置的第一个Java运行时: ${javaPath}`);
                    return javaPath;
                }
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`⚠️ 读取VS Code Java配置时出错: ${error}`);
        }
        const ufjdkPath = path.join(config.homePath, 'ufjdk');
        const ufjdkBinPath = path.join(ufjdkPath, 'bin');
        const javaExeName = process.platform === 'win32' ? 'java.exe' : 'java';
        const javaBinPath = path.join(ufjdkBinPath, javaExeName);
        if (fs.existsSync(javaBinPath)) {
            try {
                if (process.platform !== 'win32') {
                    fs.accessSync(javaBinPath, fs.constants.X_OK);
                }
                const versionResult = (0, child_process_1.spawnSync)(javaBinPath, ['-version'], {
                    encoding: 'utf8',
                    timeout: 5000
                });
                if (versionResult.status === 0) {
                    this.outputChannel.appendLine(`✅ 使用NC内置JDK: ${javaBinPath}`);
                    return javaBinPath;
                }
                else {
                    this.outputChannel.appendLine(`⚠️  NC内置JDK验证失败，使用系统Java`);
                }
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️  NC内置JDK不可用: ${error}`);
            }
        }
        else {
            this.outputChannel.appendLine(`⚠️  未找到NC内置JDK: ${javaBinPath}`);
        }
        const wrongPlatformJava = path.join(ufjdkBinPath, process.platform === 'win32' ? 'java' : 'java.exe');
        if (fs.existsSync(wrongPlatformJava)) {
            this.outputChannel.appendLine(`⚠️  检测到不匹配的JDK平台，使用系统Java`);
        }
        try {
            const systemJavaResult = (0, child_process_1.spawnSync)('java', ['-version'], {
                encoding: 'utf8',
                timeout: 5000
            });
            if (systemJavaResult.status === 0) {
                this.outputChannel.appendLine(`✅ 使用系统Java: java`);
                return 'java';
            }
        }
        catch (error) {
        }
        const commonJavaPaths = [
            '/usr/bin/java',
            '/usr/local/bin/java',
            '/opt/homebrew/bin/java'
        ];
        for (const javaPath of commonJavaPaths) {
            if (fs.existsSync(javaPath)) {
                try {
                    const result = (0, child_process_1.spawnSync)(javaPath, ['-version'], {
                        encoding: 'utf8',
                        timeout: 5000
                    });
                    if (result.status === 0) {
                        this.outputChannel.appendLine(`✅ 使用系统Java: ${javaPath}`);
                        return javaPath;
                    }
                }
                catch (error) {
                    continue;
                }
            }
        }
        this.outputChannel.appendLine(`❌ 未找到可用的Java可执行文件，使用默认java命令`);
        return 'java';
    }
    async stopHomeService() {
        this.outputChannel.show();
        this.outputChannel.clear();
        this.outputChannel.appendLine('正在停止NC HOME服务...');
        if (this.status === homeStatus_1.HomeStatus.STOPPED || this.status === homeStatus_1.HomeStatus.STOPPING) {
            vscode.window.showWarningMessage('NC HOME服务未在运行');
            this.outputChannel.appendLine('⚠️ NC HOME服务未在运行');
            return;
        }
        try {
            this.setStatus(homeStatus_1.HomeStatus.STOPPING);
            this.isManualStop = true;
            const config = this.configService.getConfig();
            let stopScriptPath = '';
            if (process.platform === 'win32') {
                stopScriptPath = path.join(config.homePath, 'bin', 'stop.bat');
            }
            else {
                stopScriptPath = path.join(config.homePath, 'bin', 'stop.sh');
            }
            if (fs.existsSync(stopScriptPath)) {
                this.outputChannel.appendLine(`🔍 找到停止脚本: ${stopScriptPath}`);
                if (process.platform !== 'win32') {
                    try {
                        fs.chmodSync(stopScriptPath, 0o755);
                        this.outputChannel.appendLine(`已为脚本添加执行权限: ${stopScriptPath}`);
                    }
                    catch (chmodError) {
                        this.outputChannel.appendLine(`添加执行权限失败: ${chmodError.message}`);
                    }
                }
                this.outputChannel.appendLine(`正在执行停止脚本: ${stopScriptPath}`);
                const stopProcess = (0, child_process_1.spawn)(stopScriptPath, {
                    cwd: path.dirname(stopScriptPath),
                    stdio: ['pipe', 'pipe', 'pipe'],
                    detached: false
                });
                stopProcess.on('close', (code) => {
                    this.outputChannel.appendLine(`停止脚本执行完成，退出码: ${code}`);
                    if (code === 0) {
                        this.setStatus(homeStatus_1.HomeStatus.STOPPED);
                        this.isManualStop = false;
                        this.outputChannel.appendLine('✅ HOME服务已成功停止');
                    }
                    else if (code === 127) {
                        this.outputChannel.appendLine('⚠️ 停止脚本执行失败(退出码127)，直接终止进程');
                        this.killProcess();
                    }
                    else if (code === 143) {
                        this.setStatus(homeStatus_1.HomeStatus.STOPPED);
                        this.isManualStop = false;
                        this.outputChannel.appendLine('✅ HOME服务已成功停止');
                    }
                    else {
                        this.outputChannel.appendLine(`⚠️ 停止脚本执行完成，但退出码为: ${code}`);
                        this.killProcess();
                    }
                });
                stopProcess.on('error', (error) => {
                    this.outputChannel.appendLine(`执行停止脚本失败: ${error.message}`);
                    this.outputChannel.appendLine(`错误代码: ${error.code}`);
                    this.outputChannel.appendLine(`错误路径: ${error.path}`);
                    this.killProcess();
                });
            }
            else {
                this.outputChannel.appendLine(`停止脚本不存在: ${stopScriptPath}，直接终止进程`);
                this.killProcess();
            }
            setTimeout(() => {
                if (this.status === homeStatus_1.HomeStatus.STOPPING) {
                    this.outputChannel.appendLine('停止服务超时，强制终止进程');
                    this.killProcess();
                }
            }, 15000);
        }
        catch (error) {
            this.outputChannel.appendLine(`停止NC HOME服务失败: ${error.message}`);
            this.setStatus(homeStatus_1.HomeStatus.ERROR);
            this.isManualStop = false;
            vscode.window.showErrorMessage(`停止NC HOME服务失败: ${error.message}`);
        }
    }
    killProcess() {
        if (this.process && !this.process.killed) {
            try {
                this.outputChannel.appendLine('正在强制终止HOME服务进程...');
                this.process.kill('SIGTERM');
                setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        this.process.kill('SIGKILL');
                        this.outputChannel.appendLine('已发送强制终止信号');
                    }
                }, 2000);
            }
            catch (error) {
                this.outputChannel.appendLine(`终止进程失败: ${error.message}`);
            }
        }
        else {
            this.outputChannel.appendLine('没有正在运行的HOME服务进程');
        }
        this.setStatus(homeStatus_1.HomeStatus.STOPPED);
        this.outputChannel.appendLine('✅ HOME服务已停止');
    }
    getStatus() {
        return this.status;
    }
    setStatus(status) {
        this.status = status;
    }
    showLogs() {
        this.outputChannel.show();
    }
    async restartHomeService() {
        this.outputChannel.appendLine('正在重启NC HOME服务...');
        await this.stopHomeService();
        await new Promise(resolve => setTimeout(resolve, 2000));
        await this.startHomeService();
    }
    isRunning() {
        return this.status === homeStatus_1.HomeStatus.RUNNING;
    }
    getProcessId() {
        return this.process?.pid || null;
    }
    dispose() {
        if (this.startupCheckTimer) {
            clearTimeout(this.startupCheckTimer);
            this.startupCheckTimer = null;
        }
        if (this.process && !this.process.killed) {
            this.process.kill();
        }
        try {
            const tempDir = path.join(this.context.extensionPath, 'temp');
            if (fs.existsSync(tempDir)) {
                const files = fs.readdirSync(tempDir);
                for (const file of files) {
                    if (file.endsWith('.txt')) {
                        const filePath = path.join(tempDir, file);
                        fs.unlinkSync(filePath);
                    }
                }
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`⚠️ 清理临时文件时出错: ${error.message}`);
        }
        if (HomeService.outputChannelInstance) {
            HomeService.outputChannelInstance.dispose();
            HomeService.outputChannelInstance = null;
        }
    }
    async ensureDesignDataSource(config) {
        const binDir = path.join(config.homePath, 'ierp', 'bin');
        const dataSourceIniPath = path.join(binDir, 'datasource.ini');
        const dataSourcePropertiesPath = path.join(binDir, 'datasource.properties');
        const propXmlPath = path.join(binDir, 'prop.xml');
        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
        }
        if (fs.existsSync(dataSourceIniPath) || fs.existsSync(dataSourcePropertiesPath)) {
            this.outputChannel.appendLine('✅ 数据源配置已存在');
        }
        else {
            if (config.dataSources && config.dataSources.length > 0) {
                let designDataSource = config.dataSources.find((ds) => ds.name === config.selectedDataSource);
                if (!designDataSource && config.dataSources.length > 0) {
                    designDataSource = config.dataSources[0];
                    this.outputChannel.appendLine(`⚠️ 未找到明确指定的design数据源，使用第一个数据源: ${designDataSource.name}`);
                }
                if (designDataSource) {
                    this.outputChannel.appendLine(`🔧 创建design数据源配置: ${designDataSource.name}`);
                    const dataSourceContent = this.buildDataSourceConfig(designDataSource);
                    fs.writeFileSync(dataSourceIniPath, dataSourceContent, 'utf-8');
                    this.outputChannel.appendLine(`✅ 已创建数据源配置文件: ${dataSourceIniPath}`);
                }
            }
            else {
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
        if (!fs.existsSync(propXmlPath)) {
            this.createBasicPropXml(config, null, propXmlPath);
        }
    }
    createBasicPropXml(config, dataSource, propXmlPath) {
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
    buildDataSourceConfig(dataSource) {
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
    getDriverClassName(databaseType) {
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
    async checkAndKillPortProcesses(serverPort, wsPort, debugPort) {
        return new Promise((resolve) => {
            this.outputChannel.appendLine(`🔍 检查HOME服务端口 ${serverPort} 和 WAS端口 ${wsPort} 和调试端口 ${debugPort} 是否被占用...`);
            let command;
            let args;
            if (process.platform === 'win32') {
                command = 'netstat';
                args = ['-a', '-n', '-o'];
            }
            else {
                command = 'lsof';
                args = ['-i', `:${serverPort}`, '-t'];
            }
            const processList = (0, child_process_1.spawn)(command, args);
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
                const processesToKill = [];
                if (process.platform === 'win32') {
                    const lines = output.split('\n');
                    for (const line of lines) {
                        const serverPortRegex = new RegExp(`TCP\\s+[^:]+:${serverPort}\\s+[^:]+:\\d+\\s+LISTENING\\s+(\\d+)`);
                        const wsPortRegex = new RegExp(`TCP\\s+[^:]+:${wsPort}\\s+[^:]+:\\d+\\s+LISTENING\\s+(\\d+)`);
                        const debugPortRegex = new RegExp(`TCP\\s+[^:]+:${debugPort}\\s+[^:]+:\\d+\\s+LISTENING\\s+(\\d+)`);
                        const serverMatch = line.match(serverPortRegex);
                        const wsMatch = line.match(wsPortRegex);
                        const debugMatch = line.match(debugPortRegex);
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
                        if (debugMatch) {
                            const pid = parseInt(debugMatch[1]);
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${debugPort} 被进程 ${pid} 占用`);
                            }
                        }
                    }
                }
                else {
                    const lines = output.split('\n').filter(line => line.trim() !== '');
                    if (lines.length > 0) {
                        for (const line of lines) {
                            const pid = parseInt(line.trim());
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${serverPort} 被进程 ${pid} 占用`);
                            }
                        }
                    }
                    try {
                        const wsProcessList = (0, child_process_1.spawn)('lsof', ['-i', `:${wsPort}`, '-t']);
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
                    }
                    catch (error) {
                        this.outputChannel.appendLine(`⚠️ 检查ws端口时出现错误: ${error}`);
                    }
                    try {
                        const debugProcessList = (0, child_process_1.spawn)('lsof', ['-i', `:${debugPort}`, '-t']);
                        let debugOutput = '';
                        debugProcessList.stdout?.on('data', (data) => {
                            debugOutput += data.toString();
                        });
                        debugProcessList.on('close', (debugCode) => {
                            if (debugCode === 0) {
                                const debugLines = debugOutput.split('\n').filter(line => line.trim() !== '');
                                for (const line of debugLines) {
                                    const pid = parseInt(line.trim());
                                    if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                        processesToKill.push(pid);
                                        this.outputChannel.appendLine(`🔍 发现端口 ${debugPort} 被进程 ${pid} 占用`);
                                    }
                                }
                            }
                        });
                    }
                    catch (error) {
                        this.outputChannel.appendLine(`⚠️ 检查调试端口时出现错误: ${error}`);
                    }
                }
                if (processesToKill.length > 0) {
                    this.outputChannel.appendLine(`🚫 发现 ${processesToKill.length} 个进程占用端口，准备终止...`);
                    for (const pid of processesToKill) {
                        try {
                            this.outputChannel.appendLine(`⏳ 正在终止进程 ${pid}...`);
                            process.kill(pid, 'SIGTERM');
                            await new Promise(r => setTimeout(r, 1000));
                            try {
                                process.kill(pid, 0);
                                this.outputChannel.appendLine(`⚠️ 进程 ${pid} 未正常退出，强制终止...`);
                                process.kill(pid, 'SIGKILL');
                            }
                            catch (error) {
                                this.outputChannel.appendLine(`✅ 进程 ${pid} 已终止`);
                            }
                        }
                        catch (error) {
                            if (error.code === 'ESRCH') {
                                this.outputChannel.appendLine(`✅ 进程 ${pid} 已经退出`);
                            }
                            else {
                                this.outputChannel.appendLine(`❌ 终止进程 ${pid} 失败: ${error.message}`);
                                vscode.window.showErrorMessage(`终止进程 ${pid} 失败: ${error.message}`);
                            }
                        }
                    }
                    this.outputChannel.appendLine('⏳ 等待端口释放...');
                    await new Promise(r => setTimeout(r, 2000));
                }
                else {
                    this.outputChannel.appendLine('✅ 未发现端口冲突');
                }
                resolve();
            });
        });
    }
    async applyConsoleEncodingPatch(homePath) {
        return new Promise((resolve) => {
            this.outputChannel.appendLine('🔧 应用控制台编码补丁...');
            try {
                const jdkVersion = this.getJDKVersion(homePath);
                this.outputChannel.appendLine(`🔍 检测到JDK版本: ${jdkVersion}`);
                if (jdkVersion >= 50) {
                    this.outputChannel.appendLine('🔧 JDK版本 >= 50，应用DirectJDKLog补丁...');
                    const targetFile = path.join(homePath, 'middleware', 'classes', 'org', 'apache', 'juli', 'logging', 'DirectJDKLog.class');
                    if (!fs.existsSync(targetFile)) {
                        const targetDir = path.dirname(targetFile);
                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }
                        const patchFile = path.join(this.context.extensionPath, 'resources', 'replacement', 'DirectJDKLog.class');
                        if (fs.existsSync(patchFile)) {
                            fs.copyFileSync(patchFile, targetFile);
                            this.outputChannel.appendLine(`✅ DirectJDKLog补丁已应用: ${targetFile}`);
                        }
                        else {
                            this.outputChannel.appendLine(`⚠️ 未找到DirectJDKLog补丁文件: ${patchFile}`);
                        }
                    }
                    else {
                        this.outputChannel.appendLine('✅ DirectJDKLog补丁已存在，无需重复应用');
                    }
                }
                else {
                    this.outputChannel.appendLine('✅ JDK版本 < 50，无需应用DirectJDKLog补丁');
                }
                this.outputChannel.appendLine('✅ 控制台编码补丁应用完成');
                resolve();
            }
            catch (error) {
                this.outputChannel.appendLine(`⚠️ 应用控制台编码补丁时出现错误: ${error.message}`);
                resolve();
            }
        });
    }
    getJDKVersion(homePath) {
        try {
            let javaExecutable = 'java';
            const ufjdkPath = path.join(homePath, 'ufjdk');
            const ufjdkBinPath = path.join(ufjdkPath, 'bin');
            if (process.platform === 'win32') {
                const javaExe = path.join(ufjdkBinPath, 'java.exe');
                if (fs.existsSync(javaExe)) {
                    javaExecutable = javaExe;
                }
            }
            else {
                const javaBin = path.join(ufjdkBinPath, 'java');
                if (fs.existsSync(javaBin)) {
                    javaExecutable = javaBin;
                }
            }
            const result = (0, child_process_1.spawnSync)(javaExecutable, ['-version'], {
                encoding: 'utf8',
                timeout: 10000
            });
            if (result.status === 0) {
                const versionOutput = result.stderr || result.stdout;
                const versionMatch = versionOutput.match(/version\s+["']([^"']+)["']/i);
                if (versionMatch && versionMatch[1]) {
                    const versionStr = versionMatch[1];
                    let version;
                    if (versionStr.startsWith('1.')) {
                        version = parseInt(versionStr.split('.')[1]);
                    }
                    else {
                        version = parseInt(versionStr.split('.')[0]);
                    }
                    return version * 10;
                }
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`⚠️ 获取JDK版本时出错: ${error}`);
        }
        return 0;
    }
}
exports.HomeService = HomeService;
//# sourceMappingURL=HomeService.js.map