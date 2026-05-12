import * as fs from 'fs';
import * as path from 'path';

/**
 * 平台类型枚举
 */
export enum PlatformType {
    Windows = 'win32',
    macOS = 'darwin',
    Linux = 'linux',
    UOS = 'uos'  // 统信UOS
}

/**
 * 平台检测工具类
 */
export class PlatformUtils {

    /**
     * 获取当前平台类型
     * @returns 平台类型
     */
    public static getPlatform(): PlatformType {
        const platform = process.platform;

        if (platform === 'win32') {
            return PlatformType.Windows;
        }

        if (platform === 'darwin') {
            return PlatformType.macOS;
        }

        // Linux 系统检测是否是统信UOS
        if (this.isUOS()) {
            return PlatformType.UOS;
        }

        return PlatformType.Linux;
    }

    /**
     * 检测是否是统信UOS系统
     * @returns 是否是UOS系统
     */
    public static isUOS(): boolean {
        return this.isLinux() && this.checkUOSDistro();
    }

    /**
     * 检测是否是Linux系统
     * @returns 是否是Linux系统
     */
    public static isLinux(): boolean {
        return process.platform === 'linux';
    }

    /**
     * 检测是否是Windows系统
     * @returns 是否是Windows系统
     */
    public static isWindows(): boolean {
        return process.platform === 'win32';
    }

    /**
     * 检测是否是macOS系统
     * @returns 是否是macOS系统
     */
    public static isMacOS(): boolean {
        return process.platform === 'darwin';
    }

    /**
     * 检查是否是UOS/统信/Deepin发行版
     * @private
     * @returns 是否是UOS相关发行版
     */
    private static checkUOSDistro(): boolean {
        try {
            // 方法1: 检查 /etc/os-release
            if (fs.existsSync('/etc/os-release')) {
                const osRelease = fs.readFileSync('/etc/os-release', 'utf-8');
                if (osRelease.includes('UnionTech') ||
                    osRelease.includes('uos') ||
                    osRelease.includes('deepin') ||
                    osRelease.includes('Uniontech')) {
                    return true;
                }
            }

            // 方法2: 检查 /etc/system-release
            if (fs.existsSync('/etc/system-release')) {
                const systemRelease = fs.readFileSync('/etc/system-release', 'utf-8');
                if (systemRelease.includes('UnionTech') ||
                    systemRelease.includes('uos') ||
                    systemRelease.includes('Uniontech')) {
                    return true;
                }
            }

            // 方法3: 检查 /etc/debian_version（UOS基于Debian）
            if (fs.existsSync('/etc/debian_version')) {
                // UOS特定标识文件
                if (fs.existsSync('/etc/uniontech-release') ||
                    fs.existsSync('/etc/uos-release')) {
                    return true;
                }
            }

            // 方法4: 检查 /etc/lsb-release
            if (fs.existsSync('/etc/lsb-release')) {
                const lsbRelease = fs.readFileSync('/etc/lsb-release', 'utf-8');
                if (lsbRelease.includes('UnionTech') ||
                    lsbRelease.includes('uos') ||
                    lsbRelease.includes('deepin')) {
                    return true;
                }
            }
        } catch {
            // 读取文件失败，返回false
        }

        return false;
    }

    /**
     * 获取平台显示名称
     * @returns 平台显示名称
     */
    public static getPlatformDisplayName(): string {
        const platform = this.getPlatform();

        switch (platform) {
            case PlatformType.Windows:
                return 'Windows';
            case PlatformType.macOS:
                return 'macOS';
            case PlatformType.UOS:
                return '统信UOS';
            case PlatformType.Linux:
                return 'Linux';
            default:
                return 'Unknown';
        }
    }

    /**
     * 检查系统命令是否可用
     * @param command 命令名称
     * @returns 命令是否可用
     */
    public static isCommandAvailable(command: string): boolean {
        if (this.isWindows()) {
            try {
                const { execSync } = require('child_process');
                execSync(`where ${command}`, { encoding: 'utf-8', stdio: 'pipe' });
                return true;
            } catch {
                return false;
            }
        } else {
            try {
                const { execSync } = require('child_process');
                execSync(`which ${command}`, { encoding: 'utf-8', stdio: 'pipe' });
                return true;
            } catch {
                return false;
            }
        }
    }

    /**
     * 获取Java可执行文件名（跨平台）
     * @returns java或java.exe
     */
    public static getJavaExecutable(): string {
        return this.isWindows() ? 'java.exe' : 'java';
    }

    /**
     * 获取路径分隔符（跨平台）
     * @returns 路径分隔符
     */
    public static getPathSeparator(): string {
        return path.sep;
    }
}
