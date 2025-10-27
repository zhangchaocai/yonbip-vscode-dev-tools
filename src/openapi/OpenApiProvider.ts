import * as vscode from 'vscode';
import { OpenApiService, ApiRequest, ApiResponse, OpenApiConfig } from './OpenApiService';

/**
 * OpenAPI WebView提供者
 */
export class OpenApiProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'yonbip-openapi';
    
    private _view?: vscode.WebviewView;
    private openApiService: OpenApiService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) {
        this.openApiService = new OpenApiService(context);
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
                case 'sendRequest':
                    await this.handleSendRequest(data.request, data.configId);
                    break;
                case 'saveConfigs':
                    await this.handleSaveConfigs(data.configs, data.currentConfigId);
                    break;
                case 'loadConfigs':
                    await this.handleLoadConfigs();
                    break;
                case 'testConnection':
                    await this.handleTestConnection(data.configId);
                    break;
                case 'addConfig':
                    await this.handleAddConfig(data.config);
                    break;
                case 'updateConfig':
                    await this.handleUpdateConfig(data.config);
                    break;
                case 'deleteConfig':
                    await this.handleDeleteConfig(data.configId);
                    break;
                case 'setCurrentConfig':
                    await this.handleSetCurrentConfig(data.configId);
                    break;
                case 'showError':
                    vscode.window.showErrorMessage(data.message);
                    break;
                case 'confirmDelete':
                    const deleteConfirmation = await vscode.window.showWarningMessage(data.message, '是', '否');
                    if (deleteConfirmation === '是') {
                        await this.handleDeleteConfig(data.configId);
                    }
                    break;
            }
        });

        // 初始加载配置
        this.handleLoadConfigs();
    }

    /**
     * 处理发送请求
     */
    private async handleSendRequest(request: ApiRequest, configId?: string) {
        try {
            const response = await this.openApiService.sendRequest(request, configId);
            this._view?.webview.postMessage({
                type: 'requestResponse',
                success: true,
                response
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'requestResponse',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理保存所有配置
     */
    private async handleSaveConfigs(configs: OpenApiConfig[], currentConfigId: string) {
        try {
            await this.openApiService.saveConfigs(configs, currentConfigId);
            vscode.window.showInformationMessage('配置已保存');
        } catch (error: any) {
            vscode.window.showErrorMessage(`保存配置失败: ${error.message}`);
        }
    }

    /**
     * 处理加载所有配置
     */
    private async handleLoadConfigs() {
        const configs = this.openApiService.getConfigs();
        const currentConfig = this.openApiService.getCurrentConfig();
        this._view?.webview.postMessage({
            type: 'configsLoaded',
            configs,
            currentConfig
        });
    }

    /**
     * 处理测试连接
     */
    private async handleTestConnection(configId?: string) {
        try {
            const result = await this.openApiService.testConnection(configId);
            this._view?.webview.postMessage({
                type: 'connectionTest',
                success: result.success,
                message: result.message
            });
        } catch (error: any) {
            this._view?.webview.postMessage({
                type: 'connectionTest',
                success: false,
                message: `连接失败: ${error.message}`
            });
        }
    }

    /**
     * 处理添加配置
     */
    private async handleAddConfig(config: OpenApiConfig) {
        try {
            await this.openApiService.addConfig(config);
            vscode.window.showInformationMessage('配置已添加');
            // 重新加载配置
            await this.handleLoadConfigs();
        } catch (error: any) {
            vscode.window.showErrorMessage(`添加配置失败: ${error.message}`);
        }
    }

    /**
     * 处理更新配置
     */
    private async handleUpdateConfig(config: OpenApiConfig) {
        try {
            await this.openApiService.updateConfig(config);
            vscode.window.showInformationMessage('配置已更新');
            // 重新加载配置
            await this.handleLoadConfigs();
        } catch (error: any) {
            vscode.window.showErrorMessage(`更新配置失败: ${error.message}`);
        }
    }

    /**
     * 处理删除配置
     */
    private async handleDeleteConfig(configId: string) {
        try {
            await this.openApiService.deleteConfig(configId);
            vscode.window.showInformationMessage('配置已删除');
            // 重新加载配置
            await this.handleLoadConfigs();
        } catch (error: any) {
            vscode.window.showErrorMessage(`删除配置失败: ${error.message}`);
        }
    }

    /**
     * 处理设置当前配置
     */
    private async handleSetCurrentConfig(configId: string) {
        try {
            await this.openApiService.setCurrentConfig(configId);
            // 重新加载配置
            await this.handleLoadConfigs();
        } catch (error: any) {
            vscode.window.showErrorMessage(`设置当前配置失败: ${error.message}`);
        }
    }

    /**
     * 生成WebView HTML内容
     */
    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenAPI测试工具</title>
    <style>
        /* ===== 设计系统基础变量 ===== */
        :root {
            /* 间距系统 - 基于8px网格 */
            --space-xs: 4px;
            --space-sm: 8px;
            --space-md: 16px;
            --space-lg: 24px;
            --space-xl: 32px;
            --space-2xl: 48px;
            
            /* 圆角系统 */
            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 12px;
            --radius-xl: 16px;
            
            /* 阴影系统 */
            --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.08);
            --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.12);
            --shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.15);
            --shadow-xl: 0 12px 24px rgba(0, 0, 0, 0.18);
            
            /* 动画系统 */
            --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
            --transition-normal: 300ms cubic-bezier(0.4, 0, 0.2, 1);
            --transition-slow: 500ms cubic-bezier(0.4, 0, 0.2, 1);
            
            /* 字体系统 */
            --font-size-xs: 12px;
            --font-size-sm: 13px;
            --font-size-base: 14px;
            --font-size-lg: 16px;
            --font-size-xl: 18px;
            --font-size-2xl: 20px;
            
            /* 行高系统 */
            --line-height-tight: 1.25;
            --line-height-normal: 1.5;
            --line-height-relaxed: 1.75;
            
            /* Z-index系统 */
            --z-dropdown: 1000;
            --z-modal: 1050;
            --z-tooltip: 1100;
            --z-notification: 1200;
        }

        /* ===== 全局重置和基础样式 ===== */
        * {
            box-sizing: border-box;
        }
        
        *::before,
        *::after {
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--font-size-base);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
            line-height: var(--line-height-normal);
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        /* ===== 布局容器组件 ===== */
        .app-container {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            background: linear-gradient(135deg, 
                var(--vscode-editor-background) 0%, 
                color-mix(in srgb, var(--vscode-editor-background) 95%, var(--vscode-button-background) 5%) 100%);
        }
        
        .form-container {
            flex: 1;
            max-width: 100%;
            padding: var(--space-xl);
            background: linear-gradient(135deg, 
                var(--vscode-editor-background) 0%, 
                color-mix(in srgb, var(--vscode-editor-background) 98%, var(--vscode-button-background) 2%) 100%);
            border-radius: var(--radius-xl);
            margin: var(--space-lg);
            box-shadow: var(--shadow-xl);
            border: 1px solid color-mix(in srgb, var(--vscode-widget-border) 80%, var(--vscode-button-background) 20%);
            position: relative;
            overflow: hidden;
            backdrop-filter: blur(10px);
        }
        
        .form-container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, 
                var(--vscode-button-background), 
                var(--vscode-textLink-foreground),
                color-mix(in srgb, var(--vscode-button-background) 70%, var(--vscode-textLink-foreground) 30%));
            opacity: 0.9;
            border-radius: var(--radius-xl) var(--radius-xl) 0 0;
        }
        
        .form-container::after {
            content: '';
            position: absolute;
            top: 4px;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(180deg, 
                color-mix(in srgb, var(--vscode-button-background) 5%, transparent) 0%,
                transparent 20%);
            pointer-events: none;
            border-radius: 0 0 var(--radius-xl) var(--radius-xl);
        }
        /* ===== 表单组件系统 ===== */
        .form-group {
            margin-bottom: var(--space-xl);
            position: relative;
            padding: var(--space-md);
            background: linear-gradient(135deg, 
                color-mix(in srgb, var(--vscode-input-background) 95%, var(--vscode-button-background) 5%) 0%,
                var(--vscode-input-background) 100%);
            border-radius: var(--radius-lg);
            border: 1px solid color-mix(in srgb, var(--vscode-input-border) 90%, var(--vscode-button-background) 10%);
            transition: var(--transition-normal);
        }
        
        .form-group:hover {
            border-color: color-mix(in srgb, var(--vscode-input-border) 70%, var(--vscode-button-background) 30%);
            box-shadow: var(--shadow-sm);
            transform: translateY(-1px);
        }
        
        .form-group:focus-within {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-focusBorder) 20%, transparent);
            transform: translateY(-2px);
        }
        
        .form-group label {
            display: block;
            margin-bottom: var(--space-md);
            font-weight: 700;
            color: var(--vscode-foreground);
            font-size: var(--font-size-base);
            letter-spacing: 0.2px;
            line-height: var(--line-height-tight);
            position: relative;
        }
        
        .form-group label::after {
            content: '';
            display: inline-block;
            width: 6px;
            height: 6px;
            background: linear-gradient(45deg, var(--vscode-button-background), var(--vscode-textLink-foreground));
            border-radius: 50%;
            margin-left: var(--space-sm);
            opacity: 0.8;
            box-shadow: 0 0 4px color-mix(in srgb, var(--vscode-button-background) 50%, transparent);
        }
        
        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: var(--space-sm) var(--space-md);
            border: 2px solid transparent;
            background: linear-gradient(135deg, 
                var(--vscode-input-background) 0%,
                color-mix(in srgb, var(--vscode-input-background) 97%, var(--vscode-button-background) 3%) 100%);
            color: var(--vscode-input-foreground);
            border-radius: var(--radius-lg);
            font-size: var(--font-size-base);
            font-family: inherit;
            line-height: var(--line-height-normal);
            transition: var(--transition-normal);
            outline: none;
            position: relative;
            box-shadow: inset 0 1px 3px color-mix(in srgb, var(--vscode-input-border) 30%, transparent),
                        0 1px 0 color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
            min-height: 36px;
            resize: vertical;
        }
        
        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-focusBorder) 25%, transparent),
                        inset 0 1px 3px color-mix(in srgb, var(--vscode-focusBorder) 20%, transparent),
                        0 4px 12px color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent);
            transform: translateY(-2px);
            background: linear-gradient(135deg, 
                color-mix(in srgb, var(--vscode-input-background) 95%, var(--vscode-button-background) 5%) 0%,
                var(--vscode-input-background) 100%);
        }
        
        .form-group input:hover:not(:focus),
        .form-group select:hover:not(:focus),
        .form-group textarea:hover:not(:focus) {
            border-color: color-mix(in srgb, var(--vscode-input-border) 70%, var(--vscode-button-background) 30%);
            background: color-mix(in srgb, var(--vscode-input-background) 99%, var(--vscode-button-background) 1%);
        }
        
        .form-group textarea {
            min-height: 80px;
            resize: vertical;
            font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
            line-height: var(--line-height-relaxed);
        }
        
        /* 输入框状态指示器 */
        .form-group input:valid:not(:placeholder-shown),
        .form-group select:valid,
        .form-group textarea:valid:not(:placeholder-shown) {
            border-left: 3px solid color-mix(in srgb, #22c55e 80%, var(--vscode-input-border) 20%);
        }
        
        .form-group input:invalid:not(:placeholder-shown),
        .form-group textarea:invalid:not(:placeholder-shown) {
            border-left: 3px solid color-mix(in srgb, #ef4444 80%, var(--vscode-input-border) 20%);
        }
        /* ===== 按钮组件系统 ===== */
        button {
            padding: 12px var(--space-lg);
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: var(--font-size-sm);
            font-weight: 600;
            font-family: inherit;
            line-height: var(--line-height-tight);
            transition: var(--transition-normal);
            position: relative;
            overflow: hidden;
            min-width: 100px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-xs);
            text-decoration: none;
            white-space: nowrap;
            user-select: none;
            outline: none;
        }
        
        /* 按钮光泽效果 */
        button::before {
            content: "";
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, 
                transparent, 
                rgba(255, 255, 255, 0.15), 
                transparent);
            transition: left var(--transition-slow);
            z-index: 1;
        }
        
        button:hover::before {
            left: 100%;
        }
        
        /* 主要按钮 */
        .button-primary {
            background: linear-gradient(135deg, 
                var(--vscode-button-background) 0%, 
                color-mix(in srgb, var(--vscode-button-background) 85%, #000 15%) 100%);
            color: var(--vscode-button-foreground);
            box-shadow: var(--shadow-md);
            border: 1px solid color-mix(in srgb, var(--vscode-button-background) 80%, transparent 20%);
        }
        
        .button-primary:hover {
            background: linear-gradient(135deg, 
                color-mix(in srgb, var(--vscode-button-background) 90%, #fff 10%) 0%, 
                var(--vscode-button-background) 100%);
            transform: translateY(-2px);
            box-shadow: var(--shadow-xl);
        }
        
        .button-primary:active {
            transform: translateY(0);
            box-shadow: var(--shadow-sm);
        }
        
        /* 次要按钮 */
        .button-secondary {
            background: var(--vscode-input-background);
            color: var(--vscode-button-secondaryForeground);
            border: 2px solid var(--vscode-input-border);
            box-shadow: var(--shadow-sm);
        }
        
        .button-secondary:hover {
            background: color-mix(in srgb, var(--vscode-input-background) 95%, var(--vscode-button-background) 5%);
            border-color: var(--vscode-focusBorder);
            transform: translateY(-1px);
            box-shadow: var(--shadow-md);
        }
        
        .button-secondary:active {
            transform: translateY(0);
            box-shadow: var(--shadow-sm);
        }
        
        /* 小尺寸按钮 */
        .button-small {
            padding: var(--space-xs) var(--space-md);
            font-size: var(--font-size-xs);
            min-width: auto;
            min-height: 28px;
        }
        
        /* 按钮禁用状态 */
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none !important;
            box-shadow: none !important;
            pointer-events: none;
        }
        
        /* 按钮加载状态 */
        .button-loading {
            position: relative;
            color: transparent !important;
        }
        
        .button-loading::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 16px;
            height: 16px;
            margin: -8px 0 0 -8px;
            border: 2px solid currentColor;
            border-radius: 50%;
            border-top-color: transparent;
            animation: button-spin 0.8s linear infinite;
        }
        
        @keyframes button-spin {
            to { transform: rotate(360deg); }
        }
        .response-area {
            min-height: 200px;
            background-color: var(--vscode-input-background);
            border: 2px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 16px;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
            overflow: auto;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        .status-success {
            color: #4caf50;
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(76, 175, 80, 0.05) 100%);
            font-size: 13px;
            padding: 12px 16px;
            border-radius: 8px;
            border-left: 4px solid #4caf50;
            margin-bottom: 16px;
        }
        .status-error {
            color: var(--vscode-errorForeground);
            background: linear-gradient(135deg, var(--vscode-inputValidation-errorBackground) 0%, rgba(255, 0, 0, 0.05) 100%);
            font-size: 13px;
            padding: 12px 16px;
            border-radius: 8px;
            border-left: 4px solid var(--vscode-inputValidation-errorBorder);
            margin-bottom: 16px;
        }
        /* ===== 选项卡导航系统 ===== */
        .tabs {
            display: flex;
            background: var(--vscode-input-background);
            border-radius: var(--radius-lg) var(--radius-lg) 0 0;
            padding: var(--space-xs);
            margin-bottom: var(--space-lg);
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--vscode-widget-border);
            border-bottom: none;
            position: relative;
            overflow-x: auto;
            scrollbar-width: none;
            -ms-overflow-style: none;
        }
        
        .tabs::-webkit-scrollbar {
            display: none;
        }
        
        .tabs::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: var(--vscode-widget-border);
        }
        
        .tab {
            padding: var(--space-md) var(--space-lg);
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            font-weight: 500;
            font-size: var(--font-size-base);
            font-family: inherit;
            border-radius: var(--radius-md);
            transition: var(--transition-normal);
            position: relative;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: var(--space-xs);
            min-height: 44px;
            outline: none;
            user-select: none;
        }
        
        .tab::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: inherit;
            background: transparent;
            transition: var(--transition-normal);
            z-index: -1;
        }
        
        .tab:hover:not(.active) {
            color: var(--vscode-textLink-foreground);
        }
        
        .tab:hover:not(.active)::before {
            background: color-mix(in srgb, var(--vscode-list-hoverBackground) 60%, transparent);
        }
        
        .tab.active {
            background: var(--vscode-editor-background);
            color: var(--vscode-textLink-foreground);
            font-weight: 600;
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--vscode-widget-border);
            z-index: 1;
        }
        
        .tab.active::after {
            content: "";
            position: absolute;
            bottom: -1px;
            left: 50%;
            transform: translateX(-50%);
            width: 60%;
            height: 3px;
            background: linear-gradient(90deg, 
                var(--vscode-button-background), 
                var(--vscode-textLink-foreground));
            border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        }
        
        /* 选项卡图标 */
        .tab-icon {
            font-size: var(--font-size-lg);
            opacity: 0.8;
            transition: var(--transition-normal);
        }
        
        .tab.active .tab-icon {
            opacity: 1;
        }
        /* ===== 选项卡内容区域 ===== */
        .tab-content {
            display: none;
            animation: slideInUp var(--transition-normal) ease-out;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-top: none;
            border-radius: 0 0 var(--radius-lg) var(--radius-lg);
            padding: var(--space-lg);
            box-shadow: var(--shadow-sm);
        }
        
        .tab-content.active {
            display: block;
        }
        
        @keyframes slideInUp {
            from { 
                opacity: 0; 
                transform: translateY(var(--space-md));
            }
            to { 
                opacity: 1; 
                transform: translateY(0);
            }
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        @keyframes slideIn {
            from { 
                opacity: 0; 
                transform: translateX(-var(--space-md));
            }
            to { 
                opacity: 1; 
                transform: translateX(0);
            }
        }
        .config-list {
            max-height: 300px;
            overflow-y: auto;
            border: 2px solid var(--vscode-input-border);
            border-radius: 12px;
            margin-bottom: 24px;
            background-color: var(--vscode-input-background);
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        .config-item {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-widget-border);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s ease;
        }
        .config-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            transform: translateX(4px);
        }
        .config-item.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
            border-left: 4px solid var(--vscode-textLink-foreground);
        }
        .config-item-info strong {
            display: block;
            font-size: 14px;
            margin-bottom: 4px;
        }
        .config-item-info small {
            font-size: 12px;
            opacity: 0.8;
        }
        .config-item-actions {
            display: flex;
            gap: 8px;
        }
        .form-actions {
            display: flex;
            gap: 12px;
            margin-top: 16px;
            flex-wrap: wrap;
            position: sticky;
            bottom: 0;
            background: linear-gradient(135deg, 
                var(--vscode-editor-background) 0%, 
                color-mix(in srgb, var(--vscode-editor-background) 98%, var(--vscode-button-background) 2%) 100%);
            padding: var(--space-lg);
            border-top: 2px solid color-mix(in srgb, var(--vscode-widget-border) 80%, var(--vscode-button-background) 20%);
            border-radius: var(--radius-lg) var(--radius-lg) 0 0;
            box-shadow: 0 -4px 12px color-mix(in srgb, var(--vscode-widget-border) 30%, transparent);
            backdrop-filter: blur(10px);
            z-index: 100;
            margin-left: calc(-1 * var(--space-xl));
            margin-right: calc(-1 * var(--space-xl));
            margin-bottom: calc(-1 * var(--space-xl));
        }
        
        .form-actions::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, 
                var(--vscode-button-background), 
                var(--vscode-textLink-foreground),
                color-mix(in srgb, var(--vscode-button-background) 70%, var(--vscode-textLink-foreground) 30%));
            opacity: 0.8;
            border-radius: var(--radius-lg) var(--radius-lg) 0 0;
        }
        .hidden {
            display: none;
        }
        /* 章节标题优化 */
        .section-title {
            font-size: var(--font-size-xl);
            font-weight: 800;
            margin: var(--space-2xl) 0 var(--space-xl) 0;
            color: var(--vscode-foreground);
            border-bottom: 3px solid transparent;
            background: linear-gradient(90deg, 
                var(--vscode-textLink-foreground), 
                color-mix(in srgb, var(--vscode-textLink-foreground) 60%, var(--vscode-button-background) 40%)) 
                bottom / 100% 3px no-repeat;
            padding-bottom: var(--space-md);
            position: relative;
            display: flex;
            align-items: center;
            letter-spacing: 0.5px;
        }
        
        .section-title::before {
            content: "";
            position: absolute;
            bottom: -3px;
            left: 0;
            width: 80px;
            height: 3px;
            background: linear-gradient(90deg, 
                var(--vscode-button-background), 
                color-mix(in srgb, var(--vscode-button-background) 50%, transparent));
            border-radius: var(--radius-sm);
            animation: titleGlow 2s ease-in-out infinite alternate;
        }
        
        @keyframes titleGlow {
            from { 
                opacity: 0.8; 
                transform: scaleX(1);
            }
            to { 
                opacity: 1; 
                transform: scaleX(1.1);
            }
        }
        
        .section {
            margin-bottom: var(--space-2xl);
            padding: var(--space-xl);
            background: linear-gradient(135deg, 
                color-mix(in srgb, var(--vscode-editor-background) 98%, var(--vscode-button-background) 2%) 0%,
                var(--vscode-editor-background) 100%);
            border-radius: var(--radius-xl);
            border: 1px solid color-mix(in srgb, var(--vscode-widget-border) 80%, var(--vscode-button-background) 20%);
            box-shadow: var(--shadow-md);
            transition: var(--transition-normal);
        }
        
        .section:hover {
            box-shadow: var(--shadow-lg);
            transform: translateY(-2px);
        }
        /* 无数据状态优化 */
        .no-data {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
            background: linear-gradient(135deg, var(--vscode-input-background) 0%, var(--vscode-editor-background) 100%);
            border-radius: 12px;
            margin: 20px 0;
        }
        .no-data-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.6;
        }
        .no-data-text {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }
        /* 加载状态优化 */
        .loading {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
        }
        .loading::before {
            content: "\\231B";
            font-size: 32px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        /* ===== 响应式设计系统 ===== */
        
        /* 平板设备 */
        @media (max-width: 1024px) {
            .form-container {
                margin: var(--space-sm);
                padding: var(--space-lg);
            }
            
            .tabs {
                padding: var(--space-xs);
            }
            
            .tab {
                padding: var(--space-sm) var(--space-md);
                font-size: var(--font-size-sm);
            }
        }
        
        /* 移动设备 */
        @media (max-width: 768px) {
            .form-container {
                padding: var(--space-md);
                margin: var(--space-xs);
                border-radius: var(--radius-md);
            }
            
            .tabs {
                padding: 2px;
                border-radius: var(--radius-md) var(--radius-md) 0 0;
            }
            
            .tab {
                padding: var(--space-sm) var(--space-md);
                font-size: var(--font-size-sm);
                min-height: 40px;
            }
            
            .tab-content {
                padding: var(--space-md);
            }
            
            .config-item {
                flex-direction: column;
                align-items: flex-start;
                gap: var(--space-md);
                padding: var(--space-md);
            }
            
            .config-item-actions {
                align-self: stretch;
                justify-content: space-between;
            }
            
            .form-actions {
                flex-direction: column;
                gap: var(--space-sm);
                margin-left: calc(-1 * var(--space-md));
                margin-right: calc(-1 * var(--space-md));
                margin-bottom: calc(-1 * var(--space-md));
                padding: var(--space-md);
            }
            
            button {
                width: 100%;
                justify-content: center;
            }
        }
        
        /* 小屏幕设备 */
        @media (max-width: 480px) {
            .form-container {
                margin: 0;
                border-radius: 0;
                min-height: 100vh;
                padding-bottom: 80px; /* 为固定按钮留出空间 */
            }
            
            .tabs {
                border-radius: 0;
                margin-bottom: var(--space-md);
            }
            
            .tab-content {
                border-radius: 0;
                padding: var(--space-sm);
                padding-bottom: 80px; /* 为固定按钮留出空间 */
            }
            
            .form-actions {
                margin-left: 0;
                margin-right: 0;
                margin-bottom: 0;
                padding: var(--space-sm);
                border-radius: 0;
            }
            
            .tab {
                flex: 1;
                justify-content: center;
                padding: var(--space-sm);
            }
            
            .tab-icon {
                font-size: var(--font-size-base);
            }
        }
        
        /* 触摸设备优化 */
        @media (hover: none) and (pointer: coarse) {
            .tab {
                min-height: 48px;
            }
            
            button {
                min-height: 44px;
                padding: var(--space-md) var(--space-lg);
            }
            
            .button-small {
                min-height: 36px;
                padding: var(--space-sm) var(--space-md);
            }
            
            .form-group input,
            .form-group select,
            .form-group textarea {
                min-height: 44px;
                padding: var(--space-md);
            }
        }
        
        /* 高对比度模式支持 */
        @media (prefers-contrast: high) {
            .form-container {
                border-width: 2px;
            }
            
            .tab.active {
                border-width: 2px;
            }
            
            button {
                border: 2px solid currentColor;
            }
            
            .form-group input,
            .form-g select,
            .form-group textarea {
                border-width: 2px;
            }
        }
        
        /* 减少动画偏好 */
        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
            
            .section-title::before {
                animation: none !important;
            }
        }
        
        /* ===== 微交互动画系统 ===== */
        @keyframes buttonPulse {
            0% { 
                box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-button-background) 40%, transparent);
            }
            70% { 
                box-shadow: 0 0 0 10px color-mix(in srgb, var(--vscode-button-background) 0%, transparent);
            }
            100% { 
                box-shadow: 0 0 0 0 color-mix(in srgb, var(--vscode-button-background) 0%, transparent);
            }
        }
        
        @keyframes slideInFromLeft {
            from {
                opacity: 0;
                transform: translateX(-20px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        @keyframes slideInFromRight {
            from {
                opacity: 0;
                transform: translateX(20px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
        
        @keyframes scaleIn {
            from {
                opacity: 0;
                transform: scale(0.9);
            }
            to {
                opacity: 1;
                transform: scale(1);
            }
        }
        
        @keyframes shimmer {
            0% {
                background-position: -200px 0;
            }
            100% {
                background-position: calc(200px + 100%) 0;
            }
        }
        
        /* 应用动画到相关元素 */
        .form-group {
            animation: slideInFromLeft 0.6s ease-out;
        }
        
        .form-group:nth-child(even) {
            animation: slideInFromRight 0.6s ease-out;
        }
        
        .button-primary:hover {
            animation: buttonPulse 1.5s infinite;
        }
        
        .config-item {
            animation: scaleIn 0.4s ease-out;
        }
        
        .config-item:nth-child(n) {
            animation-delay: calc(0.1s * var(--item-index, 0));
        }
        
        /* 加载状态动画 */
        .loading-shimmer {
            background: linear-gradient(90deg, 
                transparent, 
                color-mix(in srgb, var(--vscode-button-background) 20%, transparent), 
                transparent);
            background-size: 200px 100%;
            animation: shimmer 2s infinite;
        }
        
        /* ===== Home版本切换组件样式 ===== */
        .home-version-toggle {
            position: relative;
            display: inline-block;
            width: 100%;
            max-width: 400px;
            margin-top: var(--space-sm);
        }
        
        .home-version-toggle input[type="radio"] {
            position: absolute;
            opacity: 0;
            pointer-events: none;
            width: 0;
            height: 0;
        }
        
        .toggle-track {
            position: relative;
            display: flex;
            background: var(--vscode-input-background);
            border: 2px solid var(--vscode-input-border);
            border-radius: var(--radius-xl);
            padding: 4px;
            cursor: pointer;
            transition: var(--transition-normal);
            box-shadow: var(--shadow-sm);
            overflow: hidden;
        }
        
        .toggle-track:hover {
            border-color: color-mix(in srgb, var(--vscode-input-border) 70%, var(--vscode-button-background) 30%);
            box-shadow: var(--shadow-md);
            transform: translateY(-1px);
        }
        
        .toggle-track:active {
            transform: translateY(0);
            box-shadow: var(--shadow-sm);
        }
        
        .toggle-thumb {
            position: absolute;
            top: 4px;
            left: 4px;
            width: calc(50% - 4px);
            height: calc(100% - 8px);
            background: linear-gradient(135deg, 
                var(--vscode-button-background) 0%, 
                color-mix(in srgb, var(--vscode-button-background) 85%, #000 15%) 100%);
            border-radius: calc(var(--radius-xl) - 4px);
            transition: var(--transition-normal);
            box-shadow: var(--shadow-md);
            z-index: 2;
            border: 1px solid color-mix(in srgb, var(--vscode-button-background) 80%, transparent 20%);
        }
        
        .toggle-option {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--space-md) var(--space-lg);
            cursor: pointer;
            transition: var(--transition-normal);
            position: relative;
            z-index: 3;
            border-radius: calc(var(--radius-xl) - 4px);
            min-height: 44px;
        }
        
        .toggle-option__text {
            font-size: var(--font-size-sm);
            font-weight: 600;
            color: var(--vscode-foreground);
            transition: var(--transition-normal);
            text-align: center;
            line-height: var(--line-height-tight);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        /* 选中状态 */
        .home-version-toggle input[type="radio"]:checked + input + .toggle-track .toggle-thumb {
            transform: translateX(calc(100% + 4px));
        }
        
        .home-version-toggle input[type="radio"]:checked ~ .toggle-track .toggle-option--left .toggle-option__text {
            color: var(--vscode-button-foreground);
            font-weight: 700;
        }
        
        .home-version-toggle input[type="radio"]:nth-child(2):checked ~ .toggle-track .toggle-option--right .toggle-option__text {
            color: var(--vscode-button-foreground);
            font-weight: 700;
        }
        
        /* 焦点状态 */
        .home-version-toggle input[type="radio"]:focus ~ .toggle-track {
            outline: max(2px, 0.15em) solid var(--vscode-focusBorder);
            outline-offset: max(2px, 0.15em);
        }
        
        /* 悬停效果 */
        .toggle-option:hover .toggle-option__text {
            color: var(--vscode-textLink-foreground);
            transform: scale(1.05);
            text-shadow: 0 0 8px color-mix(in srgb, var(--vscode-textLink-foreground) 30%, transparent);
        }
        
        /* 激活效果 */
        .toggle-option:active {
            transform: scale(0.95);
        }
        
        .toggle-option:active .toggle-option__text {
            transform: scale(0.98);
        }
        
        /* 选中状态的增强效果 */
        .home-version-toggle input[type="radio"]:checked ~ .toggle-track .toggle-option--left .toggle-option__text,
        .home-version-toggle input[type="radio"]:nth-child(2):checked ~ .toggle-track .toggle-option--right .toggle-option__text {
            text-shadow: 0 1px 2px color-mix(in srgb, var(--vscode-button-foreground) 50%, transparent);
        }
        
        /* 高对比度模式支持 */
        @media (prefers-contrast: high) {
            .toggle-track {
                border-width: 3px;
            }
            
            .toggle-thumb {
                border-width: 2px;
                background: CanvasText;
            }
            
            .toggle-option__text {
                font-weight: 700;
            }
        }
        
        /* 触摸设备优化 */
        @media (hover: none) and (pointer: coarse) {
            .toggle-option {
                min-height: 48px;
                padding: var(--space-lg);
            }
            
            .toggle-option__text {
                font-size: var(--font-size-base);
            }
        }
        
        /* 移动设备响应式 */
        @media (max-width: 480px) {
            .home-version-toggle {
                max-width: 100%;
            }
            
            .toggle-option__text {
                font-size: var(--font-size-xs);
                padding: 0 var(--space-xs);
            }
        }
        
        /* 减少动画偏好 */
        @media (prefers-reduced-motion: reduce) {
            .toggle-thumb,
            .toggle-option,
            .toggle-option__text {
                transition: none !important;
            }
        }
        
        /* ===== 可访问性增强样式 ===== */
        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }
        
        /* 高对比度模式增强 */
        @media (prefers-contrast: high) {
            .home-version-toggle {
                border: 2px solid currentColor;
                border-radius: var(--radius-lg);
            }
            
            .toggle-track {
                border-width: 3px;
                background: Canvas;
                color: CanvasText;
            }
            
            .toggle-thumb {
                background: CanvasText;
                border: 2px solid CanvasText;
            }
            
            .toggle-option__text {
                font-weight: 900;
                color: CanvasText;
            }
            
            .home-version-toggle input[type="radio"]:checked ~ .toggle-track .toggle-option--left .toggle-option__text,
            .home-version-toggle input[type="radio"]:nth-child(2):checked ~ .toggle-track .toggle-option--right .toggle-option__text {
                background: Highlight;
                color: HighlightText;
                border-radius: var(--radius-sm);
                padding: var(--space-xs);
            }
        }
        
        /* 焦点可见性增强 */
        .home-version-toggle input[type="radio"]:focus-visible ~ .toggle-track {
            outline: 3px solid var(--vscode-focusBorder);
            outline-offset: 2px;
        }
        
        /* 表单验证状态样式 */
        .form-group.success {
            border-color: #22c55e;
            background: linear-gradient(135deg, 
                color-mix(in srgb, #22c55e 10%, var(--vscode-input-background)) 0%,
                var(--vscode-input-background) 100%);
        }
        
        .form-group.success::after {
            content: '✓';
            position: absolute;
            top: var(--space-md);
            right: var(--space-md);
            color: #22c55e;
            font-weight: bold;
            font-size: var(--font-size-lg);
        }
        
        .form-group.error {
            border-color: #ef4444;
            background: linear-gradient(135deg, 
                color-mix(in srgb, #ef4444 10%, var(--vscode-input-background)) 0%,
                var(--vscode-input-background) 100%);
        }
        
        .form-group.error::after {
            content: '⚠';
            position: absolute;
            top: var(--space-md);
            right: var(--space-md);
            color: #ef4444;
            font-weight: bold;
            font-size: var(--font-size-lg);
        }
        
        /* 双列布局样式 */
        .form-row {
            display: flex;
            gap: var(--space-md);
            margin-bottom: var(--space-md);
        }
        
        .form-row .form-group {
            flex: 1;
            margin-bottom: 0;
        }
        
        /* 响应式设计 - 当屏幕宽度小于768px时，使用单列布局 */
        @media (max-width: 768px) {
            .form-row {
                flex-direction: column;
                gap: var(--space-md);
            }
        }
    </style>
</head>
<body>
    <div class="app-container">
        <div class="form-container">
            <div id="app">
                <!-- 选项卡导航 -->
                <div class="tabs">
                    <button class="tab active" id="config-tab-btn">
                        <span class="tab-icon">⚙️</span>
                        <span>配置管理</span>
                    </button>
                    <button class="tab" id="request-tab-btn">
                        <span class="tab-icon">🚀</span>
                        <span>请求测试</span>
                    </button>
                    <button class="tab" id="response-tab-btn">
                        <span class="tab-icon">📊</span>
                        <span>响应结果</span>
                    </button>
                </div>

            <!-- 配置管理面板 -->
            <div id="config-tab" class="tab-content active">
                <div class="section">
                    <h3 class="section-title">配置列表</h3>
                    <div class="config-list" id="configList">
                        <div class="no-data">
                            <div class="no-data-icon">⚙️</div>
                            <div class="no-data-text">暂无配置</div>
                            <div class="no-data-subtext">点击下方按钮添加第一个OpenAPI配置</div>
        </div>
    </div>
                    <button class="button-primary" id="add-config-btn">添加配置</button>
                </div>
                
                <div class="section">
                    <h3 class="section-title">配置详情</h3>
                    <div id="configForm" class="hidden">
                        <input type="hidden" id="configId">
                        <div class="form-group">
                            <label>Home版本 *</label>
                            <div class="home-version-toggle" 
                                 role="radiogroup" 
                                 aria-labelledby="home-version-label"
                                 aria-describedby="home-version-desc">
                                <input type="radio" 
                                       id="version-new" 
                                       name="homeVersion" 
                                       value="2105后(包含)" 
                                       checked
                                       aria-describedby="version-new-desc">
                                <input type="radio" 
                                       id="version-old" 
                                       name="homeVersion" 
                                       value="2105前"
                                       aria-describedby="version-old-desc">
                                <div class="toggle-track" role="presentation">
                                    <div class="toggle-thumb" role="presentation" aria-hidden="true"></div>
                                    <label for="version-new" 
                                           class="toggle-option toggle-option--left"
                                           tabindex="-1">
                                        <span class="toggle-option__text">2105后(包含)</span>
                                    </label>
                                    <label for="version-old" 
                                           class="toggle-option toggle-option--right"
                                           tabindex="-1">
                                        <span class="toggle-option__text">2105前</span>
                                    </label>
                                </div>
                                <div id="home-version-desc" class="sr-only">
                                    选择您的Home版本。2105后(包含)支持更多功能，2105前保持兼容性。
                                </div>
                                <div id="version-new-desc" class="sr-only">
                                    2105后(包含)，支持最新功能和安全特性
                                </div>
                                <div id="version-old-desc" class="sr-only">
                                    2105前，保持向后兼容性
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="configName">名称 *</label>
                            <input type="text" id="configName" placeholder="请输入名称">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="ip">IP *</label>
                                <input type="text" id="ip" placeholder="例如 127.0.0.1">
                            </div>
                            <div class="form-group">
                                <label for="port">端口 *</label>
                                <input type="number" id="port" placeholder="例如 8080">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="accountCode">帐套编码 *</label>
                            <input type="text" id="accountCode" placeholder="请输入帐套编码">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="appId">APP ID *</label>
                                <input type="text" id="appId" placeholder="请输入APP ID">
                            </div>
                            <div class="form-group">
                                <label for="appSecret">APP Secret *</label>
                                <input type="password" id="appSecret" placeholder="请输入APP Secret">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="userCode">用户编码 *</label>
                            <input type="text" id="userCode" placeholder="请输入用户编码">
                        </div>
                        
                        <div class="form-group">
                            <label for="publicKey">公钥</label>
                            <textarea id="publicKey" rows="3" placeholder="请输入公钥（可选）"></textarea>
                        </div>
                        <div class="form-actions">
                            <button class="button-primary" id="save-config-btn">保存配置</button>
                            <button class="button-secondary" id="cancel-config-btn">取消</button>
                            <button class="button-secondary" id="delete-config-btn" class="hidden">删除配置</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 请求测试面板 -->
            <div id="request-tab" class="tab-content">
                <div class="section">
                    <h3 class="section-title">HTTP请求</h3>
                    <div class="form-group">
                        <label for="selectedConfig">选择配置 *</label>
                        <select id="selectedConfig">
                            <option value="">请选择配置</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="method">请求方法</label>
                        <select id="method">
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                            <option value="PATCH">PATCH</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="url">请求URL *</label>
                        <input type="text" id="url" placeholder="/api/users">
                    </div>
                    
                    <div class="form-group">
                        <label for="body">请求体 (JSON格式)</label>
                        <textarea id="body" rows="3" placeholder='{"name": "test", "email": "test@example.com"}'></textarea>
                    </div>
                    <div class="form-actions">
                        <button class="button-primary" id="send-request-btn">发送请求</button>
                        <button class="button-secondary" id="clear-request-btn">清空</button>
                        <button class="button-secondary" id="test-connection-btn">测试连接</button>
                    </div>
                </div>
            </div>

            <!-- 响应结果面板 -->
            <div id="response-tab" class="tab-content">
                <div class="section">
                    <h3 class="section-title">响应结果</h3>
                    <div id="responseStatus"></div>
                    <div class="response-area" id="responseContent">点击"发送请求"按钮查看响应结果</div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Home版本切换组件初始化
        function initHomeVersionToggle() {
            const toggleContainer = document.querySelector('.home-version-toggle');
            if (!toggleContainer) return;
            
            const radioInputs = toggleContainer.querySelectorAll('input[type="radio"]');
            const toggleTrack = toggleContainer.querySelector('.toggle-track');
            const toggleThumb = toggleContainer.querySelector('.toggle-thumb');
            
            // 初始化切换状态
            function updateToggleState() {
                const checkedInput = toggleContainer.querySelector('input[type="radio"]:checked');
                if (checkedInput && checkedInput.id === 'version-old') {
                    toggleThumb.style.transform = 'translateX(calc(100% + 4px))';
                } else {
                    toggleThumb.style.transform = 'translateX(0)';
                }
                
                // 更新ARIA状态
                radioInputs.forEach(input => {
                    input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
                });
                
                // 宣布状态变化给屏幕阅读器
                const checkedLabel = checkedInput ? checkedInput.value : '';
                announceToScreenReader('已选择 ' + checkedLabel);
            }
            
            // 屏幕阅读器宣布功能
            function announceToScreenReader(message) {
                const announcement = document.createElement('div');
                announcement.setAttribute('aria-live', 'polite');
                announcement.setAttribute('aria-atomic', 'true');
                announcement.className = 'sr-only';
                announcement.textContent = message;
                document.body.appendChild(announcement);
                
                // 清理
                setTimeout(() => {
                    document.body.removeChild(announcement);
                }, 1000);
            }
            
            // 处理点击事件
            function handleToggleClick(event) {
                const clickedOption = event.target.closest('.toggle-option');
                if (!clickedOption) return;
                
                const targetInput = document.getElementById(clickedOption.getAttribute('for'));
                if (targetInput && !targetInput.checked) {
                    // 添加点击动画效果
                    toggleTrack.style.transform = 'scale(0.98)';
                    setTimeout(() => {
                        toggleTrack.style.transform = 'scale(1)';
                    }, 100);
                    
                    targetInput.checked = true;
                    updateToggleState();
                    
                    // 触发change事件
                    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    // 添加成功反馈
                    showToggleFeedback();
                }
            }
            
            // 显示切换反馈
            function showToggleFeedback() {
                const feedback = document.createElement('div');
                feedback.style.position = 'absolute';
                feedback.style.top = '-10px';
                feedback.style.left = '50%';
                feedback.style.transform = 'translateX(-50%)';
                feedback.style.background = 'var(--vscode-button-background)';
                feedback.style.color = 'var(--vscode-button-foreground)';
                feedback.style.padding = '4px 8px';
                feedback.style.borderRadius = '4px';
                feedback.style.fontSize = '12px';
                feedback.style.opacity = '0';
                feedback.style.transition = 'all 0.3s ease';
                feedback.style.pointerEvents = 'none';
                feedback.style.zIndex = '1000';
                feedback.textContent = '✓';
                toggleContainer.appendChild(feedback);
                
                // 动画显示
                requestAnimationFrame(() => {
                    feedback.style.opacity = '1';
                    feedback.style.transform = 'translateX(-50%) translateY(-10px)';
                });
                
                // 自动移除
                setTimeout(() => {
                    feedback.style.opacity = '0';
                    feedback.style.transform = 'translateX(-50%) translateY(-20px)';
                    setTimeout(() => {
                        if (feedback.parentNode) {
                            feedback.parentNode.removeChild(feedback);
                        }
                    }, 300);
                }, 1000);
            }
            
            // 处理键盘导航
            function handleKeyDown(event) {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    const currentInput = toggleContainer.querySelector('input[type="radio"]:checked');
                    const allInputs = Array.from(radioInputs);
                    const currentIndex = allInputs.indexOf(currentInput);
                    
                    let nextIndex;
                    switch(event.key) {
                        case 'ArrowLeft':
                            nextIndex = currentIndex > 0 ? currentIndex - 1 : allInputs.length - 1;
                            break;
                        case 'ArrowRight':
                            nextIndex = currentIndex < allInputs.length - 1 ? currentIndex + 1 : 0;
                            break;
                        case 'Home':
                            nextIndex = 0;
                            break;
                        case 'End':
                            nextIndex = allInputs.length - 1;
                            break;
                    }
                    
                    allInputs[nextIndex].checked = true;
                    allInputs[nextIndex].focus();
                    updateToggleState();
                    
                    // 触发change事件
                    allInputs[nextIndex].dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // 空格键选择
                if (event.key === ' ') {
                    event.preventDefault();
                    const targetInput = event.target;
                    if (!targetInput.checked) {
                        targetInput.checked = true;
                        updateToggleState();
                        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                        showToggleFeedback();
                    }
                }
            }
            
            // 绑定事件
            toggleTrack.addEventListener('click', handleToggleClick);
            radioInputs.forEach((input, index) => {
                input.addEventListener('change', updateToggleState);
                input.addEventListener('keydown', handleKeyDown);
                
                // 添加焦点事件处理
                input.addEventListener('focus', () => {
                    toggleTrack.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--vscode-focusBorder) 25%, transparent)';
                });
                
                input.addEventListener('blur', () => {
                    toggleTrack.style.boxShadow = 'var(--shadow-sm)';
                });
            });
            
            // 初始化状态
            updateToggleState();
            
            // 添加初始化动画
            toggleContainer.style.opacity = '0';
            toggleContainer.style.transform = 'translateY(10px)';
            setTimeout(() => {
                toggleContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                toggleContainer.style.opacity = '1';
                toggleContainer.style.transform = 'translateY(0)';
            }, 100);
            
            // 添加键盘导航提示
            const keyboardHint = document.createElement('div');
            keyboardHint.className = 'sr-only';
            keyboardHint.textContent = '使用左右箭头键或Home/End键在选项间导航，空格键选择';
            toggleContainer.appendChild(keyboardHint);
        }
        
        // 增强表单验证反馈
        function enhanceFormValidation() {
            const formInputs = document.querySelectorAll('.form-group input, .form-group select, .form-group textarea');
            
            formInputs.forEach(input => {
                // 实时验证反馈
                input.addEventListener('input', function() {
                    const formGroup = this.closest('.form-group');
                    if (this.checkValidity()) {
                        formGroup.classList.remove('error');
                        formGroup.classList.add('success');
                    } else {
                        formGroup.classList.remove('success');
                        formGroup.classList.add('error');
                    }
                });
                
                // 焦点增强效果
                input.addEventListener('focus', function() {
                    const formGroup = this.closest('.form-group');
                    formGroup.style.transform = 'translateY(-2px)';
                    formGroup.style.boxShadow = '0 8px 25px color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent)';
                });
                
                input.addEventListener('blur', function() {
                    const formGroup = this.closest('.form-group');
                    formGroup.style.transform = 'translateY(0)';
                    formGroup.style.boxShadow = 'var(--shadow-md)';
                });
            });
        }
        const vscode = acquireVsCodeApi();
        let configs = [];
        let currentConfig = null;
        
        // 初始化按钮事件
        function initEventListeners() {
            // 初始化Home版本切换组件
            initHomeVersionToggle();
            
            // 增强表单验证
            enhanceFormValidation();
            // 选项卡切换事件
            document.getElementById('config-tab-btn').addEventListener('click', function() {
                switchTab('config');
            });
            
            document.getElementById('request-tab-btn').addEventListener('click', function() {
                switchTab('request');
            });
            
            document.getElementById('response-tab-btn').addEventListener('click', function() {
                switchTab('response');
            });
            
            // 主要按钮事件
            document.getElementById('add-config-btn').addEventListener('click', showAddConfigForm);
            document.getElementById('save-config-btn').addEventListener('click', saveConfig);
            document.getElementById('cancel-config-btn').addEventListener('click', cancelEditConfig);
            document.getElementById('delete-config-btn').addEventListener('click', deleteConfig);
            document.getElementById('send-request-btn').addEventListener('click', sendRequest);
            document.getElementById('clear-request-btn').addEventListener('click', clearRequest);
            document.getElementById('test-connection-btn').addEventListener('click', testConnection);
        }
        
        // 页面加载完成后初始化事件监听器
        document.addEventListener('DOMContentLoaded', function() {
            initEventListeners();
            
            // 添加页面加载动画
            const formGroups = document.querySelectorAll('.form-group');
            formGroups.forEach((group, index) => {
                group.style.setProperty('--item-index', index);
                group.style.opacity = '0';
                group.style.transform = 'translateY(20px)';
                
                setTimeout(() => {
                    group.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                    group.style.opacity = '1';
                    group.style.transform = 'translateY(0)';
                }, 100 + index * 100);
            });
            
            // 页面加载完成后加载配置
            vscode.postMessage({ type: 'loadConfigs' });
            
            // 添加性能监控
            if (window.performance && window.performance.mark) {
                window.performance.mark('ui-optimization-complete');
            }
        });
        
        // 测试不同主题兼容性
        function testThemeCompatibility() {
            const testResults = {
                cssVariables: {},
                accessibility: {},
                performance: {}
            };
            
            // 测试CSS变量是否可用
            const testElement = document.createElement('div');
            testElement.style.color = 'var(--vscode-foreground)';
            document.body.appendChild(testElement);
            const computedColor = window.getComputedStyle(testElement).color;
            testResults.cssVariables.vscodeForeground = computedColor !== 'var(--vscode-foreground)';
            document.body.removeChild(testElement);
            
            // 测试可访问性特性
            testResults.accessibility.ariaSupport = 'setAttribute' in document.createElement('div');
            testResults.accessibility.focusVisible = CSS.supports('selector(:focus-visible)');
            testResults.accessibility.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            
            // 测试性能特性
            testResults.performance.requestAnimationFrame = 'requestAnimationFrame' in window;
            testResults.performance.cssTransitions = CSS.supports('transition', 'all 0.3s ease');
            
            console.log('Theme Compatibility Test Results:', testResults);
            return testResults;
        }
        
        // 在开发模式下运行测试
        if (typeof vscode !== 'undefined') {
            setTimeout(testThemeCompatibility, 1000);
        }
        
        // 切换选项卡
        function switchTab(tabName) {
            // 隐藏所有选项卡内容
            const tabs = document.querySelectorAll('.tab-content');
            tabs.forEach(tab => tab.classList.remove('active'));
            
            // 移除所有选项卡的active类
            const tabButtons = document.querySelectorAll('.tab');
            tabButtons.forEach(button => button.classList.remove('active'));
            
            // 显示选中的选项卡
            document.getElementById(tabName + '-tab').classList.add('active');
            document.getElementById(tabName + '-tab-btn').classList.add('active');
        }
        
        // 显示添加配置表单
        function showAddConfigForm() {
            document.getElementById('configForm').classList.remove('hidden');
            document.getElementById('configId').value = '';
            document.getElementById('configName').value = '';
            document.getElementById('version-new').checked = true;
            document.getElementById('version-old').checked = false;
            document.getElementById('ip').value = '';
            document.getElementById('port').value = '';
            document.getElementById('accountCode').value = '';
            document.getElementById('appId').value = '';
            document.getElementById('appSecret').value = '';
            document.getElementById('userCode').value = '';
            document.getElementById('publicKey').value = '';
            document.getElementById('delete-config-btn').classList.add('hidden');
            
            // 切换到配置选项卡
            switchTab('config');
        }
        
        // 取消编辑配置
        function cancelEditConfig() {
            document.getElementById('configForm').classList.add('hidden');
        }
        
        // 保存配置
        function saveConfig() {
            const selectedVersion = document.querySelector('input[name="homeVersion"]:checked');
            const config = {
                id: (document.getElementById('configId').value || generateId()),
                name: document.getElementById('configName').value,
                homeVersion: selectedVersion ? selectedVersion.value : '2105后(包含)',
                ip: document.getElementById('ip').value,
                port: parseInt(document.getElementById('port').value, 10),
                accountCode: document.getElementById('accountCode').value,
                appId: document.getElementById('appId').value,
                appSecret: document.getElementById('appSecret').value,
                userCode: document.getElementById('userCode').value,
                
                publicKey: document.getElementById('publicKey').value
            };
            
            if (!config.name) { vscode.postMessage({ type: 'showError', message: '请输入名称' }); return; }
            if (!config.ip) { vscode.postMessage({ type: 'showError', message: '请输入IP' }); return; }
            if (!config.port || isNaN(config.port)) { vscode.postMessage({ type: 'showError', message: '请输入有效端口' }); return; }
            if (!config.accountCode) { vscode.postMessage({ type: 'showError', message: '请输入帐套编码' }); return; }
            if (!config.appId) { vscode.postMessage({ type: 'showError', message: '请输入APP ID' }); return; }
            if (!config.appSecret) { vscode.postMessage({ type: 'showError', message: '请输入APP Secret' }); return; }
            if (!config.userCode) { vscode.postMessage({ type: 'showError', message: '请输入用户编码' }); return; }
            
            if (document.getElementById('configId').value) {
                vscode.postMessage({
                    type: 'updateConfig',
                    config: config
                });
            } else {
                vscode.postMessage({
                    type: 'addConfig',
                    config: config
                });
            }
            
            document.getElementById('configForm').classList.add('hidden');
        }
        
        // 删除配置
        function deleteConfig() {
            const configId = document.getElementById('configId').value;
            if (configId) {
                vscode.postMessage({
                    type: 'confirmDelete',
                    message: '确定要删除此配置吗？',
                    configId: configId
                });
            }
        }
        
        // 设置当前配置
        function setCurrentConfig(configId) {
            vscode.postMessage({
                type: 'setCurrentConfig',
                configId: configId
            });
        }
        
        // 编辑配置
        function editConfig(config) {
            document.getElementById('configForm').classList.remove('hidden');
            document.getElementById('configId').value = config.id;
            document.getElementById('configName').value = config.name;
            document.getElementById('version-new').checked = (config.homeVersion === '2105后(包含)');
            document.getElementById('version-old').checked = (config.homeVersion === '2105前');
            document.getElementById('ip').value = config.ip || '';
            document.getElementById('port').value = (config.port != null ? String(config.port) : '');
            document.getElementById('accountCode').value = config.accountCode || '';
            document.getElementById('appId').value = config.appId || '';
            document.getElementById('appSecret').value = config.appSecret || '';
            document.getElementById('userCode').value = config.userCode || '';
            document.getElementById('publicKey').value = config.publicKey || '';
            document.getElementById('delete-config-btn').classList.remove('hidden');
        }
        
        // 测试连接
        function testConnection() {
            const selectedConfigId = document.getElementById('selectedConfig').value;
            if (!selectedConfigId) {
                vscode.postMessage({ type: 'showError', message: '请选择一个配置' });
                return;
            }
        }
        
        // 填充配置表单
        function fillConfigForm(config) {
            document.getElementById('configForm').classList.remove('hidden');
            document.getElementById('configId').value = config.id;
            document.getElementById('configName').value = config.name;
            document.getElementById('version-new').checked = (config.homeVersion === '2105后(包含)');
            document.getElementById('version-old').checked = (config.homeVersion === '2105前');
            document.getElementById('ip').value = config.ip || '';
            document.getElementById('port').value = (config.port != null ? String(config.port) : '');
            document.getElementById('accountCode').value = config.accountCode || '';
            document.getElementById('appId').value = config.appId || '';
            document.getElementById('appSecret').value = config.appSecret || '';
            document.getElementById('userCode').value = config.userCode || '';
            
            document.getElementById('publicKey').value = config.publicKey || '';
            document.getElementById('delete-config-btn').classList.remove('hidden');
        }
        
        // 发送请求
        function sendRequest() {
            const selectedConfigId = document.getElementById('selectedConfig').value;
            if (!selectedConfigId) {
                vscode.postMessage({ type: 'showError', message: '请选择一个配置' });
                return;
            }
            
            const url = document.getElementById('url').value;
            if (!url) {
                vscode.postMessage({ type: 'showError', message: '请输入请求URL' });
                return;
            }
            
            try {
                const request = {
                    method: document.getElementById('method').value,
                    url: url,
                    body: parseJson(document.getElementById('body').value)
                };
                
                vscode.postMessage({
                    type: 'sendRequest',
                    request: request,
                    configId: selectedConfigId
                });
                
                // 切换到响应选项卡
                switchTab('response');
                document.getElementById('responseContent').textContent = '请求发送中...';
                
            } catch (error) {
                vscode.postMessage({ type: 'showError', message: '请求参数格式错误: ' + error.message });
            }
        }
        
        // 清空请求
        function clearRequest() {
            document.getElementById('url').value = '';
            document.getElementById('body').value = '';
        }
        
        // 解析JSON字符串
        function parseJson(text) {
            if (!text || text.trim() === '') {
                return null;
            }
            return JSON.parse(text);
        }
        
        // 生成唯一ID
        function generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2);
        }
        
        // 渲染配置列表
        function renderConfigList() {
            const configListEl = document.getElementById('configList');
            
            if (configs.length === 0) {
                configListEl.innerHTML = [
                    '<div class="no-data">',
                    '<div class="no-data-icon">⚙️</div>',
                    '<div class="no-data-text">暂无配置</div>',
                    '<div class="no-data-subtext">点击上方按钮添加第一个OpenAPI配置</div>',
                    '</div>'
                ].join('');
                return;
            }
            
            configListEl.innerHTML = '';
            
            configs.forEach(config => {
                const configItem = document.createElement('div');
                configItem.className = 'config-item';
                if (currentConfig && currentConfig.id === config.id) {
                    configItem.classList.add('active');
                }
                
                // 为每个配置项创建唯一的ID
                const editBtnId = 'edit-config-' + config.id;
                const setCurrBtnId = 'set-current-' + config.id;
                
                // 使用字符串拼接而不是模板字符串中的表达式
                configItem.innerHTML = [
                    '<div class="config-item-info">',
                    '<strong>' + config.name + '</strong>',
                    '<small>' + (config.ip + ':' + config.port) + '</small>',
                    '</div>',
                    '<div class="config-item-actions">',
                    '<button class="button-secondary button-small" id="' + editBtnId + '">编辑</button>',
                    '<button class="button-secondary button-small" id="' + setCurrBtnId + '">' + (currentConfig && currentConfig.id === config.id ? '当前' : '设为当前') + '</button>',
                    '</div>'
                ].join('');
                
                configListEl.appendChild(configItem);
                
                // 使用setTimeout确保元素已添加到DOM后再绑定事件
                setTimeout(function() {
                    const editBtn = document.getElementById(editBtnId);
                    const setCurrBtn = document.getElementById(setCurrBtnId);
                    
                    if (editBtn) {
                        editBtn.addEventListener('click', function() {
                            editConfig(config);
                        });
                    }
                    
                    if (setCurrBtn) {
                        setCurrBtn.addEventListener('click', function() {
                            setCurrentConfig(config.id);
                        });
                    }
                }, 0);
            });
        }
        
        // 渲染配置选择下拉框
        function renderConfigSelect() {
            const selectEl = document.getElementById('selectedConfig');
            selectEl.innerHTML = '';
            
            configs.forEach(config => {
                const option = document.createElement('option');
                option.value = config.id;
                option.textContent = config.name;
                if (currentConfig && currentConfig.id === config.id) {
                    option.selected = true;
                }
                selectEl.appendChild(option);
            });
        }
        
        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configsLoaded':
                    configs = message.configs;
                    currentConfig = message.currentConfig;
                    renderConfigList();
                    renderConfigSelect();
                    break;
                    
                case 'requestResponse':
                    if (message.success) {
                        const response = message.response;
                        document.getElementById('responseStatus').innerHTML = 
                            '<div class="status-success">状态: ' + response.status + ' ' + response.statusText + ' (耗时: ' + response.duration + 'ms)</div>';
                        document.getElementById('responseContent').textContent = 
                            JSON.stringify(response.data, null, 2);
                    } else {
                        document.getElementById('responseStatus').innerHTML = 
                            '<div class="status-error">请求失败: ' + message.error + '</div>';
                        document.getElementById('responseContent').textContent = message.error;
                    }
                    break;
                    
                case 'connectionTest':
                    if (message.success) {
                        document.getElementById('responseStatus').innerHTML = 
                            '<div class="status-success">' + message.message + '</div>';
                    } else {
                        document.getElementById('responseStatus').innerHTML = 
                            '<div class="status-error">' + message.message + '</div>';
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}