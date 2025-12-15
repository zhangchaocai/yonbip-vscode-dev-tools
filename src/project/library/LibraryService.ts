import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';
import { JavaVersionUtils } from '../../utils/JavaVersionUtils';
import { ClasspathUtils } from '../../utils/ClasspathUtils';
import { spawnSync } from 'child_process';

/**
 * Jar包信息VO
 */
interface JarInfoVO {
    jarPath: string;
    jarName: string;
    jarFirstName: string;
    jarVersion: string;
}

/**
 * 库配置信息
 */
interface LibraryConfig {
    name: string;
    paths: string[];
    type: 'classes' | 'jar' | 'resources';
}

/**
 * Library服务 - 适配IDEA插件的LibraryUtil功能
 */
export class LibraryService {
    private static readonly LIBRARY_NAMES = {
        DB_DRIVER_LIBRARY: 'DB_Drive_Library',
        ANT_LIBRARY: 'Ant_Library',
        PRODUCT_COMMON_LIBRARY: 'Product_Common_Library',
        MIDDLEWARE_LIBRARY: 'Middleware_Library',
        FRAMEWORK_LIBRARY: 'Framework_Library',
        EXTENSION_PUBLIC_LIBRARY: 'Extension_Public_Library',
        HYEXT_PUBLIC_LIBRARY: 'Hyext_Public_Library',
        MODULE_PUBLIC_LIBRARY: 'Module_Public_Library',
        EXTENSION_CLIENT_LIBRARY: 'Extension_Client_Library',
        HYEXT_CLIENT_LIBRARY: 'Hyext_Client_Library',
        MODULE_CLIENT_LIBRARY: 'Module_Client_Library',
        EXTENSION_PRIVATE_LIBRARY: 'Extension_Private_Library',
        HYEXT_PRIVATE_LIBRARY: 'Hyext_Private_Library',
        MODULE_PRIVATE_LIBRARY: 'Module_Private_Library',
        MODULE_LANG_LIBRARY: 'Module_Lang_Library',
        GENERATED_EJB: 'Generated_EJB',
        NCCLOUD_LIBRARY: 'NCCloud_Library',
        NCCHR_LIBRARY: 'NCCHr_Library',
        RESOURCES_LIBRARY: 'resources'
    };

    private static outputChannelInstance: vscode.OutputChannel | null = null;
    private outputChannel: vscode.OutputChannel;

    private context?: vscode.ExtensionContext;

    private configService: NCHomeConfigService;

    constructor(context?: vscode.ExtensionContext, configService?: NCHomeConfigService) {
        // 确保outputChannel只初始化一次
        if (!LibraryService.outputChannelInstance) {
            LibraryService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP Library Service');
        }
        this.outputChannel = LibraryService.outputChannelInstance;
        this.context = context;
        this.configService = configService || new NCHomeConfigService(context!);
    }

    /**
     * 获取需要初始化的库名称列表
     */
    private getLibraryNameList(needDbLibrary: boolean): string[] {
        const list: string[] = [];

        // 注意顺序！！！！！
        if (needDbLibrary) {
            list.push(LibraryService.LIBRARY_NAMES.DB_DRIVER_LIBRARY);
        }

        list.push(LibraryService.LIBRARY_NAMES.ANT_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.PRODUCT_COMMON_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MIDDLEWARE_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.FRAMEWORK_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.MODULE_LANG_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.GENERATED_EJB);
        list.push(LibraryService.LIBRARY_NAMES.NCCLOUD_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.NCCHR_LIBRARY);
        list.push(LibraryService.LIBRARY_NAMES.RESOURCES_LIBRARY);

        return list;
    }

    /**
     * 复制脚手架文件到目标目录
     * @param scaffoldPath 脚手架源路径
     * @param targetPath 目标路径
     */
    private async copyScaffold(scaffoldPath: string, targetPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // 确保目标目录存在
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }

                // 递归复制目录
                this.copyDirectoryRecursive(scaffoldPath, targetPath);

