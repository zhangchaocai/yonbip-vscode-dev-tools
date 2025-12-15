import * as vscode from 'vscode';

/**
 * 自定义对话框工具类
 * 提供统一的自定义弹窗功能
 */
export class CustomDialogUtils {
    /**
     * 显示自定义确认弹窗
     * @param title 弹窗标题
     * @param message 弹窗消息内容
     * @returns 用户是否确认
     */
    public static async showCustomConfirmationDialog(title: string, message: string): Promise<boolean> {
        return new Promise((resolve) => {
            // 创建Webview面板
            const panel = vscode.window.createWebviewPanel(
                'customConfirmationDialog',
                title,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    // 设置为模态框，阻止用户与其他界面交互
                    enableFindWidget: false,
                    enableCommandUris: false,
                    enableForms: false
                }
            );

            // 设置HTML内容
            panel.webview.html = this.getConfirmationDialogHtml(title, message);

            // 处理来自Webview的消息
            panel.webview.onDidReceiveMessage(
                (message) => {
                    switch (message.command) {
                        case 'confirm':
                            resolve(true);
                            panel.dispose();
                            break;
                        case 'cancel':
                            resolve(false);
                            panel.dispose();
                            break;
                    }
                },
                undefined,
                [] // 不需要订阅到context，因为我们会在面板销毁时自动清理
            );

            // 监听面板关闭事件
            panel.onDidDispose(
                () => {
                    resolve(false);
                },
                null,
                [] // 不需要订阅到context，因为我们会在面板销毁时自动清理
            );
        });
    }

    /**
     * 生成确认弹窗的HTML内容
     * @param title 弹窗标题
     * @param message 弹窗消息
     * @returns HTML字符串
     */
    private static getConfirmationDialogHtml(title: string, message: string): string {
        // 将换行符转换为HTML段落
        const paragraphs = message.split('\n').map(p => `<p>${p}</p>`).join('');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body, html {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
        }
        
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        
        .modal-content {
            background-color: var(--vscode-editor-background);
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            width: 520px;
            max-width: 90%;
            padding: 0;
            position: relative;
            border: 1px solid var(--vscode-widget-border);
            overflow: hidden;
        }
        
        .modal-header {
            padding: 20px 24px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-sideBar-background);
        }
        
        .modal-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin: 0;
            display: flex;
            align-items: center;
        }
        
        .modal-title::before {
            content: '⚠️';
            margin-right: 10px;
            font-size: 18px;
        }
        
        .modal-body {
            padding: 24px;
            line-height: 1.6;
            color: var(--vscode-foreground);
        }
        
        .message-content {
            margin: 0;
            padding: 0;
        }
        
        .message-content p {
            margin: 0 0 12px 0;
            padding: 0;
        }
        
        .message-content p:last-child {
            margin-bottom: 0;
        }
        
        .modal-footer {
            padding: 16px 24px;
            background-color: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-widget-border);
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }
        
        .btn {
            padding: 8px 16px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
            min-width: 80px;
            text-align: center;
        }
        
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
        }
        
        .btn-primary:active {
            transform: translateY(0);
        }
        
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
            transform: translateY(-1px);
        }
        
        .btn-secondary:active {
            transform: translateY(0);
        }
        
        .btn:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 2px;
        }
    </style>
</head>
<body>
    <div class="modal-overlay">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title">${title}</h2>
            </div>
            <div class="modal-body">
                <div class="message-content">
                    ${paragraphs}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="cancelBtn">取消</button>
                <button class="btn btn-primary" id="confirmBtn">继续</button>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        document.getElementById('confirmBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'confirm' });
        });
        
        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });
        
        // 处理键盘事件
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                vscode.postMessage({ command: 'cancel' });
            }
        });
        
        // 聚焦到确认按钮
        document.getElementById('confirmBtn').focus();
    </script>
</body>
</html>`;
    }
}