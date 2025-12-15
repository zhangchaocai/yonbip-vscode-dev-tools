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
exports.ConfigurationUtils = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const xml2js = __importStar(require("xml2js"));
class ConfigurationUtils {
    configService;
    constructor(configService) {
        this.configService = configService;
    }
    async updateMiscellaneousConfiguration() {
        try {
            const config = this.configService.getConfig();
            let homePath = config.homePath;
            if (!homePath) {
                console.log('Home路径未配置');
                return;
            }
            if (process.platform === 'win32') {
                homePath = path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF', 'config', 'miscellaneous.xml');
            }
            else {
                homePath = path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF', 'config', 'miscellaneous.xml');
            }
            if (!fs.existsSync(homePath)) {
                console.log(`配置文件不存在: ${homePath}`);
                return;
            }
            const xmlContent = fs.readFileSync(homePath, 'utf-8');
            const parser = new xml2js.Parser({ explicitArray: false });
            const result = await parser.parseStringPromise(xmlContent);
            const tagsToUpdate = ['gzip', 'mark', 'aesKey', 'localStorage'];
            for (const tag of tagsToUpdate) {
                if (result.root && result.root[tag]) {
                    result.root[tag] = 'false';
                }
            }
            const builder = new xml2js.Builder({
                headless: true,
                renderOpts: {
                    pretty: false
                }
            });
            const updatedXml = builder.buildObject(result);
            fs.writeFileSync(homePath, updatedXml, 'utf-8');
            console.log('杂项配置文件更新成功');
        }
        catch (error) {
            console.error('更新杂项配置文件失败:', error);
        }
    }
    async updatePropXmlAddress() {
        try {
            const config = this.configService.getConfig();
            let homePath = config.homePath;
            if (!homePath) {
                console.log('Home路径未配置');
                return;
            }
            homePath = path.join(homePath, 'ierp', 'bin', 'prop.xml');
            if (!fs.existsSync(homePath)) {
                console.log(`prop.xml文件不存在: ${homePath}`);
                return;
            }
            const xmlContent = fs.readFileSync(homePath, 'utf-8');
            const parser = new xml2js.Parser({ explicitArray: true, ignoreAttrs: false });
            const result = await parser.parseStringPromise(xmlContent);
            this.updateAddressInObject(result.root);
            const builder = new xml2js.Builder({
                xmldec: { version: '1.0', encoding: 'UTF-8' },
                renderOpts: {
                    pretty: true,
                    indent: '  '
                },
                rootName: 'root'
            });
            const updatedXml = builder.buildObject(result);
            fs.writeFileSync(homePath, updatedXml, 'utf-8');
            console.log('prop.xml文件中的address标签更新成功');
        }
        catch (error) {
            console.error('更新prop.xml文件中的address标签失败:', error);
        }
    }
    updateAddressInObject(obj) {
        if (!obj)
            return;
        if (Array.isArray(obj)) {
            for (const item of obj) {
                this.updateAddressInObject(item);
            }
            return;
        }
        if (typeof obj === 'object') {
            if (obj.http) {
                const httpItems = Array.isArray(obj.http) ? obj.http : [obj.http];
                for (const http of httpItems) {
                    if (http.address && http.address !== '127.0.0.1') {
                        if (Array.isArray(http.address)) {
                            http.address[0] = '127.0.0.1';
                        }
                        else {
                            http.address = '127.0.0.1';
                        }
                        console.log(`已更新address标签: ${http.address}`);
                    }
                }
            }
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    this.updateAddressInObject(obj[key]);
                }
            }
        }
    }
    async authorizeHomeDirectoryPermissions() {
        const config = this.configService.getConfig();
        let homePath = config.homePath;
        if (process.platform !== 'darwin' && process.platform !== 'linux') {
            console.log('当前系统不是Mac或Linux，跳过权限授权');
            return;
        }
        try {
            if (!fs.existsSync(homePath)) {
                console.log(`指定的路径不存在: ${homePath}`);
                return;
            }
            const keyDirectories = [
                'bin',
                'ierp/bin',
                'hotwebs/nccloud/WEB-INF/config',
                'middleware',
                'lib',
                'modules'
            ];
            const { execSync } = require('child_process');
            for (const dir of keyDirectories) {
                const fullPath = path.join(homePath, dir);
                if (fs.existsSync(fullPath)) {
                    execSync(`chmod -R 755 "${fullPath}"`, { stdio: 'pipe' });
                    console.log(`已成功授权路径 ${fullPath} 的读写权限`);
                }
            }
        }
        catch (error) {
            console.error('授权目录权限时发生错误:', error);
        }
    }
}
exports.ConfigurationUtils = ConfigurationUtils;
//# sourceMappingURL=ConfigurationUtils.js.map