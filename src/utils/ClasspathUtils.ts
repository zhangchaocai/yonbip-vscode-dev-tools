import * as fs from 'fs';
import * as path from 'path';
import { ModuleConfigService } from './ModuleConfigService';
import * as vscode from 'vscode';

/**
 * 类路径工具类
 * 提供处理类路径相关的通用方法
 */
export class ClasspathUtils {
    /**
     * 获取指定路径下的所有classes目录路径
     * @param scanPath 要扫描的根路径
     * @returns 所有找到的classes目录路径数组
     */
    public static getClassesPaths(scanPath: string): string[] {
        const classesPaths: string[] = [];
        
        // 检查主classes目录
        const mainClassesPath = path.join(scanPath, 'classes');
        if (fs.existsSync(mainClassesPath) && fs.readdirSync(mainClassesPath).length > 0) {
            classesPaths.push(mainClassesPath);
        }
        
        return classesPaths;
    }

    /**
     * 获取指定模块路径下的所有可能的classes目录路径
     * @param modulePath 模块根路径
     * @returns 所有可能的classes目录路径数组
     */
    public static getModuleClassesPaths(modulePath: string): string[] {
        const classesPaths: string[] = [];
        
        // 查找模块下的各种classes路径
        const potentialClassesPaths = [
            // 主模块classes目录
            path.join(modulePath, 'classes'),
            // extension目录下的classes
            path.join(modulePath, 'extension', 'classes'),
            // hyext目录下的classes
            path.join(modulePath, 'hyext', 'classes'),
            // client目录下的classes
            path.join(modulePath, 'client', 'classes'),
            // client/extension目录下的classes
            path.join(modulePath, 'client', 'extension', 'classes'),
            // client/hyext目录下的classes
            path.join(modulePath, 'client', 'hyext', 'classes'),
            // META-INF目录下的classes
            path.join(modulePath, 'META-INF', 'classes'),
            // META-INF/extension目录下的classes
            path.join(modulePath, 'META-INF', 'extension', 'classes'),
            // META-INF/hyext目录下的classes
            path.join(modulePath, 'META-INF', 'hyext', 'classes')
        ];

        // 检查每个潜在的classes路径是否存在且不为空
        for (const classesPath of potentialClassesPaths) {
            if (fs.existsSync(classesPath) && fs.readdirSync(classesPath).length > 0) {
                classesPaths.push(classesPath);
            }
        }

        return classesPaths;
    }

    /**
     * 获取指定模块路径下的lib目录路径（使用通配符形式）
     * @param modulePath 模块根路径
     * @returns lib目录路径数组（如果存在jar文件）
     */
    public static getModuleLibPaths(modulePath: string): string[] {
        const libPaths: string[] = [];
        
        // 检查模块lib目录
        const moduleLibDir = path.join(modulePath, 'lib');
        if (fs.existsSync(moduleLibDir)) {
            try {
                // 检查模块lib目录中是否有jar文件
                const files = fs.readdirSync(moduleLibDir);
                const hasJars = files.some(file => file.endsWith('.jar'));
                
                // 如果有jar文件，使用通配符形式添加整个目录
                if (hasJars) {
                    libPaths.push(path.join(moduleLibDir, '*'));
                }
            } catch (error) {
                // 忽略读取错误
            }
        }

        return libPaths;
    }

    /**
     * 获取所有模块下的classes路径
     * @param homePath NC HOME路径
     * @param context VSCode扩展上下文（可选，用于获取模块配置）
     * @returns 所有模块的classes路径数组
     */
    public static getAllModuleClassesPaths(homePath: string, context?: vscode.ExtensionContext): string[] {
        const classesPaths: string[] = [];
        const modulesPath = path.join(homePath, 'modules');

        // 检查modules目录是否存在
        if (!fs.existsSync(modulesPath)) {
            return classesPaths;
        }

        try {
            // 读取所有模块目录
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            // 如果提供了context，则过滤未启用的模块
            let enabledModules = moduleDirs;
            if (context) {
                try {
                    const moduleConfigService = new ModuleConfigService(context);
                    const enabledModuleCodes = moduleConfigService.getEnabledModuleCodes(homePath);
                    enabledModules = moduleDirs.filter(moduleDir => enabledModuleCodes.includes(moduleDir));
                } catch (error) {
                    // 如果获取模块配置失败，则使用所有模块
                    console.warn('获取模块配置失败，将加载所有模块:', error);
                    enabledModules = moduleDirs;
                }
            }

            // 遍历每个启用的模块目录，查找classes路径
            for (const moduleName of enabledModules) {
                const modulePath = path.join(modulesPath, moduleName);
                const moduleClassesPaths = this.getModuleClassesPaths(modulePath);
                classesPaths.push(...moduleClassesPaths);
            }
        } catch (error) {
            // 忽略错误，返回已找到的路径
        }

        return classesPaths;
    }

    /**
     * 获取所有模块下的lib路径（使用通配符形式）
     * @param homePath NC HOME路径
     * @param context VSCode扩展上下文（可选，用于获取模块配置）
     * @returns 所有模块的lib路径数组
     */
    public static getAllModuleLibPaths(homePath: string, context?: vscode.ExtensionContext): string[] {
        const libPaths: string[] = [];
        const modulesPath = path.join(homePath, 'modules');

        // 检查modules目录是否存在
        if (!fs.existsSync(modulesPath)) {
            return libPaths;
        }

        try {
            // 读取所有模块目录
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            // 如果提供了context，则过滤未启用的模块
            let enabledModules = moduleDirs;
            if (context) {
                try {
                    const moduleConfigService = new ModuleConfigService(context);
                    const enabledModuleCodes = moduleConfigService.getEnabledModuleCodes(homePath);
                    enabledModules = moduleDirs.filter(moduleDir => enabledModuleCodes.includes(moduleDir));
                } catch (error) {
                    // 如果获取模块配置失败，则使用所有模块
                    console.warn('获取模块配置失败，将加载所有模块:', error);
                    enabledModules = moduleDirs;
                }
            }

            // 遍历每个启用的模块目录，查找lib路径
            for (const moduleName of enabledModules) {
                const modulePath = path.join(modulesPath, moduleName);
                const moduleLibPaths = this.getModuleLibPaths(modulePath);
                libPaths.push(...moduleLibPaths);
            }
        } catch (error) {
            // 忽略错误，返回已找到的路径
        }

        return libPaths;
    }
}