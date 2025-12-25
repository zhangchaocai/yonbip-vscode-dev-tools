import { spawnSync } from 'child_process';
import * as path from 'path';

/**
 * 密码加密解密工具类
 * 使用 aes-decrypt-tool.jar 进行加密解密操作
 */
export class PasswordEncryptor {
    private static extensionPath: string = '';

    /**
     * 设置扩展路径
     * @param extensionPath 扩展路径
     */
    public static setExtensionPath(extensionPath: string): void {
        PasswordEncryptor.extensionPath = extensionPath;
    }

    /**
     * 解密密码
     * @param encryptedPassword 加密后的密码
     * @returns 解密后的密码
     */
    public static decrypt(homePath: string, encryptedPassword: string): string {
        if (!encryptedPassword) {
            return '';
        }

        try {
            // 检查扩展路径是否已设置
            if (!PasswordEncryptor.extensionPath) {
                console.error('扩展路径未设置');
                return encryptedPassword;
            }

            const jarPath = path.join(PasswordEncryptor.extensionPath, 'resources', 'aes-crypto-tool', 'aes-decrypt-tool.jar');
            const dependencyJarPath = path.join(homePath, 'modules', 'iuap', 'lib', 'sagas-encrypt-1.0.0-SNAPSHOT.jar');

            // 执行Java解密命令，使用类路径包含所有必要的JAR文件
            const result = spawnSync('java', ['-cp', `${jarPath}${path.delimiter}${dependencyJarPath}`, 'com.yonyou.encrypt.AESWrapper', 'decrypt', encryptedPassword], {
                encoding: 'utf8',
                timeout: 10000 // 10秒超时
            });

            if (result.status === 0) {
                // 解析输出，提取解密结果
                let output = result.stdout || '';
                // 统一处理不同操作系统的换行符
                output = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                // 使用冒号分割，取数组中的第二值作为结果
                const parts = output.split(':');
                if (parts.length >= 2) {
                    // 取第二部分并去除前后空格和换行符
                    return parts[1].trim().replace(/[\r\n\s]+$/, '');
                }
                return encryptedPassword; // 如果分割失败，返回原始密码
            } else {
                console.error('密码解密失败:', result.stderr);
                return encryptedPassword;
            }
        } catch (error) {
            console.error('密码解密异常:', error);
            return encryptedPassword;
        }
    }

    /**
     * 加密密码
     * @param plainPassword 明文密码
     * @returns 加密后的密码
     */
    public static encrypt(homePath: string, plainPassword: string): string {
        if (!plainPassword) {
            return '';
        }

        try {
            // 检查扩展路径是否已设置
            if (!PasswordEncryptor.extensionPath) {
                console.error('扩展路径未设置');
                return plainPassword;
            }

            const jarPath = path.join(PasswordEncryptor.extensionPath, 'resources', 'aes-crypto-tool', 'aes-decrypt-tool.jar');
            const dependencyJarPath = path.join(homePath, 'modules', 'iuap', 'lib', 'sagas-encrypt-1.0.0-SNAPSHOT.jar');
            // 执行Java加密命令，使用类路径包含所有必要的JAR文件
            const result = spawnSync('java', ['-cp', `${jarPath}${path.delimiter}${dependencyJarPath}`, 'com.yonyou.encrypt.AESWrapper', 'encrypt', plainPassword], {
                encoding: 'utf8',
                timeout: 10000 // 10秒超时
            });

            if (result.status === 0) {
                // 解析输出，提取加密结果
                let output = result.stdout || '';
                // 统一处理不同操作系统的换行符
                output = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                // 使用冒号分割，取数组中的第二值作为结果
                const parts = output.split(':');
                if (parts.length >= 2) {
                    // 取第二部分并去除前后空格和换行符
                    return parts[1].trim().replace(/[\r\n\s]+$/, '');
                }
                return plainPassword; // 如果分割失败，返回原始密码
            } else {
                console.error('密码加密失败:', result.stderr);
                return plainPassword;
            }
        } catch (error) {
            console.error('密码加密异常:', error);
            return plainPassword;
        }
    }

