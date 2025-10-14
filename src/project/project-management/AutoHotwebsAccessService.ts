import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';

/**
 * 自动访问HOTWEBS资源服务
 */
export class AutoHotwebsAccessService {
    private configService: NCHomeConfigService;

    constructor(configService: NCHomeConfigService) {
        this.configService = configService;
    }

    /**
     * 验证目录是否为脚手架目录
     * @param directoryPath 目录路径
     * @returns 验证结果
     */
    public validateScaffoldDirectory(directoryPath: string): { valid: boolean; message: string } {
        // 检查config.json文件
        const configJsonPath = path.join(directoryPath, 'config.json');
        if (!fs.existsSync(configJsonPath)) {
            return { valid: false, message: '目录下缺少config.json文件，请选择前端项目根目录' };
        }

        // 检查package.json文件
        const packageJsonPath = path.join(directoryPath, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            return { valid: false, message: '目录下缺少package.json文件，请选择前端项目根目录' };
        }

        // 检查src目录
        const srcPath = path.join(directoryPath, 'src');
        if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isDirectory()) {
            return { valid: false, message: '目录下缺少src文件夹，请选择前端项目根目录' };
        }

        // 检查src/config/webpack.dev.config.js文件
        const webpackConfigPath = path.join(directoryPath, 'config', 'webpack.dev.config.js');
        if (!fs.existsSync(webpackConfigPath)) {
            return { valid: false, message: '目录下缺少src/webpack.dev.config.js文件，请选择前端项目根目录' };
        }

        return { valid: true, message: '目录验证通过' };
    }

    /**
     * 自动访问HOTWEBS资源
     * @param directoryPath 目录路径
     */
    public async autoAccessHotwebsResources(directoryPath: string): Promise<void> {
        try {
            // 验证目录是否为脚手架目录
            const validationResult = this.validateScaffoldDirectory(directoryPath);
            if (!validationResult.valid) {
                vscode.window.showErrorMessage(`目录验证失败: ${validationResult.message}`);
                return;
            }

            // 检查是否配置了home信息
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showErrorMessage('请先配置NC HOME路径');
                return;
            }

            // 获取webpack配置文件路径
            const webpackConfigPath = path.join(directoryPath, 'config', 'webpack.dev.config.js');
            
            // 读取webpack配置文件内容
            let webpackConfigContent = fs.readFileSync(webpackConfigPath, 'utf-8');
            
            // 构建替换后的内容
            const replacementContent = `contentBase: configJSON.localHomePath ? path.join(configJSON.localHomePath,
		'/hotwebs/nccloud/resources') : path.join(__dirname, \`../\${srcDir}\`)`;
            
            // 替换contentBase配置
            const originalContent = `contentBase: path.join(__dirname, \`../\${srcDir}\`)`;
            webpackConfigContent = webpackConfigContent.replace(originalContent, replacementContent);
            
            // 写入修改后的内容
            fs.writeFileSync(webpackConfigPath, webpackConfigContent, 'utf-8');
            
            // 读取config.json文件
            const configJsonPath = path.join(directoryPath, 'config.json');
            let configJsonContent: any = {};
            
            if (fs.existsSync(configJsonPath)) {
                const configJsonString = fs.readFileSync(configJsonPath, 'utf-8');
                configJsonContent = JSON.parse(configJsonString);
            }
            
            // 添加localHomePath配置
            configJsonContent.localHomePath = config.homePath;
            
            // 写入修改后的config.json文件
            fs.writeFileSync(configJsonPath, JSON.stringify(configJsonContent, null, 2), 'utf-8');
            
            vscode.window.showInformationMessage('自动访问HOTWEBS资源配置完成！');
        } catch (error: any) {
            vscode.window.showErrorMessage(`自动访问HOTWEBS资源失败: ${error.message}`);
            throw error;
        }
    }
}