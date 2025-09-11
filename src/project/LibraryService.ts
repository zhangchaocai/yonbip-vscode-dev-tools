import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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

    private outputChannel: vscode.OutputChannel;

    private context?: vscode.ExtensionContext;

    constructor(context?: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('YonBIP Library Service');
        this.context = context;
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
     * 初始化库
     */
    public async initLibrary(homePath: string, needDbLibrary: boolean = false, driverLibPath?: string): Promise<void> {
        this.outputChannel.appendLine(`开始初始化库，HOME路径: ${homePath}`);
        
        try {
            // 验证HOME路径
            if (!this.validateHomePath(homePath)) {
                throw new Error('无效的HOME路径');
            }

            // 获取工作区文件夹
            const workspaceFolder = this.getWorkspaceFolder();
            if (!workspaceFolder) {
                throw new Error('未找到工作区文件夹');
            }

            // 创建.lib目录用于存储库配置
            const libDir = path.join(workspaceFolder.uri.fsPath, '.lib');
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
            await this.updateVSCodeSettings(libDir);
            
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
    private async updateVSCodeSettings(libDir: string): Promise<void> {
        const workspaceConfig = vscode.workspace.getConfiguration();
        
        // 获取所有库配置文件
        const libraryConfigs = fs.readdirSync(libDir)
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const configPath = path.join(libDir, file);
                return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            });

        // 构建Java配置
        const javaConfig = {
            'java.project.referencedLibraries': libraryConfigs.flatMap((config: LibraryConfig) => config.paths),
            'java.project.sourcePaths': ['src'],
            'java.project.outputPath': 'bin'
        };

        // 更新配置
        for (const [key, value] of Object.entries(javaConfig)) {
            await workspaceConfig.update(key, value, vscode.ConfigurationTarget.Workspace);
        }

        this.outputChannel.appendLine('VSCode Java配置已更新');
    }

    /**
     * 从配置文件获取HOME路径
     */
    private getHomePathFromConfigFile(): string | undefined {
        try {
            // 检查全局存储路径的配置文件
            const globalStoragePath = this.context?.globalStoragePath || 
                                    path.join(require('os').homedir(), '.vscode', 'yonbip-devtool');
            const configFilePath = path.join(globalStoragePath, 'nc-home-config.json');
            
            if (fs.existsSync(configFilePath)) {
                const config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
                this.outputChannel.appendLine(`从配置文件获取HOME路径: ${config.homePath || '未找到'}`);
                return config.homePath;
            } else {
                this.outputChannel.appendLine(`配置文件不存在: ${configFilePath}`);
            }
            
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
}