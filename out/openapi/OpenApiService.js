"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenApiService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const OpenApiTokenUtils_1 = require("../utils/OpenApiTokenUtils");
const StatisticsService_1 = require("../utils/StatisticsService");
class OpenApiService {
    configs;
    currentConfigId;
    context;
    constructor(context) {
        this.context = context;
        const data = this.loadConfigs();
        this.configs = data.configs;
        this.currentConfigId = data.currentConfigId;
    }
    loadConfigs() {
        const configs = this.context.globalState.get('openapi.configs');
        const currentConfigId = this.context.globalState.get('openapi.currentConfigId');
        return {
            configs: configs || [],
            currentConfigId: currentConfigId || ''
        };
    }
    async saveConfigs(configs, currentConfigId) {
        this.configs = configs;
        this.currentConfigId = currentConfigId;
        await this.context.globalState.update('openapi.configs', configs);
        await this.context.globalState.update('openapi.currentConfigId', currentConfigId);
    }
    getConfigs() {
        return [...this.configs];
    }
    getCurrentConfig() {
        return this.configs.find(config => config.id === this.currentConfigId);
    }
    async setCurrentConfig(configId) {
        this.currentConfigId = configId;
        await this.context.globalState.update('openapi.currentConfigId', configId);
    }
    async addConfig(config) {
        this.configs.push(config);
        await this.saveConfigs(this.configs, this.currentConfigId);
    }
    async updateConfig(config) {
        const index = this.configs.findIndex(c => c.id === config.id);
        if (index !== -1) {
            this.configs[index] = config;
            await this.saveConfigs(this.configs, this.currentConfigId);
        }
    }
    async deleteConfig(configId) {
        this.configs = this.configs.filter(config => config.id !== configId);
        if (this.currentConfigId === configId && this.configs.length > 0) {
            this.currentConfigId = this.configs[0].id;
        }
        else if (this.configs.length === 0) {
            this.currentConfigId = '';
        }
        await this.saveConfigs(this.configs, this.currentConfigId);
    }
    async sendRequest(request, configId) {
        const config = configId
            ? this.configs.find(c => c.id === configId)
            : this.getCurrentConfig();
        if (!config) {
            throw new Error('未找到有效的OpenAPI配置');
        }
        const startTime = Date.now();
        try {
            let tokenResult = null;
            let securityKey = null;
            try {
                console.log('开始获取token', { configId: config.id, configName: config.name });
                const tokenResponse = await OpenApiTokenUtils_1.OpenApiTokenUtils.getToken(config);
                console.log('获取token响应:', tokenResponse);
                if (tokenResponse && tokenResponse.data && tokenResponse.data.access_token) {
                    tokenResult = tokenResponse.data;
                    securityKey = tokenResponse.data.security_key || null;
                    console.log('成功获取access_token和security_key');
                }
                else {
                    console.warn('未获取到access_token，使用原有认证方式');
                }
            }
            catch (tokenError) {
                console.error('获取token失败:', tokenError);
            }
            const fullUrl = this.buildUrl(request.url, config);
            const axiosConfig = {
                method: request.method,
                url: fullUrl,
                timeout: 30000,
                headers: {
                    ...(request.headers || {})
                }
            };
            if (request.params) {
                axiosConfig.params = request.params;
            }
            let requestBody = request.body;
            if (request.body) {
                if (securityKey) {
                    requestBody = this.dealRequestBody(JSON.stringify(request.body), securityKey, 'L0');
                }
                else {
                    requestBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
                }
                axiosConfig.data = requestBody;
                if (!axiosConfig.headers['Content-Type']) {
                    axiosConfig.headers['Content-Type'] = 'application/json;charset=utf-8';
                }
            }
            if (tokenResult && tokenResult.access_token) {
                axiosConfig.headers['access_token'] = tokenResult.access_token;
                axiosConfig.headers['client_id'] = config.appId;
                const signContent = `${config.appId}${requestBody || ''}${config.publicKey || ''}`;
                const signature = this.generateSignature(signContent, config.publicKey || '');
                axiosConfig.headers['signature'] = signature;
                axiosConfig.headers['repeat_check'] = 'Y';
                axiosConfig.headers['ucg_flag'] = 'y';
                console.log('使用新的认证方式');
            }
            else if (config.appId && config.appSecret) {
                axiosConfig.headers['Authorization'] = this.generateAuthHeader(request, config);
                console.log('回退到Basic认证');
            }
            if (config.userCode) {
                axiosConfig.headers['X-User-Code'] = config.userCode;
            }
            if (config.accountCode) {
                axiosConfig.headers['X-Account-Code'] = config.accountCode;
            }
            console.log('发送请求:', {
                method: axiosConfig.method,
                url: axiosConfig.url,
                headers: axiosConfig.headers
            });
            const response = await (0, axios_1.default)(axiosConfig);
            let responseData = response.data;
            if (securityKey && response.data) {
                const responseStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                responseData = this.dealResponseBody(responseStr, securityKey, 'L0');
                try {
                    responseData = JSON.parse(responseData);
                }
                catch (e) {
                }
            }
            const duration = Date.now() - startTime;
            console.log('请求成功:', {
                status: response.status,
                statusText: response.statusText,
                duration: duration
            });
            StatisticsService_1.StatisticsService.incrementCount(StatisticsService_1.StatisticsService.OPENAPI_TEST_COUNT);
            return {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: responseData,
                duration
            };
        }
        catch (error) {
            const duration = Date.now() - startTime;
            console.error('请求失败:', {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status
            });
            if (error.response) {
                return {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    headers: error.response.headers,
                    data: error.response.data,
                    duration
                };
            }
            else {
                throw new Error(`请求失败: ${error.message}`);
            }
        }
    }
    buildUrl(path, config) {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        const baseUrl = `http://${config.ip}:${config.port}`;
        const url = path.startsWith('/') ? path : `/${path}`;
        return `${baseUrl}${url}`;
    }
    generateAuthHeader(request, config) {
        const credentials = `${config.appId}:${config.appSecret}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    dealRequestBody(source, securityKey, level) {
        if (level === 'L0') {
            return source;
        }
        return source;
    }
    dealResponseBody(source, securityKey, level) {
        if (level === 'L0') {
            return source;
        }
        return source;
    }
    generateSignature(content, publicKey) {
        const hash = (0, crypto_1.createHash)('sha256');
        hash.update(content);
        return hash.digest('hex');
    }
    async testConnection(configId) {
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
        }
        catch (error) {
            return { success: false, message: `连接失败: ${error.message}` };
        }
    }
    formatJsonResponse(data) {
        try {
            return JSON.stringify(data, null, 2);
        }
        catch (error) {
            return String(data);
        }
    }
}
exports.OpenApiService = OpenApiService;
//# sourceMappingURL=OpenApiService.js.map