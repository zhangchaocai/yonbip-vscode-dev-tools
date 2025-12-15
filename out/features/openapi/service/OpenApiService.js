"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenApiService = void 0;
const axios_1 = __importDefault(require("axios"));
class OpenApiService {
    config;
    context;
    constructor(context) {
        this.context = context;
        this.config = this.loadConfig();
    }
    loadConfig() {
        const config = this.context.globalState.get('openapi.config');
        return config || {
            baseUrl: '',
            accessKey: '',
            secretKey: '',
            timeout: 30000,
            headers: {}
        };
    }
    async saveConfig(config) {
        this.config = config;
        await this.context.globalState.update('openapi.config', config);
    }
    getConfig() {
        return { ...this.config };
    }
    async sendRequest(request) {
        const startTime = Date.now();
        try {
            const fullUrl = this.buildUrl(request.url);
            const axiosConfig = {
                method: request.method,
                url: fullUrl,
                timeout: this.config.timeout,
                headers: {
                    ...this.config.headers,
                    ...request.headers
                }
            };
            if (request.params) {
                axiosConfig.params = request.params;
            }
            if (request.body) {
                axiosConfig.data = request.body;
                if (!axiosConfig.headers['Content-Type']) {
                    axiosConfig.headers['Content-Type'] = 'application/json';
                }
            }
            if (this.config.accessKey && this.config.secretKey) {
                axiosConfig.headers['Authorization'] = this.generateAuthHeader(request);
            }
            const response = await (0, axios_1.default)(axiosConfig);
            const duration = Date.now() - startTime;
            return {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data,
                duration
            };
        }
        catch (error) {
            const duration = Date.now() - startTime;
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
    buildUrl(path) {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        const baseUrl = this.config.baseUrl.endsWith('/')
            ? this.config.baseUrl.slice(0, -1)
            : this.config.baseUrl;
        const url = path.startsWith('/') ? path : `/${path}`;
        return `${baseUrl}${url}`;
    }
    generateAuthHeader(request) {
        const credentials = `${this.config.accessKey}:${this.config.secretKey}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    async testConnection() {
        try {
            const response = await this.sendRequest({
                method: 'GET',
                url: '/api/health'
            });
            return response.status >= 200 && response.status < 300;
        }
        catch (error) {
            return false;
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