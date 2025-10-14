import * as fs from 'fs';
import * as path from 'path';

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
     * 获取所有模块下的classes路径
     * @param homePath NC HOME路径
     * @returns 所有模块的classes路径数组
     */
    public static getAllModuleClassesPaths(homePath: string): string[] {
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

            // 遍历每个模块目录，查找classes路径
            for (const moduleName of moduleDirs) {
                const modulePath = path.join(modulesPath, moduleName);
                const moduleClassesPaths = this.getModuleClassesPaths(modulePath);
                classesPaths.push(...moduleClassesPaths);
            }
        } catch (error) {
            // 忽略错误，返回已找到的路径
        }

        return classesPaths;
    }
}