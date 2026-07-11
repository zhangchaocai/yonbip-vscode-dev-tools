import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';
import { HomeService } from '../nc-home/HomeService';
import { ClasspathUtils } from '../../utils/ClasspathUtils';
import { HomeStatus } from '../nc-home/homeStatus';

/**
 * 热部署模式
 *
 * - jdi : 通过 JPDA SocketAttach 连接到目标 JVM，调用 VirtualMachine.redefineClasses()
 *         优点：无需重启服务、无需搬运 class 文件，方法体内修改立即生效。
 *         局限：标准 JDK 仅支持方法体内的修改；如需新增/删除字段或方法需 DCEVM。
 * - ncHotDeploy : 将编译后的 class 拷贝到 NC HOME 的 external/classes 或 modules/<m>/classes，
 *                配合 NC 自带的 hotwebs 刷新机制生效（适用于非调试模式启动的服务）。
 * - auto : 优先 jdi，失败时自动回退到 ncHotDeploy
 */
export type HotDeployMode = 'jdi' | 'ncHotDeploy' | 'auto';

export type HotDeployStatus = 'idle' | 'watching' | 'compiling' | 'deploying' | 'error' | 'disabled';

export interface HotDeployResult {
    success: boolean;
    mode: HotDeployMode;
    message: string;
    changedFiles: string[];
    durationMs: number;
}

/**
 * YonBIP NC 热部署服务
 *
 * 监听工作区内 .java 文件保存事件，自动编译后通过 JPDA / JDI 把 class 推送到
 * 正在运行的 YonBIP HOME 服务中，实现"改代码立即生效"。
 *
 * 用法：
 *   1) 先用"调试启动HOME服务"启动服务（必须带 -agentlib:jdwp）
 *   2) 调用 yonbip.hotDeploy.start 开启监听（或设置 yonbip.hotDeploy.enabled=true）
 *   3) 修改 .java 保存 -> 自动编译 -> 自动热部署
 *   4) 状态栏左侧图标实时显示当前状态
 */
export class HotDeployService {
    private context: vscode.ExtensionContext;
    private configService: NCHomeConfigService;
    private homeService: HomeService;

    private outputChannel: vscode.OutputChannel;
    private statusBarItem: vscode.StatusBarItem;

    private watcher: vscode.FileSystemWatcher | null = null;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private javaHome: string | null = null;
    private cachedClasspath: { entries: string[]; signature: string } | null = null;

    private _status: HotDeployStatus = 'idle';
    private _lastError: string | null = null;
    private _lastDeployAt: number | null = null;
    private _lastDeployFiles: string[] = [];

    // 配置键
    public static readonly CONFIG_ENABLED = 'yonbip.hotDeploy.enabled';
    public static readonly CONFIG_MODE = 'yonbip.hotDeploy.mode';
    public static readonly CONFIG_DEBOUNCE_MS = 'yonbip.hotDeploy.debounceMs';
    public static readonly CONFIG_AUTO_COMPILE = 'yonbip.hotDeploy.autoCompile';

