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
exports.PatchCommands = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const StreamZip = __importStar(require("node-stream-zip"));
class PatchCommands {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    static registerCommands(context, configService) {
        const command = new PatchCommands(configService);
        const applyCmd = vscode.commands.registerCommand('yonbip.patch.applyToHome', async (uri) => {
            await command.applyPatchToHome(uri);
        });
        const revertCmd = vscode.commands.registerCommand('yonbip.patch.revertFromHome', async (uri) => {
            await command.revertPatchFromHome(uri);
        });
        const batchApplyCmd = vscode.commands.registerCommand('yonbip.patch.batchApplyToHome', async (uris) => {
            await command.batchApplyPatchToHome(uris);
        });
        const batchRevertCmd = vscode.commands.registerCommand('yonbip.patch.batchRevertFromHome', async (uris) => {
            await command.batchRevertPatchFromHome(uris);
        });
        context.subscriptions.push(applyCmd, revertCmd, batchApplyCmd, batchRevertCmd);
    }
    async batchApplyPatchToHome(uris) {
        try {
            if (!uris || uris.length === 0) {
                vscode.window.showWarningMessage('请选择要应用的补丁文件');
                return;
            }
            const patchFiles = [];
            for (const uri of uris) {
                const stats = fs.statSync(uri.fsPath);
                if (stats.isDirectory()) {
                    const patchFilesInDir = this.findPatchFilesInDirectory(uri.fsPath);
                    patchFiles.push(...patchFilesInDir.map(filePath => vscode.Uri.file(filePath)));
                }
                else {
                    patchFiles.push(uri);
                }
            }
            if (patchFiles.length === 0) {
                vscode.window.showWarningMessage('未找到任何补丁文件');
                return;
            }
            const config = this.configService.getConfig();
            const homePath = config.homePath;
            if (!homePath) {
                vscode.window.showWarningMessage('请先配置NC HOME路径');
                return;
            }
            if (!fs.existsSync(homePath)) {
                vscode.window.showErrorMessage(`HOME目录不存在: ${homePath}`);
                return;
            }
            const confirm = await vscode.window.showWarningMessage(`将把 ${patchFiles.length} 个补丁ZIP文件中的 replacement 内容复制到${os.EOL}HOME目录：${homePath}${os.EOL}若存在同名文件将覆盖。是否继续？`, '继续', '取消');
            if (confirm !== '继续')
                return;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在批量打补丁到HOME (${patchFiles.length} 个文件)...`,
                cancellable: false,
            }, async (progress) => {
                let successCount = 0;
                let failCount = 0;
                const failList = [];
                const backupsDir = path.join(homePath, '.yonbip-backups');
                if (!fs.existsSync(backupsDir))
                    fs.mkdirSync(backupsDir, { recursive: true });
                for (let i = 0; i < patchFiles.length; i++) {
                    const uri = patchFiles[i];
                    progress.report({ message: `处理文件 ${i + 1}/${patchFiles.length}: ${path.basename(uri.fsPath)}` });
                    try {
                        const zipPath = uri.fsPath;
                        if (!fs.existsSync(zipPath)) {
                            throw new Error(`文件不存在: ${zipPath}`);
                        }
                        if (!zipPath.toLowerCase().endsWith('.zip')) {
                            throw new Error('请选择ZIP压缩包文件');
                        }
                        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const manifestDir = path.join(backupsDir, `${path.basename(zipPath, path.extname(zipPath))}_${stamp}`);
                        fs.mkdirSync(manifestDir, { recursive: true });
                        const manifest = await this.applyReplacementFromZip(zipPath, homePath, manifestDir, progress);
                        fs.writeFileSync(path.join(manifestDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
                        successCount++;
                    }
                    catch (error) {
                        failCount++;
                        failList.push(`${path.basename(uri.fsPath)}: ${error.message}`);
                        console.error(`处理补丁文件失败 ${path.basename(uri.fsPath)}:`, error);
                    }
                }
                if (failCount > 0) {
                    const failMessage = `部分补丁应用失败:\n${failList.join('\n')}`;
                    vscode.window.showErrorMessage(failMessage);
                }
                vscode.window.showInformationMessage(`批量打补丁完成: 成功 ${successCount} 个，失败 ${failCount} 个`);
            });
        }
        catch (error) {
            console.error('批量打补丁失败:', error);
            vscode.window.showErrorMessage(`批量打补丁失败: ${error.message}`);
        }
    }
    async batchRevertPatchFromHome(uris) {
        try {
            if (!uris || uris.length === 0) {
                vscode.window.showWarningMessage('请选择要撤销的补丁文件');
                return;
            }
            const patchFiles = [];
            for (const uri of uris) {
                const stats = fs.statSync(uri.fsPath);
                if (stats.isDirectory()) {
                    const patchFilesInDir = this.findPatchFilesInDirectory(uri.fsPath);
                    patchFiles.push(...patchFilesInDir.map(filePath => vscode.Uri.file(filePath)));
                }
                else {
                    patchFiles.push(uri);
                }
            }
            if (patchFiles.length === 0) {
                vscode.window.showWarningMessage('未找到任何补丁文件');
                return;
            }
            const config = this.configService.getConfig();
            const homePath = config.homePath;
            if (!homePath) {
                vscode.window.showWarningMessage('请先配置NC HOME路径');
                return;
            }
            if (!fs.existsSync(homePath)) {
                vscode.window.showErrorMessage(`HOME目录不存在: ${homePath}`);
                return;
            }
            const confirm = await vscode.window.showWarningMessage(`将撤销 ${patchFiles.length} 个补丁文件的更改。${os.EOL}是否继续？`, '继续', '取消');
            if (confirm !== '继续')
                return;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在批量撤销补丁 (${patchFiles.length} 个文件)...`,
                cancellable: false,
            }, async (progress) => {
                let successCount = 0;
                let failCount = 0;
                const failList = [];
                for (let i = 0; i < patchFiles.length; i++) {
                    const uri = patchFiles[i];
                    progress.report({ message: `处理文件 ${i + 1}/${patchFiles.length}: ${path.basename(uri.fsPath)}` });
                    try {
                        const zipPath = uri.fsPath;
                        if (!fs.existsSync(zipPath)) {
                            throw new Error(`文件不存在: ${zipPath}`);
                        }
                        if (!zipPath.toLowerCase().endsWith('.zip')) {
                            throw new Error('请选择ZIP压缩包文件');
                        }
                        const patchBase = path.basename(zipPath, path.extname(zipPath));
                        const backupsDir = path.join(homePath, '.yonbip-backups');
                        let latestManifestPath;
                        if (fs.existsSync(backupsDir)) {
                            const dirs = fs.readdirSync(backupsDir)
                                .filter(d => d.startsWith(patchBase) && fs.statSync(path.join(backupsDir, d)).isDirectory())
                                .sort()
                                .reverse();
                            for (const d of dirs) {
                                const p = path.join(backupsDir, d, 'manifest.json');
                                if (fs.existsSync(p)) {
                                    latestManifestPath = p;
                                    break;
                                }
                            }
                        }
                        const zip = new StreamZip.async({ file: zipPath });
                        const entries = await zip.entries();
                        const replacementEntries = Object.values(entries).filter((e) => !e.isDirectory && this.isReplacementEntry(e.name));
                        if (replacementEntries.length === 0) {
                            await zip.close();
                            throw new Error('补丁ZIP不包含 replacement 目录内容');
                        }
                        let manifest;
                        if (latestManifestPath) {
                            try {
                                manifest = JSON.parse(fs.readFileSync(latestManifestPath, 'utf-8'));
                            }
                            catch { }
                        }
                        const warnings = [];
                        let processed = 0;
                        for (const entry of replacementEntries) {
                            const rel = this.toRelativeFromReplacement(entry.name);
                            if (!rel)
                                continue;
                            const targetPath = this.safeJoin(homePath, rel);
                            if (!targetPath) {
                                warnings.push(`跳过可疑路径：${entry.name}`);
                                continue;
                            }
                            const mEntry = manifest?.entries.find(e => e.relativePath === rel);
                            if (mEntry && mEntry.existedBefore) {
                                const backupFile = path.join(path.dirname(latestManifestPath), rel);
                                const backupBase = path.dirname(latestManifestPath);
                                const backupPath = path.join(backupBase, rel);
                                if (!fs.existsSync(backupPath)) {
                                    warnings.push(`未找到备份文件，跳过恢复：${rel}`);
                                }
                                else {
                                    if (fs.existsSync(targetPath)) {
                                        const currentSha = await this.sha256File(targetPath);
                                        if (currentSha !== mEntry.sha256Patch) {
                                            warnings.push(`文件已被修改，跳过恢复：${rel}`);
                                        }
                                        else {
                                            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                                            fs.copyFileSync(backupPath, targetPath);
                                            processed++;
                                        }
                                    }
                                    else {
                                        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                                        fs.copyFileSync(backupPath, targetPath);
                                        processed++;
                                    }
                                }
                            }
                            else {
                                if (fs.existsSync(targetPath)) {
                                    const patchBuf = await zip.entryData(entry.name);
                                    const patchSha = this.sha256Buffer(patchBuf);
                                    const currentSha = await this.sha256File(targetPath);
                                    if (currentSha !== patchSha) {
                                        warnings.push(`文件已被修改，跳过删除：${rel}`);
                                    }
                                    else {
                                        fs.unlinkSync(targetPath);
                                        processed++;
                                    }
                                }
                            }
                        }
                        await zip.close();
                        successCount++;
                    }
                    catch (error) {
                        failCount++;
                        failList.push(`${path.basename(uri.fsPath)}: ${error.message}`);
                        console.error(`撤销补丁文件失败 ${path.basename(uri.fsPath)}:`, error);
                    }
                }
                if (failCount > 0) {
                    const failMessage = `部分补丁撤销失败:\n${failList.join('\n')}`;
                    vscode.window.showErrorMessage(failMessage);
                }
                vscode.window.showInformationMessage(`批量撤销补丁完成: 成功 ${successCount} 个，失败 ${failCount} 个`);
            });
        }
        catch (error) {
            console.error('批量撤销补丁失败:', error);
            vscode.window.showErrorMessage(`批量撤销补丁失败: ${error.message}`);
        }
    }
    async applyPatchToHome(uri) {
        try {
            let uris = undefined;
            if (uri) {
                uris = Array.isArray(uri) ? uri : [uri];
            }
            await this.batchApplyPatchToHome(uris);
        }
        catch (error) {
            console.error('打补丁失败:', error);
            vscode.window.showErrorMessage(`打补丁失败: ${error.message}`);
        }
    }
    async revertPatchFromHome(uri) {
        try {
            let uris = undefined;
            if (uri) {
                uris = Array.isArray(uri) ? uri : [uri];
            }
            await this.batchRevertPatchFromHome(uris);
        }
        catch (error) {
            console.error('撤销补丁失败:', error);
            vscode.window.showErrorMessage(`撤销补丁失败: ${error.message}`);
        }
    }
    async applyReplacementFromZip(zipPath, homePath, manifestDir, progress) {
        const zip = new StreamZip.async({ file: zipPath });
        const entries = await zip.entries();
        const files = Object.values(entries).filter((e) => !e.isDirectory && this.isReplacementEntry(e.name));
        if (files.length === 0) {
            await zip.close();
            throw new Error('补丁ZIP不包含 replacement 目录内容');
        }
        const manifest = {
            patchFileName: path.basename(zipPath),
            appliedAt: new Date().toISOString(),
            homePath,
            entries: [],
        };
        let processed = 0;
        for (const entry of files) {
            const rel = this.toRelativeFromReplacement(entry.name);
            if (!rel)
                continue;
            const targetPath = this.safeJoin(homePath, rel);
            if (!targetPath) {
                continue;
            }
            progress?.report({ message: `复制：${rel}` });
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            const existedBefore = fs.existsSync(targetPath);
            const beforeSha = existedBefore ? await this.sha256File(targetPath) : undefined;
            const buf = await zip.entryData(entry.name);
            const patchSha = this.sha256Buffer(buf);
            if (existedBefore) {
                const backupPath = path.join(manifestDir, rel);
                fs.mkdirSync(path.dirname(backupPath), { recursive: true });
                try {
                    fs.copyFileSync(targetPath, backupPath);
                }
                catch (err) {
                    await zip.close();
                    throw new Error(`备份原文件失败：${rel}，错误：${err?.message || err}`);
                }
            }
            fs.writeFileSync(targetPath, buf);
            const finalSha = await this.sha256File(targetPath);
            manifest.entries.push({
                relativePath: rel,
                targetPath,
                existedBefore,
                sha256Before: beforeSha,
                sha256Patch: patchSha,
                finalSha256: finalSha,
            });
            processed++;
        }
        await zip.close();
        return manifest;
    }
    async resolveZipPath(uri, title) {
        if (uri && uri.fsPath) {
            if (!fs.existsSync(uri.fsPath)) {
                vscode.window.showErrorMessage(`文件不存在: ${uri.fsPath}`);
                return undefined;
            }
            if (!uri.fsPath.toLowerCase().endsWith('.zip')) {
                vscode.window.showWarningMessage('请选择ZIP压缩包文件');
                return undefined;
            }
            return uri.fsPath;
        }
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: title,
            filters: { 'Zip': ['zip'] },
        });
        if (!picked || picked.length === 0)
            return undefined;
        return picked[0].fsPath;
    }
    isReplacementEntry(entryName) {
        return entryName.startsWith('replacement/') || entryName.startsWith('replacement\\');
    }
    toRelativeFromReplacement(entryName) {
        const rel = entryName.replace(/^replacement[\/\\]/, '');
        return rel;
    }
    safeJoin(base, rel) {
        const target = path.resolve(base, rel);
        const relative = path.relative(base, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            return undefined;
        }
        return target;
    }
    async sha256File(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('error', reject);
            stream.on('data', (chunk) => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }
    sha256Buffer(buf) {
        const hash = crypto.createHash('sha256');
        hash.update(buf);
        return hash.digest('hex');
    }
    findPatchFilesInDirectory(dirPath) {
        const patchFiles = [];
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                patchFiles.push(...this.findPatchFilesInDirectory(fullPath));
            }
            else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip') && entry.name.toLowerCase().startsWith('patch')) {
                patchFiles.push(fullPath);
            }
        }
        return patchFiles;
    }
}
exports.PatchCommands = PatchCommands;
//# sourceMappingURL=PatchCommands.js.map