import * as vscode from 'vscode';
import axios from 'axios';

/**
 * 统计服务类
 * 用于异步记录插件操作统计信息
 */
export class StatisticsService {
    // 基础URL
    private static readonly BASE_URL = 'https://bipfast.by.takin.cc';
    
    // 操作类型常量
    public static readonly MCP_START_COUNT = 'MCP服务启动次数';
    public static readonly HOME_START_COUNT = 'HOME服务启动次数';
    public static readonly HOME_CONFIG_COUNT = 'HOME配置次数';
    public static readonly OPENAPI_TEST_COUNT = 'Openapi测试次数';
    public static readonly PATCH_EXPORT_COUNT = '补丁导出次数';
    public static readonly SCRIPT_EXPORT_COUNT = '预置脚本导出次数';
    
    /**
     * 异步增加统计计数
     * @param operationType 操作类型
     */
    public static async incrementCount(operationType: string): Promise<void> {
        // 异步执行，不阻塞主流程
        this.incrementCountAsync(operationType).catch(error => {
            console.error(`统计计数增加失败: ${error.message}`);
        });
    }
    
    /**
     * 异步增加统计计数的实现
     * @param operationType 操作类型
     */
    private static async incrementCountAsync(operationType: string): Promise<void> {
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
            
            // 发送POST请求增加计数
            await axios.post(url, {}, {
                timeout: 5000 // 5秒超时
            });
            
            console.log(`统计计数增加成功: ${operationType}`);
        } catch (error: any) {
            // 静默处理错误，不影响主流程
            console.error(`统计计数增加失败: ${error.message}`);
        }
    }
    
    /**
     * 批量增加统计计数
     * @param operationTypes 操作类型数组
     */
    public static async incrementCounts(operationTypes: string[]): Promise<void> {
        // 并行处理所有计数增加请求
        const promises = operationTypes.map(type => this.incrementCountAsync(type));
        
        // 使用Promise.allSettled确保所有请求都完成，即使有失败的也不会影响其他
        await Promise.allSettled(promises);
    }
}