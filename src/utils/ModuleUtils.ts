import * as fs from 'fs';
import * as path from 'path';

/**
 * 模块信息接口
 */
export interface ModuleInfo {
    code: string;
    name: string;
    must: boolean;
    enabled: boolean;
}

/**
 * 模块配置信息接口
 */
export interface ModuleConfigInfo {
    code: string;
    name: string;
    must: boolean;
}

/**
 * 模块工具类
 * 提供处理模块相关的通用方法
 */
export class ModuleUtils {
    /**
     * 获取home/modules下所有模块的编码
     * @param homePath NC HOME路径
     * @returns 模块编码数组
     */
    public static getAllModuleCodes(homePath: string): string[] {
        const moduleCodes: string[] = [];
        const modulesPath = path.join(homePath, 'modules');

        // 检查modules目录是否存在
        if (!fs.existsSync(modulesPath)) {
            return moduleCodes;
        }

        try {
            // 读取所有模块目录
            const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            moduleCodes.push(...moduleDirs);
        } catch (error) {
            // 忽略错误，返回已找到的模块
            console.error('读取模块目录失败:', error);
        }

        return moduleCodes;
    }

    /**
     * 读取模块配置文件
     * @param configFilePath 配置文件路径
     * @returns 模块配置信息数组
     */
    public static readModuleConfig(configFilePath: string): ModuleConfigInfo[] {
        const moduleConfigs: ModuleConfigInfo[] = [];

        if (!fs.existsSync(configFilePath)) {
            return moduleConfigs;
        }

        try {
            const content = fs.readFileSync(configFilePath, 'utf-8');
            const configData = JSON.parse(content);

            // 遍历配置数据，提取模块信息
            if (Array.isArray(configData)) {
                for (const group of configData) {
                    if (group.modules && Array.isArray(group.modules)) {
                        for (const module of group.modules) {
                            moduleConfigs.push({
                                code: module.code,
                                name: module.name || '',
                                must: module.must || false
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('读取模块配置文件失败:', error);
        }

        return moduleConfigs;
    }

    /**
     * 构建模块信息数组
     * @param homePath NC HOME路径
     * @param configFilePath 配置文件路径
     * @returns 模块信息数组
     */
    public static buildModuleInfos(homePath: string, configFilePath: string): ModuleInfo[] {
        const moduleInfos: ModuleInfo[] = [];
        
        // 获取所有模块编码
        const moduleCodes = this.getAllModuleCodes(homePath);
        
        // 读取模块配置
        const moduleConfigs = this.readModuleConfig(configFilePath);
        
        // 创建配置映射，便于查找
        const configMap = new Map<string, ModuleConfigInfo>();
        moduleConfigs.forEach(config => {
            configMap.set(config.code, config);
        });

        // 构建模块信息
        for (const code of moduleCodes) {
            const config = configMap.get(code);
            moduleInfos.push({
                code: code,
                name: config?.name || '',
                must: config?.must || false,
                enabled: true // 默认全部勾选
            });
        }

        return moduleInfos;
    }

    /**
     * 过滤启用的模块编码
     * @param moduleInfos 模块信息数组
     * @returns 启用的模块编码数组
     */
    public static getEnabledModuleCodes(moduleInfos: ModuleInfo[]): string[] {
        return moduleInfos
            .filter(module => module.enabled)
            .map(module => module.code);
    }

    /**
     * 检查模块是否为必选模块
     * @param moduleCode 模块编码
     * @param moduleInfos 模块信息数组
     * @returns 是否为必选模块
     */
    public static isRequiredModule(moduleCode: string, moduleInfos: ModuleInfo[]): boolean {
        const module = moduleInfos.find(m => m.code === moduleCode);
        return module?.must || false;
    }
}