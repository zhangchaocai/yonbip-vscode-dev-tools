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
exports.ServiceDirectoryScanner = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ServiceDirectoryScanner {
    static scannedCount = 0;
    static totalCount = 0;
    static progressCallback;
    static async scanServiceDirectories(progressCallback) {
        this.scannedCount = 0;
        this.totalCount = 0;
        this.progressCallback = progressCallback;
        const serviceDirectories = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('请先打开一个工作区文件夹');
            return serviceDirectories;
        }
        if (progressCallback) {
            progressCallback({ increment: 0, message: '开始扫描工作区...' });
        }
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            this.totalCount += await this.countDirectories(folderPath);
        }
        if (progressCallback) {
            progressCallback({ increment: 10, message: `准备扫描 ${this.totalCount} 个目录...` });
        }
        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            await this.scanDirectoryRecursive(folderPath, serviceDirectories, 0, 2);
        }
        if (progressCallback) {
            progressCallback({ increment: 90, message: '扫描完成，正在整理结果...' });
        }
        return serviceDirectories;
    }
    static async countDirectories(dirPath) {
        let count = 1;
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const childDirPath = path.join(dirPath, entry.name);
                    count += await this.countDirectories(childDirPath);
                }
            }
        }
        catch (error) {
        }
        return count;
    }
    static async scanDirectoryRecursive(dirPath, serviceDirectories, currentDepth, maxDepth) {
        try {
            const hasProjectFile = fs.existsSync(path.join(dirPath, '.project'));
            const hasClasspathFile = fs.existsSync(path.join(dirPath, '.classpath'));
            if (hasProjectFile && hasClasspathFile) {
                if (!serviceDirectories.includes(dirPath)) {
                    serviceDirectories.push(dirPath);
                }
            }
            this.scannedCount++;
            if (this.progressCallback && this.totalCount > 0) {
                const progressPercent = 10 + (this.scannedCount / this.totalCount) * 70;
                const dirName = path.basename(dirPath);
                this.progressCallback({
                    increment: 0,
                    message: `正在扫描: ${dirName} (${this.scannedCount}/${this.totalCount})`
                });
            }
            if (currentDepth >= maxDepth) {
                return;
            }
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const childDirPath = path.join(dirPath, entry.name);
                    await this.scanDirectoryRecursive(childDirPath, serviceDirectories, currentDepth + 1, maxDepth);
                }
            }
        }
        catch (error) {
            this.scannedCount++;
        }
    }
    static getDirectoryDisplayName(dirPath) {
        return path.basename(dirPath);
    }
}
exports.ServiceDirectoryScanner = ServiceDirectoryScanner;
//# sourceMappingURL=ServiceDirectoryScanner.js.map