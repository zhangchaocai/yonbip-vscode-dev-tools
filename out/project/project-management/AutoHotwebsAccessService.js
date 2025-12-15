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
exports.AutoHotwebsAccessService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class AutoHotwebsAccessService {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    validateScaffoldDirectory(directoryPath) {
        const configJsonPath = path.join(directoryPath, 'config.json');
        if (!fs.existsSync(configJsonPath)) {
            return { valid: false, message: '目录下缺少config.json文件，请选择前端项目根目录' };
        }
        const packageJsonPath = path.join(directoryPath, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            return { valid: false, message: '目录下缺少package.json文件，请选择前端项目根目录' };
        }
        const srcPath = path.join(directoryPath, 'src');
        if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isDirectory()) {
            return { valid: false, message: '目录下缺少src文件夹，请选择前端项目根目录' };
        }
        const webpackConfigPath = path.join(directoryPath, 'config', 'webpack.dev.config.js');
        if (!fs.existsSync(webpackConfigPath)) {
            return { valid: false, message: '目录下缺少src/webpack.dev.config.js文件，请选择前端项目根目录' };
        }
        return { valid: true, message: '目录验证通过' };
    }
    async autoAccessHotwebsResources(directoryPath) {
        try {
            const validationResult = this.validateScaffoldDirectory(directoryPath);
            if (!validationResult.valid) {
                vscode.window.showErrorMessage(`目录验证失败: ${validationResult.message}`);
                return;
            }
            const config = this.configService.getConfig();
            if (!config.homePath) {
                vscode.window.showErrorMessage('请先配置NC HOME路径');
                return;
            }
            const webpackConfigPath = path.join(directoryPath, 'config', 'webpack.dev.config.js');
            let webpackConfigContent = fs.readFileSync(webpackConfigPath, 'utf-8');
            const replacementContent = `contentBase: configJSON.localHomePath ? path.join(configJSON.localHomePath,
		'/hotwebs/nccloud/resources') : path.join(__dirname, \`../\${srcDir}\`)`;
            const originalContent = `contentBase: path.join(__dirname, \`../\${srcDir}\`)`;
            webpackConfigContent = webpackConfigContent.replace(originalContent, replacementContent);
            fs.writeFileSync(webpackConfigPath, webpackConfigContent, 'utf-8');
            const configJsonPath = path.join(directoryPath, 'config.json');
            let configJsonContent = {};
            if (fs.existsSync(configJsonPath)) {
                const configJsonString = fs.readFileSync(configJsonPath, 'utf-8');
                configJsonContent = JSON.parse(configJsonString);
            }
            configJsonContent.localHomePath = config.homePath;
            fs.writeFileSync(configJsonPath, JSON.stringify(configJsonContent, null, 2), 'utf-8');
            vscode.window.showInformationMessage('自动访问HOTWEBS资源配置完成！');
        }
        catch (error) {
            vscode.window.showErrorMessage(`自动访问HOTWEBS资源失败: ${error.message}`);
            throw error;
        }
    }
}
exports.AutoHotwebsAccessService = AutoHotwebsAccessService;
//# sourceMappingURL=AutoHotwebsAccessService.js.map