    constructor(context: vscode.ExtensionContext, configService: NCHomeConfigService, homeService: HomeService) {
        this.context = context;
        this.configService = configService;
        this.homeService = homeService;
        this.outputChannel = vscode.window.createOutputChannel('YonBIP 热部署');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.statusBarItem.command = 'yonbip.hotDeploy.status';
        this.updateStatusBar();

        // 监听配置变化
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(HotDeployService.CONFIG_ENABLED) ||
                    e.affectsConfiguration(HotDeployService.CONFIG_MODE)) {
                    this.applyConfig();
                }
            })
        );
    }

    // ------------------------------------------------------------------
    // 公开 API
    // ------------------------------------------------------------------

    /**
     * 开启热部署监听。重复调用安全。
     */
    public async start(): Promise<void> {
        if (this.watcher) {
            this.log('热部署已在运行中，无需重复开启');
            return;
        }

        const home = this.getHomeStatus();
        if (home !== 'running') {
            throw new Error(`HOME 服务未运行（当前状态: ${home}），请先用"调试启动 HOME 服务"启动服务`);
        }

        // 创建 .java 监听器
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*.java');
        this.watcher.onDidChange((uri) => this.scheduleDeploy(uri, 'change'));
        this.watcher.onDidCreate((uri) => this.scheduleDeploy(uri, 'create'));
        this.watcher.onDidDelete((uri) => this.onJavaDeleted(uri));
        this.context.subscriptions.push(this.watcher);

        this.setStatus('watching');
        this.log('热部署已开启，监听工作区 .java 文件变更');
        this.log(`   模式: ${this.getMode()}`);
        this.log(`   调试端口: ${this.getDebugPort()}`);
        this.log(`   防抖: ${this.getDebounceMs()}ms`);
    }

    /**
     * 关闭热部署监听。
     */
    public async stop(): Promise<void> {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
        }
        for (const t of this.debounceTimers.values()) {
            clearTimeout(t);
        }
        this.debounceTimers.clear();
        this.setStatus('idle');
        this.log('热部署已停止');
    }

    /**
     * 手动部署指定 Java 文件（或已编译好的 class 文件）。
     * 接收字符串数组，可以混合 .java 与 .class。
     */
    public async deploy(paths: string[]): Promise<HotDeployResult> {
        const start = Date.now();
        if (paths.length === 0) {
            return { success: false, mode: this.getMode(), message: '没有可部署的文件', changedFiles: [], durationMs: 0 };
        }

        const javaFiles = paths.filter((p) => p.endsWith('.java'));
        const classFilesIn = paths.filter((p) => p.endsWith('.class'));

        let classFiles: string[] = [...classFilesIn];

        try {
            // 1) 编译 Java 文件
            if (javaFiles.length > 0) {
                this.setStatus('compiling');
                const compiled = await this.compileJavaFiles(javaFiles);
                classFiles.push(...compiled);
            }

            if (classFiles.length === 0) {
                throw new Error('编译未产出任何 class 文件');
            }

            // 2) 按模式部署
            this.setStatus('deploying');
            const mode = this.getMode();
            let result: { success: boolean; message: string; actualMode: HotDeployMode };

            try {
                if (mode === 'ncHotDeploy') {
                    result = await this.deployNcHotDeploy(classFiles);
                } else if (mode === 'jdi') {
                    result = await this.deployViaJdi(classFiles);
                } else {
                    // auto: 先 JDI，失败回退 NC
                    try {
                        result = await this.deployViaJdi(classFiles);
                    } catch (jdiErr: any) {
                        this.log(`JDI 热加载失败，回退到 NC 热部署模式: ${jdiErr.message}`);
                        result = await this.deployNcHotDeploy(classFiles);
                        result.actualMode = 'ncHotDeploy';
                    }
                }
            } catch (err: any) {
                this._lastError = err.message || String(err);
                this.setStatus('error');
                throw err;
            }

            this._lastDeployAt = Date.now();
            this._lastDeployFiles = classFiles;
            this.setStatus(this.watcher ? 'watching' : 'idle');
            return {
                success: result.success,
                mode: result.actualMode,
                message: result.message,
                changedFiles: classFiles,
                durationMs: Date.now() - start
            };
        } catch (err: any) {
            this._lastError = err.message || String(err);
            this.setStatus('error');
            return {
                success: false,
                mode: this.getMode(),
                message: err.message || String(err),
                changedFiles: classFiles,
                durationMs: Date.now() - start
            };
        }
    }

    /**
     * 部署当前编辑器打开的 Java 文件。
     */
    public async deployActiveEditor(): Promise<HotDeployResult | null> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('没有打开的编辑器');
            return null;
        }
        const filePath = editor.document.uri.fsPath;
        if (!filePath.endsWith('.java')) {
            vscode.window.showWarningMessage('当前文件不是 .java 文件');
            return null;
        }
        // 等待保存（如果脏）
        if (editor.document.isDirty) {
            await editor.document.save();
        }
        return this.deploy([filePath]);
    }

    /**
     * 部署当前 workspace 中 build/classes 下所有 class 文件。
     */
    public async deployAll(): Promise<HotDeployResult | null> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            vscode.window.showWarningMessage('未打开任何工作区');
            return null;
        }
        const classesDirs = folders
            .map((f) => path.join(f.uri.fsPath, 'build', 'classes'))
            .filter((p) => fs.existsSync(p));
        if (classesDirs.length === 0) {
            vscode.window.showWarningMessage('未找到 build/classes 目录，请先编译项目');
            return null;
        }
        const classes: string[] = [];
        for (const dir of classesDirs) {
            this.collectClasses(dir, classes);
        }
        if (classes.length === 0) {
            vscode.window.showWarningMessage('build/classes 为空，请先编译项目');
            return null;
        }
        this.log(`准备全量部署 ${classes.length} 个 class 文件...`);
        return this.deploy(classes);
    }

    public getStatus(): HotDeployStatus {
        return this._status;
    }

    public getLastError(): string | null {
        return this._lastError;
    }

    public isWatching(): boolean {
        return this.watcher !== null;
    }

    public showStatus(): void {
        const mode = this.getMode();
        const debounce = this.getDebounceMs();
        const statusLabel = this.statusLabel(this._status);
        const homeState = this.getHomeStatus();
        const lines: string[] = [];
        lines.push(`YonBIP 热部署状态: ${statusLabel}`);
        lines.push(`  HOME 服务: ${this.statusLabel(homeState)}`);
        lines.push(`  部署模式: ${mode}`);
        lines.push(`  监听中: ${this.watcher ? '是' : '否'}`);
        lines.push(`  防抖: ${debounce}ms`);
        if (this._lastDeployAt) {
            const ago = Math.round((Date.now() - this._lastDeployAt) / 1000);
            lines.push(`  上次部署: ${ago} 秒前（${this._lastDeployFiles.length} 个文件）`);
        }
        if (this._lastError) {
            lines.push(`  最近错误: ${this._lastError}`);
        }
        const msg = lines.join('\n');
        this.log(msg);
        vscode.window.showInformationMessage(`YonBIP 热部署：${statusLabel}（${mode}）`);
    }

    public dispose(): void {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = null;
        }
        for (const t of this.debounceTimers.values()) {
            clearTimeout(t);
        }
        this.debounceTimers.clear();
        this.statusBarItem.dispose();
    }

    // ------------------------------------------------------------------
    // 内部：模式与配置
    // ------------------------------------------------------------------

    private applyConfig(): void {
        const enabled = this.getConfigBoolean(HotDeployService.CONFIG_ENABLED, false);
        if (enabled && !this.watcher) {
            this.start().catch((e) => this.log(`自动启动热部署失败: ${e.message}`));
        } else if (!enabled && this.watcher) {
            this.stop().catch(() => undefined);
        }
    }

    private getMode(): HotDeployMode {
        const raw = vscode.workspace.getConfiguration().get<string>(HotDeployService.CONFIG_MODE, 'auto');
        if (raw === 'jdi' || raw === 'ncHotDeploy' || raw === 'auto') {
            return raw;
        }
        return 'auto';
    }

    private getDebounceMs(): number {
        return Math.max(0, this.getConfigNumber(HotDeployService.CONFIG_DEBOUNCE_MS, 300));
    }

    private getAutoCompile(): boolean {
        return this.getConfigBoolean(HotDeployService.CONFIG_AUTO_COMPILE, true);
    }

    private getDebugPort(): number {
        const config = this.configService.getConfig();
        return config.debugPort || 8888;
    }

    private getHomeStatus(): HomeStatus | string {
        try {
            return this.homeService.getStatus();
        } catch {
            return 'unknown';
        }
    }

    private getConfigBoolean(key: string, defaultValue: boolean): boolean {
        const v = vscode.workspace.getConfiguration().get<boolean>(key, defaultValue);
        return typeof v === 'boolean' ? v : defaultValue;
    }

    private getConfigNumber(key: string, defaultValue: number): number {
        const v = vscode.workspace.getConfiguration().get<number>(key, defaultValue);
        return typeof v === 'number' ? v : defaultValue;
    }

    // ------------------------------------------------------------------
    // 内部：文件监听
    // ------------------------------------------------------------------

    private scheduleDeploy(uri: vscode.Uri, kind: 'change' | 'create'): void {
        const fsPath = uri.fsPath;
        if (!this.shouldHandleFile(fsPath)) {
            return;
        }
        const existing = this.debounceTimers.get(fsPath);
        if (existing) {
            clearTimeout(existing);
        }
        const delay = this.getDebounceMs();
        const timer = setTimeout(async () => {
            this.debounceTimers.delete(fsPath);
            // 文件保存事件可能触发多次，最终触发时文件已存在；保险起见再次校验
            if (!fs.existsSync(fsPath)) {
                return;
            }
            this.log(`[${kind}] 检测到 Java 文件变更: ${path.relative(this.workspaceRoot(), fsPath)}`);
            try {
                const result = await this.deploy([fsPath]);
                if (result.success) {
                    vscode.window.setStatusBarMessage(`$(check) 热部署成功 (${result.changedFiles.length} 个类, ${result.durationMs}ms)`, 3000);
                } else {
                    vscode.window.setStatusBarMessage(`$(warning) 热部署失败: ${result.message}`, 5000);
                    vscode.window.showErrorMessage(`热部署失败: ${result.message}`);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`热部署异常: ${err.message}`);
            }
        }, delay);
        this.debounceTimers.set(fsPath, timer);
    }

    private onJavaDeleted(uri: vscode.Uri): void {
        // 仅记录日志，class 文件本身可能仍存在
        this.log(`检测到 Java 文件删除: ${uri.fsPath}`);
    }

    private shouldHandleFile(fsPath: string): boolean {
        // 排除常见的不需要热加载的目录
        const skipDirs = ['/node_modules/', '/.git/', '/target/', '/dist/', '/out/', '/.gradle/', '/.idea/'];
        for (const dir of skipDirs) {
            if (fsPath.includes(dir)) {
                return false;
            }
        }
        return fsPath.endsWith('.java');
    }

    // ------------------------------------------------------------------
    // 内部：编译
    // ------------------------------------------------------------------

    private async compileJavaFiles(javaFiles: string[]): Promise<string[]> {
        if (!this.getAutoCompile()) {
            this.log('自动编译已关闭，假设 class 已就绪');
            return this.resolveExpectedClassFiles(javaFiles);
        }

        const javaExe = await this.resolveJavac();
        const classpathEntries = await this.resolveCompileClasspath();
        // 把 classpath 写入文件，避免命令行超长
        const cpFile = await this.writeClasspathFile(classpathEntries);
        const args: string[] = [
            '--release', '8',
            '-encoding', 'UTF-8',
            '-nowarn',
            '-Xlint:-options',
            '-cp', `@${cpFile}`,
            '-d', await this.resolveOutputDir()
        ];
        args.push(...javaFiles);

        this.log(`执行 javac（${javaFiles.length} 个文件）...`);
        const result = await this.runProcess(javaExe, args, { cwd: this.workspaceRoot() });
        if (result.code !== 0) {
            // 编译失败，把 stderr 摘要抛出
            const errSummary = (result.stderr || result.stdout || '').split(/\r?\n/).slice(-30).join('\n');
            throw new Error(`javac 编译失败 (code=${result.code}):\n${errSummary}`);
        }
        this.log(`javac 编译成功`);
        return this.resolveExpectedClassFiles(javaFiles);
    }

    private async resolveExpectedClassFiles(javaFiles: string[]): Promise<string[]> {
        const outDir = await this.resolveOutputDir();
        const result: string[] = [];
        for (const javaFile of javaFiles) {
            const rel = path.relative(this.workspaceRoot(), javaFile).replace(/\\/g, '/');
            // src/main/java/com/x/Y.java  -> build/classes/com/x/Y.class
            // src/com/x/Y.java            -> build/classes/com/x/Y.class
            let pkgPath = rel;
            const candidates = [
                'src/main/java/',
                'src/test/java/',
                'src/'
            ];
            for (const c of candidates) {
                const idx = rel.indexOf(c);
                if (idx >= 0) {
                    pkgPath = rel.substring(idx + c.length);
                    break;
                }
            }
            const classRel = pkgPath.replace(/\.java$/, '.class');
            const classFile = path.join(outDir, classRel);
            if (fs.existsSync(classFile)) {
                result.push(classFile);
            } else {
                // 兜底：尝试在 workspace 内搜索同名 class
                const alt = await this.findClassFile(javaFile, outDir);
                if (alt) {
                    result.push(alt);
                } else {
                    this.log(`[警告] 未找到对应的 class 文件: ${classFile}`);
                }
            }
        }
        return result;
    }

    private async findClassFile(javaFile: string, outDir: string): Promise<string | null> {
        const base = path.basename(javaFile, '.java');
        // 在 outDir 下广度优先搜索
        const queue: string[] = [outDir];
        while (queue.length) {
            const dir = queue.shift() as string;
            let entries: fs.Dirent[] = [];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const e of entries) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) {
                    queue.push(p);
                } else if (e.name === base + '.class') {
                    return p;
                }
            }
        }
        return null;
    }

    private async resolveJavac(): Promise<string> {
        const home = await this.resolveJavaHome();
        const exe = process.platform === 'win32' ? 'javac.exe' : 'javac';
        const p = path.join(home, 'bin', exe);
        if (!fs.existsSync(p)) {
            throw new Error(`未找到 javac: ${p}，请在设置中配置 yonbip.mcp.homePath 或安装 JDK`);
        }
        return p;
    }

    private async resolveJavaHome(): Promise<string> {
        if (this.javaHome) {
            return this.javaHome;
        }
        // 优先级：HOME 服务使用的 Java -> VSCode java.configuration.runtimes -> JAVA_HOME
        const candidates: string[] = [];
        const config = this.configService.getConfig();
        if (config && (config as any).javaHome) {
            candidates.push((config as any).javaHome);
        }
        const envHome = process.env.JAVA_HOME;
        if (envHome) {
            candidates.push(envHome);
        }
        // 从 vscode java 扩展读取
        try {
            const javaConfig = vscode.workspace.getConfiguration('java');
            const runtimes = javaConfig.get<any[]>('configuration.runtimes', []);
            for (const r of runtimes) {
                if (r && r.path) {
                    candidates.push(r.path);
                }
            }
        } catch {
            // ignore
        }

        for (const c of candidates) {
            if (c && fs.existsSync(path.join(c, 'bin', 'javac' + (process.platform === 'win32' ? '.exe' : '')))) {
                this.javaHome = c;
                this.log(`使用 JDK: ${c}`);
                return c;
            }
        }
        throw new Error('无法定位 JDK，请设置 JAVA_HOME 环境变量或在 settings.json 配置 java.configuration.runtimes');
    }

    private async resolveCompileClasspath(): Promise<string[]> {
        const config = this.configService.getConfig();
        const signature = JSON.stringify({
            home: config.homePath,
            workspace: this.workspaceRoot()
        });
        if (this.cachedClasspath && this.cachedClasspath.signature === signature) {
            return this.cachedClasspath.entries;
        }

        const entries: string[] = [];

        // 工作区 build/classes 优先
        const buildClasses = path.join(this.workspaceRoot(), 'build', 'classes');
        if (fs.existsSync(buildClasses)) {
            entries.push(buildClasses);
        }

        // NC HOME 的 modules
        if (config.homePath && fs.existsSync(config.homePath)) {
            const modulesClasses = ClasspathUtils.getAllModuleClassesPaths(config.homePath, this.context);
            const modulesLibs = ClasspathUtils.getAllModuleLibPaths(config.homePath, this.context);
            entries.push(...modulesClasses);
            entries.push(...modulesLibs);
            // webapps classes
            const webappsClasses = [
                path.join(config.homePath, 'webapps', 'nccloud', 'WEB-INF', 'classes'),
                path.join(config.homePath, 'hotwebs', 'nccloud', 'WEB-INF', 'classes')
            ];
            for (const w of webappsClasses) {
                if (fs.existsSync(w)) {
                    entries.push(w);
                }
            }
            // external libs/classes
            const extLib = path.join(config.homePath, 'external', 'lib');
            if (fs.existsSync(extLib)) {
                entries.push(path.join(extLib, '*'));
            }
            const extClasses = path.join(config.homePath, 'external', 'classes');
            if (fs.existsSync(extClasses)) {
                entries.push(extClasses);
            }
        }

        // JDK lib
        try {
            const jh = await this.resolveJavaHome();
            entries.push(path.join(jh, 'lib', 'jrt-fs.jar'));
        } catch {
            // ignore
        }

        const filtered = entries.filter((p) => p && fs.existsSync(p) || p.endsWith('/*'));
        this.cachedClasspath = { entries: filtered, signature };
        return filtered;
    }

    private async writeClasspathFile(entries: string[]): Promise<string> {
        const cpFile = path.join(os.tmpdir(), `yonbip-cp-${process.pid}-${Date.now()}.txt`);
        await fs.promises.writeFile(cpFile, entries.join(path.delimiter), 'utf8');
        return cpFile;
    }

    private async resolveOutputDir(): Promise<string> {
        // 优先读取 .classpath 中的 output kind，否则使用 build/classes
        const root = this.workspaceRoot();
        const classpathFile = path.join(root, '.classpath');
        if (fs.existsSync(classpathFile)) {
            try {
                const xml = fs.readFileSync(classpathFile, 'utf8');
                const m = xml.match(/<classpathentry[^>]*kind=["']output["'][^>]*path=["']([^"']+)["']/);
                if (m && m[1]) {
                    const out = path.isAbsolute(m[1]) ? m[1] : path.join(root, m[1]);
                    if (!fs.existsSync(out)) {
                        fs.mkdirSync(out, { recursive: true });
                    }
                    return out;
                }
            } catch {
                // ignore
            }
        }
        const def = path.join(root, 'build', 'classes');
        if (!fs.existsSync(def)) {
            fs.mkdirSync(def, { recursive: true });
        }
        return def;
    }

    // ------------------------------------------------------------------
    // 内部：JDI 部署
    // ------------------------------------------------------------------

    private async deployViaJdi(classFiles: string[]): Promise<{ success: boolean; message: string; actualMode: HotDeployMode }> {
        const javaHome = await this.resolveJavaHome();
        const javaExe = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        const helperJar = this.getHelperJarPath();
        if (!fs.existsSync(helperJar)) {
            throw new Error(`热部署助手 JAR 不存在: ${helperJar}，请重新安装插件`);
        }

        const debugPort = this.getDebugPort();
        const config = this.configService.getConfig();
        const host = (config as any).debugHost || '127.0.0.1';

        const args = ['-cp', helperJar, 'HotDeployHelper', host, String(debugPort), ...classFiles];
        this.log(`调用 JDI 助手 java ${args.slice(0, 4).join(' ')} ...`);
        const result = await this.runProcess(javaExe, args, { cwd: this.workspaceRoot() });

        const output = (result.stdout || '') + (result.stderr || '');
        if (result.code === 0) {
            const successLine = output.split(/\r?\n/).filter((l) => l.includes('[成功]')).pop() || '热加载成功';
            return { success: true, message: successLine, actualMode: 'jdi' };
        }
        throw new Error(`JDI 热加载失败 (exit=${result.code}): ${output.split(/\r?\n/).slice(-10).join('\n')}`);
    }

    private getHelperJarPath(): string {
        // 优先使用 jar；否则使用 class 文件所在目录
        const jar = path.join(this.context.extensionPath, 'resources', 'hot-deploy', 'hot-deploy-helper.jar');
        if (fs.existsSync(jar)) {
            return jar;
        }
        // 兜底：直接传 class 文件所在目录
        return path.join(this.context.extensionPath, 'resources', 'hot-deploy');
    }

    // ------------------------------------------------------------------
    // 内部：NC 热部署（拷贝 class 到 external/classes）
    // ------------------------------------------------------------------

    private async deployNcHotDeploy(classFiles: string[]): Promise<{ success: boolean; message: string; actualMode: HotDeployMode }> {
        const config = this.configService.getConfig();
        if (!config.homePath || !fs.existsSync(config.homePath)) {
            throw new Error('NC HOME 路径未配置或不存在');
        }

        // 决定目标目录：优先 external/classes，否则 modules/<first>/classes
        const targets: string[] = [];
        const externalClasses = path.join(config.homePath, 'external', 'classes');
        if (!fs.existsSync(externalClasses)) {
            fs.mkdirSync(externalClasses, { recursive: true });
        }
        targets.push(externalClasses);

        let copied = 0;
        const failed: string[] = [];
        for (const cf of classFiles) {
            try {
                const rel = path.basename(cf); // 类文件名；按包路径拷贝更精确
                const packagePath = this.extractPackagePath(cf);
                const targetSub = packagePath ? path.join(externalClasses, packagePath) : externalClasses;
                if (!fs.existsSync(targetSub)) {
                    fs.mkdirSync(targetSub, { recursive: true });
                }
                const dest = path.join(targetSub, rel);
                fs.copyFileSync(cf, dest);
                copied++;
            } catch (err: any) {
                failed.push(`${path.basename(cf)}: ${err.message}`);
            }
        }

        // 触发 NC 热部署：写 sentinel 文件让 NC 扫描
        const sentinel = path.join(config.homePath, 'external', 'classes', '.reload');
        try {
            fs.writeFileSync(sentinel, String(Date.now()), 'utf8');
        } catch {
            // ignore
        }

        if (copied === 0) {
            return { success: false, message: `拷贝失败：${failed.join('; ')}`, actualMode: 'ncHotDeploy' };
        }
        const msg = `已拷贝 ${copied}/${classFiles.length} 个 class 到 ${externalClasses}${failed.length ? '，失败: ' + failed.join('; ') : ''}`;
        return { success: true, message: msg, actualMode: 'ncHotDeploy' };
    }

    private extractPackagePath(classFile: string): string {
        const norm = classFile.replace(/\\/g, '/');
        const markers = ['/build/classes/', '/classes/', '/target/classes/', '/WEB-INF/classes/', '/bin/'];
        for (const m of markers) {
            const idx = norm.indexOf(m);
            if (idx >= 0) {
                const tail = norm.substring(idx + m.length);
                return path.dirname(tail);
            }
        }
        return '';
    }

    private collectClasses(dir: string, out: string[]): void {
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                this.collectClasses(p, out);
            } else if (e.name.endsWith('.class')) {
                out.push(p);
            }
        }
    }

    // ------------------------------------------------------------------
    // 内部：工具
    // ------------------------------------------------------------------

    private workspaceRoot(): string {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return folders[0].uri.fsPath;
        }
        return process.cwd();
    }

    private setStatus(s: HotDeployStatus): void {
        this._status = s;
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        const label = this.statusLabel(this._status);
        const mode = this.getMode();
        this.statusBarItem.text = `$(sync) 热部署: ${label}`;
        this.statusBarItem.tooltip = `YonBIP 热部署（${mode}）\n点击查看详情`;
        this.statusBarItem.show();
    }

    private statusLabel(s: HotDeployStatus | string): string {
        switch (s) {
            case 'idle': return '空闲';
            case 'watching': return '监听中';
            case 'compiling': return '编译中';
            case 'deploying': return '部署中';
            case 'error': return '异常';
            case 'disabled': return '已停用';
            case 'running': return '运行中';
            case 'starting': return '启动中';
            case 'stopping': return '停止中';
            case 'stopped': return '已停止';
            default: return String(s);
        }
    }

    private log(msg: string): void {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
        this.outputChannel.appendLine(line);
    }

    private runProcess(exe: string, args: string[], options: { cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            const child: ChildProcess = spawn(exe, args, {
                cwd: options.cwd,
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
            child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
            child.on('error', (err) => {
                stderr += `\nspawn error: ${err.message}`;
                resolve({ code: -1, stdout, stderr });
            });
            child.on('close', (code) => {
                resolve({ code: code ?? 0, stdout, stderr });
            });
        });
    }
}