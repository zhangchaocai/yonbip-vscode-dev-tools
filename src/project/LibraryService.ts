import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NCHomeConfigService } from './NCHomeConfigService';

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

            // 根据HOME版本获取对应的脚手架路径
            const scaffoldPath = this.getScaffoldPathByHomeVersion(homePath);
            if (scaffoldPath && fs.existsSync(scaffoldPath)) {
                // 如果有版本对应的脚手架，则复制对应的脚手架
                this.outputChannel.appendLine(`复制版本对应的脚手架: ${scaffoldPath}`);
                await this.copyScaffold(scaffoldPath, targetPath);
            } else {
                this.outputChannel.appendLine('使用默认脚手架处理逻辑');
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

            // 生成VSCode的settings.json更新
            await this.updateVSCodeSettings(libDir, targetPath);

            // 生成launch.json配置用于调试Java代码
            await this.generateLaunchConfiguration(targetPath, libDir);

            // 修复：生成Eclipse项目文件时传递正确的路径参数
            await this.generateEclipseProjectFiles(homePath, targetPath);

            // 只有在通过ProjectContextCommands调用时才创建标记文件
            // 当通过LibraryCommands直接调用时不创建标记文件，避免重复创建
            if (selectedPath) {
                // 创建标记文件来标识已初始化的项目（修复图标消失问题）
                const markerFilePath = path.join(targetPath, '.yonbip-project');
                this.outputChannel.appendLine(`创建标记文件: ${markerFilePath}`);

                try {
                    fs.writeFileSync(markerFilePath, 'This directory is initialized as a YonBIP project.');
                    this.outputChannel.appendLine('标记文件创建成功');
                } catch (error) {
                    this.outputChannel.appendLine(`创建标记文件失败: ${error}`);
                }
            }

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

        // 获取classes目录
        const classesPath = path.join(scanPath, 'classes');
        if (fs.existsSync(classesPath) && fs.readdirSync(classesPath).length > 0) {
            pathList.push(classesPath);
        }

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
        if (fs.existsSync(projectFilePath)) {
            this.outputChannel.appendLine('.project 文件已存在，跳过生成');
            return;
        }

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
        if (fs.existsSync(classpathFilePath)) {
            this.outputChannel.appendLine('.classpath 文件已存在，跳过生成');
            return;
        }

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

        // 确保使用正斜杠路径分隔符
        const normalizedRelativePath = relativePath.split(path.sep).join('/');

        // 如果是当前目录('.')，则不添加前缀
        // const srcPath = normalizedRelativePath === '.' ? 'src' : `${normalizedRelativePath}/src`;
        // const binPath = normalizedRelativePath === '.' ? 'bin' : `${normalizedRelativePath}/bin`;
        const srcPath = normalizedRelativePath === '.' ? 'src' : `src`;
        // 生成 .classpath 文件内容
        let classpathContent = `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
    <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>
    <classpathentry kind="src" path="${srcPath}/client"/>
    <classpathentry kind="src" path="${srcPath}/private"/>
    <classpathentry kind="src" path="${srcPath}/public"/>
    <classpathentry kind="output" path="build/classes"/>`;

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
        this.outputChannel.appendLine('.classpath 文件已生成，包含 ' + jarPaths.length + ' 个jar文件');
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
            // 优先检查工作区目录下的配置文件
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

            // 如果工作区目录下没有配置文件，检查全局存储路径的配置文件
            const globalStoragePath = this.context?.globalStoragePath ||
                path.join(require('os').homedir(), '.vscode', 'yonbip-devtool');
            const configFilePath = path.join(globalStoragePath, 'nc-home-config.json');

            if (fs.existsSync(configFilePath)) {
                const config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
                this.outputChannel.appendLine(`从全局配置文件获取HOME路径: ${config.homePath || '未找到'}`);
                return config.homePath;
            } else {
                this.outputChannel.appendLine(`全局配置文件不存在: ${configFilePath}`);
            }

            return undefined;
        } catch (error) {
            this.outputChannel.appendLine(`读取配置文件失败: ${error}`);
            return undefined;
        }
    }

    /**
     * 从setup.ini文件中获取HOME版本信息
     * @param homePath NC HOME路径
     * @returns 版本号，如果无法获取则返回null
     */
    private getHomeVersion(homePath: string): string | null {
        try {
            // 构建setup.ini文件路径
            const setupIniPath = path.join(homePath, 'ncscript', 'uapServer', 'setup.ini');

            // 检查文件是否存在
            if (!fs.existsSync(setupIniPath)) {
                this.outputChannel.appendLine(`setup.ini文件不存在: ${setupIniPath}`);
                return null;
            }

            // 读取文件内容
            const content = fs.readFileSync(setupIniPath, 'utf-8');

            // 解析版本信息
            // 查找version=开头的行
            const versionMatch = content.match(/^version\s*=\s*(.+)$/m);
            if (!versionMatch) {
                this.outputChannel.appendLine('未在setup.ini中找到版本信息');
                return null;
            }

            const versionLine = versionMatch[1];
            this.outputChannel.appendLine(`从setup.ini中读取到版本信息: ${versionLine}`);

            // 解析版本字符串 "YonBIP V3 (R2_2311_1 Premium) 20230830171835"
            // 提取其中的 "2311" 部分
            const versionPattern = /R2_(\d+)_\d+/;
            const versionParts = versionLine.match(versionPattern);

            if (versionParts && versionParts[1]) {
                const version = versionParts[1];
                this.outputChannel.appendLine(`提取到版本号: ${version}`);
                return version;
            } else {
                this.outputChannel.appendLine('无法从版本字符串中提取版本号');
                return null;
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`读取setup.ini文件失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 根据HOME版本获取对应的脚手架路径
     * @param homePath NC HOME路径
     * @returns 脚手架路径
     */
    private getScaffoldPathByHomeVersion(homePath: string): string | null {
        const version = this.getHomeVersion(homePath);

        if (!version) {
            this.outputChannel.appendLine('无法获取HOME版本，使用默认脚手架路径');
            return null;
        }

        // 根据版本号确定脚手架路径
        // 这里可以根据实际需求进行调整
        const scaffoldPath = path.join(homePath, 'scaffolds', `v${version}`);

        if (fs.existsSync(scaffoldPath)) {
            this.outputChannel.appendLine(`使用版本对应的脚手架路径: ${scaffoldPath}`);
            return scaffoldPath;
        } else {
            this.outputChannel.appendLine(`版本对应的脚手架路径不存在: ${scaffoldPath}，使用默认脚手架路径`);
            return null;
        }
    }

    /**
     * 自动初始化库（如果配置了HOME路径）
     */
    public async autoInitLibrary(): Promise<void> {
        this.outputChannel.appendLine('=== 开始检查HOME路径配置 ===');

        // 检查不同作用域的配置
        const config = vscode.workspace.getConfiguration('yonbip');
        const homePath = config.get<string>('homePath');

        // 详细调试信息
        this.outputChannel.appendLine(`从yonbip配置获取的homePath: ${homePath || '未找到'}`);

        // 检查配置详情
        const inspect = config.inspect('homePath');
        if (inspect) {
            this.outputChannel.appendLine(`全局配置: ${inspect.globalValue || '未设置'}`);
            this.outputChannel.appendLine(`工作区配置: ${inspect.workspaceValue || '未设置'}`);
            this.outputChannel.appendLine(`工作区文件夹配置: ${inspect.workspaceFolderValue || '未设置'}`);
        }

        // 从配置文件获取HOME路径
        const configFileHomePath = this.getHomePathFromConfigFile();

        // 优先使用任何可用的配置
        let actualHomePath = homePath ||
            configFileHomePath ||
            inspect?.workspaceValue ||
            inspect?.workspaceFolderValue ||
            inspect?.globalValue;

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
}