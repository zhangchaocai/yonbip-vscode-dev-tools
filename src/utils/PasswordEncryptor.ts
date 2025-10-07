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
                const output = result.stdout || '';
                const match = output.match(/解密结果:\s*(.*)/);
                if (match && match[1]) {
                    return match[1].trim();
                }
                return encryptedPassword; // 如果没有匹配到结果，返回原始密码
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
                const output = result.stdout || '';
                const match = output.match(/加密结果:\s*(.*)/);
                if (match && match[1]) {
                    return match[1].trim();
                }
                return plainPassword; // 如果没有匹配到结果，返回原始密码
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
     * @param password 密码字符串
     * @returns 是否已加密
     */
    public static isEncrypted(homePath: string, password: string): boolean {
        if (!password || password.length === 0) {
            return false;
        }

        // 简单判断：如果密码只包含小写字母且长度看起来像加密后的格式
        // 这是一个启发式判断，可能需要根据实际情况调整
        return /^[a-z]+$/.test(password) && password.length >= 8;
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

        // 如果密码已加密，则解密
        if (PasswordEncryptor.isEncrypted(homePath, password)) {
            return PasswordEncryptor.decrypt(homePath, password);
        }

        // 否则返回原密码
        return password;
    }
}