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
exports.JavaVersionUtils = void 0;
const vscode = __importStar(require("vscode"));
class JavaVersionUtils {
    static async getJavaVersion(outputChannel) {
        let javaVersion = 0;
        try {
            const javaConfig = vscode.workspace.getConfiguration('java.configuration');
            const runtimes = javaConfig.get('runtimes', []);
            const defaultRuntime = runtimes.find(runtime => runtime.default === true);
            if (defaultRuntime && defaultRuntime.name) {
                const versionMatch = defaultRuntime.name.match(/(\d+\.\d+|\d+)/);
                if (versionMatch && versionMatch[1]) {
                    if (versionMatch[1].includes('.')) {
                        const parts = versionMatch[1].split('.');
                        javaVersion = parseInt(parts[1]);
                    }
                    else {
                        javaVersion = parseInt(versionMatch[1]);
                    }
                    if (outputChannel) {
                        outputChannel.appendLine(`从VS Code配置获取Java版本: ${javaVersion}`);
                    }
                }
            }
            if (javaVersion === 0 && runtimes.length > 0 && runtimes[0].name) {
                const versionMatch = runtimes[0].name.match(/(\d+\.\d+|\d+)/);
                if (versionMatch && versionMatch[1]) {
                    if (versionMatch[1].includes('.')) {
                        const parts = versionMatch[1].split('.');
                        javaVersion = parseInt(parts[1]);
                    }
                    else {
                        javaVersion = parseInt(versionMatch[1]);
                    }
                    if (outputChannel) {
                        outputChannel.appendLine(`从VS Code配置获取第一个Java运行时版本: ${javaVersion}`);
                    }
                }
            }
            if (javaVersion === 0) {
                const { execSync } = require('child_process');
                const versionOutput = execSync('java -version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
                const versionMatch = (versionOutput || '').match(/version\s+"(\d+)/i);
                if (versionMatch && versionMatch[1]) {
                    javaVersion = parseInt(versionMatch[1]);
                    if (outputChannel) {
                        outputChannel.appendLine(`通过命令行检测到Java版本: ${javaVersion}`);
                    }
                }
            }
        }
        catch (error) {
            if (outputChannel) {
                outputChannel.appendLine(`警告: 无法检测Java版本，将假设使用Java 8+: ${error.message}`);
            }
        }
        return javaVersion;
    }
    static getJavaVersionName(javaExecutable, outputChannel) {
        let runtimeName = "JavaSE-1.8";
        try {
            const { execSync } = require('child_process');
            const javaVersionOutput = execSync(`"${javaExecutable}" -version 2>&1`, { encoding: 'utf-8' });
            if (javaVersionOutput.includes('version "1.7')) {
                runtimeName = "JavaSE-1.7";
            }
            else if (javaVersionOutput.includes('version "1.8')) {
                runtimeName = "JavaSE-1.8";
            }
            else if (javaVersionOutput.includes('version "11')) {
                runtimeName = "JavaSE-11";
            }
            else if (javaVersionOutput.includes('version "17')) {
                runtimeName = "JavaSE-17";
            }
            else if (javaVersionOutput.includes('version "1.6')) {
                runtimeName = "JavaSE-1.6";
            }
            else {
                const versionMatch = javaVersionOutput.match(/version "(\d+\.?\d*\.?\d*)/);
                if (versionMatch && versionMatch[1]) {
                    runtimeName = `JavaSE-${versionMatch[1]}`;
                }
            }
        }
        catch (versionError) {
            if (outputChannel) {
                outputChannel.appendLine(`获取Java版本时出错: ${versionError}`);
            }
        }
        return runtimeName;
    }
}
exports.JavaVersionUtils = JavaVersionUtils;
//# sourceMappingURL=JavaVersionUtils.js.map