    /**
     * 判断密码是否已经加密
     * @param homePath NC HOME路径
     * @param password 密码字符串
     * @returns 是否已加密
     */
    public static isEncrypted(homePath: string, password: string): boolean {
        if (!password || password.length === 0) {
            return false;
        }
    
        // 检查prop.xml文件中的isEncode标签来判断是否启用加密功能
        try {
            const fs = require('fs');
            const path = require('path');
            const iconv = require('iconv-lite');
                
            const propXmlPath = path.join(homePath, 'ierp', 'bin', 'prop.xml');
                
            // 检查文件是否存在
            if (!fs.existsSync(propXmlPath)) {
                // 如果prop.xml不存在，默认认为密码未加密
                return false;
            }
                
            // 读取文件内容，文件编码为gb2312
            const buffer = fs.readFileSync(propXmlPath);
            const content = iconv.decode(buffer, 'gb2312');
                
            // 查找isEncode标签
            const isEncodeMatch = content.match(/<isEncode>([^<]*)<\/isEncode>/);
            let isEncodeEnabled = false;
            if (isEncodeMatch && isEncodeMatch[1]) {
                // 如果isEncode为true，则启用加密功能
                isEncodeEnabled = isEncodeMatch[1].trim().toLowerCase() === 'true';
            }
                
            // 如果加密功能未启用，直接返回false
            if (!isEncodeEnabled) {
                return false;
            }
                
            // 通过尝试解密来判断密码是否已加密
            // 如果密码是加密的，解密后应该得到有意义的明文
            // 如果密码是明文，解密后会得到乱码
            try {
                const decryptedPassword = PasswordEncryptor.decrypt(homePath, password);
                    
                // 检查解密结果是否包含大量乱码字符
                // 如果解密后包含多个连续的替换字符，说明原密码可能是明文
                const replacementCharCount = (decryptedPassword.match(/\uFFFD/g) || []).length;
                    
                // 如果乱码字符数量超过一定阈值（比如2个），则原密码很可能是明文
                if (replacementCharCount > 2) {
                    return false; // 原密码是明文
                }
                    
                // 如果解密后没有大量乱码，且与原密码不同，则原密码是加密的
                if (decryptedPassword !== password) {
                    return true; // 原密码是加密的
                }
                    
                // 如果解密后与原密码相同，需要进一步判断
                // 检查解密结果是否看起来像明文
                // 通常加密结果包含更多特殊字符，而明文更可能是普通字符
                const specialCharCount = (decryptedPassword.match(/[^a-zA-Z0-9\s]/g) || []).length;
                const totalLength = decryptedPassword.length;
                    
                // 如果特殊字符比例较高，可能是加密的
                if (totalLength > 0 && specialCharCount / totalLength > 0.3) {
                    return true;
                }
                    
                // 默认情况下，如果启用了加密且能成功解密，认为是加密的
                return true;
            } catch (decryptError) {
                // 如果解密失败，说明原密码可能就是明文
                return false;
            }
        } catch (error) {
            // 如果读取文件出错，默认认为密码未加密
            console.error('检查密码加密状态时出错:', error);
            return false;
        }
    }

    /**
     * 获取安全的密码（如果已加密则解密，否则返回原密码）
     * @param password 密码字符串
     * @returns 解密后的密码
     */
    public static getSecurePassword(homePath: string, password: string): string {
        if (!password) {
            return '';
        }

        // 确保返回的是字符串类型
        let result: string;
        
        // 如果密码已加密，则解密
        if (PasswordEncryptor.isEncrypted(homePath, password)) {
            result = PasswordEncryptor.decrypt(homePath, password);
        } else {
            // 否则返回原密码
            result = password;
        }
        
        // 确保返回的是字符串类型，避免SCRAM认证错误
        return typeof result === 'string' ? result : String(result || '');
    }
}