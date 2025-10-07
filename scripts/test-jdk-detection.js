/**
 * 简单的脚本用于测试JDK路径检测功能
 */

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

console.log('测试JDK路径检测功能');

// 检查操作系统类型
const platform = os.platform();
console.log(`操作系统: ${platform}`);

if (platform === 'darwin') {
    console.log('检测macOS系统的JDK路径...');
    
    // 首先尝试从环境变量中获取JDK路径
    let jdkPath = process.env.JAVA_HOME || process.env.JDK_HOME;
    console.log(`从环境变量获取的JDK路径: ${jdkPath || '未找到'}`);
    
    // 如果环境变量中没有找到，尝试使用/usr/libexec/java_home命令获取
    if (!jdkPath) {
        try {
            jdkPath = execSync('/usr/libexec/java_home', { encoding: 'utf-8' }).trim();
            console.log(`通过/usr/libexec/java_home命令获取的JDK路径: ${jdkPath}`);
        } catch (error) {
            console.log(`/usr/libexec/java_home命令执行失败: ${error.message}`);
        }
    }
    
    // 检查路径是否存在
    if (jdkPath && fs.existsSync(jdkPath)) {
        console.log(`JDK路径存在: ${jdkPath}`);
        
        // 验证是否包含java可执行文件
        const javaExecutable = require('path').join(jdkPath, 'bin', 'java');
        if (fs.existsSync(javaExecutable)) {
            console.log(`Java可执行文件存在: ${javaExecutable}`);
        } else {
            console.log(`Java可执行文件不存在: ${javaExecutable}`);
        }
    } else {
        console.log(`JDK路径不存在: ${jdkPath || '未找到'}`);
    }
} else if (platform === 'win32') {
    console.log('检测Windows系统的JDK路径...');
    
    // 在Windows系统上，默认使用homepath/ufjdk作为JDK路径
    const homePath = process.env.USERPROFILE || process.env.HOMEPATH || 'C:\\';
    const defaultJdkPath = require('path').join(homePath, 'ufjdk');
    console.log(`默认JDK路径: ${defaultJdkPath}`);
    
    // 检查默认路径是否存在
    if (fs.existsSync(defaultJdkPath)) {
        console.log(`默认JDK路径存在: ${defaultJdkPath}`);
        
        // 验证是否包含java可执行文件
        const javaExecutable = require('path').join(defaultJdkPath, 'bin', 'java.exe');
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
        const javaExecutable = require('path').join(jdkPath, 'bin', 'java.exe');
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