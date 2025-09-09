import * as vscode from 'vscode';
import axios from 'axios';

/**
 * OpenAPI配置接口
 */
export interface OpenApiConfig {
    baseUrl: string;
    accessKey: string;
    secretKey: string;
    timeout: number;
    headers: Record<string, string>;
}

/**
 * HTTP请求方法
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * API请求参数
 */
export interface ApiRequest {
    method: HttpMethod;
    url: string;
    headers?: Record<string, string>;
    params?: Record<string, any>;
    body?: any;
}

/**
 * API响应结果
 */
export interface ApiResponse {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: any;
    duration: number;
}

/**
 * OpenAPI服务类
 */
export class OpenApiService {
    private config: OpenApiConfig;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = this.loadConfig();
    }

    /**
     * 加载配置
     */
    private loadConfig(): OpenApiConfig {
        const config = this.context.globalState.get<OpenApiConfig>('openapi.config');
        return config || {
            baseUrl: '',
            accessKey: '',
            secretKey: '',
            timeout: 30000,
            headers: {}
        };
    }

    /**
     * 保存配置
     */
    public async saveConfig(config: OpenApiConfig): Promise<void> {
        this.config = config;
        await this.context.globalState.update('openapi.config', config);
    }

    /**
     * 获取配置
     */
    public getConfig(): OpenApiConfig {
        return { ...this.config };
    }

    /**
     * 发送API请求
     */
    public async sendRequest(request: ApiRequest): Promise<ApiResponse> {
        const startTime = Date.now();
        
        try {
            // 构建完整URL
            const fullUrl = this.buildUrl(request.url);
            
            // 构建请求配置
            const axiosConfig: any = {
                method: request.method,
                url: fullUrl,
                timeout: this.config.timeout,
                headers: {
                    ...this.config.headers,
                    ...request.headers
                }
            };

            // 添加请求参数
            if (request.params) {
                axiosConfig.params = request.params;
            }

            // 添加请求体
            if (request.body) {
                axiosConfig.data = request.body;
                if (!axiosConfig.headers['Content-Type']) {
                    axiosConfig.headers['Content-Type'] = 'application/json';
                }
            }

            // 添加认证头
            if (this.config.accessKey && this.config.secretKey) {
                axiosConfig.headers['Authorization'] = this.generateAuthHeader(request);
            }

            // 发送请求
            const response: any = await axios(axiosConfig);
            
            const duration = Date.now() - startTime;
            
            return {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data,
                duration
            };

        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            if (error.response) {
                // 服务器响应错误
                return {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    headers: error.response.headers,
                    data: error.response.data,
                    duration
                };
            } else {
                // 网络错误或其他错误
                throw new Error(`请求失败: ${error.message}`);
            }
        }
    }

    /**
     * 构建完整URL
     */
    private buildUrl(path: string): string {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        
        const baseUrl = this.config.baseUrl.endsWith('/') 
            ? this.config.baseUrl.slice(0, -1) 
            : this.config.baseUrl;
        const url = path.startsWith('/') ? path : `/${path}`;
        
        return `${baseUrl}${url}`;
    }

    /**
     * 生成认证头
     */
    private generateAuthHeader(request: ApiRequest): string {
        // 这里可以实现具体的认证逻辑，比如签名算法
        // 目前使用简单的Basic Auth格式
        const credentials = `${this.config.accessKey}:${this.config.secretKey}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    /**
     * 测试连接
     */
    public async testConnection(): Promise<boolean> {
        try {
            const response = await this.sendRequest({
                method: 'GET',
                url: '/api/health'
            });
            return response.status >= 200 && response.status < 300;
        } catch (error) {
            return false;
        }
    }

    /**
     * 格式化JSON响应
     */
    public formatJsonResponse(data: any): string {
        try {
            return JSON.stringify(data, null, 2);
        } catch (error) {
            return String(data);
        }
    }
}