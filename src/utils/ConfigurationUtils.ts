import { NCHomeConfigService } from '../project/nc-home/config/NCHomeConfigService';
import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

/**
 * 配置工具类
 * 参考IDEA插件的ConfigurationUtils.java实现
 * 
 * 该类提供了以下功能：
 * 1. 更新杂项配置文件 (miscellaneous.xml)
 * 2. 更新prop.xml文件中的address标签
 */
export class ConfigurationUtils {
    private configService: NCHomeConfigService;

    /**
     * 构造函数
     * @param configService NC Home配置服务实例
     */
    constructor(configService: NCHomeConfigService) {
        this.configService = configService;
    }

    /**
     * 更新杂项配置文件
     * 参考IDEA插件中updateMiscellaneousConfiguration方法的实现
     */
    public async updateMiscellaneousConfiguration(): Promise<void> {
        try {
            const config = this.configService.getConfig();
            let homePath = config.homePath;
            
            if (!homePath) {
                console.log('Home路径未配置');
                return;
            }
    
            
            // 根据操作系统调整路径分隔符
            if (process.platform === 'win32') {
                homePath = path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF', 'config', 'miscellaneous.xml');
            } else {
                homePath = path.join(homePath, 'hotwebs', 'nccloud', 'WEB-INF', 'config', 'miscellaneous.xml');
            }
            
            // 检查文件是否存在
            if (!fs.existsSync(homePath)) {
                console.log(`配置文件不存在: ${homePath}`);
                return;
            }
            
            // 读取XML文件
            const xmlContent = fs.readFileSync(homePath, 'utf-8');
            
            // 解析XML
            const parser = new xml2js.Parser({ explicitArray: false });
            const result = await parser.parseStringPromise(xmlContent);
            
            // 修改指定标签的值
            const tagsToUpdate = ['gzip', 'mark', 'aesKey', 'localStorage'];
            for (const tag of tagsToUpdate) {
                if (result.root && result.root[tag]) {
                    result.root[tag] = 'false';
                }
            }
            
            // 构建更新后的XML
            const builder = new xml2js.Builder({
                headless: true,
                renderOpts: {
                    pretty: false
                }
            });
            const updatedXml = builder.buildObject(result);
            
            // 写入文件
            fs.writeFileSync(homePath, updatedXml, 'utf-8');
            console.log('杂项配置文件更新成功');
        } catch (error) {
            console.error('更新杂项配置文件失败:', error);
        }
    }

    /**
     * 更新prop.xml文件中的address标签
     * 参考IDEA插件中updatePropXmlAddress方法的实现
     * 支持更新所有address标签，包括cluster、mgr、peer等结构中的address
     */
    public async updatePropXmlAddress(): Promise<void> {
        try {
            const config = this.configService.getConfig();
            let homePath = config.homePath;
            
            if (!homePath) {
                console.log('Home路径未配置');
                return;
            }
            
        
            // 构建prop.xml文件路径
            homePath = path.join(homePath, 'ierp', 'bin', 'prop.xml');
            
            // 检查文件是否存在
            if (!fs.existsSync(homePath)) {
                console.log(`prop.xml文件不存在: ${homePath}`);
                return;
            }
            
            // 读取XML文件
            const xmlContent = fs.readFileSync(homePath, 'utf-8');
            
            // 解析XML
            const parser = new xml2js.Parser({ explicitArray: true, ignoreAttrs: false });
            const result = await parser.parseStringPromise(xmlContent);
            
            // 更新所有http标签下的address节点
            this.updateAddressInObject(result.root);
            
            // 构建更新后的XML
            const builder = new xml2js.Builder({
                xmldec: { version: '1.0', encoding: 'UTF-8' },
                renderOpts: {
                    pretty: true,
                    indent: '  '
                },
                rootName: 'root'
            });
            const updatedXml = builder.buildObject(result);
            
            // 写入文件
            fs.writeFileSync(homePath, updatedXml, 'utf-8');
            console.log('prop.xml文件中的address标签更新成功');
        } catch (error) {
            console.error('更新prop.xml文件中的address标签失败:', error);
        }
    }

    /**
     * 递归更新对象中的所有address标签
     * @param obj 要更新的对象
     */
    private updateAddressInObject(obj: any): void {
        if (!obj) return;

        // 如果是数组，递归处理每个元素
        if (Array.isArray(obj)) {
            for (const item of obj) {
                this.updateAddressInObject(item);
            }
            return;
        }

        // 如果是对象，检查是否有http属性
        if (typeof obj === 'object') {
            // 检查是否有http属性
            if (obj.http) {
                // http可能是一个数组或单个对象
                const httpItems = Array.isArray(obj.http) ? obj.http : [obj.http];
                
                for (const http of httpItems) {
                    // 检查是否有address属性
                    if (http.address && http.address !== '127.0.0.1') {
                        // address可能是一个数组或单个值
                        if (Array.isArray(http.address)) {
                            http.address[0] = '127.0.0.1';
                        } else {
                            http.address = '127.0.0.1';
                        }
                        console.log(`已更新address标签: ${http.address}`);
                    }
                }
            }

            // 递归处理对象的所有属性
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    this.updateAddressInObject(obj[key]);
                }
            }
        }
    }

    /**
     * 授权home路径下的所有目录具有读写权限 (仅限Mac和Linux系统)
     * @param homePath home路径
     */
    public async authorizeHomeDirectoryPermissions(): Promise<void> {
        const config = this.configService.getConfig();
        let homePath = config.homePath;
        // 仅在Mac和Linux系统上执行
        if (process.platform !== 'darwin' && process.platform !== 'linux') {
            console.log('当前系统不是Mac或Linux，跳过权限授权');
            return;
        }

        try {
            // 检查路径是否存在
            if (!fs.existsSync(homePath)) {
                console.log(`指定的路径不存在: ${homePath}`);
                return;
            }

            // 使用chmod命令递归授权读写权限
            const { execSync } = require('child_process');
            execSync(`chmod -R 755 "${homePath}"`, { stdio: 'pipe' });
            console.log(`已成功授权路径 ${homePath} 下所有目录的读写权限`);
        } catch (error) {
            console.error('授权目录权限时发生错误:', error);
        }
    }
}