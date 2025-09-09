import * as vscode from 'vscode';

/**
 * 文档操作相关的命令
 */
export class DocumentCommands {
    
    /**
     * 注册所有文档相关的命令
     */
    static registerCommands(context: vscode.ExtensionContext) {
        // 统计当前文档字符数
        const countCharsCommand = vscode.commands.registerCommand('helloworld.countChars', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const text = document.getText();
                const charCount = text.length;
                const lineCount = document.lineCount;
                
                vscode.window.showInformationMessage(
                    `文档统计: ${charCount} 个字符, ${lineCount} 行`
                );
            } else {
                vscode.window.showWarningMessage('没有打开的文档');
            }
        });

        // 插入当前时间
        const insertTimeCommand = vscode.commands.registerCommand('helloworld.insertTime', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const now = new Date();
                const timeString = now.toLocaleString('zh-CN');
                editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, timeString);
                });
            }
        });

        // 转换选中文本为大写
        const upperCaseCommand = vscode.commands.registerCommand('helloworld.upperCase', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.selection;
                const text = editor.document.getText(selection);
                
                if (text) {
                    editor.edit(editBuilder => {
                        editBuilder.replace(selection, text.toUpperCase());
                    });
                } else {
                    vscode.window.showInformationMessage('请先选择要转换的文本');
                }
            }
        });

        context.subscriptions.push(countCharsCommand, insertTimeCommand, upperCaseCommand);
    }
}