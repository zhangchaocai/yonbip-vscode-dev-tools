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
exports.DocumentCommands = void 0;
const vscode = __importStar(require("vscode"));
class DocumentCommands {
    static registerCommands(context) {
        const countCharsCommand = vscode.commands.registerCommand('helloworld.countChars', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const document = editor.document;
                const text = document.getText();
                const charCount = text.length;
                const lineCount = document.lineCount;
                vscode.window.showInformationMessage(`文档统计: ${charCount} 个字符, ${lineCount} 行`);
            }
            else {
                vscode.window.showWarningMessage('没有打开的文档');
            }
        });
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
        const upperCaseCommand = vscode.commands.registerCommand('helloworld.upperCase', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.selection;
                const text = editor.document.getText(selection);
                if (text) {
                    editor.edit(editBuilder => {
                        editBuilder.replace(selection, text.toUpperCase());
                    });
                }
                else {
                    vscode.window.showInformationMessage('请先选择要转换的文本');
                }
            }
        });
        context.subscriptions.push(countCharsCommand, insertTimeCommand, upperCaseCommand);
    }
}
exports.DocumentCommands = DocumentCommands;
//# sourceMappingURL=commands.js.map