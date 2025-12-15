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
exports.PatchToHomeCommand = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const StreamZip = __importStar(require("node-stream-zip"));
class PatchToHomeCommand {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    static registerCommands(context, configService) {
        const command = new PatchToHomeCommand(configService);
        const applyCmd = vscode.commands.registerCommand('yonbip.patch.applyToHome', async (uri) => {
            await command.applyPatchToHome(uri);
        });
        const removeCmd = vscode.commands.registerCommand('yonbip.patch.removeFromHome', async (uri) => {
            await command.removePatchFromHome(uri);
        });
        context.subscriptions.push(applyCmd, removeCmd);
    }
    async applyPatchToHome(uri) {
        try {
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            const homePath = config.homePath;
            if (!homePath) {
                const result = await vscode.window.showInformationMessage('未配置HOME路径，是否现在配置？', '是', '否');
                if (result === '是') {
                    await vscode.commands.executeCommand('yonbip.nchome.config');
                }
                else {
                    vscode.window.showWarningMessage('请先配置NC HOME路径');
                }
                return;
            }
            if (!fs.existsSync(homePath) || !fs.statSync(homePath).isDirectory()) {
                vscode.window.showErrorMessage(`HOME路径无效或不存在：${homePath}`);
                return;
            }
            const selectedPath = uri?.fsPath;
            if (!selectedPath || !fs.existsSync(selectedPath)) {
                vscode.window.showErrorMessage('请选择一个文件夹或补丁压缩包再执行。');
                return;
            }
            const patchFiles = this.collectPatchZipFiles(selectedPath);
            if (patchFiles.length === 0) {
                vscode.window.showWarningMessage('未找到可用的补丁压缩包（文件夹内按 patch*.zip 搜索，或直接选择.zip文件）。');
                return;
            }
            const confirm = await vscode.window.showWarningMessage(`将要把 ${patchFiles.length} 个补丁的 replacement 复制到 HOME，可能覆盖已有文件，是否继续？`, '继续', '取消');
            if (confirm !== '继续') {
                return;
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在应用补丁到HOME...',
                cancellable: false
            }, async (progress) => {
                let totalExtracted = 0;
                let processed = 0;
                const skipped = [];
                for (const zipPath of patchFiles) {
                    progress.report({ message: `处理中: ${path.basename(zipPath)} (${++processed}/${patchFiles.length})` });
                    try {
                        const extractedCount = await this.extractReplacementToHome(zipPath, homePath);
                        if (extractedCount === 0) {
                            skipped.push(`${path.basename(zipPath)}(无replacement)`);
                        }
                        totalExtracted += extractedCount;
                    }
                    catch (e) {
                        skipped.push(`${path.basename(zipPath)}(失败: ${e?.message || '未知错误'})`);
                    }
                }
                progress.report({ message: '完成' });
                const summary = `✅ 已应用补丁：${patchFiles.length - skipped.length} 个，复制文件 ${totalExtracted} 个。
${skipped.length > 0 ? `⚠️ 跳过/失败：${skipped.length} 个：\n- ${skipped.join('\n- ')}` : ''}`;
                vscode.window.showInformationMessage(summary);
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`应用补丁失败：${error.message}`);
        }
    }
    async removePatchFromHome(uri) {
        try {
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            const homePath = config.homePath;
            if (!homePath) {
                const result = await vscode.window.showInformationMessage('未配置HOME路径，是否现在配置？', '是', '否');
                if (result === '是') {
                    await vscode.commands.executeCommand('yonbip.nchome.config');
                }
                else {
                    vscode.window.showWarningMessage('请先配置NC HOME路径');
                }
                return;
            }
            if (!fs.existsSync(homePath) || !fs.statSync(homePath).isDirectory()) {
                vscode.window.showErrorMessage(`HOME路径无效或不存在：${homePath}`);
                return;
            }
            const selectedPath = uri?.fsPath;
            if (!selectedPath || !fs.existsSync(selectedPath)) {
                vscode.window.showErrorMessage('请选择一个文件夹或补丁压缩包再执行。');
                return;
            }
            const patchFiles = this.collectPatchZipFiles(selectedPath);
            if (patchFiles.length === 0) {
                vscode.window.showWarningMessage('未找到可用的补丁压缩包（文件夹内按 patch*.zip 搜索，或直接选择.zip文件）。');
                return;
            }
            const confirm = await vscode.window.showWarningMessage(`将从 HOME 删除 ${patchFiles.length} 个补丁中的 replacement 文件，是否继续？`, '继续', '取消');
            if (confirm !== '继续') {
                return;
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在取消补丁...',
                cancellable: false
            }, async (progress) => {
                let totalDeleted = 0;
                let processed = 0;
                const skipped = [];
                for (const zipPath of patchFiles) {
                    progress.report({ message: `处理中: ${path.basename(zipPath)} (${++processed}/${patchFiles.length})` });
                    try {
                        const deletedCount = await this.deleteReplacementFromHome(zipPath, homePath);
                        if (deletedCount === 0) {
                            skipped.push(`${path.basename(zipPath)}(无replacement)`);
                        }
                        totalDeleted += deletedCount;
                    }
                    catch (e) {
                        skipped.push(`${path.basename(zipPath)}(失败: ${e?.message || '未知错误'})`);
                    }
                }
                progress.report({ message: '完成' });
                const summary = `✅ 已取消补丁：${patchFiles.length - skipped.length} 个，删除文件 ${totalDeleted} 个。
${skipped.length > 0 ? `⚠️ 跳过/失败：${skipped.length} 个：\n- ${skipped.join('\n- ')}` : ''}`;
                vscode.window.showInformationMessage(summary);
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`取消补丁失败：${error.message}`);
        }
    }
    collectPatchZipFiles(selectedPath) {
        const result = [];
        try {
            const stat = fs.statSync(selectedPath);
            if (stat.isFile()) {
                if (this.isZipFile(selectedPath)) {
                    result.push(selectedPath);
                }
            }
            else if (stat.isDirectory()) {
                this.walkAndCollectPatchZips(selectedPath, result);
            }
        }
        catch {
        }
        return result;
    }
    walkAndCollectPatchZips(dir, out) {
        try {
            const entries = fs.readdirSync(dir);
            for (const name of entries) {
                if (name === 'node_modules' || name === '.git' || name === 'target')
                    continue;
                const full = path.join(dir, name);
                try {
                    const st = fs.statSync(full);
                    if (st.isDirectory()) {
                        this.walkAndCollectPatchZips(full, out);
                    }
                    else if (st.isFile()) {
                        const lower = name.toLowerCase();
                        if (lower.endsWith('.zip') && lower.startsWith('patch')) {
                            out.push(full);
                        }
                    }
                }
                catch {
                }
            }
        }
        catch {
        }
    }
    isZipFile(filePath) {
        const lower = path.basename(filePath).toLowerCase();
        return lower.endsWith('.zip');
    }
    async extractReplacementToHome(zipFilePath, homePath) {
        const zip = new StreamZip.async({ file: zipFilePath });
        try {
            const entries = await zip.entries();
            const targets = Object.values(entries)
                .filter((e) => typeof e.name === 'string' && (e.name.startsWith('replacement/') || e.name === 'replacement' || e.name.startsWith('replacement\\')));
            if (targets.length === 0) {
                await zip.close();
                return 0;
            }
            let count = 0;
            for (const entry of targets) {
                const entryName = entry.name;
                const dest = path.join(homePath, entryName.replace(/\\/g, '/'));
                if (entry.isDirectory) {
                    this.ensureDir(dest);
                }
                else {
                    this.ensureDir(path.dirname(dest));
                    await zip.extract(entryName, dest);
                    count++;
                }
            }
            await zip.close();
            return count;
        }
        catch (err) {
            await zip.close();
            throw err;
        }
    }
    async deleteReplacementFromHome(zipFilePath, homePath) {
        const zip = new StreamZip.async({ file: zipFilePath });
        try {
            const entries = await zip.entries();
            const targets = Object.values(entries)
                .filter((e) => typeof e.name === 'string' && (e.name.startsWith('replacement/') || e.name === 'replacement' || e.name.startsWith('replacement\\')));
            if (targets.length === 0) {
                await zip.close();
                return 0;
            }
            let count = 0;
            const filesToDelete = [];
            const dirsToCheck = new Set();
            for (const entry of targets) {
                const entryName = entry.name.replace(/\\/g, '/');
                const dest = path.join(homePath, entryName);
                if (entry.isDirectory) {
                    dirsToCheck.add(dest);
                }
                else {
                    filesToDelete.push(dest);
                }
            }
            for (const filePath of filesToDelete) {
                try {
                    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                        fs.unlinkSync(filePath);
                        count++;
                    }
                }
                catch {
                }
            }
            const sortedDirs = Array.from(dirsToCheck.values()).sort((a, b) => b.length - a.length);
            for (const dir of sortedDirs) {
                this.removeDirIfEmpty(dir);
            }
            await zip.close();
            return count;
        }
        catch (err) {
            await zip.close();
            throw err;
        }
    }
    ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }
    removeDirIfEmpty(dirPath) {
        try {
            if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory())
                return;
            const items = fs.readdirSync(dirPath);
            if (items.length === 0) {
                fs.rmdirSync(dirPath);
            }
        }
        catch {
        }
    }
}
exports.PatchToHomeCommand = PatchToHomeCommand;
//# sourceMappingURL=PatchToHomeCommand.js.map