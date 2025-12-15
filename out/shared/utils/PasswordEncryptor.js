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
exports.PasswordEncryptor = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
class PasswordEncryptor {
    static extensionPath = '';
    static setExtensionPath(extensionPath) {
        PasswordEncryptor.extensionPath = extensionPath;
    }
    static decrypt(homePath, encryptedPassword) {
        if (!encryptedPassword) {
            return '';
        }
        try {
            if (!PasswordEncryptor.extensionPath) {
                console.error('扩展路径未设置');
                return encryptedPassword;
            }
            const jarPath = path.join(PasswordEncryptor.extensionPath, 'resources', 'aes-crypto-tool', 'aes-decrypt-tool.jar');
            const dependencyJarPath = path.join(homePath, 'modules', 'iuap', 'lib', 'sagas-encrypt-1.0.0-SNAPSHOT.jar');
            const result = (0, child_process_1.spawnSync)('java', ['-cp', `${jarPath}${path.delimiter}${dependencyJarPath}`, 'com.yonyou.encrypt.AESWrapper', 'decrypt', encryptedPassword], {
                encoding: 'utf8',
                timeout: 10000
            });
            if (result.status === 0) {
                let output = result.stdout || '';
                output = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                const parts = output.split(':');
                if (parts.length >= 2) {
                    return parts[1].trim().replace(/[\r\n\s]+$/, '');
                }
                return encryptedPassword;
            }
            else {
                console.error('密码解密失败:', result.stderr);
                return encryptedPassword;
            }
        }
        catch (error) {
            console.error('密码解密异常:', error);
            return encryptedPassword;
        }
    }
    static encrypt(homePath, plainPassword) {
        if (!plainPassword) {
            return '';
        }
        try {
            if (!PasswordEncryptor.extensionPath) {
                console.error('扩展路径未设置');
                return plainPassword;
            }
            const jarPath = path.join(PasswordEncryptor.extensionPath, 'resources', 'aes-crypto-tool', 'aes-decrypt-tool.jar');
            const dependencyJarPath = path.join(homePath, 'modules', 'iuap', 'lib', 'sagas-encrypt-1.0.0-SNAPSHOT.jar');
            const result = (0, child_process_1.spawnSync)('java', ['-cp', `${jarPath}${path.delimiter}${dependencyJarPath}`, 'com.yonyou.encrypt.AESWrapper', 'encrypt', plainPassword], {
                encoding: 'utf8',
                timeout: 10000
            });
            if (result.status === 0) {
                let output = result.stdout || '';
                output = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                const parts = output.split(':');
                if (parts.length >= 2) {
                    return parts[1].trim().replace(/[\r\n\s]+$/, '');
                }
                return plainPassword;
            }
            else {
                console.error('密码加密失败:', result.stderr);
                return plainPassword;
            }
        }
        catch (error) {
            console.error('密码加密异常:', error);
            return plainPassword;
        }
    }
    static isEncrypted(homePath, password) {
        if (!password || password.length === 0) {
            return false;
        }
        return /^[a-z]+$/.test(password) && password.length >= 8;
    }
    static getSecurePassword(homePath, password) {
        if (!password) {
            return '';
        }
        if (PasswordEncryptor.isEncrypted(homePath, password)) {
            return PasswordEncryptor.decrypt(homePath, password);
        }
        return password;
    }
}
exports.PasswordEncryptor = PasswordEncryptor;
//# sourceMappingURL=PasswordEncryptor.js.map