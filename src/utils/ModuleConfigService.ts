import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleInfo, ModuleUtils } from './ModuleUtils';

/**
 * 模块配置服务
 * 负责管理模块选择状态的保存和读取
 */
export class ModuleConfigService {
    private context: vscode.ExtensionContext;
    private configFilePath: string;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.configFilePath = this.getConfigFilePath();
    }

    /**
     * 获取模块配置文件路径
     */
    private getConfigFilePath(): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return path.join(workspaceFolders[0].uri.fsPath, '.nc-module-config.json');
        } else {
            return path.join(this.context.extensionPath, '.nc-module-config.json');
        }
    }

    /**
     * 获取模块信息列表
     * @param homePath NC HOME路径
     * @returns 模块信息数组
     */
    public getModuleInfos(homePath: string): ModuleInfo[] {
        // 获取资源配置文件路径
        const resourceConfigPath = path.join(this.context.extensionPath, 'resources', 'configuration', 'module-config.json');
        
        // 构建基础模块信息
        const moduleInfos = ModuleUtils.buildModuleInfos(homePath, resourceConfigPath);
        
        // 加载用户的模块选择状态
        const savedConfig = this.loadModuleConfig();
        if (savedConfig) {
            // 应用保存的配置
            for (const moduleInfo of moduleInfos) {
                const savedModule = savedConfig.find(m => m.code === moduleInfo.code);
                if (savedModule) {
                    // 必选模块不能被禁用
                    moduleInfo.enabled = moduleInfo.must ? true : savedModule.enabled;
                }
            }
        }

        return moduleInfos;
    }

    /**
     * 保存模块配置
     * @param moduleInfos 模块信息数组
     */
    public async saveModuleConfig(moduleInfos: ModuleInfo[]): Promise<void> {
        try {
            const configData = moduleInfos.map(module => ({
                code: module.code,
                name: module.name,
                must: module.must,
                enabled: module.enabled
            }));

            const content = JSON.stringify(configData, null, 2);
            fs.writeFileSync(this.configFilePath, content, 'utf-8');
        } catch (error) {
            console.error('保存模块配置失败:', error);
            throw error;
        }
    }

    /**
     * 加载模块配置
     * @returns 模块信息数组或null
     */
    private loadModuleConfig(): ModuleInfo[] | null {
        try {
            if (fs.existsSync(this.configFilePath)) {
                const content = fs.readFileSync(this.configFilePath, 'utf-8');
                return JSON.parse(content) as ModuleInfo[];
            }
        } catch (error) {
            console.error('加载模块配置失败:', error);
        }
        return null;
    }

    /**
     * 获取启用的模块编码列表
     * @param homePath NC HOME路径
     * @returns 启用的模块编码数组
     */
    public getEnabledModuleCodes(homePath: string): string[] {
        const moduleInfos = this.getModuleInfos(homePath);
        return ModuleUtils.getEnabledModuleCodes(moduleInfos);
    }

    /**
     * 重置模块配置为默认值
     * @param homePath NC HOME路径
     */
    public async resetToDefault(homePath: string): Promise<void> {
        try {
            // 删除配置文件，下次加载时会使用默认配置
            if (fs.existsSync(this.configFilePath)) {
                fs.unlinkSync(this.configFilePath);
            }
        } catch (error) {
            console.error('重置模块配置失败:', error);
            throw error;
        }
    }

    /**
     * 检查模块是否启用
     * @param moduleCode 模块编码
     * @param homePath NC HOME路径
     * @returns 是否启用
     */
    public isModuleEnabled(moduleCode: string, homePath: string): boolean {
        const moduleInfos = this.getModuleInfos(homePath);
        const module = moduleInfos.find(m => m.code === moduleCode);
        return module?.enabled || false;
    }
}