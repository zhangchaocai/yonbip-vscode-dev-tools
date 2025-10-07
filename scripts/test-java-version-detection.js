/**
 * 简单的脚本用于测试Java版本检测功能
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('测试Java版本检测功能');

// 检查操作系统类型
const platform = os.platform();
console.log(`操作系统: ${platform}`);

if (platform === 'darwin') {
    console.log('检测macOS系统的Java版本...');
    
    // 尝试使用/usr/libexec/java_home -V命令获取所有已安装的JDK
    try {
        const javaVersionsOutput = execSync('/usr/libexec/java_home -V', { encoding: 'utf-8' });
        console.log('已安装的Java版本:');
        console.log(javaVersionsOutput);
        
        const lines = javaVersionsOutput.split('\n');
        const javaRuntimes = [];
        
        // 解析每个Java版本
        for (const line of lines) {
            const match = line.match(/(\d+\.\d+\.?\d*).*?(\/.*?\/Contents\/Home)/);
            if (match) {
                const version = match[1];
                const jdkPath = match[2];
                
                // 验证路径是否存在且包含java可执行文件
                if (fs.existsSync(jdkPath)) {
                    const javaExecutable = path.join(jdkPath, 'bin', 'java');
                    if (fs.existsSync(javaExecutable)) {
                        // 根据Java版本确定运行时名称
                        let runtimeName = "JavaSE-1.8";
                        if (version.startsWith("1.8")) {
                            runtimeName = "JavaSE-1.8";
                        } else if (version.startsWith("11")) {
                            runtimeName = "JavaSE-11";
                        } else if (version.startsWith("17")) {
                            runtimeName = "JavaSE-17";
                        } else if (version.startsWith("1.6")) {
                            runtimeName = "JavaSE-1.6";
                        } else {
                            // 对于其他版本，使用通用名称
                            runtimeName = `JavaSE-${version}`;
                        }
                        
                        javaRuntimes.push({
                            "name": runtimeName,
                            "path": jdkPath
                        });
                        
                        console.log(`找到Java版本: ${runtimeName} at ${jdkPath}`);
                    }
                }
            }
        }
    } catch (error) {
        console.log(`/usr/libexec/java_home -V命令执行失败: ${error.message}`);
    }
} else if (platform === 'win32') {
    console.log('检测Windows系统的Java版本...');
    
    // 在Windows系统上，检查默认路径
    const homePath = process.env.USERPROFILE || process.env.HOMEPATH || 'C:\\';
    const defaultJdkPath = path.join(homePath, 'ufjdk');
    console.log(`默认JDK路径: ${defaultJdkPath}`);
    
    // 检查默认路径是否存在
    if (fs.existsSync(defaultJdkPath)) {
        console.log(`默认JDK路径存在: ${defaultJdkPath}`);
        
        // 验证是否包含java可执行文件
        const javaExecutable = path.join(defaultJdkPath, 'bin', 'java.exe');
        if (fs.existsSync(javaExecutable)) {
            console.log(`Java可执行文件存在: ${javaExecutable}`);
        } else {
            console.log(`Java可执行文件不存在: ${javaExecutable}`);
        }
    } else {
        console.log(`默认JDK路径不存在: ${defaultJdkPath}`);
    }
    
    // 如果默认路径不存在或无效，尝试从环境变量中获取
    let jdkPath = process.env.JAVA_HOME || process.env.JDK_HOME;
    console.log(`从环境变量获取的JDK路径: ${jdkPath || '未找到'}`);
    
    // 检查路径是否存在
    if (jdkPath && fs.existsSync(jdkPath)) {
        console.log(`JDK路径存在: ${jdkPath}`);
        
        // 验证是否包含java可执行文件
        const javaExecutable = path.join(jdkPath, 'bin', 'java.exe');
        if (fs.existsSync(javaExecutable)) {
            console.log(`Java可执行文件存在: ${javaExecutable}`);
        } else {
            console.log(`Java可执行文件不存在: ${javaExecutable}`);
        }
    } else {
        console.log(`JDK路径不存在: ${jdkPath || '未找到'}`);
    }
} else {
    console.log(`不支持的操作系统: ${platform}`);
}