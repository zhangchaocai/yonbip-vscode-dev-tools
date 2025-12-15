import * as vscode from 'vscode';

/**
 * Java版本工具类
 */
export class JavaVersionUtils {
    
    /**
     * 获取Java版本
     * @param outputChannel 输出通道，用于记录日志
     * @returns Java版本号（如8, 11, 17等），如果无法获取则返回0
     */
    public static async getJavaVersion(outputChannel?: vscode.OutputChannel): Promise<number> {
        let javaVersion = 0;
        try {
            // 优先从VS Code配置中获取Java版本
            const javaConfig = vscode.workspace.getConfiguration('java.configuration');
            const runtimes = javaConfig.get<any[]>('runtimes', []);
            
            // 查找默认的Java运行时版本
            const defaultRuntime = runtimes.find(runtime => runtime.default === true);
            if (defaultRuntime && defaultRuntime.name) {
                // 改进的版本匹配正则表达式，支持Java 1.8, 11, 17等格式
                const versionMatch = defaultRuntime.name.match(/(\d+\.\d+|\d+)/);
                if (versionMatch && versionMatch[1]) {
                    // 对于1.8这样的版本号，只取小数点后的数字
                    if (versionMatch[1].includes('.')) {
                        const parts = versionMatch[1].split('.');
                        javaVersion = parseInt(parts[1]); // 对于1.8，取8
                    } else {
                        javaVersion = parseInt(versionMatch[1]); // 对于11, 17等，直接使用
                    }
                    if (outputChannel) {
                        outputChannel.appendLine(`从VS Code配置获取Java版本: ${javaVersion}`);
                    }
                }
            }
            
            // 如果没有默认运行时，尝试使用第一个配置的运行时版本
            if (javaVersion === 0 && runtimes.length > 0 && runtimes[0].name) {
                // 改进的版本匹配正则表达式，支持Java 1.8, 11, 17等格式
                const versionMatch = runtimes[0].name.match(/(\d+\.\d+|\d+)/);
                if (versionMatch && versionMatch[1]) {
                    // 对于1.8这样的版本号，只取小数点后的数字
                    if (versionMatch[1].includes('.')) {
                        const parts = versionMatch[1].split('.');
                        javaVersion = parseInt(parts[1]); // 对于1.8，取8
                    } else {
                        javaVersion = parseInt(versionMatch[1]); // 对于11, 17等，直接使用
                    }
                    if (outputChannel) {
                        outputChannel.appendLine(`从VS Code配置获取第一个Java运行时版本: ${javaVersion}`);
                    }
                }
            }
            
            // 如果从VS Code配置中无法获取版本，则通过命令行检测
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
        } catch (error: any) {
            if (outputChannel) {
                outputChannel.appendLine(`警告: 无法检测Java版本，将假设使用Java 8+: ${error.message}`);
            }
        }
        
        return javaVersion;
    }

    /**
     * 获取Java版本信息
     * @param javaExecutable Java可执行文件路径
     * @param outputChannel 输出通道，用于记录日志
     * @returns Java运行时名称
     */
    public static getJavaVersionName(javaExecutable: string, outputChannel?: vscode.OutputChannel): string {
        let runtimeName = "JavaSE-1.8";
        try {
            const { execSync } = require('child_process');
            const javaVersionOutput = execSync(`"${javaExecutable}" -version 2>&1`, { encoding: 'utf-8' });
            
            if (javaVersionOutput.includes('version "1.7')) {
                runtimeName = "JavaSE-1.7";
            } else if (javaVersionOutput.includes('version "1.8')) {
                runtimeName = "JavaSE-1.8";
            } else if (javaVersionOutput.includes('version "11')) {
                runtimeName = "JavaSE-11";
            } else if (javaVersionOutput.includes('version "17')) {
                runtimeName = "JavaSE-17";
            } else if (javaVersionOutput.includes('version "1.6')) {
                runtimeName = "JavaSE-1.6";
            } else {
                // 尝试从输出中提取版本号
                const versionMatch = javaVersionOutput.match(/version "(\d+\.?\d*\.?\d*)/);
                if (versionMatch && versionMatch[1]) {
                    runtimeName = `JavaSE-${versionMatch[1]}`;
                }
            }
        } catch (versionError: any) {
            if (outputChannel) {
                outputChannel.appendLine(`获取Java版本时出错: ${versionError}`);
            }
        }
        return runtimeName;
    }
}