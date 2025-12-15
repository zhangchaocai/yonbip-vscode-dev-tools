import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as StreamZip from 'node-stream-zip';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';

/**
 * 将补丁(replacement目录)应用到HOME，以及从HOME取消补丁
 */
export class PatchToHomeCommand {
    private configService: NCHomeConfigService;

    constructor(configService: NCHomeConfigService) {
        this.configService = configService;
    }

    /**
     * 注册两个命令：
     * - yonbip.patch.applyToHome
     * - yonbip.patch.removeFromHome
     */
    public static registerCommands(context: vscode.ExtensionContext, configService: NCHomeConfigService): void {
        const command = new PatchToHomeCommand(configService);

        const applyCmd = vscode.commands.registerCommand(
            'yonbip.patch.applyToHome',
            async (uri: vscode.Uri) => {
                await command.applyPatchToHome(uri);
            }
        );

        const removeCmd = vscode.commands.registerCommand(
            'yonbip.patch.removeFromHome',
            async (uri: vscode.Uri) => {
                await command.removePatchFromHome(uri);
            }
        );

        context.subscriptions.push(applyCmd, removeCmd);
    }

    /**
     * 逻辑：支持文件夹和压缩包。文件夹中递归查找以 patch 开头的 .zip。
     * 将每个压缩包里的 replacement 目录复制到 HOME 根目录下（生成 homePath/replacement/...）。
     */
    private async applyPatchToHome(uri?: vscode.Uri): Promise<void> {
        try {
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            const homePath = config.homePath;

            if (!homePath) {
                const result = await vscode.window.showInformationMessage(
                    '未配置HOME路径，是否现在配置？',
                    '是',
                    '否'
                );
                if (result === '是') {
                    await vscode.commands.executeCommand('yonbip.nchome.config');
                } else {
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

            // 扫描补丁文件
            const patchFiles = this.collectPatchZipFiles(selectedPath);
            if (patchFiles.length === 0) {
                vscode.window.showWarningMessage('未找到可用的补丁压缩包（文件夹内按 patch*.zip 搜索，或直接选择.zip文件）。');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `将要把 ${patchFiles.length} 个补丁的 replacement 复制到 HOME，可能覆盖已有文件，是否继续？`,
                '继续',
                '取消'
            );
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
                const skipped: string[] = [];

                for (const zipPath of patchFiles) {
                    progress.report({ message: `处理中: ${path.basename(zipPath)} (${++processed}/${patchFiles.length})` });
                    try {
                        const extractedCount = await this.extractReplacementToHome(zipPath, homePath);
                        if (extractedCount === 0) {
                            skipped.push(`${path.basename(zipPath)}(无replacement)`);
                        }
                        totalExtracted += extractedCount;
                    } catch (e: any) {
                        skipped.push(`${path.basename(zipPath)}(失败: ${e?.message || '未知错误'})`);
                    }
                }

                progress.report({ message: '完成' });

                const summary = `✅ 已应用补丁：${patchFiles.length - skipped.length} 个，复制文件 ${totalExtracted} 个。
${skipped.length > 0 ? `⚠️ 跳过/失败：${skipped.length} 个：\n- ${skipped.join('\n- ')}` : ''}`;
                vscode.window.showInformationMessage(summary);
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`应用补丁失败：${error.message}`);
        }
    }

    /**
     * 逻辑：支持文件夹和压缩包。删除 HOME 中与补丁 replacement 对应的文件，并清理空目录。
     */
    private async removePatchFromHome(uri?: vscode.Uri): Promise<void> {
        try {
            this.configService.reloadConfig();
            const config = this.configService.getConfig();
            const homePath = config.homePath;

            if (!homePath) {
                const result = await vscode.window.showInformationMessage(
                    '未配置HOME路径，是否现在配置？',
                    '是',
                    '否'
                );
                if (result === '是') {
                    await vscode.commands.executeCommand('yonbip.nchome.config');
                } else {
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

            const confirm = await vscode.window.showWarningMessage(
                `将从 HOME 删除 ${patchFiles.length} 个补丁中的 replacement 文件，是否继续？`,
                '继续',
                '取消'
            );
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
                const skipped: string[] = [];

                for (const zipPath of patchFiles) {
                    progress.report({ message: `处理中: ${path.basename(zipPath)} (${++processed}/${patchFiles.length})` });
                    try {
                        const deletedCount = await this.deleteReplacementFromHome(zipPath, homePath);
                        if (deletedCount === 0) {
                            skipped.push(`${path.basename(zipPath)}(无replacement)`);
                        }
                        totalDeleted += deletedCount;
                    } catch (e: any) {
                        skipped.push(`${path.basename(zipPath)}(失败: ${e?.message || '未知错误'})`);
                    }
                }

                progress.report({ message: '完成' });

                const summary = `✅ 已取消补丁：${patchFiles.length - skipped.length} 个，删除文件 ${totalDeleted} 个。
${skipped.length > 0 ? `⚠️ 跳过/失败：${skipped.length} 个：\n- ${skipped.join('\n- ')}` : ''}`;
                vscode.window.showInformationMessage(summary);
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`取消补丁失败：${error.message}`);
        }
    }

    /**
     * 收集补丁压缩包：
     * - 如果是文件且是.zip，直接使用（不强制要求以patch开头）。
     * - 如果是文件夹，递归查找以patch开头的.zip。
     */
    private collectPatchZipFiles(selectedPath: string): string[] {
        const result: string[] = [];
        try {
            const stat = fs.statSync(selectedPath);
            if (stat.isFile()) {
                if (this.isZipFile(selectedPath)) {
                    result.push(selectedPath);
                }
            } else if (stat.isDirectory()) {
                this.walkAndCollectPatchZips(selectedPath, result);
            }
        } catch {
            // ignore
        }
        return result;
    }

    private walkAndCollectPatchZips(dir: string, out: string[]): void {
        try {
            const entries = fs.readdirSync(dir);
            for (const name of entries) {
                if (name === 'node_modules' || name === '.git' || name === 'target') continue;
                const full = path.join(dir, name);
                try {
                    const st = fs.statSync(full);
                    if (st.isDirectory()) {
                        this.walkAndCollectPatchZips(full, out);
                    } else if (st.isFile()) {
                        const lower = name.toLowerCase();
                        if (lower.endsWith('.zip') && lower.startsWith('patch')) {
                            out.push(full);
                        }
                    }
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore
        }
    }

    private isZipFile(filePath: string): boolean {
        const lower = path.basename(filePath).toLowerCase();
        return lower.endsWith('.zip');
    }

    /**
     * 将zip中的replacement目录提取到homePath下
     * 返回复制的文件数量
     */
    private async extractReplacementToHome(zipFilePath: string, homePath: string): Promise<number> {
        const zip = new (StreamZip as any).async({ file: zipFilePath });
        try {
            const entries: Record<string, any> = await zip.entries();
            const targets = Object.values(entries)
                .filter((e: any) => typeof e.name === 'string' && (e.name.startsWith('replacement/') || e.name === 'replacement' || e.name.startsWith('replacement\\')));

            if (targets.length === 0) {
                await zip.close();
                return 0;
            }

            let count = 0;
            for (const entry of targets) {
                const entryName: string = entry.name;
                const dest = path.join(homePath, entryName.replace(/\\/g, '/'));
                if (entry.isDirectory) {
                    this.ensureDir(dest);
                } else {
                    this.ensureDir(path.dirname(dest));
                    await zip.extract(entryName, dest);
                    count++;
                }
            }

            await zip.close();
            return count;
        } catch (err) {
            await zip.close();
            throw err;
        }
    }

    /**
     * 根据zip的replacement目录删除HOME中的对应文件
     * 返回删除的文件数量
     */
    private async deleteReplacementFromHome(zipFilePath: string, homePath: string): Promise<number> {
        const zip = new (StreamZip as any).async({ file: zipFilePath });
        try {
            const entries: Record<string, any> = await zip.entries();
            const targets = Object.values(entries)
                .filter((e: any) => typeof e.name === 'string' && (e.name.startsWith('replacement/') || e.name === 'replacement' || e.name.startsWith('replacement\\')));

            if (targets.length === 0) {
                await zip.close();
                return 0;
            }

            let count = 0;
            const filesToDelete: string[] = [];
            const dirsToCheck: Set<string> = new Set<string>();

            for (const entry of targets) {
                const entryName: string = entry.name.replace(/\\/g, '/');
                const dest = path.join(homePath, entryName);
                if (entry.isDirectory) {
                    dirsToCheck.add(dest);
                } else {
                    filesToDelete.push(dest);
                }
            }

            // 删除文件
            for (const filePath of filesToDelete) {
                try {
                    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                        fs.unlinkSync(filePath);
                        count++;
                    }
                } catch {
                    // ignore single file errors
                }
            }

            // 清理空目录（从深到浅）
            const sortedDirs = Array.from(dirsToCheck.values()).sort((a, b) => b.length - a.length);
            for (const dir of sortedDirs) {
                this.removeDirIfEmpty(dir);
            }

            await zip.close();
            return count;
        } catch (err) {
            await zip.close();
            throw err;
        }
    }

    private ensureDir(dirPath: string): void {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    private removeDirIfEmpty(dirPath: string): void {
        try {
            if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;
            const items = fs.readdirSync(dirPath);
            if (items.length === 0) {
                fs.rmdirSync(dirPath);
            }
        } catch {
            // ignore
        }
    }
}