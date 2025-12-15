import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { NCHomeConfigService } from '../nc-home/config/NCHomeConfigService';

/**
 * Mac HOME转换服务
 */
export class MacHomeConversionService {
    private configService: NCHomeConfigService;
    private static outputChannelInstance: vscode.OutputChannel | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor(configService: NCHomeConfigService) {
        this.configService = configService;
        // 确保OutputChannel只初始化一次
        if (!MacHomeConversionService.outputChannelInstance) {
            MacHomeConversionService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP Mac HOME转换');
        }
        this.outputChannel = MacHomeConversionService.outputChannelInstance;
    }

    /**
     * 执行Mac HOME转换
     * @param homePath HOME路径
     */
    public async convertToMacHome(homePath: string): Promise<boolean> {
        try {
            this.outputChannel.appendLine('开始执行Mac HOME转换...');
            this.outputChannel.show();

            // 1. 解压home/bin下的jarsh.jar
            await this.extractJarshJar(homePath);

            // 2. 使用本目录resource/sysconfig/sysConfig.sh替换home/bin/sysConfig.sh
            await this.replaceSysConfigSh(homePath);

            // 3. 使用本目录resource/sysconfig/uapSetupCmdLine.sh替换home/bin/uapSetupCmdLine.sh
            await this.replaceUapSetupCmdLineSh(homePath);

            // 4. 设置权限
            await this.setPermissions(homePath);

            this.outputChannel.appendLine('Mac HOME转换完成！');
            vscode.window.showInformationMessage('Mac HOME转换完成！');
            return true;
        } catch (error: any) {
            this.outputChannel.appendLine(`Mac HOME转换失败: ${error.message}`);
            vscode.window.showErrorMessage(`Mac HOME转换失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 解压home/bin下的jarsh.jar
     * @param homePath HOME路径
     */
    private async extractJarshJar(homePath: string): Promise<void> {
        this.outputChannel.appendLine('正在解压jarsh.jar...');

        const jarshJarPath = path.join(homePath, 'bin', 'jarsh.jar');
        const binPath = path.join(homePath, 'bin');

        if (!fs.existsSync(jarshJarPath)) {
            throw new Error(`未找到jarsh.jar文件: ${jarshJarPath}`);
        }

        try {
            const zip = new AdmZip(jarshJarPath);
            zip.extractAllTo(binPath, true);
            this.outputChannel.appendLine('jarsh.jar解压完成');
        } catch (error: any) {
            throw new Error(`解压jarsh.jar失败: ${error.message}`);
        }
    }

    /**
     * 替换sysConfig.sh文件
     * @param homePath HOME路径
     */
    private async replaceSysConfigSh(homePath: string): Promise<void> {
        this.outputChannel.appendLine('正在替换sysConfig.sh文件...');

        // 获取扩展路径
        const extensionPath = vscode.extensions.getExtension('zhangchck.yonbip-devtool')?.extensionPath;
        if (!extensionPath) {
            throw new Error('无法获取扩展路径');
        }

        const sourceSysConfigPath = path.join(extensionPath, 'resources', 'sysconfig', 'sysConfig.sh');
        const targetSysConfigPath = path.join(homePath, 'bin', 'sysConfig.sh');

        if (!fs.existsSync(sourceSysConfigPath)) {
            throw new Error(`未找到源sysConfig.sh文件: ${sourceSysConfigPath}`);
        }

        // 读取源文件内容
        let content = fs.readFileSync(sourceSysConfigPath, 'utf-8');

        // 获取用户的JDK路径
        const jdkPath = await this.getJdkPath();
        content = content.replace('替换为用户的jdk路径', jdkPath);

        // 写入目标文件
        fs.writeFileSync(targetSysConfigPath, content, 'utf-8');
        this.outputChannel.appendLine(`sysConfig.sh文件已替换: ${targetSysConfigPath}`);
        this.outputChannel.appendLine(`JDK路径设置为: ${jdkPath}`);
    }

    /**
     * 替换uapSetupCmdLine.sh文件
     * @param homePath HOME路径
     */
    private async replaceUapSetupCmdLineSh(homePath: string): Promise<void> {
        this.outputChannel.appendLine('正在替换uapSetupCmdLine.sh文件...');

        // 获取扩展路径
        const extensionPath = vscode.extensions.getExtension('zhangchck.yonbip-devtool')?.extensionPath;
        if (!extensionPath) {
            throw new Error('无法获取扩展路径');
        }

        const sourceUapSetupCmdLinePath = path.join(extensionPath, 'resources', 'sysconfig', 'uapSetupCmdLine.sh');
        const targetUapSetupCmdLinePath = path.join(homePath, 'bin', 'uapSetupCmdLine.sh');

        if (!fs.existsSync(sourceUapSetupCmdLinePath)) {
            throw new Error(`未找到源uapSetupCmdLine.sh文件: ${sourceUapSetupCmdLinePath}`);
        }

        // 读取源文件内容
        let content = fs.readFileSync(sourceUapSetupCmdLinePath, 'utf-8');


        // 写入目标文件
        fs.writeFileSync(targetUapSetupCmdLinePath, content, 'utf-8');
        this.outputChannel.appendLine(`uapSetupCmdLine.sh文件已替换: ${targetUapSetupCmdLinePath}`);
    }

    /**
     * 获取JDK路径
     */
    private async getJdkPath(): Promise<string> {
        // 首先尝试从环境变量中获取JDK路径
        let jdkPath = process.env.JAVA_HOME || process.env.JDK_HOME;

        // 如果环境变量中没有找到，尝试一些常见的JDK安装路径
        if (!jdkPath) {
            const commonJdkPaths = [
                '/Library/Java/JavaVirtualMachines/default/Contents/Home',
                '/Library/Java/JavaVirtualMachines/zulu-8.jdk/Contents/Home',
                '/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home'
            ];

            for (const path of commonJdkPaths) {
                if (fs.existsSync(path)) {
                    jdkPath = path;
                    break;
                }
            }
        }

        // 如果还是没有找到，尝试使用java命令来获取
        if (!jdkPath) {
            try {
                const { execSync } = require('child_process');
                const javaPath = execSync('which java', { encoding: 'utf-8' }).trim();
                if (javaPath) {
                    // 从java命令路径推断JDK路径
                    if (javaPath.includes('/bin/java')) {
                        jdkPath = javaPath.replace(/\/bin\/java$/, '');
                    } else {
                        // 尝试使用java -XshowSettings:properties命令获取java.home
                        const javaProperties = execSync('java -XshowSettings:properties -version 2>&1', { encoding: 'utf-8' });
                        const javaHomeMatch = javaProperties.match(/java\.home = (.+)/);
                        if (javaHomeMatch && javaHomeMatch[1]) {
                            jdkPath = javaHomeMatch[1].trim();
                        }
                    }
                }
            } catch (error) {
                this.outputChannel.appendLine(`获取Java路径时出错: ${error}`);
            }
        }

        // 如果仍然没有找到JDK路径，抛出错误
        if (!jdkPath) {
            throw new Error('无法自动检测到JDK路径，请确保已正确安装JDK并设置环境变量(JAVA_HOME或JDK_HOME)');
        }

        // 验证JDK路径是否存在
        if (!fs.existsSync(jdkPath)) {
            throw new Error(`检测到的JDK路径不存在: ${jdkPath}`);
        }

        // 验证是否包含java可执行文件
        const javaExecutable = path.join(jdkPath, 'bin', 'java');
        if (!fs.existsSync(javaExecutable)) {
            throw new Error(`JDK路径中未找到java可执行文件: ${javaExecutable}`);
        }

        return jdkPath;
    }

    /**
     * 设置权限
     * @param homePath HOME路径
     */
    private async setPermissions(homePath: string): Promise<void> {
        this.outputChannel.appendLine('正在设置文件权限...');

        const binPath = path.join(homePath, 'bin');
        const antPath = path.join(homePath, 'ant');

        // 授权home/ant的路径权限：chmod -R 777 ant
        if (fs.existsSync(antPath)) {
            try {
                await this.executeCommand(`chmod -R 777 "${antPath}"`);
                this.outputChannel.appendLine(`已设置${antPath}权限为777`);
            } catch (error) {
                this.outputChannel.appendLine(`警告：设置${antPath}权限失败: ${error}`);
            }
        } else {
            this.outputChannel.appendLine(`警告：${antPath}目录不存在，跳过权限设置`);
        }

        // 授权home/bin下的.sh文件权限：chmod u+x *.sh
        if (fs.existsSync(binPath)) {
            try {
                await this.executeCommand(`chmod u+x "${binPath}"/*.sh`);
                this.outputChannel.appendLine(`已设置${binPath}/*.sh执行权限`);
            } catch (error) {
                this.outputChannel.appendLine(`警告：设置${binPath}/*.sh执行权限失败: ${error}`);
            }
        } else {
            this.outputChannel.appendLine(`警告：${binPath}目录不存在，跳过权限设置`);
        }
    }

    /**
     * 执行命令
     * @param command 命令
     */
    private async executeCommand(command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            exec(command, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    reject(new Error(`执行命令失败: ${error.message}\nstderr: ${stderr}`));
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * 显示输出面板
     */
    public showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        if (MacHomeConversionService.outputChannelInstance) {
            MacHomeConversionService.outputChannelInstance.dispose();
            MacHomeConversionService.outputChannelInstance = null;
        }
    }
}