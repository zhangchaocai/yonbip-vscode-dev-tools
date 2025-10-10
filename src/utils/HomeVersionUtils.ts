import * as fs from 'fs';
import * as path from 'path';

/**
 * NC HOME版本枚举值
 */
export const HOME_VERSIONS = [
    '1903', '1909', '2005', '2105', '2111', 
    '2207', '2305', '2312', '2411', '2505'
];

/**
 * 从setup.ini文件中获取HOME版本信息
 * @param homePath NC HOME路径
 * @returns 版本号，如果无法获取则返回null
 */
export function getHomeVersion(homePath: string): string | null {
    try {
        // 构建setup.ini文件路径
        const setupIniPath = path.join(homePath, 'ncscript', 'uapServer', 'setup.ini');

        // 检查文件是否存在
        if (!fs.existsSync(setupIniPath)) {
            return null;
        }

        // 读取文件内容
        const content = fs.readFileSync(setupIniPath, 'utf-8');

        // 解析版本信息
        // 查找version=开头的行
        const versionMatch = content.match(/^version\s*=\s*(.+)$/m);
        if (!versionMatch) {
            return null;
        }

        const versionLine = versionMatch[1];

        // 解析版本字符串 "YonBIP V3 (R2_2311_1 Premium) 20230830171835"
        // 提取其中的 "2311" 部分
        const versionPattern = /R\d+_(\d+)_\d+/;
        const versionParts = versionLine.match(versionPattern);

        if (versionParts && versionParts[1]) {
            const version = versionParts[1];
            return version;
        } else {
            return null;
        }
    } catch (error) {
        return null;
    }
}

/**
 * 查找最接近的HOME版本
 * @param version 当前版本
 * @returns 最接近的版本号，如果无法匹配则返回null
 */
export function findClosestHomeVersion(version: string | null): string | null {
    if (!version) {
        return null;
    }

    // 如果版本在枚举值中，直接返回
    if (HOME_VERSIONS.includes(version)) {
        return version;
    }

    // 将版本转换为数字进行比较
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum)) {
        return null;
    }

    // 查找最接近的版本
    let closestVersion: string | null = null;
    let minDifference = Infinity;

    for (const enumVersion of HOME_VERSIONS) {
        const enumVersionNum = parseInt(enumVersion, 10);
        if (isNaN(enumVersionNum)) {
            continue;
        }

        const difference = Math.abs(versionNum - enumVersionNum);
        if (difference < minDifference) {
            minDifference = difference;
            closestVersion = enumVersion;
        }
    }

    return closestVersion;
}