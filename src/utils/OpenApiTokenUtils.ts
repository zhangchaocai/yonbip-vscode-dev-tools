import axios from 'axios';
import * as qs from 'querystring';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import * as path from 'path';
import { OpenApiConfig } from '../openapi/OpenApiService';

/**
 * OpenAPI Token工具类
 * 用于根据用户配置获取访问token
 */
export class OpenApiTokenUtils {
    
    /**
     * 获取token方法
     * 通过调用外部JAR包实现token获取
     * 
     * @param config OpenAPI配置信息
     * @returns Promise<any> 返回获取到的token信息
     */
    public static async getToken(config: OpenApiConfig): Promise<any> {
        // 使用相对路径引用JAR文件
        const jarPath = path.join(__dirname, '../../resources/aes-crypto-tool/encryption-tool-1.0-SNAPSHOT.jar');
        
        // 构建命令参数
        const args = [
            '-jar',
            jarPath,
            `http://${config.ip}:${config.port}/`,
            config.accountCode,
            config.appId,
            config.appSecret,
            config.publicKey || '',
            'token',
            config.homeVersion == "2105及之后版本" ? "2105after" : "2105before"
        ];
        
        // 如果提供了用户密码，则添加到参数中
        if (config.userPassword) {
            args.splice(6, 0, config.userPassword);
        }
        
        return new Promise((resolve, reject) => {
            // 使用spawn执行JAR文件
            const child = spawn('java', args);
            
            let output = '';
            let errorOutput = '';
            
            child.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        // 尝试解析输出为JSON
                        const result = JSON.parse(output);
                        resolve(result);
                    } catch (parseError) {
                        // 如果不是JSON格式，直接返回原始输出
                        resolve({ output });
                    }
                } else {
                    reject(new Error(`JAR工具执行失败: ${errorOutput}`));
                }
            });
        });
    }
}