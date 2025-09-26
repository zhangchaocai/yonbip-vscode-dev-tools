/**
 * 密码加密解密工具类
 * 参考IDEA插件的nc.uap.plugin.studio.ui.preference.rsa.Encode实现
 * 简化版本，使用可逆的字符变换算法
 */
export class PasswordEncryptor {
    private static readonly KEY = 1231234234;

    /**
     * 解密密码
     * @param encryptedPassword 加密后的密码
     * @returns 解密后的密码
     */
    public static decrypt(encryptedPassword: string): string {
        if (!encryptedPassword) {
            return '';
        }

        try {
            // 如果不是加密格式，直接返回
            if (!this.isEncrypted(encryptedPassword)) {
                return encryptedPassword;
            }

            let result = '';
            const key = this.KEY;
            
            // 每16个字符为一组进行解密
            for (let i = 0; i < Math.floor(encryptedPassword.length / 16); i++) {
                const chunk = encryptedPassword.substring(i * 16, (i + 1) * 16);
                const decryptedChunk = this.decryptChunk(chunk, key);
                result += decryptedChunk;
            }

            return result.trim();
        } catch (error) {
            console.error('密码解密失败:', error);
            // 如果解密失败，返回原始密码（可能是未加密的）
            return encryptedPassword;
        }
    }

    /**
     * 加密密码
     * @param plainPassword 明文密码
     * @returns 加密后的密码
     */
    public static encrypt(plainPassword: string): string {
        if (!plainPassword) {
            return '';
        }

        try {
            const key = this.KEY;
            const space = 32; // 空格字符
            
            // 计算需要填充的长度（8的倍数）
            const paddedLength = Math.ceil(plainPassword.length / 8) * 8;
            const paddedPassword = plainPassword.padEnd(paddedLength, String.fromCharCode(space));

            let result = '';

            // 每8个字节为一组进行加密
            for (let i = 0; i < paddedPassword.length; i += 8) {
                const chunk = paddedPassword.substring(i, i + 8);
                const encryptedChunk = this.encryptChunk(chunk, key);
                result += encryptedChunk;
            }

            return result;
        } catch (error) {
            console.error('密码加密失败:', error);
            return plainPassword;
        }
    }

    /**
     * 判断密码是否已经加密
     * @param password 密码字符串
     * @returns 是否已加密
     */
    public static isEncrypted(password: string): boolean {
        if (!password || password.length === 0) {
            return false;
        }

        // 加密后的密码长度应该是16的倍数，且只包含a-p的小写字母
        if (password.length % 16 !== 0) {
            return false;
        }

        // 检查是否只包含a-p的小写字母（加密后的特征）
        return /^[a-p]+$/.test(password);
    }

    /**
     * 获取安全的密码（如果已加密则解密，否则返回原密码）
     * @param password 密码字符串
     * @returns 解密后的密码
     */
    public static getSecurePassword(password: string): string {
        if (!password) {
            return '';
        }

        // 如果密码已加密，则解密
        if (PasswordEncryptor.isEncrypted(password)) {
            return PasswordEncryptor.decrypt(password);
        }

        // 否则返回原密码
        return password;
    }

    /**
     * 加密一个8字符的块
     */
    private static encryptChunk(chunk: string, key: number): string {
        const bytes = Buffer.from(chunk, 'utf8');
        const keyBytes = this.keyToBytes(key);
        
        // 使用异或操作进行加密
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
        }

        // 转换为16进制字符串，然后映射到a-p字符
        let result = '';
        for (let i = 0; i < bytes.length; i++) {
            const high = (bytes[i] >>> 4) & 0x0F;
            const low = bytes[i] & 0x0F;
            result += String.fromCharCode(97 + high); // 'a'到'p'
            result += String.fromCharCode(97 + low);  // 'a'到'p'
        }

        return result;
    }

    /**
     * 解密一个16字符的块
     */
    private static decryptChunk(chunk: string, key: number): string {
        const keyBytes = this.keyToBytes(key);
        const bytes = new Array(chunk.length / 2);

        // 将a-p字符转换回字节
        for (let i = 0; i < chunk.length; i += 2) {
            const high = chunk.charCodeAt(i) - 97;
            const low = chunk.charCodeAt(i + 1) - 97;
            bytes[i / 2] = (high << 4) | low;
        }

        // 使用异或操作进行解密
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
        }

        return Buffer.from(bytes).toString('utf8');
    }

    /**
     * 将密钥转换为字节数组
     */
    private static keyToBytes(key: number): number[] {
        const bytes = new Array(8);
        let tempKey = key;
        
        for (let i = 7; i >= 0; i--) {
            bytes[i] = tempKey & 0xFF;
            tempKey = tempKey >>> 8;
        }

        return bytes;
    }
}