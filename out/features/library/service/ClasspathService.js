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
exports.ClasspathService = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const xml2js = __importStar(require("xml2js"));
class ClasspathService {
    outputChannel;
    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('YonBIP Classpath');
    }
    async addAllSourcePaths(selectedPath) {
        try {
            const classpathFile = this.findClasspathFile(selectedPath);
            if (!classpathFile) {
                vscode.window.showErrorMessage('未找到.classpath文件，请确保选中的目录是包含.classpath文件的项目目录');
                return;
            }
            this.outputChannel.appendLine(`找到.classpath文件: ${classpathFile}`);
            const projectRoot = path.dirname(classpathFile);
            const sourcePaths = this.scanForSourcePaths(selectedPath);
            if (sourcePaths.length === 0) {
                vscode.window.showInformationMessage('未找到符合条件的源码目录（src/client、src/public、src/private）');
                return;
            }
            this.outputChannel.appendLine(`找到 ${sourcePaths.length} 个源码路径:`);
            sourcePaths.forEach(p => this.outputChannel.appendLine(`  - ${p}`));
            const classpathContent = await this.readClasspathFile(classpathFile);
            const updatedContent = await this.addSourcePathsToClasspath(classpathContent, sourcePaths, projectRoot);
            await this.writeClasspathFile(classpathFile, updatedContent);
            vscode.window.showInformationMessage(`成功添加 ${sourcePaths.length} 个源码路径到.classpath文件`);
            this.outputChannel.show();
        }
        catch (error) {
            this.outputChannel.appendLine(`添加源码路径失败: ${error.message}`);
            vscode.window.showErrorMessage(`添加源码路径失败: ${error.message}`);
        }
    }
    findClasspathFile(selectedPath) {
        try {
            const items = fs.readdirSync(selectedPath, { withFileTypes: true });
            for (const item of items) {
                if (!item.isDirectory() && item.name === '.classpath') {
                    const classpathFile = path.join(selectedPath, '.classpath');
                    if (fs.existsSync(classpathFile)) {
                        return classpathFile;
                    }
                }
            }
        }
        catch (error) {
            this.outputChannel.appendLine(`检查目录时出错: ${error}`);
        }
        return null;
    }
    scanForSourcePaths(rootPath) {
        const sourcePaths = [];
        const targetPatterns = ['src/client', 'src/public', 'src/private'];
        const scanDirectory = (dirPath, relativePath = '') => {
            try {
                const items = fs.readdirSync(dirPath, { withFileTypes: true });
                for (const item of items) {
                    if (item.isDirectory()) {
                        const itemPath = path.join(dirPath, item.name);
                        const itemRelativePath = relativePath ? path.join(relativePath, item.name) : item.name;
                        for (const pattern of targetPatterns) {
                            if (itemRelativePath.endsWith(pattern)) {
                                sourcePaths.push(itemRelativePath);
                                this.outputChannel.appendLine(`找到匹配路径: ${itemRelativePath}`);
                            }
                        }
                        scanDirectory(itemPath, itemRelativePath);
                    }
                }
            }
            catch (error) {
                this.outputChannel.appendLine(`跳过无法访问的目录: ${dirPath}`);
            }
        };
        scanDirectory(rootPath);
        return sourcePaths;
    }
    async readClasspathFile(classpathFile) {
        const content = fs.readFileSync(classpathFile, 'utf-8');
        const parser = new xml2js.Parser();
        return await parser.parseStringPromise(content);
    }
    async addSourcePathsToClasspath(classpathData, sourcePaths, projectRoot) {
        if (!classpathData.classpath) {
            classpathData.classpath = {};
        }
        if (!classpathData.classpath.classpathentry) {
            classpathData.classpath.classpathentry = [];
        }
        const existingPaths = new Set();
        const entries = Array.isArray(classpathData.classpath.classpathentry)
            ? classpathData.classpath.classpathentry
            : [classpathData.classpath.classpathentry];
        entries.forEach((entry) => {
            if (entry.$ && entry.$.kind === 'src' && entry.$.path) {
                existingPaths.add(entry.$.path);
            }
        });
        let addedCount = 0;
        for (const sourcePath of sourcePaths) {
            if (!existingPaths.has(sourcePath)) {
                const newEntry = {
                    $: {
                        kind: 'src',
                        path: sourcePath
                    }
                };
                if (Array.isArray(classpathData.classpath.classpathentry)) {
                    classpathData.classpath.classpathentry.push(newEntry);
                }
                else {
                    classpathData.classpath.classpathentry = [classpathData.classpath.classpathentry, newEntry];
                }
                addedCount++;
                this.outputChannel.appendLine(`添加源码路径: ${sourcePath}`);
            }
            else {
                this.outputChannel.appendLine(`源码路径已存在，跳过: ${sourcePath}`);
            }
        }
        this.outputChannel.appendLine(`实际添加了 ${addedCount} 个新的源码路径`);
        return classpathData;
    }
    async writeClasspathFile(classpathFile, classpathData) {
        const builder = new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true, indent: '\t' }
        });
        const xmlContent = builder.buildObject(classpathData);
        fs.writeFileSync(classpathFile, xmlContent, 'utf-8');
        this.outputChannel.appendLine(`已更新.classpath文件: ${classpathFile}`);
    }
}
exports.ClasspathService = ClasspathService;
//# sourceMappingURL=ClasspathService.js.map