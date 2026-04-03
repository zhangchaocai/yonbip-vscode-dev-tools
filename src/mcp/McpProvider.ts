import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { McpService, McpConfig, McpStatus } from './McpService';

/**
 * MCP服务WebView提供者
 */
export class McpProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip-mcp';

    private _view?: vscode.WebviewView;
    private mcpService: McpService;
    private outputChannel: vscode.OutputChannel;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext,
        mcpService: McpService
    ) {
        this.mcpService = mcpService;
        this.outputChannel = vscode.window.createOutputChannel('MCP Provider');
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 处理来自WebView的消息
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'loadConfig':
                    await this.handleLoadConfig();
                    break;
                case 'saveConfig':
                    await this.handleSaveConfig(data.config);
                    break;
                case 'resetConfig':
                    await this.handleResetConfig();
                    break;
                case 'startMcp':
                    await this.handleStart();
                    break;
                case 'stopMcp':
                    await this.handleStop();
                    break;
                case 'getStatus':
                    await this.handleGetStatus();
                    break;
                case 'selectJarFile':
                    await this.handleSelectJarFile();
                    break;
                case 'selectJavaPath':
                    await this.handleSelectJavaPath();
                    break;
                case 'showResetConfirm':
                    await this.handleShowResetConfirm();
                    break;
                case 'downloadJson':
                    await this.handleDownloadJson(data.tenant, data.version).catch((err: Error) => {
                        this.outputChannel.appendLine(`downloadJson 异常: ${err?.message ?? err}`);
                        vscode.window.showErrorMessage(`下载 JSON 失败: ${err?.message ?? String(err)}`);
                    });
                    break;
                default:
                    console.log('收到未知消息类型:', data.type);
                    this.outputChannel.appendLine(`收到未知消息类型: ${data.type}`);
            }
        });

        // 初始加载配置和状态
        this.handleLoadConfig();
        this.handleGetStatus();
    }

    /**
     * 处理加载配置
     */
    private async handleLoadConfig() {
        const config = this.mcpService.getConfig();

        this._view?.webview.postMessage({
            type: 'configLoaded',
            config
        });
    }

    /**
     * 处理重置配置
     */
    private async handleResetConfig() {
        try {
            // 获取默认配置
            const defaultConfig = this.mcpService.getDefaultConfig();

            // 保存默认配置
            await this.mcpService.saveConfig(defaultConfig);

            // 发送配置加载消息，更新前端显示
            this._view?.webview.postMessage({
                type: 'configLoaded',
                config: defaultConfig
            });

            // 显示重置成功的提示
            vscode.window.showInformationMessage('MCP配置已重置为默认值');

            this._view?.webview.postMessage({
                type: 'configSaved',
                success: true
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`重置MCP配置失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理保存配置
     */
    private async handleSaveConfig(config: McpConfig) {
        try {
            await this.mcpService.saveConfig(config);

            // 添加保存成功的提示
            vscode.window.showInformationMessage('MCP配置已保存');

            this._view?.webview.postMessage({
                type: 'configSaved',
                success: true
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`保存MCP配置失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'configSaved',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理启动MCP服务
     */
    private async handleStart() {
        try {
            // 显示启动中状态
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: '正在启动服务...'
                }
            });

            await this.mcpService.start();
            await this.handleGetStatus();

            // 启动成功后自动切换到MCP服务面板
            vscode.commands.executeCommand('workbench.view.extension.yonbip-view');

            this._view?.webview.postMessage({
                type: 'mcpStarted',
                success: true
            });
        } catch (error: any) {
            // 更新状态为错误
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: `启动失败: ${error.message}`
                }
            });

            this._view?.webview.postMessage({
                type: 'mcpStarted',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理停止MCP服务
     */
    private async handleStop() {
        try {
            this.outputChannel.appendLine('开始停止MCP服务...');

            // 先更新状态为停止中
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    message: '正在停止服务...'
                }
            });

            await this.mcpService.stop();

            // 停止完成后更新状态
            await this.handleGetStatus();

            this._view?.webview.postMessage({
                type: 'mcpStopped',
                success: true
            });

            this.outputChannel.appendLine('MCP服务停止操作完成');
        } catch (error: any) {
            this.outputChannel.appendLine(`MCP服务停止失败: ${error.message}`);
            this._view?.webview.postMessage({
                type: 'mcpStopped',
                success: false,
                error: error.message
            });
        }
    }



    /**
     * 处理获取状态
     */
    private async handleGetStatus() {
        try {
            const mcpStatus = this.mcpService.getStatus();
            const alive = await this.mcpService.isServiceAlive();
            const status = {
                isRunning: alive,
                hasError: mcpStatus === McpStatus.ERROR,
                message: this.getStatusMessageWithAlive(mcpStatus, alive)
            };

            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'statusLoaded',
                status: {
                    isRunning: false,
                    hasError: false,
                    message: `获取状态失败: ${error.message}`
                }
            });
        }
    }

    /**
     * 获取状态消息
     */
    private getStatusMessageWithAlive(status: McpStatus, alive: boolean): string {
        if (alive) {
            if (status === McpStatus.ERROR) {
                return '服务运行中（日志出现错误）';
            }
            if (status === McpStatus.STARTING) {
                return '服务正在启动中';
            }
            return '服务正在运行中';
        } else {
            switch (status) {
                case McpStatus.STOPPING:
                    return '服务正在停止中';
                case McpStatus.ERROR:
                    return '服务发生错误（可能已不可用）';
                case McpStatus.STOPPED:
                default:
                    return '服务已停止';
            }
        }
    }



    /**
     * 处理显示重置确认对话框
     */
    private async handleShowResetConfirm() {
        const result = await vscode.window.showWarningMessage(
            '确定要重置所有配置为默认值吗？',
            '确定',
            '取消'
        );

        if (result === '确定') {
            await this.handleResetConfig();
        }
    }

    /**
     * 处理选择JAR文件
     */
    private async handleSelectJarFile() {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'JAR文件': ['jar']
                },
                openLabel: '选择MCP JAR文件'
            });

            if (result && result[0]) {
                this._view?.webview.postMessage({
                    type: 'jarFileSelected',
                    success: true,
                    jarPath: result[0].fsPath
                });
            } else {
                this._view?.webview.postMessage({
                    type: 'jarFileSelected',
                    success: false
                });
            }
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'jarFileSelected',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理选择Java路径
     */
    private async handleSelectJavaPath() {
        try {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'Executable Files': ['exe', 'bat', 'cmd', 'sh', 'bin'],
                    'All Files': ['*']
                },
                openLabel: '选择Java可执行文件'
            });

            if (result && result[0]) {
                this._view?.webview.postMessage({
                    type: 'javaPathSelected',
                    success: true,
                    javaPath: result[0].fsPath
                });
            } else {
                this._view?.webview.postMessage({
                    type: 'javaPathSelected',
                    success: false
                });
            }
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'javaPathSelected',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理下载JSON文件
     */
    private async handleDownloadJson(tenant: string, version: string) {
        console.log('handleDownloadJson被调用，租户:', tenant, '版本:', version);
        // 主动打开输出面板，方便定位“看不到日志”的问题
        this.outputChannel.show(true);
        this.outputChannel.appendLine(`处理下载JSON文件请求 - 租户: ${tenant}, 版本: ${version}`);
        // 立即给用户反馈，避免“点击没反应”的感觉
        vscode.window.setStatusBarMessage('正在准备 JSON 文件...', 3000);
        try {
            if (!tenant) {
                vscode.window.showErrorMessage('租户信息不能为空');
                return;
            }

            // 构建源文件路径
            const sourceFileName = `${version}.json`;
            const sourcePath = path.join(this._extensionUri.fsPath, 'resources', 'env', sourceFileName);

            this.outputChannel.appendLine(`源文件路径: ${sourcePath}`);

            // 检查文件是否存在
            if (!fs.existsSync(sourcePath)) {
                vscode.window.showErrorMessage(`找不到配置文件: ${sourceFileName}`);
                this.outputChannel.appendLine(`错误: 找不到配置文件 ${sourcePath}`);
                return;
            }

            // 读取JSON文件内容
            let fileContent = fs.readFileSync(sourcePath, 'utf-8');
            this.outputChannel.appendLine(`成功读取文件，大小: ${fileContent.length} 字符`);

            // 替换所有的 XXXXXXXXX 为租户信息
            const tenantRegex = /XXXXXXXXX/g;
            const matches = fileContent.match(tenantRegex);
            this.outputChannel.appendLine(`找到 ${matches ? matches.length : 0} 个占位符需要替换`);

            fileContent = fileContent.replace(tenantRegex, tenant);

            // 直接保存到「下载」文件夹，避免保存对话框不显示或找不到文件
            const downloadsDir = this.getDefaultDownloadDir();
            const saveFileName = `${version}_${tenant}.json`;
            const savePath = path.join(downloadsDir, saveFileName);

            fs.mkdirSync(downloadsDir, { recursive: true });
            fs.writeFileSync(savePath, fileContent, 'utf-8');

            this.outputChannel.appendLine(`JSON 文件已保存到: ${savePath}`);

            // 弹出明确提示，提供「在系统中显示」「打开文件」按钮
            const action = await vscode.window.showInformationMessage(
                `JSON 文件已保存到「下载」文件夹: ${saveFileName}\n完整路径: ${savePath}`,
                '在系统中显示',
                '打开文件'
            );

            if (action === '在系统中显示') {
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(savePath));
            } else if (action === '打开文件') {
                const doc = await vscode.workspace.openTextDocument(savePath);
                await vscode.window.showTextDocument(doc);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`下载JSON文件失败: ${error.message}`);
            this.outputChannel.appendLine(`下载JSON文件失败: ${error.message}`);
            console.error('下载JSON文件失败:', error);
        }
    }


    private getDefaultDownloadDir(): string {
        const home = os.homedir();
        // Windows: USERPROFILE\Downloads 通常存在
        const userProfile =
            process.platform === 'win32'
                ? (process.env.USERPROFILE || process.env.HOMEPATH || process.env.HOME || home)
                : home;

        const candidate = path.join(userProfile, 'Downloads');
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // ignore
        }
        // 若 Downloads 不存在（或权限问题），退回到用户主目录，确保可写概率更高
        return userProfile;
    }

    /**
     * 生成WebView HTML内容
     */
    public getHtmlForWebview(webview: vscode.Webview): string {
        return this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // 说明文档图片转为 data URI，避免路径 / CSP 带来的不确定性
        const getDocImageDataUri = (fileName: string): string => {
            try {
                const imgPath = vscode.Uri.joinPath(
                    this._extensionUri,
                    'resources',
                    'ultimate-doc-instruction',
                    'image',
                    'typora-user-images',
                    fileName
                ).fsPath;
                if (fs.existsSync(imgPath)) {
                    const base64 = fs.readFileSync(imgPath).toString('base64');
                    return `data:image/png;base64,${base64}`;
                }
            } catch {
                // ignore, 返回空字符串即可
            }
            return '';
        };

        const imgJdkCheck = getDocImageDataUri('image-20260316163347443.png');
        const imgTenantVersion = getDocImageDataUri('image-20260316105036481.png');
        const imgImportJson = getDocImageDataUri('image-20260316105303082.png');
        const imgAuth1 = getDocImageDataUri('image-20260316162031805.png');
        const imgAuth2 = getDocImageDataUri('image-20260316162113336.png');
        const imgAuth3 = getDocImageDataUri('image-20260316162147199.png');
        const imgAuth4 = getDocImageDataUri('image-20260316162217024.png');
        const imgPluginSecret = getDocImageDataUri('image-20260316162334859.png');
        const imgStartService = getDocImageDataUri('image-20260316163113094.png');
        const imgCert1 = getDocImageDataUri('image-20260316101827786.png');
        const imgCert2 = getDocImageDataUri('image-20260316101856238.png');
        const imgCert3 = getDocImageDataUri('image-20260316101934289.png');
        const imgCertOk = getDocImageDataUri('image-20260316104358418.png');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        img-src data: blob:;
        script-src 'unsafe-inline' ${webview.cspSource};
        style-src 'unsafe-inline' ${webview.cspSource};
        font-src ${webview.cspSource} https: data:;
    ">
    <title>MCP服务管理</title>
    <style>
        /* 全局样式优化 */
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-sideBar-background) 100%);
            padding: 0;
            margin: 0;
            line-height: 1.5;
        }
        /* 页面容器与基础布局 */
        #app {
            /* 宽屏下限制内容宽度，避免过度拉伸导致布局混乱 */
            max-width: 1100px;
            width: 100%;
            padding: 24px 24px 120px 24px; /* 增加底部padding为120px，为固定按钮留出空间 */
            background-color: var(--vscode-editor-background);
            border-radius: 12px;
            margin: 16px auto; /* 居中显示 */
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            border: 1px solid var(--vscode-widget-border);
        }
        .section {
            margin-bottom: 24px;
            position: relative;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 12px;
            padding: 24px;
            background-color: var(--vscode-input-background);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .section:hover {
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1);
            border-color: var(--vscode-focusBorder);
        }
        .section-title {
            font-weight: 700;
            margin: 0 0 20px 0;
            color: var(--vscode-foreground);
            font-size: 16px;
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            padding-bottom: 12px;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .section-title::before {
            content: "";
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 60px;
            height: 2px;
            background: linear-gradient(90deg, var(--vscode-button-background), transparent);
        }
        /* 表单组样式优化 */
        .form-group {
            margin-bottom: 24px;
            position: relative;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--vscode-input-foreground);
            font-size: 13px;
            letter-spacing: 0.3px;
        }
        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 8px;
            font-size: 14px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            outline: none;
            box-sizing: border-box;
        }
        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.1);
            transform: translateY(-1px);
        }
        .form-group input:hover,
        .form-group select:hover,
        .form-group textarea:hover {
            border-color: var(--vscode-inputOption-hoverBackground);
        }
        .form-group textarea {
            min-height: 80px;
            resize: vertical;
            font-family: var(--vscode-font-family);
        }
        /* 表单行样式 */
        .form-row {
            display: flex;
            gap: 12px;
            align-items: stretch;
            margin-bottom: 16px;
        }
        .form-row input {
            flex: 1;
        }
        /* 状态指示器优化 */
        .status-indicator {
            display: inline-flex;
            align-items: center;
            padding: 12px 20px;
            border-radius: 30px;
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 20px;
            gap: 10px;
            border: 2px solid var(--vscode-widget-border);
            background-color: var(--vscode-editor-background);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .status-indicator::before {
            content: '';
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background-color: var(--vscode-descriptionForeground);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .status-running {
            color: var(--vscode-terminal-ansiGreen);
            border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 30%, transparent);
            background-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 10%, transparent);
        }
        .status-running::before {
            background-color: var(--vscode-terminal-ansiGreen);
            box-shadow: 0 0 8px var(--vscode-terminal-ansiGreen);
        }
        .status-stopped {
            color: var(--vscode-errorForeground);
            border-color: color-mix(in srgb, var(--vscode-errorForeground) 30%, transparent);
            background-color: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
        }
        .status-stopped::before {
            background-color: var(--vscode-errorForeground);
            box-shadow: 0 0 8px var(--vscode-errorForeground);
        }
        .status-unknown {
            color: var(--vscode-descriptionForeground);
            border-color: color-mix(in srgb, var(--vscode-descriptionForeground) 30%, transparent);
            background-color: color-mix(in srgb, var(--vscode-descriptionForeground) 10%, transparent);
        }
        .status-unknown::before {
            background-color: var(--vscode-descriptionForeground);
            box-shadow: 0 0 8px var(--vscode-descriptionForeground);
        }
        .status-warning {
            color: var(--vscode-terminal-ansiYellow);
            border-color: color-mix(in srgb, var(--vscode-terminal-ansiYellow) 30%, transparent);
            background-color: color-mix(in srgb, var(--vscode-terminal-ansiYellow) 10%, transparent);
        }
        .status-warning::before {
            background-color: var(--vscode-terminal-ansiYellow);
            box-shadow: 0 0 8px var(--vscode-terminal-ansiYellow);
        }
        /* 按钮样式优化 */
        button {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
            min-width: 100px;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        button::before {
            content: "";
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            transition: left 0.5s;
        }
        button:hover::before {
            left: 100%;
        }
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        }
        button:active {
            transform: translateY(0);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        button.primary {
            background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            color: var(--vscode-button-foreground);
            box-shadow: 0 4px 16px rgba(0, 122, 255, 0.3);
        }
        button.primary:hover {
            background: linear-gradient(135deg, var(--vscode-button-hoverBackground) 0%, var(--vscode-button-background) 100%);
            box-shadow: 0 8px 24px rgba(0, 122, 255, 0.4);
        }
        button.secondary {
            background: linear-gradient(135deg, var(--vscode-button-secondaryBackground) 0%, var(--vscode-input-background) 100%);
            color: var(--vscode-button-secondaryForeground);
            border: 2px solid var(--vscode-input-border);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        button.secondary:hover {
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, var(--vscode-button-secondaryBackground) 100%);
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
        }
        button.danger {
            background: linear-gradient(135deg, var(--vscode-errorForeground) 0%, color-mix(in srgb, var(--vscode-errorForeground) 70%, black) 100%);
            color: white;
            box-shadow: 0 4px 16px rgba(255, 0, 0, 0.3);
        }
        button.danger:hover {
            background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-errorForeground) 70%, black) 0%, var(--vscode-errorForeground) 100%);
            box-shadow: 0 8px 24px rgba(255, 0, 0, 0.4);
        }
        /* 选项卡样式优化 */
        .tabs {
            display: flex;
            border-bottom: 2px solid var(--vscode-widget-border);
            margin-bottom: 24px;
            position: sticky;
            top: 0;
            background-color: var(--vscode-editor-background);
            z-index: 90;
            padding-top: 12px;
            border-radius: 12px 12px 0 0;
        }
        .tab {
            padding: 14px 24px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--vscode-foreground);
            margin-right: 6px;
            border-radius: 8px 8px 0 0;
            font-weight: 600;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
        }
        .tab:hover {
            background-color: var(--vscode-tab-hoverBackground);
        }
        .tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-textLink-foreground);
        }
        .tab.active::after {
            content: "";
            position: absolute;
            bottom: -2px;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, var(--vscode-textLink-foreground), transparent);
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
            animation: fadeIn 0.3s ease-in-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        /* 帮助文本样式 */
        .help-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
            font-style: italic;
        }
        .sample-text {
            font-style: normal;
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-editor-background);
            border: 1px dashed var(--vscode-widget-border);
            padding: 8px 10px;
            border-radius: 6px;
            margin-top: 6px;
            word-break: break-all;
        }
        /* 服务控制按钮组 */
        .service-controls {
            display: flex;
            gap: 16px;
            margin-top: 20px;
            flex-wrap: wrap;
        }
        .service-controls button {
            /* 按钮保持自然宽度，避免在超宽屏下被拉伸 */
            flex: 0 0 auto;
            min-width: 140px;
        }
        /* 快速信息网格 */
        #quickInfo {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 16px;
        }
        .config-item {
            background-color: var(--vscode-editor-background);
            border: 2px solid var(--vscode-widget-border);
            border-radius: 12px;
            padding: 20px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
        }
        .config-item:hover {
            border-color: var(--vscode-focusBorder);
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
        }
        .config-label {
            font-weight: 700;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 10px;
            font-size: 14px;
            letter-spacing: 0.3px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .config-label::before {
            content: "🔹";
            font-size: 16px;
        }
        .config-value {
            color: var(--vscode-foreground);
            font-family: var(--vscode-editor-font-family);
            word-break: break-all;
            font-size: 14px;
            line-height: 1.5;
            padding: 8px 12px;
            background-color: var(--vscode-input-background);
            border-radius: 6px;
            border: 1px solid var(--vscode-input-border);
        }
        /* 配置页底部操作条 */
        .sticky-actions {
            position: sticky;
            bottom: 0;
            background-color: var(--vscode-input-background);
            padding: 20px 0;
            border-top: 2px solid var(--vscode-widget-border);
            z-index: 95;
            display: flex;
            gap: 16px;
            justify-content: flex-end;
            box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(8px);
            border-radius: 0 0 12px 12px;
            margin: 0 -24px -24px -24px;
            padding: 20px 24px;
        }
        /* Java路径输入框样式 */
        .path-input-container {
            position: relative;
            display: flex;
            align-items: center;
            width: 100%;
            min-width: 0;
        }
        #javaPath {
            flex: 1 1 auto;
            width: 100%;
            min-width: 0;
            padding-right: 44px;
        }
        .folder-icon {
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%); /* 垂直居中，避免宽屏/不同高度下漂移 */
            cursor: pointer;
            font-size: 18px;
            color: var(--vscode-foreground);
            user-select: none;
            transition: all 0.2s ease;
            background: var(--vscode-input-background);
            padding: 8px;
            border-radius: 6px;
        }
        .folder-icon:hover {
            color: var(--vscode-textLink-foreground);
            background: var(--vscode-input-border);
            transform: scale(1.1);
        }
        /* 响应式布局 - 窄屏优化 */
        @media (max-width: 600px) {
            #app {
                padding: 16px 16px 100px 16px;
                margin: 12px;
            }
            .section {
                padding: 16px;
            }
            .tabs {
                flex-wrap: wrap;
                gap: 6px;
                padding-top: 8px;
            }
            .tab {
                padding: 10px 16px;
                font-size: 13px;
                margin-right: 4px;
                flex: 1;
                min-width: 0;
                text-align: center;
            }
            .form-row {
                flex-direction: column;
                align-items: stretch;
                gap: 12px;
            }
            .form-row label {
                margin-right: 0;
                margin-bottom: 6px;
                min-width: auto;
            }
            .form-row input {
                margin-right: 0;
                width: 100%;
            }
            .service-controls {
                flex-direction: column;
            }
            .service-controls button {
                max-width: 100%;
                width: 100%;
            }
            #quickInfo {
                grid-template-columns: 1fr;
            }
            .config-item {
                max-width: 100%;
            }
            .section-title {
                font-size: 15px;
            }
            .sticky-actions {
                flex-direction: column;
                gap: 12px;
                margin: 0 -16px -16px -16px;
                padding: 16px;
            }
        }
        /* 旗舰版配置页面（advanced）专业化样式与布局 */
        #advanced-tab .section {
            display: grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            gap: 16px 20px;
            padding: 28px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 14px;
            background:
                linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, transparent) 0%, var(--vscode-input-background) 100%);
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        }
        #advanced-tab .section-title {
            grid-column: 1 / -1;
            font-size: 17px;
            letter-spacing: 0.2px;
            color: var(--vscode-foreground);
        }
        #advanced-tab .form-group {
            grid-column: span 6;
            margin: 0;
        }
        #advanced-tab .form-group label {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }
        #advanced-tab .form-group input {
            border: 1.5px solid var(--vscode-input-border);
            background: color-mix(in srgb, var(--vscode-input-background) 88%, transparent);
            border-radius: 10px;
        }
        #advanced-tab .form-group input:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.12);
        }
        /* 自定义版本下拉框样式 */
        .version-dropdown {
            position: relative;
            width: 100%;
        }
        .version-dropdown-trigger {
            width: 100%;
            padding: 12px 40px 12px 16px;
            border: 1.5px solid var(--vscode-input-border);
            background: color-mix(in srgb, var(--vscode-input-background) 88%, transparent);
            color: var(--vscode-input-foreground);
            border-radius: 10px;
            font-size: 14px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: all 0.2s ease;
            box-sizing: border-box;
        }
        .version-dropdown-trigger:hover {
            border-color: var(--vscode-inputOption-hoverBackground);
        }
        .version-dropdown-trigger.open {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.12);
        }
        .version-dropdown-trigger::after {
            content: '';
            position: absolute;
            right: 14px;
            top: 50%;
            transform: translateY(-50%);
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 6px solid var(--vscode-foreground);
            opacity: 0.7;
            transition: transform 0.2s ease;
        }
        .version-dropdown-trigger.open::after {
            transform: translateY(-50%) rotate(180deg);
        }
        .version-dropdown-menu {
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            right: 0;
            background: var(--vscode-dropdown-background, var(--vscode-input-background));
            border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
            z-index: 100;
            overflow: hidden;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-8px);
            transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s;
        }
        .version-dropdown-menu.open {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .version-dropdown-option {
            padding: 12px 16px;
            color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: background 0.15s ease;
        }
        .version-dropdown-option:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .version-dropdown-option.selected {
            background: var(--vscode-list-activeSelectionBackground, var(--vscode-button-background));
            color: var(--vscode-list-activeSelectionForeground, var(--vscode-button-foreground));
        }
        .version-dropdown-option .check-icon {
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            color: inherit;
        }
        .version-dropdown-option:not(.selected) .check-icon {
            visibility: hidden;
        }
        #advanced-tab .help-text {
            margin-top: 6px;
            color: var(--vscode-descriptionForeground);
        }
        /* 操作条占满整行 */
        #advanced-tab .form-group:last-of-type {
            grid-column: 1 / -1;
        }
        #advanced-tab .sticky-actions {
            justify-content: flex-end;
            gap: 12px;
            border-top: 1px solid var(--vscode-widget-border);
            box-shadow: none;
            background: transparent;
            padding: 12px 0 0 0;
            margin: 0;
        }
        #advanced-tab .sticky-actions button {
            min-width: 140px;
        }
        /* 响应式：中屏两列、小屏一列 */
        @media (max-width: 900px) {
            #advanced-tab .form-group {
                grid-column: 1 / -1;
            }
        }
        @media (min-width: 901px) {
            #advanced-tab .form-group:nth-child(odd) {
                grid-column: span 6;
            }
            #advanced-tab .form-group:nth-child(even) {
                grid-column: span 6;
            }
        }
        /* 中等屏幕优化 */
        @media (max-width: 800px) and (min-width: 601px) {
            .form-row {
                flex-wrap: wrap;
            }
            .form-row label {
                min-width: 100px;
            }
            .service-controls button {
                max-width: calc(50% - 10px);
            }
            #quickInfo {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        /* 说明文档全屏预览样式 */
        body.doc-fullscreen {
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
        body.doc-fullscreen #app {
            max-width: 100%;
            width: 100%;
            height: 100vh;
            margin: 0;
            padding: 16px 24px;
            border-radius: 0;
            box-shadow: none;
            border: none;
        }
        body.doc-fullscreen .tabs {
            display: none;
        }
        body.doc-fullscreen .tab-content {
            display: none !important;
        }
        body.doc-fullscreen #doc-tab {
            display: block !important;
        }
        body.doc-fullscreen #doc-tab .section {
            height: 100%;
            margin: 0;
        }
        body.doc-fullscreen #doc-tab .doc-content-scroll {
            max-height: calc(100vh - 100px);
        }
        .doc-header-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .doc-fullscreen-toggle {
            padding: 6px 12px;
            font-size: 12px;
            border-radius: 16px;
        }
    </style>
