import * as vscode from 'vscode';
import axios from 'axios';

/**
 * OpenAPI配置接口
 */
export type HomeVersionOption = '2105及之后版本' | '2105之前版本';
export interface OpenApiConfig {
    id: string;
    name: string; // 名称
    homeVersion: HomeVersionOption; // Home版本
    ip: string; // IP
    port: number; // 端口
    accountCode: string; // 帐套编码
    appId: string; // APP ID
    appSecret: string; // APP Secret
    userCode: string; // 用户编码
    publicKey?: string; // 公钥（可选）
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
    private configs: OpenApiConfig[];
    private currentConfigId: string;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        const data = this.loadConfigs();
        this.configs = data.configs;
        this.currentConfigId = data.currentConfigId;
    }

    /**
     * 加载所有配置
     */
    private loadConfigs(): { configs: OpenApiConfig[], currentConfigId: string } {
        const configs = this.context.globalState.get<OpenApiConfig[]>('openapi.configs');
        const currentConfigId = this.context.globalState.get<string>('openapi.currentConfigId');
        
        return {
            configs: configs || [],
            currentConfigId: currentConfigId || ''
        };
    }

    /**
     * 保存所有配置
     */
    public async saveConfigs(configs: OpenApiConfig[], currentConfigId: string): Promise<void> {
        this.configs = configs;
        this.currentConfigId = currentConfigId;
        await this.context.globalState.update('openapi.configs', configs);
        await this.context.globalState.update('openapi.currentConfigId', currentConfigId);
    }

    /**
     * 获取所有配置
     */
    public getConfigs(): OpenApiConfig[] {
        return [...this.configs];
    }

    /**
     * 获取当前配置
     */
    public getCurrentConfig(): OpenApiConfig | undefined {
        return this.configs.find(config => config.id === this.currentConfigId);
    }

    /**
     * 设置当前配置
     */
    public async setCurrentConfig(configId: string): Promise<void> {
        this.currentConfigId = configId;
        await this.context.globalState.update('openapi.currentConfigId', configId);
    }

    /**
     * 添加新配置
     */
    public async addConfig(config: OpenApiConfig): Promise<void> {
        this.configs.push(config);
        await this.saveConfigs(this.configs, this.currentConfigId);
    }

    /**
     * 更新配置
     */
    public async updateConfig(config: OpenApiConfig): Promise<void> {
        const index = this.configs.findIndex(c => c.id === config.id);
        if (index !== -1) {
            this.configs[index] = config;
            await this.saveConfigs(this.configs, this.currentConfigId);
        }
    }

    /**
     * 删除配置
     */
    public async deleteConfig(configId: string): Promise<void> {
        this.configs = this.configs.filter(config => config.id !== configId);
        // 如果删除的是当前配置，设置第一个配置为当前配置
        if (this.currentConfigId === configId && this.configs.length > 0) {
            this.currentConfigId = this.configs[0].id;
        } else if (this.configs.length === 0) {
            this.currentConfigId = '';
        }
        await this.saveConfigs(this.configs, this.currentConfigId);
    }

    /**
     * 发送API请求
     */
    public async sendRequest(request: ApiRequest, configId?: string): Promise<ApiResponse> {
        const config = configId 
            ? this.configs.find(c => c.id === configId) 
            : this.getCurrentConfig();
            
        if (!config) {
            throw new Error('未找到有效的OpenAPI配置');
        }
        
        const startTime = Date.now();
        
        try {
            // 构建完整URL
            const fullUrl = this.buildUrl(request.url, config);
            
            // 构建请求配置
            const axiosConfig: any = {
                method: request.method,
                url: fullUrl,
                timeout: 30000,
                headers: {
                    ...(request.headers || {})
                }
            };

            // 附加来自配置的业务头
            if (config.userCode) {
                axiosConfig.headers['X-User-Code'] = config.userCode;
            }
            if (config.accountCode) {
                axiosConfig.headers['X-Account-Code'] = config.accountCode;
            }

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

            // 添加认证头（使用 APP ID/APP Secret）
            if (config.appId && config.appSecret) {
                axiosConfig.headers['Authorization'] = this.generateAuthHeader(request, config);
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
    private buildUrl(path: string, config: OpenApiConfig): string {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        
        const baseUrl = `http://${config.ip}:${config.port}`;
        const url = path.startsWith('/') ? path : `/${path}`;
        
        return `${baseUrl}${url}`;
    }

    /**
     * 生成认证头（APP ID/APP Secret）
     */
    private generateAuthHeader(request: ApiRequest, config: OpenApiConfig): string {
        const credentials = `${config.appId}:${config.appSecret}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    /**
     * 测试连接
     */
    public async testConnection(configId?: string): Promise<{ success: boolean; message: string }> {
        try {
            const config = configId 
                ? this.configs.find(c => c.id === configId) 
                : this.getCurrentConfig();
                
            if (!config) {
                return { success: false, message: '未找到有效的OpenAPI配置' };
            }
            
            const response = await this.sendRequest({
                method: 'GET',
                url: '/api/health'
            }, configId);
            
            return { 
                success: response.status >= 200 && response.status < 300,
                message: response.status >= 200 && response.status < 300 
                    ? '连接成功' 
                    : `连接失败: ${response.status} ${response.statusText}`
            };
        } catch (error: any) {
            return { success: false, message: `连接失败: ${error.message}` };
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