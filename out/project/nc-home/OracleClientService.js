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
exports.OracleClientService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class OracleClientService {
    context;
    static outputChannelInstance = null;
    outputChannel;
    constructor(context) {
        this.context = context;
        if (!OracleClientService.outputChannelInstance) {
            OracleClientService.outputChannelInstance = vscode.window.createOutputChannel('Oracle Instant Client');
        }
        this.outputChannel = OracleClientService.outputChannelInstance;
    }
    async checkOracleClientInstalled() {
        this.outputChannel.appendLine('🔍 检查Oracle Instant Client是否已安装...');
        const envPaths = this.getOracleClientPathsFromEnv();
        for (const envPath of envPaths) {
            if (this.isOracleClientPathValid(envPath)) {
                this.outputChannel.appendLine(`✅ 在环境变量中找到有效的Oracle客户端: ${envPath}`);
                return { installed: true, path: envPath };
            }
        }
        const commonPaths = this.getCommonOracleClientPaths();
        for (const commonPath of commonPaths) {
            if (this.isOracleClientPathValid(commonPath)) {
                this.outputChannel.appendLine(`✅ 在常见路径中找到有效的Oracle客户端: ${commonPath}`);
                return { installed: true, path: commonPath };
            }
        }
        const systemLibPaths = this.getSystemLibraryPaths();
        for (const libPath of systemLibPaths) {
            if (this.isOracleClientPathValid(libPath)) {
                this.outputChannel.appendLine(`✅ 在系统库路径中找到有效的Oracle客户端: ${libPath}`);
                return { installed: true, path: libPath };
            }
        }
        this.outputChannel.appendLine('❌ 未找到有效的Oracle客户端');
        return { installed: false };
    }
    getOracleClientPathsFromEnv() {
        const paths = [];
        if (process.env.ORACLE_HOME) {
            paths.push(process.env.ORACLE_HOME);
        }
        if (process.env.ORACLE_BASE) {
            paths.push(path.join(process.env.ORACLE_BASE, 'instantclient'));
        }
        if (process.env.LD_LIBRARY_PATH) {
            const ldPaths = process.env.LD_LIBRARY_PATH.split(':');
            paths.push(...ldPaths);
        }
        if (process.env.DYLD_LIBRARY_PATH) {
            const dyldPaths = process.env.DYLD_LIBRARY_PATH.split(':');
            paths.push(...dyldPaths);
        }
        if (process.env.PATH) {
            const pathDirs = process.env.PATH.split(path.delimiter);
            paths.push(...pathDirs);
        }
        return paths;
    }
    getCommonOracleClientPaths() {
        const paths = [];
        if (process.platform === 'darwin') {
            paths.push('/opt/oracle/instantclient_23_3');
            paths.push('/opt/oracle/instantclient_21_8');
            paths.push('/opt/oracle/instantclient_19_17');
            paths.push('/usr/local/oracle/instantclient_23_3');
            paths.push('/usr/local/oracle/instantclient_21_8');
            paths.push('/usr/local/oracle/instantclient_19_17');
            paths.push('/opt/homebrew/lib');
        }
        else if (process.platform === 'win32') {
            paths.push('C:\\oracle\\instantclient_23_3');
            paths.push('C:\\oracle\\instantclient_21_8');
            paths.push('C:\\oracle\\instantclient_19_17');
            paths.push('C:\\Program Files\\Oracle\\instantclient_23_3');
            paths.push('C:\\Program Files\\Oracle\\instantclient_21_8');
            paths.push('C:\\Program Files\\Oracle\\instantclient_19_17');
        }
        else {
            paths.push('/opt/oracle/instantclient_23_3');
            paths.push('/opt/oracle/instantclient_21_8');
            paths.push('/opt/oracle/instantclient_19_17');
            paths.push('/usr/lib/oracle/instantclient_23_3');
            paths.push('/usr/lib/oracle/instantclient_21_8');
            paths.push('/usr/lib/oracle/instantclient_19_17');
        }
        return paths;
    }
    getSystemLibraryPaths() {
        const paths = [];
        if (process.platform === 'darwin') {
            paths.push('/usr/lib');
            paths.push('/usr/local/lib');
            paths.push('/opt/homebrew/lib');
        }
        else if (process.platform === 'win32') {
            paths.push('C:\\Windows\\System32');
        }
        else {
            paths.push('/usr/lib');
            paths.push('/usr/lib64');
            paths.push('/lib');
            paths.push('/lib64');
        }
        return paths;
    }
    isOracleClientPathValid(clientPath) {
        if (!clientPath || !fs.existsSync(clientPath)) {
            return false;
        }
        try {
            const files = fs.readdirSync(clientPath);
            if (process.platform === 'darwin') {
                return files.some(file => file.startsWith('libclntsh.dylib'));
            }
            else if (process.platform === 'win32') {
                return files.includes('oci.dll');
            }
            else {
                return files.some(file => file.startsWith('libclntsh.so'));
            }
        }
        catch (error) {
            return false;
        }
    }
    async promptInstallOracleClient() {
        const result = await vscode.window.showInformationMessage('检测到您尚未安装Oracle Instant Client，这将影响Oracle数据库连接功能。是否现在安装？', '安装', '取消');
        if (result === '安装') {
            return await this.installOracleClient();
        }
        return false;
    }
    async installOracleClient() {
        this.outputChannel.show();
        this.outputChannel.appendLine('🚀 开始安装Oracle Instant Client...');
        try {
            const installGuide = this.getInstallGuide();
            this.outputChannel.appendLine(installGuide);
            const downloadUrl = this.getDownloadUrl();
            this.outputChannel.appendLine(`📥 下载地址: ${downloadUrl}`);
            vscode.env.openExternal(vscode.Uri.parse(downloadUrl));
            vscode.window.showInformationMessage('请根据上述指南下载并安装Oracle Instant Client，安装完成后请重启VS Code。', '查看指南', '关闭').then(selection => {
                if (selection === '查看指南') {
                    this.outputChannel.show();
                }
            });
            return true;
        }
        catch (error) {
            this.outputChannel.appendLine(`❌ 安装过程中出现错误: ${error.message}`);
            vscode.window.showErrorMessage(`安装失败: ${error.message}`);
            return false;
        }
    }
    getInstallGuide() {
        let guide = '\n📋 Oracle Instant Client 安装指南\n';
        guide += '===============================\n\n';
        if (process.platform === 'darwin') {
            guide += '🍎 macOS 安装步骤:\n';
            guide += '1. 访问Oracle官网下载页面\n';
            guide += '2. 下载适用于macOS的Instant Client Basic包\n';
            guide += '3. 解压到目录，例如: /opt/oracle/instantclient_21_8\n';
            guide += '4. 创建符号链接:\n';
            guide += '   cd /opt/oracle/instantclient_21_8\n';
            guide += '   ln -s libclntsh.dylib.* libclntsh.dylib\n';
            guide += '5. 设置环境变量:\n';
            guide += '   export DYLD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$DYLD_LIBRARY_PATH\n\n';
        }
        else if (process.platform === 'win32') {
            guide += '🪟 Windows 安装步骤:\n';
            guide += '1. 访问Oracle官网下载页面\n';
            guide += '2. 下载适用于Windows的Instant Client Basic包\n';
            guide += '3. 解压到目录，例如: C:\\oracle\\instantclient_21_8\n';
            guide += '4. 将该目录添加到系统PATH环境变量中\n\n';
        }
        else {
            guide += '🐧 Linux 安装步骤:\n';
            guide += '1. 访问Oracle官网下载页面\n';
            guide += '2. 下载适用于Linux的Instant Client Basic包\n';
            guide += '3. 解压到目录，例如: /opt/oracle/instantclient_21_8\n';
            guide += '4. 设置环境变量:\n';
            guide += '   export LD_LIBRARY_PATH=/opt/oracle/instantclient_21_8:$LD_LIBRARY_PATH\n\n';
        }
        guide += '🔗 安装完成后，建议重启VS Code以确保环境变量生效。\n';
        return guide;
    }
    getDownloadUrl() {
        return 'https://www.oracle.com/database/technologies/instant-client.html';
    }
    showOutput() {
        this.outputChannel.show();
    }
    dispose() {
        if (OracleClientService.outputChannelInstance) {
            OracleClientService.outputChannelInstance.dispose();
            OracleClientService.outputChannelInstance = null;
        }
    }
}
exports.OracleClientService = OracleClientService;
//# sourceMappingURL=OracleClientService.js.map