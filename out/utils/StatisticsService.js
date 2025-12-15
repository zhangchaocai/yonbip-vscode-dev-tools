"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatisticsService = void 0;
const axios_1 = __importDefault(require("axios"));
class StatisticsService {
    static BASE_URL = 'https://bipfast.by.takin.cc';
    static MCP_START_COUNT = 'MCP服务启动次数';
    static HOME_START_COUNT = 'HOME服务启动次数';
    static HOME_CONFIG_COUNT = 'HOME配置次数';
    static OPENAPI_TEST_COUNT = 'Openapi测试次数';
    static PATCH_EXPORT_COUNT = '补丁导出次数';
    static SCRIPT_EXPORT_COUNT = '预置脚本导出次数';
    static async incrementCount(operationType) {
        this.incrementCountAsync(operationType).catch(error => {
            console.error(`统计计数增加失败: ${error.message}`);
        });
    }
    static async incrementCountAsync(operationType) {
        try {
            let url = '';
            switch (operationType) {
                case this.MCP_START_COUNT:
                    url = `${this.BASE_URL}/vscode/stats/mcp/start`;
                    break;
                case this.HOME_CONFIG_COUNT:
                    url = `${this.BASE_URL}/vscode/stats/home/config`;
                    break;
                case this.OPENAPI_TEST_COUNT:
                    url = `${this.BASE_URL}/vscode/stats/openapi/test`;
                    break;
                case this.PATCH_EXPORT_COUNT:
                    url = `${this.BASE_URL}/vscode/stats/patch/export`;
                    break;
                case this.SCRIPT_EXPORT_COUNT:
                    url = `${this.BASE_URL}/vscode/stats/script/export`;
                    break;
                case this.HOME_START_COUNT:
                    url = `${this.BASE_URL}/vscode/stats/home/start`;
                    break;
                default:
                    console.warn(`未知的操作类型: ${operationType}`);
                    return;
            }
            await axios_1.default.post(url, {}, {
                timeout: 5000
            });
            console.log(`统计计数增加成功: ${operationType}`);
        }
        catch (error) {
            console.error(`统计计数增加失败: ${error.message}`);
        }
    }
    static async incrementCounts(operationTypes) {
        const promises = operationTypes.map(type => this.incrementCountAsync(type));
        await Promise.allSettled(promises);
    }
}
exports.StatisticsService = StatisticsService;
//# sourceMappingURL=StatisticsService.js.map