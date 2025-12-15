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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MacHomeConversionService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
class MacHomeConversionService {
    configService;
    static outputChannelInstance = null;
    outputChannel;
    constructor(configService) {
        this.configService = configService;
        if (!MacHomeConversionService.outputChannelInstance) {
            MacHomeConversionService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP Mac HOME转换');
        }
        this.outputChannel = MacHomeConversionService.outputChannelInstance;
    }
    async convertToMacHome(homePath) {
        try {
            this.outputChannel.appendLine('开始执行Mac HOME转换...');
            this.outputChannel.show();
            await this.extractJarshJar(homePath);
            await this.replaceSysConfigSh(homePath);
            await this.replaceUapSetupCmdLineSh(homePath);
            await this.setPermissions(homePath);
            this.outputChannel.appendLine('Mac HOME转换完成！');
            vscode.window.showInformationMessage('Mac HOME转换完成！');
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`Mac HOME转换失败: ${error.message}`);
            vscode.window.showErrorMessage(`Mac HOME转换失败: ${error.message}`);
            return false;
        }
    }
    async extractJarshJar(homePath) {
        this.outputChannel.appendLine('正在解压jarsh.jar...');
        const jarshJarPath = path.join(homePath, 'bin', 'jarsh.jar');
        const binPath = path.join(homePath, 'bin');
        if (!fs.existsSync(jarshJarPath)) {
            throw new Error(`未找到jarsh.jar文件: ${jarshJarPath}`);
        }
        try {
            const zip = new adm_zip_1.default(jarshJarPath);
            zip.extractAllTo(binPath, true);
            this.outputChannel.appendLine('jarsh.jar解压完成');
        }
        catch (error) {
            throw new Error(`解压jarsh.jar失败: ${error.message}`);
        }
    }
    async replaceSysConfigSh(homePath) {
        this.outputChannel.appendLine('正在替换sysConfig.sh文件...');
        const extensionPath = vscode.extensions.getExtension('zhang-chaocai.yonbip-devtool')?.extensionPath;
        if (!extensionPath) {
            throw new Error('无法获取扩展路径');
        }
        const sourceSysConfigPath = path.join(extensionPath, 'resources', 'sysconfig', 'sysConfig.sh');
        const targetSysConfigPath = path.join(homePath, 'bin', 'sysConfig.sh');
        if (!fs.existsSync(sourceSysConfigPath)) {
            throw new Error(`未找到源sysConfig.sh文件: ${sourceSysConfigPath}`);
        }
        let content = fs.readFileSync(sourceSysConfigPath, 'utf-8');
        const jdkPath = await this.getJdkPath();
        content = content.replace('替换为用户的jdk路径', jdkPath);
        fs.writeFileSync(targetSysConfigPath, content, 'utf-8');
        this.outputChannel.appendLine(`sysConfig.sh文件已替换: ${targetSysConfigPath}`);
        this.outputChannel.appendLine(`JDK路径设置为: ${jdkPath}`);
    }
    async replaceUapSetupCmdLineSh(homePath) {
        this.outputChannel.appendLine('正在替换uapSetupCmdLine.sh文件...');
        const extensionPath = vscode.extensions.getExtension('zhang-chaocai.yonbip-devtool')?.extensionPath;
        if (!extensionPath) {
            throw new Error('无法获取扩展路径');
        }
        const sourceUapSetupCmdLinePath = path.join(extensionPath, 'resources', 'sysconfig', 'uapSetupCmdLine.sh');
        const targetUapSetupCmdLinePath = path.join(homePath, 'bin', 'uapSetupCmdLine.sh');
        if (!fs.existsSync(sourceUapSetupCmdLinePath)) {
            throw new Error(`未找到源uapSetupCmdLine.sh文件: ${sourceUapSetupCmdLinePath}`);
        }
        let content = fs.readFileSync(sourceUapSetupCmdLinePath, 'utf-8');
        fs.writeFileSync(targetUapSetupCmdLinePath, content, 'utf-8');
        this.outputChannel.appendLine(`uapSetupCmdLine.sh文件已替换: ${targetUapSetupCmdLinePath}`);
    }
    async getJdkPath() {
        let jdkPath = process.env.JAVA_HOME || process.env.JDK_HOME;
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
        if (!jdkPath) {
            try {
                const { execSync } = require('child_process');
                const javaPath = execSync('which java', { encoding: 'utf-8' }).trim();
                if (javaPath) {
                    if (javaPath.includes('/bin/java')) {
                        jdkPath = javaPath.replace(/\/bin\/java$/, '');
                    }
                    else {
                        const javaProperties = execSync('java -XshowSettings:properties -version 2>&1', { encoding: 'utf-8' });
                        const javaHomeMatch = javaProperties.match(/java\.home = (.+)/);
                        if (javaHomeMatch && javaHomeMatch[1]) {
                            jdkPath = javaHomeMatch[1].trim();
                        }
                    }
                }
            }
            catch (error) {
                this.outputChannel.appendLine(`获取Java路径时出错: ${error}`);
            }
        }
        if (!jdkPath) {
            throw new Error('无法自动检测到JDK路径，请确保已正确安装JDK并设置环境变量(JAVA_HOME或JDK_HOME)');
        }
        if (!fs.existsSync(jdkPath)) {
            throw new Error(`检测到的JDK路径不存在: ${jdkPath}`);
        }
        const javaExecutable = path.join(jdkPath, 'bin', 'java');
        if (!fs.existsSync(javaExecutable)) {
            throw new Error(`JDK路径中未找到java可执行文件: ${javaExecutable}`);
        }
        return jdkPath;
    }
    async setPermissions(homePath) {
        this.outputChannel.appendLine('正在设置文件权限...');
        const binPath = path.join(homePath, 'bin');
        const antPath = path.join(homePath, 'ant');
        if (fs.existsSync(antPath)) {
            try {
                await this.executeCommand(`chmod -R 777 "${antPath}"`);
                this.outputChannel.appendLine(`已设置${antPath}权限为777`);
            }
            catch (error) {
                this.outputChannel.appendLine(`警告：设置${antPath}权限失败: ${error}`);
            }
        }
        else {
            this.outputChannel.appendLine(`警告：${antPath}目录不存在，跳过权限设置`);
        }
        if (fs.existsSync(binPath)) {
            try {
                await this.executeCommand(`chmod u+x "${binPath}"/*.sh`);
                this.outputChannel.appendLine(`已设置${binPath}/*.sh执行权限`);
            }
            catch (error) {
                this.outputChannel.appendLine(`警告：设置${binPath}/*.sh执行权限失败: ${error}`);
            }
        }
        else {
            this.outputChannel.appendLine(`警告：${binPath}目录不存在，跳过权限设置`);
        }
    }
    async executeCommand(command) {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`执行命令失败: ${error.message}\nstderr: ${stderr}`));
                }
                else {
                    resolve();
                }
            });
        });
    }
    showOutput() {
        this.outputChannel.show();
    }
    dispose() {
        if (MacHomeConversionService.outputChannelInstance) {
            MacHomeConversionService.outputChannelInstance.dispose();
            MacHomeConversionService.outputChannelInstance = null;
        }
    }
}
exports.MacHomeConversionService = MacHomeConversionService;
//# sourceMappingURL=MacHomeConversionService.js.map