                this.outputChannel.appendLine(`脚手架复制完成: ${scaffoldPath} -> ${targetPath}`);
                resolve();
            } catch (error) {
                this.outputChannel.appendLine(`复制脚手架失败: ${error}`);
                reject(error);
            }
        });
    }

    /**
     * 递归复制目录
     * @param source 源目录
     * @param target 目标目录
     */
    private copyDirectoryRecursive(source: string, target: string): void {
        if (!fs.existsSync(source)) {
            return;
        }

        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }

        const files = fs.readdirSync(source);

        for (const file of files) {
            const sourcePath = path.join(source, file);
            const targetPath = path.join(target, file);

            const stat = fs.statSync(sourcePath);

            if (stat.isDirectory()) {
                // 递归复制子目录
                this.copyDirectoryRecursive(sourcePath, targetPath);
            } else {
                // 复制文件
                fs.copyFileSync(sourcePath, targetPath);
            }
        }
    }

    /**
     * 初始化库
     */
    public async initLibrary(homePath: string, needDbLibrary: boolean = false, driverLibPath?: string, selectedPath?: string): Promise<void> {
        this.outputChannel.appendLine(`开始初始化库，HOME路径: ${homePath}`);

        try {
            // 验证HOME路径
            if (!this.validateHomePath(homePath)) {
                throw new Error('无效的HOME路径');
            }

            // 确定目标目录
            let targetPath: string;
            if (selectedPath) {
                targetPath = selectedPath;
            } else {
                // 获取工作区文件夹
                const workspaceFolder = this.getWorkspaceFolder();
                if (!workspaceFolder) {
                    throw new Error('未找到工作区文件夹');
                }
                targetPath = workspaceFolder.uri.fsPath;
            }

            // 创建.lib目录用于存储库配置
            const libDir = path.join(targetPath, '.lib');
            if (!fs.existsSync(libDir)) {
                fs.mkdirSync(libDir, { recursive: true });
            }

            // 获取库名称列表
            const libraryNameList = this.getLibraryNameList(needDbLibrary);

            // 获取模块jar映射
            const moduleJarMap = this.getModuleJarMap(homePath);

            // 已处理的jar列表，用于去重
            const allJarNameList: string[] = [];

            // 为每个库生成配置
            for (const libraryName of libraryNameList) {
                await this.generateLibraryConfig(
                    libraryName,
                    homePath,
                    libDir,
                    moduleJarMap,
                    driverLibPath,
                    allJarNameList
                );
            }

            // 选中的文件夹生成VSCode的settings.json更新
            //await this.updateVSCodeSettings(libDir, targetPath);

            // 工作区根目录下生成settings.json文件
            await this.generateWorkspaceSettings(homePath);

            // 生成launch.json配置用于调试Java代码
            await this.generateLaunchConfiguration(targetPath, libDir);

            // 修复：生成Eclipse项目文件时传递正确的路径参数
            await this.generateEclipseProjectFiles(homePath, targetPath);

            this.outputChannel.appendLine('库初始化完成');
            vscode.window.showInformationMessage('Java项目库初始化完成');

        } catch (error: any) {
            this.outputChannel.appendLine(`初始化库失败: ${error.message}`);
            vscode.window.showErrorMessage(`初始化库失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 验证HOME路径
     */
    private validateHomePath(homePath: string): boolean {
        const requiredPaths = ['bin', 'lib', 'modules', 'hotwebs', 'resources'];

        for (const requiredPath of requiredPaths) {
            const fullPath = path.join(homePath, requiredPath);
            if (!fs.existsSync(fullPath)) {
                this.outputChannel.appendLine(`缺少必需的目录: ${requiredPath}`);
                return false;
            }
        }

        return true;
    }

    /**
     * 获取工作区文件夹
     */
    private getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return workspaceFolders ? workspaceFolders[0] : undefined;
    }

    /**
     * 获取模块jar映射
     */
    private getModuleJarMap(homePath: string): Map<string, string[]> {
        const moduleJarMap = new Map<string, string[]>();

        // 初始化映射
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY, []);
        moduleJarMap.set(LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY, []);

        // 扫描modules目录
        const modulesPath = path.join(homePath, 'modules');
        if (fs.existsSync(modulesPath)) {
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => path.join(modulesPath, dirent.name));

            for (const modulePath of moduleDirs) {
                this.loadModuleJarMap(moduleJarMap, modulePath);
            }
        }

        return moduleJarMap;
    }

    /**
     * 加载模块jar映射
     */
    private loadModuleJarMap(moduleJarMap: Map<string, string[]>, modulePath: string): void {
        // extension公共库
        const extensionPublicPaths = this.getJarAndClasses(path.join(modulePath, 'extension'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY)?.push(...extensionPublicPaths);

        // hyext公共库
        const hyextPublicPaths = this.getJarAndClasses(path.join(modulePath, 'hyext'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY)?.push(...hyextPublicPaths);

        // 模块公共库
        const publicPaths = this.getJarAndClasses(modulePath, true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY)?.push(...publicPaths);

        // extension客户端库
        const extensionClientPaths = this.getJarAndClasses(path.join(modulePath, 'client', 'extension'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY)?.push(...extensionClientPaths);

        // hyext客户端库
        const hyextClientPaths = this.getJarAndClasses(path.join(modulePath, 'client', 'hyext'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY)?.push(...hyextClientPaths);

        // 模块客户端库
        const clientPaths = this.getJarAndClasses(path.join(modulePath, 'client'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY)?.push(...clientPaths);

        // extension私有库
        const extensionPrivatePaths = this.getJarAndClasses(path.join(modulePath, 'META-INF', 'extension'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY)?.push(...extensionPrivatePaths);

        // hyext私有库
        const hyextPrivatePaths = this.getJarAndClasses(path.join(modulePath, 'META-INF', 'hyext'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY)?.push(...hyextPrivatePaths);

        // 模块私有库
        const privatePaths = this.getJarAndClasses(path.join(modulePath, 'META-INF'), true);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY)?.push(...privatePaths);

        // 额外私有库
        const privateExtraPaths = this.getJarAndClasses(path.join(modulePath, 'META-INF', 'extra'), false);
        moduleJarMap.get(LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY)?.push(...privateExtraPaths);
    }

    /**
     * 获取jar和classes文件
     */
    private getJarAndClasses(scanPath: string, hasLibPath: boolean): string[] {
        const pathList: string[] = [];

        // 获取lib目录下的jar文件
        const jarPath = hasLibPath ? path.join(scanPath, 'lib') : scanPath;
        const jarDir = path.join(jarPath);
        if (fs.existsSync(jarDir)) {
            const files = fs.readdirSync(jarDir);
            for (const file of files) {
                if (file.endsWith('.jar')) {
                    pathList.push(path.join(jarDir, file));
                }
            }
        }

        return pathList;
    }

    /**
     * 生成库配置
     */
    private async generateLibraryConfig(
        libraryName: string,
        homePath: string,
        libDir: string,
        moduleJarMap: Map<string, string[]>,
        driverLibPath: string | undefined,
        allJarNameList: string[]
    ): Promise<void> {
        let jarPathList: string[] = [];

        switch (libraryName) {
            case LibraryService.LIBRARY_NAMES.DB_DRIVER_LIBRARY:
                if (driverLibPath && fs.existsSync(driverLibPath)) {
                    const driverPaths = driverLibPath.split(',');
                    for (const path of driverPaths) {
                        if (fs.existsSync(path.trim())) {
                            jarPathList.push(path.trim());
                        }
                    }
                }
                break;

            case LibraryService.LIBRARY_NAMES.ANT_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'ant'), true);
                break;

            case LibraryService.LIBRARY_NAMES.PRODUCT_COMMON_LIBRARY:
                const externalPaths = this.getJarAndClasses(path.join(homePath, 'external'), true);
                const libPaths = this.getJarAndClasses(path.join(homePath, 'lib'), false);
                jarPathList = [...externalPaths, ...libPaths];
                break;

            case LibraryService.LIBRARY_NAMES.MIDDLEWARE_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'middleware'), false);
                break;

            case LibraryService.LIBRARY_NAMES.FRAMEWORK_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'framework'), false);
                break;

            case LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY:
            case LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY:
            case LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY:
            case LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY:
            case LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY:
            case LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY:
            case LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY:
            case LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY:
            case LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY:
                jarPathList = moduleJarMap.get(libraryName) || [];
                break;

            case LibraryService.LIBRARY_NAMES.MODULE_LANG_LIBRARY:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'langlib'), false);
                break;

            case LibraryService.LIBRARY_NAMES.GENERATED_EJB:
                jarPathList = this.getJarAndClasses(path.join(homePath, 'ejb'), false);
                break;

            case LibraryService.LIBRARY_NAMES.NCCLOUD_LIBRARY:
                jarPathList = this.getJarAndClasses(
                    path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF'), true
                );
                break;

            case LibraryService.LIBRARY_NAMES.NCCHR_LIBRARY:
                jarPathList = this.getJarAndClasses(
                    path.join(homePath, 'hotwebs', 'ncchr', 'WEB-INF'), true
                );
                break;

            case LibraryService.LIBRARY_NAMES.RESOURCES_LIBRARY:
                jarPathList = [path.join(homePath, 'resources')];
                break;
        }

        // 去重处理
        const distinctJarPaths = this.getDistinctJarPaths(jarPathList, allJarNameList);

        // 生成库配置文件
        const libraryConfig = {
            name: libraryName,
            paths: distinctJarPaths,
            type: this.getLibraryType(libraryName)
        };

        const configPath = path.join(libDir, `${libraryName}.json`);
        fs.writeFileSync(configPath, JSON.stringify(libraryConfig, null, 2), 'utf-8');

        this.outputChannel.appendLine(`库配置已生成: ${libraryName} (${distinctJarPaths.length}个路径)`);
    }

    /**
     * 获取库类型
     */
    private getLibraryType(libraryName: string): 'classes' | 'jar' | 'resources' {
        if (libraryName === LibraryService.LIBRARY_NAMES.RESOURCES_LIBRARY) {
            return 'resources';
        }
        return 'jar';
    }

    /**
     * 去重处理jar路径
     */
    private getDistinctJarPaths(jarPathList: string[], allJarNameList: string[]): string[] {
        const resultList: string[] = [];

        const jarInfoList = jarPathList.map(jarPath => {
            if (!jarPath.toLowerCase().endsWith('.jar') || jarPath.toLowerCase().endsWith('_src.jar')) {
                resultList.push(jarPath);
                return null;
            }

            const jarInfo = this.parseJarInfo(jarPath);
            if (!allJarNameList.includes(jarInfo.jarName)) {
                return jarInfo;
            }
            return null;
        }).filter(info => info !== null) as JarInfoVO[];

        jarInfoList.forEach(jarInfo => {
            const first = jarInfoList.find(
                info => this.getJarFirstName(info.jarName) === this.getJarFirstName(jarInfo.jarName) &&
                    this.compareVersions(info.jarVersion, jarInfo.jarVersion) > 0
            );

            if (!first) {
                resultList.push(jarInfo.jarPath);
                allJarNameList.push(jarInfo.jarName);
            }
        });

        return resultList;
    }

    /**
     * 解析jar信息
     */
    private parseJarInfo(jarPath: string): JarInfoVO {
        const jarName = path.basename(jarPath);
        const match = jarName.match(/^(.+?)-(\d+(?:\.\d+)*).*\.jar$/);

        if (match) {
            return {
                jarPath,
                jarName,
                jarFirstName: match[1],
                jarVersion: match[2]
            };
        }

        return {
            jarPath,
            jarName,
            jarFirstName: jarName.replace('.jar', ''),
            jarVersion: '0.0.0'
        };
    }

    /**
     * 获取jar文件名前缀
     */
    private getJarFirstName(jarName: string): string {
        return jarName.replace(/-\d.*\.jar$/, '');
    }

    /**
     * 版本比较
     */
    private compareVersions(version1: string, version2: string): number {
        const v1 = version1.split('.');
        const v2 = version2.split('.');

        const length = Math.max(v1.length, v2.length);

        for (let i = 0; i < length; i++) {
            try {
                const num1 = i < v1.length ? parseInt(v1[i]) : 0;
                const num2 = i < v2.length ? parseInt(v2[i]) : 0;

                if (num1 < num2) return -1;
                if (num1 > num2) return 1;
            } catch (error) {
                return 0;
            }
        }

        return 0;
    }

    /**
     * 更新VSCode设置
     */
    private async updateVSCodeSettings(libDir: string, targetPath?: string): Promise<void> {
        // 获取所有库配置文件
        const libraryConfigs = fs.readdirSync(libDir)
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const configPath = path.join(libDir, file);
                return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            });

        // 获取工作区根目录
        const workspaceRoot = this.getWorkspaceFolder()?.uri.fsPath || '';

        // 计算相对于工作区根目录的路径
        let relativePath = '.';
        if (targetPath && workspaceRoot) {
            relativePath = path.relative(workspaceRoot, targetPath) || '.';
        }

        // 确保使用正斜杠路径分隔符
        const normalizedRelativePath = relativePath.split(path.sep).join('/');

        // 修复：正确设置源码路径和输出路径
        // 如果是当前目录('.')，则使用默认路径；否则添加相对路径前缀
        const sourcePaths = normalizedRelativePath === '.'
            ? ['src/private', 'src/public']
            : [`${normalizedRelativePath}/src/private`, `${normalizedRelativePath}/src/public`];

        const outputPath = normalizedRelativePath === '.'
            ? 'build/classes'
            : `${normalizedRelativePath}/build/classes`;

        // 构建Java配置
        const javaConfig = {
            'java.project.sourcePaths': sourcePaths,
            'java.project.outputPath': outputPath,
            'java.project.referencedLibraries': libraryConfigs.flatMap((config: LibraryConfig) => config.paths)
        };

        // 如果提供了目标路径，则在该路径下创建.vscode/settings.json文件
        if (targetPath) {
            const vscodeDir = path.join(targetPath, '.vscode');
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }

            const settingsPath = path.join(vscodeDir, 'settings.json');

            // 如果文件已存在，读取现有配置并合并
            let existingSettings = {};
            if (fs.existsSync(settingsPath)) {
                try {
                    const content = fs.readFileSync(settingsPath, 'utf-8');
                    existingSettings = JSON.parse(content);
                } catch (error) {
                    this.outputChannel.appendLine(`读取现有settings.json失败: ${error}`);
                }
            }

            // 合并配置
            const mergedSettings = { ...existingSettings, ...javaConfig };

            // 写入配置文件
            fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
            this.outputChannel.appendLine(`VSCode Java配置已保存到: ${settingsPath}`);
        } else {
            // 如果没有提供目标路径，则更新工作区配置
            const workspaceConfig = vscode.workspace.getConfiguration();
            for (const [key, value] of Object.entries(javaConfig)) {
                await workspaceConfig.update(key, value, vscode.ConfigurationTarget.Workspace);
            }
            this.outputChannel.appendLine('VSCode Java配置已更新');
        }
    }

    /**
     * 生成launch.json配置用于调试Java代码
     */
    private async generateLaunchConfiguration(workspacePath: string, libDir: string): Promise<void> {
        try {
            // 获取工作区根目录
            const workspaceRoot = this.getWorkspaceFolder()?.uri.fsPath || '';

            // 如果没有工作区根目录，使用传入的工作区路径
            const targetWorkspacePath = workspaceRoot || workspacePath;

            // 计算相对于工作区根目录的路径
            let relativePath = '.';
            if (workspaceRoot) {
                relativePath = path.relative(workspaceRoot, workspacePath) || '.';
            }

            // 确保使用正斜杠路径分隔符
            const normalizedRelativePath = relativePath.split(path.sep).join('/');

            // 修复：正确设置源码路径
            // 如果是当前目录('.')，则使用默认路径；否则添加相对路径前缀
            // const sourcePath = normalizedRelativePath === '.'
            //     ? '${workspaceFolder}/src'
            //     : `\${workspaceFolder}/${normalizedRelativePath}/src`;
            const sourcePath = normalizedRelativePath === '.'
                ? '${workspaceFolder}/src'
                : `\${workspaceFolder}/src`;

            // 获取所有库配置文件
            // const libraryConfigs = fs.readdirSync(libDir)
            //     .filter(file => file.endsWith('.json'))
            //     .map(file => {
            //         const configPath = path.join(libDir, file);
            //         return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            //     });

            // 构建类路径，包含所有jar文件和classes目录
            //const classPaths = libraryConfigs.flatMap((config: LibraryConfig) => config.paths);

            // 添加项目源代码路径
            //classPaths.push(sourcePath);

            // 创建.vscode目录（如果不存在）- 现在在工作区根目录下创建
            const vscodeDir = path.join(targetWorkspacePath, '.vscode');
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }

            // 读取现有的launch.json文件（如果存在）
            let existingLaunchConfig: any = {
                version: "0.2.0",
                configurations: []
            };

            const launchJsonPath = path.join(vscodeDir, 'launch.json');
            if (fs.existsSync(launchJsonPath)) {
                try {
                    const existingContent = fs.readFileSync(launchJsonPath, 'utf-8');
                    existingLaunchConfig = JSON.parse(existingContent);
                } catch (error) {
                    this.outputChannel.appendLine(`读取现有launch.json失败，将创建新的配置: ${error}`);
                }
            }


            // 提前获取配置以避免变量作用域问题
            const config = this.configService.getConfig();
            // 创建Java调试配置
            const javaDebugConfigurations = [
                {
                    type: "java",
                    name: "调试Java代码 (含JDK/第三方库)",
                    request: "attach",
                    hostName: "localhost",
                    port: config.debugPort || 8888,  // 使用获取到的调试端口
                    projectName: "${workspaceFolderBasename}"
                }
                // {
                //     type: "java",
                //     name: "启动并调试Java应用",
                //     request: "launch",
                //     mainClass: "",
                //     projectName: "${workspaceFolderBasename}",
                //     classPaths: classPaths,
                //     vmArgs: [
                //         "-Dfile.encoding=UTF-8",
                //         `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${config.debugPort || 8888}`  // 使用获取到的调试端口
                //     ],
                //     sourcePaths: [
                //         sourcePath
                //     ]
                // }
            ];

            // 合并配置，保留非Java配置，替换或添加Java配置
            const nonJavaConfigurations = existingLaunchConfig.configurations.filter((config: any) =>
                config.type !== "java"
            );

            const newConfigurations = [
                ...nonJavaConfigurations,
                ...javaDebugConfigurations
            ];

            // 生成最终的launch.json配置
            const launchConfig = {
                version: "0.2.0",
                configurations: newConfigurations
            };

            // 写入launch.json文件
            fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 4), 'utf-8');

            this.outputChannel.appendLine('launch.json调试配置已生成');
        } catch (error: any) {
            this.outputChannel.appendLine(`生成launch.json配置失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 生成普通Java项目所需的 .project 和 .classpath 文件
     */
    public async generateEclipseProjectFiles(homePath: string, selectedPath?: string): Promise<void> {
        this.outputChannel.appendLine(`开始生成Eclipse项目文件，HOME路径: ${homePath}`);

        try {
            // 确定目标目录
            let targetPath: string;
            if (selectedPath) {
                targetPath = selectedPath;
            } else {
                // 获取工作区文件夹
                const workspaceFolder = this.getWorkspaceFolder();
                if (!workspaceFolder) {
                    throw new Error('未找到工作区文件夹');
                }
                targetPath = workspaceFolder.uri.fsPath;
            }

            // 生成 .project 文件
            await this.generateProjectFile(targetPath);

            // 生成 .classpath 文件
            await this.generateClasspathFile(homePath, targetPath);

            this.outputChannel.appendLine('Eclipse项目文件生成完成');
            vscode.window.showInformationMessage('Eclipse项目文件生成完成');

        } catch (error: any) {
            this.outputChannel.appendLine(`生成Eclipse项目文件失败: ${error.message}`);
            vscode.window.showErrorMessage(`生成Eclipse项目文件失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 生成 .project 文件
     */
    private async generateProjectFile(workspacePath: string): Promise<void> {
        const projectFilePath = path.join(workspacePath, '.project');

        // 检查文件是否已存在
        // if (fs.existsSync(projectFilePath)) {
        //     this.outputChannel.appendLine('.project 文件已存在，跳过生成');
        //     return;
        // }

        // 获取项目名称
        const projectName = path.basename(workspacePath);

        // 生成 .project 文件内容
        const projectFileContent = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
    <name>${projectName}</name>
    <comment></comment>
    <projects>
    </projects>
    <buildSpec>
        <buildCommand>
            <name>org.eclipse.jdt.core.javabuilder</name>
            <arguments>
            </arguments>
        </buildCommand>
    </buildSpec>
    <natures>
        <nature>org.eclipse.jdt.core.javanature</nature>
    </natures>
</projectDescription>`;

        // 写入文件
        fs.writeFileSync(projectFilePath, projectFileContent, 'utf-8');
        this.outputChannel.appendLine('.project 文件已生成');
    }

    /**
     * 生成 .classpath 文件
     */
    private async generateClasspathFile(homePath: string, workspacePath: string): Promise<void> {
        const classpathFilePath = path.join(workspacePath, '.classpath');

        // 检查文件是否已存在
        // if (fs.existsSync(classpathFilePath)) {
        //     this.outputChannel.appendLine('.classpath 文件已存在，跳过生成');
        //     return;
        // }

        // 获取所有modules下模块的classes路径
        const moduleClassesPaths = this.getModuleClassesPaths(homePath);
        // 获取所有jar文件路径
        const jarPaths = this.getAllJarPaths(homePath);

        // 修复：正确计算相对于工作区的源码和输出路径
        // 获取工作区根目录
        const workspaceRoot = this.getWorkspaceFolder()?.uri.fsPath || '';

        // 计算相对于工作区根目录的路径
        let relativePath = '.';
        if (workspaceRoot) {
            relativePath = path.relative(workspaceRoot, workspacePath) || '.';
        }

        // 生成 .classpath 文件内容
        let classpathContent = `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
    <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>
    <classpathentry kind="output" path="build/classes"/>`;

        // 添加所有模块的classes路径
        for (const classesPath of moduleClassesPaths) {
            // 转换为相对路径（如果可能）
            const relativePath = path.relative(workspacePath, classesPath);
            const usePath = relativePath.startsWith('..') ? classesPath : relativePath;

            classpathContent += `\n    <classpathentry kind="lib" path="${usePath}"/>`;
        }

        // 添加所有jar文件
        for (const jarPath of jarPaths) {
            // 转换为相对路径（如果可能）
            const relativePath = path.relative(workspacePath, jarPath);
            const usePath = relativePath.startsWith('..') ? jarPath : relativePath;

            classpathContent += `\n    <classpathentry kind="lib" path="${usePath}"/>`;
        }



        classpathContent += '\n</classpath>';

        // 写入文件
        fs.writeFileSync(classpathFilePath, classpathContent, 'utf-8');
        this.outputChannel.appendLine('.classpath 文件已生成，包含 ' + jarPaths.length + ' 个jar文件和 ' + moduleClassesPaths.length + ' 个classes路径');
    }

    /**
     * 获取所有modules下模块的classes路径
     * @param homePath NC HOME路径
     * @returns 所有模块的classes路径数组
     */
    private getModuleClassesPaths(homePath: string): string[] {
        this.outputChannel.appendLine(`开始扫描模块classes路径: ${homePath}`);
        const classesPaths = ClasspathUtils.getAllModuleClassesPaths(homePath, this.context);
        
        // 记录找到的路径
        for (const classesPath of classesPaths) {
            this.outputChannel.appendLine(`找到模块classes路径: ${classesPath}`);
        }
        
        return classesPaths;
    }

    /**
     * 获取所有jar文件路径
     */
    private getAllJarPaths(homePath: string): string[] {
        const jarPaths: string[] = [];

        // 获取模块jar映射
        const moduleJarMap = this.getModuleJarMap(homePath);

        // 收集所有库的jar路径
        const libraryNameList = this.getLibraryNameList(true); // 包含DB驱动库

        for (const libraryName of libraryNameList) {
            let paths: string[] = [];

            switch (libraryName) {
                case LibraryService.LIBRARY_NAMES.DB_DRIVER_LIBRARY:
                    // DB驱动库需要特殊处理，这里暂时跳过
                    break;

                case LibraryService.LIBRARY_NAMES.ANT_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'ant'), true);
                    break;

                case LibraryService.LIBRARY_NAMES.PRODUCT_COMMON_LIBRARY:
                    const externalPaths = this.getJarAndClasses(path.join(homePath, 'external'), true);
                    const libPaths = this.getJarAndClasses(path.join(homePath, 'lib'), false);
                    paths = [...externalPaths, ...libPaths];
                    break;

                case LibraryService.LIBRARY_NAMES.MIDDLEWARE_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'middleware'), false);
                    break;

                case LibraryService.LIBRARY_NAMES.FRAMEWORK_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'framework'), false);
                    break;

                case LibraryService.LIBRARY_NAMES.EXTENSION_PUBLIC_LIBRARY:
                case LibraryService.LIBRARY_NAMES.HYEXT_PUBLIC_LIBRARY:
                case LibraryService.LIBRARY_NAMES.MODULE_PUBLIC_LIBRARY:
                case LibraryService.LIBRARY_NAMES.EXTENSION_CLIENT_LIBRARY:
                case LibraryService.LIBRARY_NAMES.HYEXT_CLIENT_LIBRARY:
                case LibraryService.LIBRARY_NAMES.MODULE_CLIENT_LIBRARY:
                case LibraryService.LIBRARY_NAMES.EXTENSION_PRIVATE_LIBRARY:
                case LibraryService.LIBRARY_NAMES.HYEXT_PRIVATE_LIBRARY:
                case LibraryService.LIBRARY_NAMES.MODULE_PRIVATE_LIBRARY:
                    paths = moduleJarMap.get(libraryName) || [];
                    break;

                case LibraryService.LIBRARY_NAMES.MODULE_LANG_LIBRARY:
                    paths = this.getJarAndClasses(path.join(homePath, 'langlib'), false);
                    break;

                case LibraryService.LIBRARY_NAMES.GENERATED_EJB:
                    paths = this.getJarAndClasses(path.join(homePath, 'ejb'), false);
                    break;

                case LibraryService.LIBRARY_NAMES.NCCLOUD_LIBRARY:
                    paths = this.getJarAndClasses(
                        path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF'), true
                    );
                    break;

                case LibraryService.LIBRARY_NAMES.NCCHR_LIBRARY:
                    paths = this.getJarAndClasses(
                        path.join(homePath, 'hotwebs', 'ncchr', 'WEB-INF'), true
                    );
                    break;

                case LibraryService.LIBRARY_NAMES.RESOURCES_LIBRARY:
                    // resources库不包含jar文件
                    break;
            }

            // 过滤出jar文件
            const jarFiles = paths.filter(p => p.toLowerCase().endsWith('.jar') && !p.toLowerCase().endsWith('_src.jar'));
            jarPaths.push(...jarFiles);
        }

        // 去重
        return [...new Set(jarPaths)];
    }

    /**
     * 从配置文件获取HOME路径
     */
    private getHomePathFromConfigFile(): string | undefined {
        try {
            // 只检查工作区目录下的配置文件
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceConfigPath = path.join(workspaceFolders[0].uri.fsPath, '.nc-home-config.json');

                if (fs.existsSync(workspaceConfigPath)) {
                    const config = JSON.parse(fs.readFileSync(workspaceConfigPath, 'utf-8'));
                    this.outputChannel.appendLine(`从工作区配置文件获取HOME路径: ${config.homePath || '未找到'}`);
                    return config.homePath;
                } else {
                    this.outputChannel.appendLine(`工作区配置文件不存在: ${workspaceConfigPath}`);
                }
            }

            // 不再检查全局存储路径的配置文件
            return undefined;
        } catch (error) {
            this.outputChannel.appendLine(`读取配置文件失败: ${error}`);
            return undefined;
        }
    }


    /**
     * 自动初始化库（如果配置了HOME路径）
     */
    public async autoInitLibrary(): Promise<void> {
        this.outputChannel.appendLine('=== 开始检查HOME路径配置 ===');

        // 只检查工作区配置，不使用全局配置
        const config = vscode.workspace.getConfiguration('yonbip');
        const homePath = config.get<string>('homePath');

        // 详细调试信息
        this.outputChannel.appendLine(`从yonbip配置获取的homePath: ${homePath || '未找到'}`);

        // 检查配置详情（只关注工作区配置）
        const inspect = config.inspect('homePath');
        if (inspect) {
            this.outputChannel.appendLine(`工作区配置: ${inspect.workspaceValue || '未设置'}`);
            this.outputChannel.appendLine(`工作区文件夹配置: ${inspect.workspaceFolderValue || '未设置'}`);
        }

        // 从配置文件获取HOME路径（只检查工作区目录下的配置文件）
        const configFileHomePath = this.getHomePathFromConfigFile();

        // 优先使用工作区配置
        let actualHomePath = homePath ||
            configFileHomePath ||
            inspect?.workspaceValue ||
            inspect?.workspaceFolderValue;
        // 不再使用全局配置 inspect?.globalValue

        if (!actualHomePath) {
            this.outputChannel.appendLine('未找到任何HOME路径配置，跳过库初始化');

            // 提供解决方案
            this.outputChannel.appendLine('解决方案:');
            this.outputChannel.appendLine('1. 通过命令面板运行: YonBIP/库管理: 调试配置信息');
            this.outputChannel.appendLine('2. 检查.vscode/settings.json中的yonbip.homePath配置');
            this.outputChannel.appendLine('3. 使用NC Home配置界面重新设置路径');
            return;
        }

        if (!fs.existsSync(actualHomePath as string)) {
            this.outputChannel.appendLine(`HOME路径不存在: ${actualHomePath}`);
            return;
        }

        this.outputChannel.appendLine(`使用HOME路径: ${actualHomePath}`);

        try {
            await this.initLibrary(actualHomePath as string);
            this.outputChannel.appendLine('库自动初始化完成');
        } catch (error: any) {
            this.outputChannel.appendLine(`自动初始化库失败: ${error.message}`);
        }
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        // 只有在扩展完全停用时才应该dispose outputChannel
        if (LibraryService.outputChannelInstance) {
            LibraryService.outputChannelInstance.dispose();
            LibraryService.outputChannelInstance = null;
        }
    }

    /**
     * 获取VS Code用户设置路径（跨平台兼容）
     */
    private getVSCodeUserSettingsPath(): string {
        const platform = process.platform;
        const homeDir = os.homedir();
        
        switch (platform) {
            case 'win32': // Windows
                return path.join(process.env.APPDATA || '', 'Code', 'User');
            case 'darwin': // macOS
                return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User');
            case 'linux': // Linux
                return path.join(homeDir, '.config', 'Code', 'User');
            default:
                // 默认使用Unix风格路径
                return path.join(homeDir, '.config', 'Code', 'User');
        }
    }

    /**
     * 在编辑器用户设置中添加配置信息
     */
    public async generateWorkspaceSettings(homePath: string): Promise<void> {
        try {
            // 检查是否为多根工作区
            if (vscode.workspace.workspaceFile) {
                // 多根工作区：在工作区文件中添加配置
                this.outputChannel.appendLine(`检测到多根工作区: ${vscode.workspace.workspaceFile.fsPath}`);
                
                // 修复：确保正确解析工作区文件路径
                // 检查工作区文件的scheme是否为'file'，以确认工作区已保存
                if (vscode.workspace.workspaceFile.scheme !== 'file') {
                    this.outputChannel.appendLine('工作区未保存，无法直接更新工作区配置文件');
                    const errorMessage = '多根工作区需要先保存后才可以初始化项目。请先保存工作区文件（Ctrl+Shift+P 或 Cmd+Shift+P），搜索 save workplace 保存工作空间 然后重新执行初始化操作。';
                    vscode.window.showErrorMessage(errorMessage);
                    throw new Error(errorMessage);
                }
                
                // 确保工作区文件路径存在
                const workspaceFilePath = vscode.workspace.workspaceFile.fsPath;
                if (!fs.existsSync(workspaceFilePath)) {
                    this.outputChannel.appendLine(`工作区配置文件不存在: ${workspaceFilePath}`);
                    const errorMessage = '多根工作区需要先保存后才可以初始化项目。请先保存工作区文件（Ctrl+Shift+P 或 Cmd+Shift+P），搜索 save workplace 保存工作空间，然后重新执行初始化操作。';
                    vscode.window.showErrorMessage(errorMessage);
                    throw new Error(errorMessage);
                }
                
                // 读取现有的工作区配置
                let workspaceConfig: any = {};
                try {
                    const content = fs.readFileSync(workspaceFilePath, 'utf-8');
                    workspaceConfig = JSON.parse(content);
                } catch (error) {
                    this.outputChannel.appendLine(`读取现有工作区配置失败: ${error}`);
                }

                // 获取JDK运行时配置
                const javaRuntimeConfig = await this.getJavaRuntimeConfig(homePath);

                // 检查工作区配置中是否已存在java.jdt.ls.java.home配置
                let jdk21OrHigherPath = "";
                if (workspaceConfig.settings && workspaceConfig.settings['java.jdt.ls.java.home']) {
                    // 如果已存在配置，使用现有的值
                    jdk21OrHigherPath = workspaceConfig.settings['java.jdt.ls.java.home'];
                    this.outputChannel.appendLine(`✅ 使用已存在的java.jdt.ls.java.home配置: ${jdk21OrHigherPath}`);
                } else {
                    // 检测JDK 21或更高版本用于java.jdt.ls.java.home
                    try {
                        const detectedJdkPath = await this.detectJdk21OrHigher();
                        if (detectedJdkPath) {
                            jdk21OrHigherPath = detectedJdkPath;
                            this.outputChannel.appendLine(`✅ 自动配置java.jdt.ls.java.home为: ${jdk21OrHigherPath}`);
                        } else {
                            // 如果未找到JDK 21+，提醒用户安装
                            this.outputChannel.appendLine('⚠️ 未找到JDK 21或更高版本，java.jdt.ls.java.home将保持为空');
                            this.outputChannel.appendLine('💡 请安装JDK 21或更高版本以获得最佳开发体验');
                            this.outputChannel.appendLine('💡 推荐下载地址: https://adoptium.net/');
                            vscode.window.showWarningMessage(
                                '未找到JDK 21或更高版本。请安装JDK 21+,配置setting.json中的java.jdt.ls.java.home才能正确构建项目,获得最佳开发体验。推荐下载地址: https://adoptium.net/',
                                '了解更多'
                            ).then(selection => {
                                if (selection === '了解更多') {
                                    vscode.env.openExternal(vscode.Uri.parse('https://adoptium.net/'));
                                }
                            });
                        }
                    } catch (error) {
                        this.outputChannel.appendLine(`检测JDK 21+时出错: ${error}`);
                    }
                }

                // 要添加的配置内容
                const newSettings = {
                    "java.saveActions.organizeImports": true,
                    "java.compile.nullAnalysis.mode": "automatic",
                    "java.configuration.runtimes": javaRuntimeConfig,
                    "[java]": {
                        "files.encoding": "gbk"
                    },
                    "[javascript]": {
                        "files.encoding": "utf8"
                    },
                    "[typescript]": {
                        "files.encoding": "utf8"
                    },
                    //此处配置JDK21或以上版本
                    "java.jdt.ls.java.home": jdk21OrHigherPath,
                    // 添加自动编译配置
                    "java.autobuild.enabled": true
                };

                // 如果工作区配置中还没有settings部分，则创建
                if (!workspaceConfig.hasOwnProperty('settings')) {
                    workspaceConfig['settings'] = {};
                }

                // 合并现有配置和新配置
                workspaceConfig['settings'] = { ...workspaceConfig['settings'], ...newSettings };

                // 写入工作区配置文件
                fs.writeFileSync(workspaceFilePath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
                
                this.outputChannel.appendLine(`多根工作区配置已更新: ${workspaceFilePath}`);
                vscode.window.showInformationMessage('多根工作区配置已更新，文件编码已设置为GBK，JDK运行时已配置');
            } else {
                // 单根工作区、未保存的多根工作区或无工作区：在用户设置中添加配置
                this.outputChannel.appendLine('检测到单根工作区或未保存的多根工作区，使用用户设置');
                
                // 获取编辑器配置目录（跨平台兼容）
                //const editorConfigPath = this.getVSCodeUserSettingsPath();
                const editorConfigPath = this.getWorkspaceFolder()?.uri.fsPath || '';
            
                // 确保.vscode目录存在
                const vscodeDirPath = path.join(editorConfigPath, '.vscode');
                if (!fs.existsSync(vscodeDirPath)) {
                    try {
                        fs.mkdirSync(vscodeDirPath, { recursive: true });
                    } catch (mkdirError: unknown) {
                        this.outputChannel.appendLine(`创建.vscode目录失败: ${mkdirError instanceof Error ? mkdirError.message : String(mkdirError)}`);
                        // 回退到用户设置
                        await this.fallbackToUserSettings(homePath);
                        return;
                    }
                }

                // settings.json文件路径
                const settingsPath = path.join(editorConfigPath, '.vscode','settings.json');

                // 读取现有配置（如果存在）
                let existingSettings: any = {};
                if (fs.existsSync(settingsPath)) {
                    try {
                        const content = fs.readFileSync(settingsPath, 'utf-8');
                        existingSettings = JSON.parse(content);
                    } catch (error) {
                        this.outputChannel.appendLine(`读取现有settings.json失败: ${error}`);
                    }
                }

                // 获取JDK运行时配置
                const javaRuntimeConfig = await this.getJavaRuntimeConfig(homePath);

                // 检查是否已存在java.jdt.ls.java.home配置
                let jdk21OrHigherPath = "";
                if (existingSettings && existingSettings['java.jdt.ls.java.home']) {
                    // 如果已存在配置，使用现有的值
                    jdk21OrHigherPath = existingSettings['java.jdt.ls.java.home'];
                    this.outputChannel.appendLine(`✅ 使用已存在的java.jdt.ls.java.home配置: ${jdk21OrHigherPath}`);
                } else {
                    // 检测JDK 21或更高版本用于java.jdt.ls.java.home
                    try {
                        const detectedJdkPath = await this.detectJdk21OrHigher();
                        if (detectedJdkPath) {
                            jdk21OrHigherPath = detectedJdkPath;
                            this.outputChannel.appendLine(`✅ 自动配置java.jdt.ls.java.home为: ${jdk21OrHigherPath}`);
                        } else {
                            // 如果未找到JDK 21+，提醒用户安装
                            this.outputChannel.appendLine('⚠️ 未找到JDK 21或更高版本，java.jdt.ls.java.home将保持为空');
                            this.outputChannel.appendLine('💡 请安装JDK 21或更高版本以获得最佳开发体验');
                            this.outputChannel.appendLine('💡 推荐下载地址: https://adoptium.net/');
                            vscode.window.showWarningMessage(
                                '未找到JDK 21或更高版本。请安装JDK 21+,配置setting.json中的java.jdt.ls.java.home才能正确构建项目,获得最佳开发体验。推荐下载地址: https://adoptium.net/',
                                '了解更多'
                            ).then(selection => {
                                if (selection === '了解更多') {
                                    vscode.env.openExternal(vscode.Uri.parse('https://adoptium.net/'));
                                }
                            });
                        }
                    } catch (error) {
                        this.outputChannel.appendLine(`检测JDK 21+时出错: ${error}`);
                    }
                }

                // 要添加的配置内容
                const newSettings = {
                    "java.saveActions.organizeImports": true,
                    "java.compile.nullAnalysis.mode": "automatic",
                    "java.configuration.runtimes": javaRuntimeConfig,
                    "[java]": {
                        "files.encoding": "gbk"
                    },
                    "[javascript]": {
                        "files.encoding": "utf8"
                    },
                    "[typescript]": {
                        "files.encoding": "utf8"
                    },
                    //此处配置JDK21或以上版本
                    "java.jdt.ls.java.home": jdk21OrHigherPath,
                    // 添加自动编译配置
                    "java.autobuild.enabled": true
                };

                // 合并现有配置和新配置
                const mergedSettings = { ...existingSettings, ...newSettings };

                // 写入文件
                try {
                    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
                } catch (writeError: unknown) {
                    this.outputChannel.appendLine(`写入settings.json文件失败: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
                    // 回退到用户设置
                    await this.fallbackToUserSettings(homePath);
                    return;
                }
                
                this.outputChannel.appendLine(`编辑器settings.json文件已更新: ${settingsPath}`);
                vscode.window.showInformationMessage('编辑器settings.json文件已更新，文件编码已设置为GBK，JDK运行时已配置');
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`更新编辑器配置失败: ${error.message}`);
            vscode.window.showErrorMessage(`更新编辑器配置失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 回退到用户设置的处理方法
     */
    private async fallbackToUserSettings(homePath: string): Promise<void> {
        this.outputChannel.appendLine('回退到用户级settings.json进行配置写入');
        
        try {
            // 获取编辑器配置目录（跨平台兼容）
            const editorConfigPath = this.getVSCodeUserSettingsPath();
            
            // 确保.vscode目录存在
            if (!fs.existsSync(editorConfigPath)) {
                fs.mkdirSync(editorConfigPath, { recursive: true });
            }

            // settings.json文件路径
            const settingsPath = path.join(editorConfigPath, 'settings.json');

            // 读取现有配置（如果存在）
            let existingSettings: any = {};
            if (fs.existsSync(settingsPath)) {
                try {
                    const content = fs.readFileSync(settingsPath, 'utf-8');
                    existingSettings = JSON.parse(content);
                } catch (error) {
                    this.outputChannel.appendLine(`读取现有settings.json失败: ${error}`);
                }
            }

            // 获取JDK运行时配置
            const javaRuntimeConfig = await this.getJavaRuntimeConfig(homePath);

            // 检查是否已存在java.jdt.ls.java.home配置
            let jdk21OrHigherPath = "";
            if (existingSettings && existingSettings['java.jdt.ls.java.home']) {
                // 如果已存在配置，使用现有的值
                jdk21OrHigherPath = existingSettings['java.jdt.ls.java.home'];
                this.outputChannel.appendLine(`✅ 使用已存在的java.jdt.ls.java.home配置: ${jdk21OrHigherPath}`);
            } else {
                // 检测JDK 21或更高版本用于java.jdt.ls.java.home
                try {
                    const detectedJdkPath = await this.detectJdk21OrHigher();
                    if (detectedJdkPath) {
                        jdk21OrHigherPath = detectedJdkPath;
                        this.outputChannel.appendLine(`✅ 自动配置java.jdt.ls.java.home为: ${jdk21OrHigherPath}`);
                    } else {
                        // 如果未找到JDK 21+，提醒用户安装
                        this.outputChannel.appendLine('⚠️ 未找到JDK 21或更高版本，java.jdt.ls.java.home将保持为空');
                        this.outputChannel.appendLine('💡 请安装JDK 21或更高版本以获得最佳开发体验');
                        this.outputChannel.appendLine('💡 推荐下载地址: https://adoptium.net/');
                        vscode.window.showWarningMessage(
                            '未找到JDK 21或更高版本。请安装JDK 21+,配置setting.json中的java.jdt.ls.java.home才能正确构建项目,获得最佳开发体验。推荐下载地址: https://adoptium.net/',
                            '了解更多'
                        ).then(selection => {
                            if (selection === '了解更多') {
                                vscode.env.openExternal(vscode.Uri.parse('https://adoptium.net/'));
                            }
                        });
                    }
                } catch (error) {
                    this.outputChannel.appendLine(`检测JDK 21+时出错: ${error}`);
                }
            }

            // 要添加的配置内容
            const newSettings = {
                "java.saveActions.organizeImports": true,
                "java.compile.nullAnalysis.mode": "automatic",
                "java.configuration.runtimes": javaRuntimeConfig,
                "[java]": {
                    "files.encoding": "gbk"
                },
                "[javascript]": {
                    "files.encoding": "utf8"
                },
                "[typescript]": {
                    "files.encoding": "utf8"
                },
                //此处配置JDK21或以上版本
                "java.jdt.ls.java.home": jdk21OrHigherPath,
                // 添加自动编译配置
                "java.autobuild.enabled": true
            };

            // 合并现有配置和新配置
            const mergedSettings = { ...existingSettings, ...newSettings };

            // 写入文件
            fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
            
            this.outputChannel.appendLine(`编辑器settings.json文件已更新: ${settingsPath}`);
            vscode.window.showInformationMessage('编辑器settings.json文件已更新，文件编码已设置为GBK，JDK运行时已配置');
        } catch (error: unknown) {
            this.outputChannel.appendLine(`回退到用户设置失败: ${error instanceof Error ? error.message : String(error)}`);
            vscode.window.showErrorMessage(`回退到用户设置失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 检测JDK 21或更高版本
     * @returns JDK 21+的路径，如果未找到则返回null
     */
    private async detectJdk21OrHigher(): Promise<string | null> {
        try {
            // 1. 首先检查环境变量
            const javaHome = process.env.JAVA_HOME || process.env.JDK_HOME;
            if (javaHome) {
                const javaExecutable = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                if (fs.existsSync(javaExecutable)) {
                    const version = await this.getJavaVersionFromExecutable(javaExecutable);
                    if (version >= 21) {
                        this.outputChannel.appendLine(`✅ 从环境变量找到JDK ${version}: ${javaHome}`);
                        return javaHome;
                    }
                }
            }

            // 2. 在macOS上使用/usr/libexec/java_home命令查找JDK 21+
            if (process.platform === 'darwin') {
                try {
                    const { execSync } = require('child_process');
                    // 尝试查找JDK 21
                    let jdk21Path = '';
                    try {
                        jdk21Path = execSync('/usr/libexec/java_home -F -v 21', { encoding: 'utf-8' }).trim();
                    } catch (error) {
                        // 如果找不到JDK 21，尝试查找更高版本
                        try {
                            jdk21Path = execSync('/usr/libexec/java_home -F -v 17+', { encoding: 'utf-8' }).trim();
                        } catch (error) {
                            // 继续尝试其他方法
                        }
                    }

                    if (jdk21Path && fs.existsSync(jdk21Path)) {
                        const javaExecutable = path.join(jdk21Path, 'bin', 'java');
                        if (fs.existsSync(javaExecutable)) {
                            const version = await this.getJavaVersionFromExecutable(javaExecutable);
                            if (version >= 21) {
                                this.outputChannel.appendLine(`✅ 从/usr/libexec/java_home找到JDK ${version}: ${jdk21Path}`);
                                return jdk21Path;
                            }
                        }
                    }
                } catch (error) {
                    // 继续尝试其他方法
                }
            }

            // 3. 检查常见的JDK安装路径
            const commonJdkPaths = [
                // macOS路径
                '/Library/Java/JavaVirtualMachines/openjdk-21.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/openjdk-22.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/jdk-22.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/openjdk-23.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/jdk-23.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/openjdk-24.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/jdk-24.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/openjdk-25.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/jdk-25.jdk/Contents/Home',
                // Windows路径
                'C:\\Program Files\\Java\\jdk-21',
                'C:\\Program Files\\Java\\openjdk-21',
                'C:\\Program Files\\Java\\jdk-22',
                'C:\\Program Files\\Java\\openjdk-22',
                'C:\\Program Files\\Java\\jdk-23',
                'C:\\Program Files\\Java\\openjdk-23',
                'C:\\Program Files\\Java\\jdk-24',
                'C:\\Program Files\\Java\\openjdk-24',
                'C:\\Program Files\\Java\\jdk-25',
                'C:\\Program Files\\Java\\openjdk-25',
                // Linux路径
                '/usr/lib/jvm/java-21-openjdk',
                '/usr/lib/jvm/java-21-oracle',
                '/usr/lib/jvm/java-22-openjdk',
                '/usr/lib/jvm/java-22-oracle',
                '/usr/lib/jvm/java-23-openjdk',
                '/usr/lib/jvm/java-23-oracle',
                '/usr/lib/jvm/java-24-openjdk',
                '/usr/lib/jvm/java-24-oracle',
                '/usr/lib/jvm/java-25-openjdk',
                '/usr/lib/jvm/java-25-oracle'
            ];

            for (const jdkPath of commonJdkPaths) {
                if (fs.existsSync(jdkPath)) {
                    const javaExecutable = path.join(jdkPath, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                    if (fs.existsSync(javaExecutable)) {
                        const version = await this.getJavaVersionFromExecutable(javaExecutable);
                        if (version >= 21) {
                            this.outputChannel.appendLine(`✅ 从常见路径找到JDK ${version}: ${jdkPath}`);
                            return jdkPath;
                        }
                    }
                }
            }

            // 4. 尝试使用which/where命令查找java可执行文件
            try {
                const { execSync } = require('child_process');
                const whichCommand = process.platform === 'win32' ? 'where java' : 'which java';
                const javaPathsOutput = execSync(whichCommand, { encoding: 'utf-8' });
                
                if (javaPathsOutput) {
                    const javaPaths = javaPathsOutput.trim().split('\n');
                    for (const javaPath of javaPaths) {
                        const trimmedPath = javaPath.trim();
                        if (trimmedPath && fs.existsSync(trimmedPath)) {
                            // 从可执行文件路径推断JDK路径
                            const jdkPath = process.platform === 'win32' 
                                ? path.dirname(path.dirname(trimmedPath)) 
                                : path.dirname(path.dirname(trimmedPath));
                            
                            const version = await this.getJavaVersionFromExecutable(trimmedPath);
                            if (version >= 21) {
                                this.outputChannel.appendLine(`✅ 从系统路径找到JDK ${version}: ${jdkPath}`);
                                return jdkPath;
                            }
                        }
                    }
                }
            } catch (error) {
                // 继续执行
            }

            this.outputChannel.appendLine('⚠️ 未找到JDK 21或更高版本');
            return null;
        } catch (error) {
            this.outputChannel.appendLine(`检测JDK 21+时出错: ${error}`);
            return null;
        }
    }

    /**
     * 从Java可执行文件获取版本号
     * @param javaExecutable Java可执行文件路径
     * @returns Java版本号
     */
    private async getJavaVersionFromExecutable(javaExecutable: string): Promise<number> {
        try {
            const result = spawnSync(javaExecutable, ['-version'], {
                encoding: 'utf8',
                timeout: 10000
            });

            if (result.status === 0) {
                const versionOutput = result.stderr || result.stdout;
                // 解析Java版本，例如 "java version \"21.0.1\"" 或 "openjdk version \"21.0.1\""
                const versionMatch = versionOutput.match(/version\s+["']([^"']+)["']/i);
                if (versionMatch && versionMatch[1]) {
                    const versionStr = versionMatch[1];
                    // 提取主版本号
                    let version: number;
                    if (versionStr.startsWith('1.')) {
                        // Java 8及以下版本格式 "1.8.0_261"
                        version = parseInt(versionStr.split('.')[1]);
                    } else {
                        // Java 9及以上版本格式 "11.0.8" 或 "21.0.1"
                        version = parseInt(versionStr.split('.')[0]);
                    }
                    return version;
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`获取Java版本时出错: ${error}`);
        }
        return 0;
    }

    /**
     * 获取Java运行时配置
     */
    private async getJavaRuntimeConfig(homePath: string): Promise<any[]> {
        try {
            // 检查操作系统类型
            if (process.platform === 'darwin') {
                // macOS系统
                return await this.getMacJavaRuntimeConfig(homePath);
            } else if (process.platform === 'win32') {
                // Windows系统
                return await this.getWindowsJavaRuntimeConfig(homePath);
            } else {
                // 其他系统（Linux等）
                return await this.getMacJavaRuntimeConfig(homePath);
            }
        } catch (error) {
            this.outputChannel.appendLine(`获取Java运行时配置失败: ${error}`);
            // 返回默认配置
            return [];
        }
    }

    /**
     * 获取macOS系统的Java运行时配置
     */
    private async getMacJavaRuntimeConfig(homePath: string): Promise<any[]> {
        try {
            const javaRuntimes: any[] = [];
            //获取home版本
            const versionStr = this.configService.getConfig().homeVersion 

            const version = versionStr ? parseInt(versionStr, 10) : 0;

            // 根据home版本确定需要的JDK版本
            let requiredJavaVersion = "JavaSE-1.8"; // 默认JDK8
            let requiredJavaVersionNumber = "1.8";
            if (version >= 2312) {
                requiredJavaVersion = "JavaSE-17"; // JDK17
                requiredJavaVersionNumber = "17";
            } else if (version < 1903) {
                requiredJavaVersion = "JavaSE-1.7"; // JDK7
                requiredJavaVersionNumber = "1.7";
            }
            // 1903 <= version < 2312 的情况使用默认的 JDK8

            // 尝试使用/usr/libexec/java_home命令获取特定版本的JDK
            try {
                const { execSync } = require('child_process');
                
                // 直接获取特定版本的JDK路径
                let jdkPath = "";
                try {
                    jdkPath = execSync(`/usr/libexec/java_home -F -v ${requiredJavaVersionNumber}`, { encoding: 'utf-8' }).trim();
                } catch (versionError) {
                    this.outputChannel.appendLine(`无法找到JDK ${requiredJavaVersionNumber}: ${versionError}`);
                }
                
                // 如果找到了JDK路径，验证并添加到结果中
                if (jdkPath && fs.existsSync(jdkPath)) {
                    // 验证是否包含java可执行文件
                    const javaExecutable = path.join(jdkPath, 'bin', 'java');
                    if (fs.existsSync(javaExecutable)) {
                        // 使用统一的方法获取Java版本名称
                        const runtimeName = JavaVersionUtils.getJavaVersionName(javaExecutable, this.outputChannel);
                        
                        // 如果版本匹配，则将其设为默认
                        if (runtimeName === requiredJavaVersion) {
                            // 添加匹配的JDK作为默认JDK
                            javaRuntimes.push({
                                "name": runtimeName,
                                "path": jdkPath,
                                "default": true  // 将匹配的JDK设为默认
                            });
                        } else {
                            // 版本不匹配，但仍添加到列表中（非默认）
                            javaRuntimes.push({
                                "name": runtimeName,
                                "path": jdkPath
                            });
                        }
                    }
                }
            } catch (error) {
                this.outputChannel.appendLine(`使用/usr/libexec/java_home命令获取JDK路径失败: ${error}`);
            }
            
            // 如果没有通过/usr/libexec/java_home -F -v获取到Java版本，使用原来的逻辑
            if (javaRuntimes.length === 0) {
                // 首先尝试从环境变量中获取JDK路径
                let jdkPath = process.env.JAVA_HOME || process.env.JDK_HOME;

                // 如果环境变量中没有找到，尝试使用/usr/libexec/java_home命令获取
                if (!jdkPath) {
                    try {
                        const { execSync } = require('child_process');
                        jdkPath = execSync('/usr/libexec/java_home', { encoding: 'utf-8' }).trim();
                    } catch (error) {
                        this.outputChannel.appendLine(`使用/usr/libexec/java_home命令获取JDK路径失败: ${error}`);
                    }
                }

                // 如果还是没有找到，尝试一些常见的JDK安装路径
                if (!jdkPath) {
                    const commonJdkPaths = [
                        '/Library/Java/JavaVirtualMachines/default/Contents/Home',
                        '/Library/Java/JavaVirtualMachines/jdk1.8.0_281.jdk/Contents/Home',
                        '/Library/Java/JavaVirtualMachines/jdk-11.jdk/Contents/Home',
                        '/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home',
                        '/System/Library/Java/JavaVirtualMachines/1.6.0.jdk/Contents/Home'
                    ];

                    for (const path of commonJdkPaths) {
                        if (fs.existsSync(path)) {
                            jdkPath = path;
                            break;
                        }
                    }
                }

                // 如果找到了JDK路径，返回配置
                if (jdkPath && fs.existsSync(jdkPath)) {
                    // 验证是否包含java可执行文件
                    const javaExecutable = path.join(jdkPath, 'bin', 'java');
                    if (fs.existsSync(javaExecutable)) {
                        // 使用新的方法获取Java版本
                        const runtimeName = JavaVersionUtils.getJavaVersionName(javaExecutable, this.outputChannel);
                        
                        // 添加找到的第一个JDK作为默认JDK
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": jdkPath,
                            "default": true  // 将第一个找到的JDK设为默认
                        });
                    }
                }
            }

            // 如果无法找到有效的JDK路径，返回空数组
            if (javaRuntimes.length === 0) {
                this.outputChannel.appendLine(`无法自动检测到有效的JDK路径，需要的JDK版本: ${requiredJavaVersion}`);
            }
            
            return javaRuntimes;
        } catch (error) {
            this.outputChannel.appendLine(`获取macOS Java运行时配置失败: ${error}`);
            return [];
        }
    }



    /**
     * 获取Windows系统的Java运行时配置
     */
    private async getWindowsJavaRuntimeConfig(homePath: string): Promise<any[]> {
        try {
            const javaRuntimes: any[] = [];
            
            // 获取home版本
            const versionStr = this.configService.getConfig().homeVersion;
            const version = versionStr ? parseInt(versionStr, 10) : 0;

            // 根据home版本确定需要的JDK版本
            let requiredJavaVersion = "JavaSE-1.8"; // 默认JDK8
            if (version >= 2312) {
                requiredJavaVersion = "JavaSE-17"; // JDK17
            } else if (version < 1903) {
                requiredJavaVersion = "JavaSE-1.7"; // JDK7
            }
            // 1903 <= version < 2312 的情况使用默认的 JDK8

            // 在Windows系统上，默认使用homepath/ufjdk作为JDK路径
            const defaultJdkPath = path.join(homePath, 'ufjdk');

            // 检查默认路径是否存在
            if (fs.existsSync(defaultJdkPath)) {
                // 验证是否包含java可执行文件
                const javaExecutable = path.join(defaultJdkPath, 'bin', 'java.exe');
                if (fs.existsSync(javaExecutable)) {
                    // 使用新的方法获取Java版本
                    const runtimeName = JavaVersionUtils.getJavaVersionName(javaExecutable, this.outputChannel);
                    
                    // 如果版本匹配，则将其设为默认
                    if (runtimeName === requiredJavaVersion) {
                        // 添加匹配的JDK作为默认JDK
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": defaultJdkPath,
                            "default": true  // 将匹配的JDK设为默认
                        });
                    } else {
                        // 版本不匹配，但仍添加到列表中（非默认）
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": defaultJdkPath
                        });
                    }
                }
            }

            // 如果默认路径不存在或无效，尝试从环境变量中获取
            let jdkPath = process.env.JAVA_HOME || process.env.JDK_HOME;

            // 如果找到了JDK路径，返回配置
            if (jdkPath && fs.existsSync(jdkPath)) {
                // 验证是否包含java可执行文件
                const javaExecutable = path.join(jdkPath, 'bin', 'java.exe');
                if (fs.existsSync(javaExecutable)) {
                    // 使用新的方法获取Java版本
                    const runtimeName = JavaVersionUtils.getJavaVersionName(javaExecutable, this.outputChannel);
                    
                    // 检查是否已经添加了默认JDK
                    const hasDefault = javaRuntimes.some(runtime => runtime.default === true);
                    
                    // 如果版本匹配且还没有默认JDK，则将其设为默认
                    if (runtimeName === requiredJavaVersion && !hasDefault) {
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": jdkPath,
                            "default": true  // 将匹配的JDK设为默认
                        });
                    } else if (!javaRuntimes.some(runtime => runtime.path === jdkPath)) {
                        // 避免重复添加，且版本不匹配或已有默认JDK时作为普通JDK添加
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": jdkPath,
                            "default": !hasDefault  // 如果还没有默认JDK，则设为默认
                        });
                    }
                }
            }

            // 如果无法找到有效的JDK路径，返回空数组
            if (javaRuntimes.length === 0) {
                this.outputChannel.appendLine('无法找到有效的JDK路径');
            }
            
            return javaRuntimes;
        } catch (error) {
            this.outputChannel.appendLine(`获取Windows Java运行时配置失败: ${error}`);
            return [];
        }
    }
}