</head>
<body>
    <div id="app">
        <!-- 页头 -->
        <!--
        <div class="header">
            <div>
                <div class="header-title">YonBIP MCP 服务</div>
                <div class="header-subtitle">本地开发服务管理与配置</div>
            </div>

        </div>
        -->
        <!-- 选项卡 -->
        <div class="tabs">
            <button class="tab active" onclick="switchTab('status')">📊 服务状态</button>
            <button class="tab" onclick="switchTab('config')">⚙️ 配置管理</button>
            <button class="tab" onclick="switchTab('advanced')">🚀 旗舰版配置信息</button>
            <button class="tab" onclick="switchTab('doc')">📖 说明文档</button>
        </div>

        <!-- 服务状态选项卡 -->
        <div id="status-tab" class="tab-content active">
            <div class="section">
                <div class="section-title">MCP 服务状态</div>
                
                <div id="statusIndicator" class="status-indicator status-unknown">
                    🔍 检查服务状态中...
                </div>
                
                <div id="statusMessage" style="margin-bottom: 15px; color: var(--vscode-descriptionForeground);">
                    正在获取服务状态信息...
                </div>
                
                <div class="service-controls">
                    <button id="startBtn" onclick="startMcp()">▶️ 启动服务</button>
                    <button id="stopBtn" onclick="stopMcp()" class="danger">⏹️ 停止服务</button>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">快速信息</div>
                <div id="quickInfo">
                    <div class="config-item">
                        <div class="config-label">服务端口</div>
                        <div class="config-value" id="quickPort">-</div>
                    </div>
                    <div class="config-item">
                        <div class="config-label">Java路径</div>
                        <div class="config-value" id="quickJavaPath">-</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 配置管理选项卡 -->
        <div id="config-tab" class="tab-content">
            <div class="section">
                <div class="section-title">服务配置</div>
                
                <div class="form-group">
                    <label for="port">服务端口:</label>
                    <input type="number" id="port" placeholder="9000" min="1024" max="65535">
                    <div class="help-text">MCP服务监听的端口号 (1024-65535)</div>
                </div>
                
                <div class="form-group">
                    <label for="javaPath">Java可执行文件路径:</label>
                    <div class="form-row">
                        <div class="path-input-container">
                            <input type="text" id="javaPath" placeholder="java" readonly onclick="selectJavaPath()">
                            <span class="folder-icon" onclick="selectJavaPath()">📁</span>
                        </div>
                    </div>
                    <div class="help-text">Java运行时环境路径，留空使用系统默认</div>
                    <div class="help-text sample-text">示例（macOS）：/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home/bin/java</div>
                    <div class="help-text sample-text">示例（Windows）：C:\\Program Files\\Java\\jdk-17\\bin\\java.exe</div>
                    <div class="help-text sample-text">示例（Linux）：/usr/bin/java 或 /usr/lib/jvm/java-17/bin/java</div>
                </div>
                
                <div class="form-group">
                    <div id="configActions" class="sticky-actions">
                        <button onclick="saveConfig()">💾 保存配置</button>
                        <button onclick="resetToDefaults()" class="secondary">🔄 重置为默认</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 旗舰版配置信息选项卡 -->
        <div id="advanced-tab" class="tab-content">
            <div class="section">
                <div class="section-title">旗舰版配置信息</div>
                
                <div class="form-group">
                    <label for="tenant">租户:</label>
                    <input type="text" id="tenant" placeholder="请输入租户信息" oninput="updateUrlFields()">
                </div>

                <div class="form-group">
                    <label for="version">版本:</label>
                    <div class="version-dropdown">
                        <input type="hidden" id="version" value="BIP5">
                        <div class="version-dropdown-trigger" id="versionTrigger" tabindex="0" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-label="选择版本">
                            <span id="versionDisplay">BIP5</span>
                        </div>
                        <div class="version-dropdown-menu" id="versionMenu" role="listbox">
                            <div class="version-dropdown-option selected" data-value="BIP5" role="option">
                                <span class="check-icon">✓</span>
                                <span>BIP5</span>
                            </div>
                            <div class="version-dropdown-option" data-value="BIPV3_R6" role="option">
                                <span class="check-icon">✓</span>
                                <span>BIPV3_R6</span>
                            </div>
                            <div class="version-dropdown-option" data-value="BIPV3_R5" role="option">
                                <span class="check-icon">✓</span>
                                <span>BIPV3_R5</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <label for="apiAppKey">API应用Key(AppKey):</label>
                    <input type="text" id="apiAppKey" placeholder="请输入API应用Key">
                </div>
                
                <div class="form-group">
                    <label for="apiAppSecret">API应用密钥(AppSecret):</label>
                    <input type="password" id="apiAppSecret" placeholder="请输入API应用密钥">
                </div>

                <div class="form-group">
                    <label for="apiUrl">API服务地址(URL):</label>
                    <input type="text" id="apiUrl" placeholder="请输入API服务地址">
                </div>

                <!-- 隐藏的字段，用于存储动态生成的URL -->
                <input type="hidden" id="metadataByname">
                <input type="hidden" id="metadataByboid">
                <input type="hidden" id="metadataEntityid">
                <input type="hidden" id="metadataUri">
                <input type="hidden" id="businessInterfaceList">
                <input type="hidden" id="businessInterfaceDetail">
                
                <div class="form-group">
                    <div id="advancedConfigActions" class="sticky-actions">
                        <button onclick="saveConfig()">💾 保存配置</button>
                        <button onclick="downloadJsonFile()" class="primary">📥 下载JSON文件</button>
                        <button onclick="resetToDefaults()" class="secondary">🔄 重置为默认</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 说明文档选项卡 -->
        <div id="doc-tab" class="tab-content">
            <div class="section">
                <div class="section-title">
                    <span>YDS Premium Fusion - MCP 使用指南</span>
                    <div class="doc-header-actions">
                        <button class="secondary doc-fullscreen-toggle" onclick="toggleDocFullscreen()">
                            ⛶ 全屏预览
                        </button>
                    </div>
                </div>
                <div class="doc-content-scroll" style="max-height:520px; overflow:auto; padding-right:8px;">
                    <h3>1. 检查是否自动获取到 JDK17 以上版本</h3>
                    <p>如果未自动识别，请在 MCP 配置中手动指定 JDK17 及以上版本的 <code>java</code> 可执行路径。</p>
                    <p><img src="${imgJdkCheck}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>

                    <h3>2. 配置租户与选择 BIP 版本</h3>
                    <p>在「旗舰版配置信息」页签中填写租户并选择对应的 BIP 版本（如 BIP5、BIPV3_R6）。</p>
                    <p><img src="${imgTenantVersion}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>

                    <h3>3. 将下载的 JSON 文件导入到系统的 API 发布中</h3>
                    <p>在 YonBIP 后台导入 JSON 配置后，记得<strong>全部发布</strong>。</p>
                    <p><img src="${imgImportJson}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>

                    <h3>4. API 调用处新增授权</h3>
                    <p>根据文档提示在 API 调用处新增授权，确保访问权限正确。</p>
                    <p>
                        <img src="${imgAuth1}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" />
                    </p>
                    <p>
                        <img src="${imgAuth2}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" />
                    </p>
                    <p>
                        <img src="${imgAuth3}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" />
                    </p>
                    <p>
                        <img src="${imgAuth4}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" />
                    </p>

                    <h3>5. 配置密钥信息到插件中</h3>
                    <p>将 YonBIP 后台获取的 AppKey / AppSecret / API 地址等信息配置到 MCP 插件界面，然后点击保存。</p>
                    <p><img src="${imgPluginSecret}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>

                    <h3>6. 启动服务</h3>
                    <p>在「服务状态」页签中点击「启动服务」，启动成功后可在 VS Code 状态栏和页面上看到运行状态。</p>
                    <p><img src="${imgStartService}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>

                    <h3>常见问题：证书错误</h3>
                    <p>错误信息类似：</p>
                    <p class="sample-text">请求业务对象信息失败: PKIX path building failed: sun.security.provider.certpath.SunCertPathBuilderException: unable to find valid certification path to requested target</p>

                    <h4>1）手动导出证书（浏览器）</h4>
                    <p>在浏览器中访问目标地址，导出证书文件（后缀修改为 <code>.crt</code>）。</p>
                    <p><img src="${imgCert1}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>
                    <p><img src="${imgCert2}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>
                    <p><img src="${imgCert3}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>

                    <h4>2）使用 keytool 导入到 JDK</h4>
                    <p>在终端执行类似命令（路径替换为你本机 JDK 与证书路径）：</p>
                    <pre class="sample-text">"D:\\home\\20240515\\ufjdk\\bin\\keytool.exe" -import -alias tkkfbip-cert -file "C:\\Users\\Administrator\\Desktop\\test.crt" -keystore "D:\\home\\20240515\\ufjdk\\lib\\security\\cacerts" -storepass changeit</pre>

                    <h4>3）导入成功示例</h4>
                    <p><img src="${imgCertOk}" style="max-width:100%;border-radius:6px;border:1px solid var(--vscode-widget-border);" /></p>
                </div>
            </div>
        </div>


    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentConfig = {};
        let currentStatus = {};
        
        // 版本下拉框交互
        (function initVersionDropdown() {
            const trigger = document.getElementById('versionTrigger');
            const menu = document.getElementById('versionMenu');
            const hiddenInput = document.getElementById('version');
            const display = document.getElementById('versionDisplay');
            const options = document.querySelectorAll('.version-dropdown-option');
            
            function setValue(value, label) {
                hiddenInput.value = value;
                display.textContent = label || value;
                options.forEach(opt => {
                    opt.classList.toggle('selected', opt.dataset.value === value);
                });
            }
            
            function closeMenu() {
                trigger.classList.remove('open');
                menu.classList.remove('open');
                trigger.setAttribute('aria-expanded', 'false');
            }
            
            function openMenu() {
                trigger.classList.add('open');
                menu.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
            }
            
            trigger.addEventListener('click', function(e) {
                e.stopPropagation();
                if (menu.classList.contains('open')) {
                    closeMenu();
                } else {
                    openMenu();
                }
            });
            
            trigger.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (menu.classList.contains('open')) closeMenu();
                    else openMenu();
                }
            });
            
            options.forEach(opt => {
                opt.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const value = this.dataset.value;
                    const label = this.querySelector('span:last-child').textContent;
                    setValue(value, label);
                    closeMenu();
                });
            });
            
            document.addEventListener('click', function() {
                closeMenu();
            });
            
            menu.addEventListener('click', function(e) {
                e.stopPropagation();
            });
        })();
        
        // 切换选项卡
        function switchTab(tabName) {
            const tabs = document.querySelectorAll('.tab-content');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            document.getElementById(tabName + '-tab').classList.add('active');
            
            // 确保触发的按钮存在后再添加active类
            if (event && event.target) {
                event.target.classList.add('active');
            } else {
                // 如果找不到event.target，尝试通过tabName找到对应的按钮
                const tabButton = Array.from(tabButtons).find(btn => {
                    const onclickAttr = btn.getAttribute('onclick');
                    return onclickAttr && onclickAttr.indexOf('switchTab("' + tabName + '")') !== -1;
                });
                if (tabButton) {
                    tabButton.classList.add('active');
                }
            }
        }

        // 切换说明文档全屏预览
        function toggleDocFullscreen() {
            const body = document.body;
            const btn = document.querySelector('.doc-fullscreen-toggle');
            const isFull = body.classList.toggle('doc-fullscreen');
            if (btn) {
                btn.textContent = isFull ? '⤢ 退出全屏' : '⛶ 全屏预览';
            }
        }
        
        // 启动MCP服务
        function startMcp() {
            vscode.postMessage({ type: 'startMcp' });
        }
        
        // 停止MCP服务
        function stopMcp() {
            console.log('点击了停止服务按钮，直接执行停止操作');
            
            // 立即禁用按钮，显示停止中状态
            const stopBtn = document.getElementById('stopBtn');
            if (stopBtn) {
                stopBtn.disabled = true;
                stopBtn.textContent = '⏹️ 停止中...';
            }
            
            const indicator = document.getElementById('statusIndicator');
            if (indicator) {
                indicator.className = 'status-indicator status-stopped';
                indicator.textContent = '🟡 正在停止...';
            }
            
            console.log('发送停止消息到后端');
            vscode.postMessage({ type: 'stopMcp' });
        }
        

        
        // 选择JAR文件
        function selectJarFile() {
            vscode.postMessage({ type: 'selectJarFile' });
        }
        
        // 选择Java路径
        function selectJavaPath() {
            vscode.postMessage({ type: 'selectJavaPath' });
        }
        
        // 保存配置
        function saveConfig() {
            const config = {
                port: parseInt(document.getElementById('port').value) || 9000,
                javaPath: document.getElementById('javaPath').value || 'java',
                tenant: document.getElementById('tenant').value || undefined,
                version: document.getElementById('version').value || 'BIP5',
                apiAppKey: document.getElementById('apiAppKey').value || undefined,
                apiAppSecret: document.getElementById('apiAppSecret').value || undefined,
                apiUrl: document.getElementById('apiUrl').value || undefined,
                metadataByname: document.getElementById('metadataByname').value || undefined,
                metadataByboid: document.getElementById('metadataByboid').value || undefined,
                metadataEntityid: document.getElementById('metadataEntityid').value || undefined,
                metadataUri: document.getElementById('metadataUri').value || undefined,
                businessInterfaceList: document.getElementById('businessInterfaceList').value || undefined,
                businessInterfaceDetail: document.getElementById('businessInterfaceDetail').value || undefined
            };

            vscode.postMessage({
                type: 'saveConfig',
                config: config
            });
        }

        // 下载JSON文件（与保存配置相同流程：直接发送消息，由后端校验并反馈）
        function downloadJsonFile() {
            const config = {
                port: parseInt(document.getElementById('port').value) || 9000,
                javaPath: document.getElementById('javaPath').value || 'java',
                tenant: document.getElementById('tenant').value || undefined,
                version: document.getElementById('version').value || 'BIP5',
                apiAppKey: document.getElementById('apiAppKey').value || undefined,
                apiAppSecret: document.getElementById('apiAppSecret').value || undefined,
                apiUrl: document.getElementById('apiUrl').value || undefined,
                metadataByname: document.getElementById('metadataByname').value || undefined,
                metadataByboid: document.getElementById('metadataByboid').value || undefined,
                metadataEntityid: document.getElementById('metadataEntityid').value || undefined,
                metadataUri: document.getElementById('metadataUri').value || undefined,
                businessInterfaceList: document.getElementById('businessInterfaceList').value || undefined,
                businessInterfaceDetail: document.getElementById('businessInterfaceDetail').value || undefined
            };

            vscode.postMessage({
                type: 'downloadJson',
                tenant: config.tenant,
                version: config.version
            });
        }

        // URL模板配置（apiUrl需要用户手动输入）
        const urlTemplates = {
            metadataByname: '/iuap-api-gateway/{tenant}/current_yonbip_default_sys/GDBG/businessobject/searchByName',
            metadataByboid: '/iuap-api-gateway/{tenant}/current_yonbip_default_sys/GDBG/businessobject/getEntityListByBOId',
            metadataEntityid: '/iuap-api-gateway/{tenant}/current_yonbip_default_sys/GDBG/getEntityInfoByBOIdAndEntityId',
            metadataUri: '/iuap-api-gateway/{tenant}/current_yonbip_default_sys/GDBG/queryByUri',
            businessInterfaceList: '/iuap-api-gateway/{tenant}/yonbip/CPC/api/search',
            businessInterfaceDetail: '/iuap-api-gateway/{tenant}/yonbip/CPC/api/detail/{apiId}'
        };

        // 根据租户动态生成URL
        function generateUrls(tenant) {
            if (!tenant) {
                return {
                    metadataByname: '',
                    metadataByboid: '',
                    metadataEntityid: '',
                    metadataUri: '',
                    businessInterfaceList: '',
                    businessInterfaceDetail: ''
                };
            }

            return {
                metadataByname: urlTemplates.metadataByname.replace(/\{tenant\}/g, tenant),
                metadataByboid: urlTemplates.metadataByboid.replace(/\{tenant\}/g, tenant),
                metadataEntityid: urlTemplates.metadataEntityid.replace(/\{tenant\}/g, tenant),
                metadataUri: urlTemplates.metadataUri.replace(/\{tenant\}/g, tenant),
                businessInterfaceList: urlTemplates.businessInterfaceList.replace(/\{tenant\}/g, tenant),
                businessInterfaceDetail: urlTemplates.businessInterfaceDetail.replace(/\{tenant\}/g, tenant)
            };
        }

        // 更新URL字段
        function updateUrlFields() {
            const tenant = document.getElementById('tenant').value;
            const urls = generateUrls(tenant);

            document.getElementById('metadataByname').value = urls.metadataByname;
            document.getElementById('metadataByboid').value = urls.metadataByboid;
            document.getElementById('metadataEntityid').value = urls.metadataEntityid;
            document.getElementById('metadataUri').value = urls.metadataUri;
            document.getElementById('businessInterfaceList').value = urls.businessInterfaceList;
            document.getElementById('businessInterfaceDetail').value = urls.businessInterfaceDetail;
        }
        
        // 重置为默认配置
        function resetToDefaults() {
                vscode.postMessage({
                    type: 'resetConfig'
                });
        }
        

        
        // 更新配置显示
        function updateConfigDisplay(config) {
            currentConfig = config;

            document.getElementById('port').value = config.port || 9000;
            document.getElementById('javaPath').value = config.javaPath || 'java';
            document.getElementById('tenant').value = config.tenant || '';
            const version = config.version || 'BIP5';
            document.getElementById('version').value = version;
            const versionDisplay = document.getElementById('versionDisplay');
            if (versionDisplay) versionDisplay.textContent = version;
            document.querySelectorAll('.version-dropdown-option').forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.value === version);
            });
            document.getElementById('apiAppKey').value = config.apiAppKey || '';
            document.getElementById('apiAppSecret').value = config.apiAppSecret || '';
            document.getElementById('apiUrl').value = config.apiUrl || '';

            // 根据租户动态生成URL（metadata相关的URL）
            if (config.tenant) {
                updateUrlFields();
            } else {
                document.getElementById('metadataByname').value = config.metadataByname || '';
                document.getElementById('metadataByboid').value = config.metadataByboid || '';
                document.getElementById('metadataEntityid').value = config.metadataEntityid || '';
                document.getElementById('metadataUri').value = config.metadataUri || '';
                document.getElementById('businessInterfaceList').value = config.businessInterfaceList || '';
                document.getElementById('businessInterfaceDetail').value = config.businessInterfaceDetail || '';
            }

            // 更新快速信息
            document.getElementById('quickPort').textContent = config.port || 9000;
            document.getElementById('quickJavaPath').textContent = config.javaPath || 'java';

            // 更新页头端口摘要
            const portChip = document.getElementById('headerPortChip');
            if (portChip) {
                portChip.textContent = '端口: ' + (config.port || 9000);
            }
        }
        
        // 更新状态显示
        function updateStatusDisplay(status) {
            currentStatus = status;
            
            const indicator = document.getElementById('statusIndicator');
            const message = document.getElementById('statusMessage');
            const startBtn = document.getElementById('startBtn');
            const stopBtn = document.getElementById('stopBtn');
            
            if (status.isRunning && status.hasError) {
                indicator.className = 'status-indicator status-warning';
                indicator.textContent = '🟡 服务运行中（出现错误日志）';
                
                startBtn.disabled = true;
                stopBtn.disabled = false;
                stopBtn.textContent = '⏹️ 停止服务';
            } else if (status.isRunning) {
                indicator.className = 'status-indicator status-running';
                indicator.textContent = '服务运行中';
                
                startBtn.disabled = true;
                stopBtn.disabled = false;
                stopBtn.textContent = '⏹️ 停止服务';
            } else {
                indicator.className = 'status-indicator status-stopped';
                indicator.textContent = '服务已停止';
                
                startBtn.disabled = false;
                stopBtn.disabled = true;
                stopBtn.textContent = '⏹️ 停止服务';
            }
            
            message.textContent = status.message || '无状态信息';

            // 更新页头状态摘要
            const headerStatusChip = document.getElementById('headerStatusChip');
            if (headerStatusChip) {
                if (status.isRunning && status.hasError) {
                    headerStatusChip.textContent = '状态: 运行中（异常）';
                    headerStatusChip.className = 'chip chip-warning';
                } else if (status.isRunning) {
                    headerStatusChip.textContent = '状态: 运行中';
                    headerStatusChip.className = 'chip chip-running';
                } else {
                    headerStatusChip.textContent = '状态: 已停止';
                    headerStatusChip.className = 'chip chip-stopped';
                }
            }
        }
        
        // 监听消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configLoaded':
                    updateConfigDisplay(message.config);
                    break;
                    
                case 'statusLoaded':
                    updateStatusDisplay(message.status);
                    break;
                    
                case 'configSaved':
                    if (message.success) {
                        console.log('配置保存成功');
                    } else {
                        console.error('配置保存失败: ' + message.error);
                    }
                    break;
                    
                case 'mcpStarted':
                    if (message.success) {
                        console.log('MCP服务启动成功');
                    } else {
                        console.error('MCP服务启动失败: ' + message.error);
                    }
                    break;
                    
                case 'mcpStopped':
                    if (message.success) {
                        console.log('MCP服务已停止');
                    } else {
                        console.error('MCP服务停止失败: ' + message.error);
                    }
                    break;
                    

                    
                case 'jarFileSelected':
                    if (message.success && message.jarPath) {
                        document.getElementById('jarPath').value = message.jarPath;
                        console.log('JAR文件选择成功: ' + message.jarPath);
                    } else {
                        console.log('取消选择JAR文件');
                    }
                    break;
                    
                case 'javaPathSelected':
                    if (message.success && message.javaPath) {
                        document.getElementById('javaPath').value = message.javaPath;
                        console.log('Java路径选择成功: ' + message.javaPath);
                    } else {
                        console.log('取消选择Java路径');
                    }
                    break;
            }
        });
        
        // 页面加载完成后加载配置
        vscode.postMessage({ type: 'loadConfig' });
        
        // 定期刷新状态 - 使用变量控制，避免停止后继续刷新
        let statusInterval = setInterval(() => {
            vscode.postMessage({ type: 'getStatus' });
        }, 5000);
        
        // 监听停止事件，清理定时器
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.type === 'mcpStopped' && message.success) {
                clearInterval(statusInterval);
                console.log('服务已停止，清理状态刷新定时器');
                
                // 延迟重新启动定时器（服务完全停止后）
                setTimeout(() => {
                    statusInterval = setInterval(() => {
                        vscode.postMessage({ type: 'getStatus' });
                    }, 5000);
                }, 3000);
            }
        });
    </script>
</body>
</html>`;
    }
}
