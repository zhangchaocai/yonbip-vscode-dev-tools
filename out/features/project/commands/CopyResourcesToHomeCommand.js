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
exports.CopyResourcesToHomeCommand = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
class CopyResourcesToHomeCommand {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    static registerCommand(context, configService) {
        const command = new CopyResourcesToHomeCommand(configService);
        const copyCommand = vscode.commands.registerCommand('yonbip.project.copyResourcesToHome', async (uri) => {
            await command.copyResourcesToHome(uri);
        });
        context.subscriptions.push(copyCommand);
    }
    async copyResourcesToHome(uri) {
        try {
            let selectedPath;
            if (!uri) {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: '选择项目目录'
                });
                if (!result || result.length === 0) {
                    return;
                }
                selectedPath = result[0].fsPath;
            }
            else {
                selectedPath = uri.fsPath;
            }
            const config = this.configService.getConfig();
            const homePath = config.homePath;
            if (!homePath) {
                vscode.window.showWarningMessage('请先配置NC HOME路径');
                return;
            }
            const eol = os.EOL;
            const confirm = await vscode.window.showWarningMessage(`将复制项目资源到${eol}HOME目录：${homePath}${eol}源目录为：${selectedPath}${eol}是否继续？`, '继续', '取消');
            if (confirm !== '继续') {
                return;
            }
            let copyInfo = { targetPaths: [], copiedFiles: [] };
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在复制资源到HOME目录...',
                cancellable: false
            }, async () => {
                copyInfo = await this.copyResources(selectedPath, homePath);
            });
            let message = '资源复制完成！';
            if (copyInfo.targetPaths.length > 0) {
                message += `\n目标路径: ${copyInfo.targetPaths.join(', ')}`;
            }
            if (copyInfo.copiedFiles.length > 0) {
                message += `\n复制的文件: ${copyInfo.copiedFiles.join(', ')}`;
            }
            if (copyInfo.copiedFiles.length > 0) {
                vscode.window.showInformationMessage(message);
            }
        }
        catch (error) {
            console.error('复制资源失败:', error);
            vscode.window.showErrorMessage(`复制资源失败: ${error.message}`);
        }
    }
    async copyResources(sourcePath, homePath) {
        const targetPaths = [];
        const copiedFiles = [];
        const metaInfPaths = this.findMetaInfPaths(sourcePath);
        if (metaInfPaths.length === 0) {
            vscode.window.showWarningMessage('未找到META-INF目录');
            return { targetPaths, copiedFiles };
        }
        for (const metaInfPath of metaInfPaths) {
            const projectPath = path.dirname(metaInfPath);
            const moduleInfo = this.getModuleNameFromModuleXml(projectPath);
            if (moduleInfo) {
                const targetPath = path.join(homePath, 'modules', moduleInfo.name, 'META-INF');
                targetPaths.push(targetPath);
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                const files = fs.readdirSync(metaInfPath);
                for (const file of files) {
                    if (file.endsWith('.rest') || file.endsWith('.upm')) {
                        const sourceFilePath = path.join(metaInfPath, file);
                        const targetFilePath = path.join(targetPath, file);
                        fs.copyFileSync(sourceFilePath, targetFilePath);
                        copiedFiles.push(file);
                    }
                }
            }
            else {
                vscode.window.showWarningMessage(`在 ${projectPath} 中未找到有效的module.xml文件`);
            }
        }
        const yyconfigPaths = this.findYyconfigPaths(sourcePath);
        for (const yyconfigPath of yyconfigPaths) {
            const targetPath = path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF', 'extend', 'yyconfig');
            targetPaths.push(targetPath);
            const files = this.collectFilesInDirectory(yyconfigPath);
            copiedFiles.push(...files.map(file => path.basename(file)));
            await this.copyDirectory(yyconfigPath, targetPath);
        }
        return { targetPaths, copiedFiles };
    }
    findMetaInfPaths(selectedPath) {
        const metaInfPaths = [];
        const metaInfDir = path.join(selectedPath, 'META-INF');
        if (fs.existsSync(metaInfDir) && fs.statSync(metaInfDir).isDirectory()) {
            metaInfPaths.push(metaInfDir);
        }
        else {
            if (fs.existsSync(selectedPath) && fs.statSync(selectedPath).isFile()) {
                const parentDir = path.dirname(selectedPath);
                if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
                    metaInfPaths.push(parentDir);
                }
            }
            else if (fs.existsSync(selectedPath) && fs.statSync(selectedPath).isDirectory()) {
                this.findMetaInfInSubdirectories(selectedPath, metaInfPaths);
            }
        }
        return metaInfPaths;
    }
    findMetaInfInSubdirectories(dirPath, metaInfPaths) {
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                if (item === 'node_modules' || item === '.git' || item === 'target') {
                    continue;
                }
                if (fs.statSync(fullPath).isDirectory()) {
                    const metaInfDir = path.join(fullPath, 'META-INF');
                    if (fs.existsSync(metaInfDir) && fs.statSync(metaInfDir).isDirectory()) {
                        metaInfPaths.push(metaInfDir);
                    }
                    else {
                        this.findMetaInfInSubdirectories(fullPath, metaInfPaths);
                    }
                }
            }
        }
        catch (error) {
            console.warn(`无法访问目录: ${dirPath}`, error);
        }
    }
    findYyconfigPaths(projectPath) {
        const yyconfigPaths = [];
        this.findYyconfigRecursively(projectPath, yyconfigPaths);
        return yyconfigPaths;
    }
    findYyconfigRecursively(dirPath, yyconfigPaths) {
        const yyconfigDir = path.join(dirPath, 'src', 'client', 'yyconfig');
        if (fs.existsSync(yyconfigDir) && fs.statSync(yyconfigDir).isDirectory()) {
            yyconfigPaths.push(yyconfigDir);
        }
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                if (item === 'node_modules' || item === '.git' || item === 'target') {
                    continue;
                }
                if (fs.statSync(fullPath).isDirectory()) {
                    this.findYyconfigRecursively(fullPath, yyconfigPaths);
                }
            }
        }
        catch (error) {
        }
    }
    getModuleNameFromModuleXml(projectPath) {
        const moduleXmlPath = path.join(projectPath, 'META-INF', 'module.xml');
        if (!fs.existsSync(moduleXmlPath)) {
            return null;
        }
        try {
            const content = fs.readFileSync(moduleXmlPath, 'utf-8');
            const nameMatch = content.match(/<module[^>]*name=["']([^"']*)["']/);
            if (nameMatch && nameMatch[1]) {
                return { name: nameMatch[1] };
            }
        }
        catch (error) {
        }
        return null;
    }
    async copyDirectory(sourceDir, targetDir) {
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        this.copyDirectoryRecursive(sourceDir, targetDir);
    }
    copyDirectoryRecursive(sourceDir, targetDir) {
        if (!fs.existsSync(sourceDir)) {
            return;
        }
        const items = fs.readdirSync(sourceDir);
        for (const item of items) {
            const sourcePath = path.join(sourceDir, item);
            const targetPath = path.join(targetDir, item);
            const stat = fs.statSync(sourcePath);
            if (stat.isDirectory()) {
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                this.copyDirectoryRecursive(sourcePath, targetPath);
            }
            else {
                fs.copyFileSync(sourcePath, targetPath);
            }
        }
    }
    collectFilesInDirectory(dirPath) {
        const files = [];
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const fullPath = path.join(dirPath, item);
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    files.push(...this.collectFilesInDirectory(fullPath));
                }
                else {
                    files.push(fullPath);
                }
            }
        }
        catch (error) {
            console.warn(`无法访问目录: ${dirPath}`, error);
        }
        return files;
    }
}
exports.CopyResourcesToHomeCommand = CopyResourcesToHomeCommand;
//# sourceMappingURL=CopyResourcesToHomeCommand.js.map