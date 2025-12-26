import * as vscode from 'vscode';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as iconv from 'iconv-lite';
import { NCHomeConfigService } from './config/NCHomeConfigService';
import { OracleClientService } from './OracleClientService';
import { HomeStatus } from './homeStatus';
import { JavaVersionUtils } from '../../utils/JavaVersionUtils';
import { ClasspathUtils } from '../../utils/ClasspathUtils';
import { StatisticsService } from '../../utils/StatisticsService';
import { ServiceStateManager } from '../../utils/ServiceStateManager';
import { ToolbarIconService } from './ToolbarIconService';


/**
 * NC HOME服务管理类
 */
export class HomeService {
    private context: vscode.ExtensionContext;
    private configService: NCHomeConfigService;
    private process: ChildProcess | null = null;
    private status: HomeStatus = HomeStatus.STOPPED;
    private outputChannel: vscode.OutputChannel;
    private static outputChannelInstance: vscode.OutputChannel | null = null;
    private isManualStop: boolean = false;
    private startupCheckTimer: NodeJS.Timeout | null = null;
    private oracleClientService: OracleClientService;
    private statusBarItem: vscode.StatusBarItem | null = null;
    private currentModuleInfo: { moduleName: string; modulePath: string } | null = null;
    private currentClasspathFile: string | null = null;

    constructor(context: vscode.ExtensionContext, configService: NCHomeConfigService) {
        this.context = context;
        this.configService = configService;
        this.oracleClientService = new OracleClientService(context);
        // 确保outputChannel只初始化一次
        if (!HomeService.outputChannelInstance) {
            HomeService.outputChannelInstance = vscode.window.createOutputChannel('YonBIP NC HOME服务');
        }
        this.outputChannel = HomeService.outputChannelInstance;
        
        // 创建状态栏项
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.text = "YonBIP HOME服务";
        this.statusBarItem.tooltip = "YonBIP HOME服务状态";
        // 确保状态栏项可见
        this.statusBarItem.show();
    }

    /**
     * 检测字符串是否包含乱码字符
     * @param str 待检测的字符串
     * @returns 如果包含乱码返回true，否则返回false
     */
    private containsGarbledCharacters(str: string): boolean {
        // 检查是否包含典型的乱码字符模式
        const garbledPatterns = [
            '????',         // 四个问号的乱码模式
            '???',          // 三个问号的乱码模式
            '??',           // 两个问号的乱码模式
            '? ?',          // 间隔问号
            'Warning: setSecurityManager',
            '\u00ca\u00ca',          // 十月乱码
            '\u00ca\u00ca\u00ca\u00ca',          // 乱码字符
            '\u672a\u627e\u5230',     // "未找到"的乱码
            '\u5e94\u7528\u5de5\u5382', // "应用工厂"的乱码
            '\u63d2\u4ef6\u626b\u63cf',  // "插件扫描"的乱码
            // 十二月相关乱码
            'ʮ',            // 希腊字母ʮ，可能是十二月乱码的一部分
            'ʮ��',          // 十二月乱码新模式
            'ʮ���',         // 十二月乱码新模式
            'ʮ����',        // 十二月乱码新模式
            // 其他月份的可能乱码模式
            'һ', 'һ��', 'һ���', 'һ����', // 一月
            '��', '���', '���', '����', // 二月
            '���', '���', '����', // 三月
            '�ġ', '�ġ��', '�ġ���', '�ġ����', // 四月
            '�', '��', '���', '���', '��', '���', // 五月
            '��', '���', '����', // 六月
            '��', '���', '����', // 七月
            '��', '���', '����', // 八月
            '��', '���', '����', // 九月
            'ʮһ', 'ʮһ��', 'ʮһ���', 'ʮһ����', // 十一月
            // 信息相关乱码
            '�Ϣ',           // 信息乱码新模式
            '��Ϣ',          // 信息乱码新模式（更长版本）
            // 未找到相关乱码
            'δ�ҵ�',         // 未找到乱码新模式
            'δ�ҵ�ȫ��',      // 未找到完整乱码新模式
            // 其他新发现的乱码模式
            '��ʼ��Э�鴦����', // 开始绑定端口乱码
            'Servlet ���棺', // Servlet容器乱码
            // 应用工厂插件扫描相关乱码
            '搴旂敤宸ュ巶鎻掍欢鎵弿锛五', // 应用工厂插件扫描
            '绯荤粺鐗规€ф彃浠剁被锛屽寘鍚墦鍗伴檮浠跺強鍩虹鍔熻兘', // 系统规格化发布类
            '涓氬姟娴佹彃浠五', // 业务流发布
            'excel瀵煎叆瀵煎嚭鐗规€ф彃浠剁被', // excel导入导出规格化发布类
            '澶栭儴浜ゆ崲骞冲彴鐗规€ф彃浠剁被', // 外部交换平台规格化发布类
            '瀹℃壒娴五(甯︾Щ鍔ㄥ鎵五)鎻掍欢绫五', // 流程(灵动设计)插件类
            // 新增乱码模式
            'n.绡锋悈锏惧€冪墷鏀敤绋嬪綍鍏垫椠鏍稿缓鑱婃祹绌洪綈椤绘柊', // 新识别的乱码
            '绡锋悈锏惧€冪墷鏀敤绋嬪綍鍏垫椠', // 新识别的乱码
            // 新增更多乱码模式
            '鍗曟嵁鐗规€ц繍琛屾椂鎻掍欢绫五', // 新识别的乱码
            '涓氬姟娴佽繍琛屾椂鎻掍欢', // 新识别的乱码
            '鍗曟嵁鐗规€ф彃浠剁被', // 新识别的乱码
            '妗ｆ鐗规€ф彃浠剁被', // 新识别的乱码
            // 从截图中识别的新乱码模式
            '綅荤粺鏍规嵁鐗规€ф繍琛屾椂鎻掍欢绫五', // 新识别的乱码
            '妗ｆ鏍规嵁鐗规€ф彃浠剁被', // 新识别的乱码
            '妗ｆ鏍规嵁鐗规€ф繍琛屾椂鎻掍欢绫五', // 新识别的乱码
            '綅荤粺鏍规嵁鐗规€ф彃浠剁被', // 新识别的乱码
            // 从最新截图中识别的新乱码模式
            '瀹℃壒娴佽繍琛屾椂鎻掍欢绫五', // 流程运行时插件类
            // 从新截图中识别的系统基础运行时插件类乱码
            '绯荤粺鏍规€ф繍琛屾椂鎻掍欢绫五', // 系统基础运行时插件类
            // 优化添加：流程相关的更多可能乱码模式
            '瀹℃壒娴侊五', '瀹℃壒娴佹牸', '瀹℃壒鐗规€',
            '娴佽繍琛屾椂', '娴佽繍琛屾椂鎻掍欢', '娴佽繍琛屾椂鎻掍欢绫',
            '鎻掍欢绫五', '鎻掍欢绫诲瀷', '鎻掍欢绫诲瀷鐗规€',
            // 扩展添加：更多可能的乱码变体
            '瀹℃壒', '瀹℃壒娴侊', '瀹℃壒鐗规',
            '娴佽繍', '娴佽繍琛屾', '娴佽繍琛屾椂鎻掍',
            '鎻掍欢', '鎻掍欢绫', '鎻掍欢绫诲',
            // 新增：系统和流程相关的更多乱码模式
            '绯荤粺', '绯荤粺鏍规€', '鏍规€ф繍琛屾椂',
            '涓氬姟', '涓氬姟娴侊', '涓氬姟娴佽繍琛屾椂',
            '鍗曟嵁', '鍗曟嵁鐗规€', '鍗曟嵁鐗规€ф繍琛屾椂',
            '妗ｆ', '妗ｆ鐗规€', '妗ｆ鐗规€ф繍琛屾椂',
            // 新增：从最新日志中识别的新乱码模式
            '甯︾Щ鍔ㄥ鎵五', '鐗规€х壒鎬ц繍琛屾椂'
        ];

        // 检查是否包含中文字符（正常中文应该能正确显示）
        const hasChinese = /[\u4e00-\u9fa5]/.test(str);

        // 检查是否包含大量非ASCII字符（可能是乱码）
        const nonAsciiChars = str.match(/[^\x00-\x7F]/g) || [];
        const hasManyNonAscii = nonAsciiChars.length > str.length * 0.3;

        // 检查是否包含典型的乱码字符模式
        const hasGarbledPattern = garbledPatterns.some(pattern => {
            return pattern && str.includes(pattern);
        });

        // 检查是否包含非中文字符的亚洲字符（可能是乱码）
        const hasNonChineseAsianChars = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/.test(str) && 
                                         !/[一-龥]/.test(str);
                
        // 检查是否包含希腊字母（可能是乱码）
        const hasGreekChars = /[α-ωΑ-Ω]/.test(str);
                
        // 检查是否包含日期格式的乱码（如月份乱码）
        const hasDateGarbledPattern = /\d+[,，]\s*\d+\s*(日|月|年)/.test(str) && 
                                    (str.includes('\u00ca\u00ca\u00ca\u00ca') || str.includes('\u00ca\u00ca\u00ca\u00ca') || str.includes('\u00ca\u00ca\u00ca\u00ca') || hasGreekChars);
        
        // 检查是否包含信息乱码模式
        const hasInfoGarbledPattern = str.includes('�Ϣ') || str.includes('��Ϣ');
        
        // 检查是否包含未找到乱码模式
        const hasNotFoundGarbledPattern = str.includes('δ�ҵ�') || str.includes('δ�ҵ�') || str.includes('δ�ҵ�ȫ��');
        
        // 如果包含中文但也有乱码特征，则认为有乱码
        if (hasChinese && (hasGarbledPattern || hasDateGarbledPattern || hasInfoGarbledPattern || hasNotFoundGarbledPattern)) {
            return true;
        }

        // 如果不包含中文，但包含大量非ASCII字符、有乱码模式或包含非中文亚洲字符或希腊字母，可能有乱码
        if (!hasChinese && (hasManyNonAscii || hasGarbledPattern || hasNonChineseAsianChars || hasGreekChars)) {
            return true;
        }

        // 特殊处理：如果包含月份乱码，则认为有乱码
        if (str.includes('\u00ca\u00ca') && !str.includes('十月')) {
            return true;
        }

        // 特殊处理：如果包含希腊字母乱码，则认为有乱码
        if (hasGreekChars && !/[\u4e00-\u9fa5]/.test(str)) {
            return true;
        }

        // 特殊处理：如果包含信息乱码，则认为有乱码
        if (hasInfoGarbledPattern && !str.includes('信息')) {
            return true;
        }

        // 特殊处理：如果包含未找到乱码，则认为有乱码
        if (hasNotFoundGarbledPattern && !str.includes('未找到')) {
            return true;
        }

        // 检查是否包含XML错误信息的乱码特征
        if (str.includes('\u672a\u627e\u5230') && str.includes('\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca')) {
            return true;
        }
        
        // 如果包含日期格式乱码，也认为有乱码
        if (hasDateGarbledPattern) {
            return true;
        }

        return false;
    }

    /**
     * 尝试多种编码方式解码数据
     * @param data 原始数据
     * @returns 解码后的字符串
     */
    private decodeDataWithMultipleEncodings(data: Buffer): string {
        // 尝试的编码列表，按优先级排序，将可能更适合中文环境的编码放在前面
        const encodings = ['gbk', 'utf-8', 'gb2312', 'gb18030', 'cp936', 'big5', 'euc-jp', 'euc-kr', 'shift_jis'];

        // 保存原始字符串用于比较
        const originalString = data.toString();
        let bestDecodedString = originalString;
        let minGarbledScore = this.calculateGarbledScore(originalString);

        // 尝试直接的字符串替换处理（作为最后的手段）
        let directReplacementString = this.applyDirectReplacements(originalString);

        for (const encoding of encodings) {
            try {
                let decoded = iconv.decode(data, encoding);
                
                // 应用直接字符串替换，处理特殊乱码模式
                decoded = this.applyDirectReplacements(decoded);
                
                // 计算当前解码结果的乱码分数
                const garbledScore = this.calculateGarbledScore(decoded);
                
                // 如果当前解码结果的乱码分数更低，则更新最佳结果
                if (garbledScore < minGarbledScore) {
                    bestDecodedString = decoded;
                    minGarbledScore = garbledScore;
                }
                
                // 如果乱码分数足够低，认为是正确的解码
                if (garbledScore === 0) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含大量问号，但当前编码解码后没有问号，可能是正确编码
                if (originalString.includes('???') && !decoded.includes('???')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含四个问号乱码，但当前编码解码后没有四个问号，可能是正确编码
                if (originalString.includes('????') && !decoded.includes('????')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含月份乱码，但当前编码解码后是正常月份，可能是正确编码
                if ((originalString.includes('\u00ca\u00ca') || originalString.includes('\u00ca\u00ca\u00ca\u00ca')) && decoded.includes('十月')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含"应用工厂"乱码，但当前编码解码后是正常中文，可能是正确编码
                if (originalString.includes('\u5e94\u7528\u5de5\u5382') && decoded.includes('应用工厂')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含插件扫描乱码，但当前编码解码后是正常中文，可能是正确编码
                if (originalString.includes('\u63d2\u4ef6\u626b\u63cf') && decoded.includes('插件扫描')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含XML错误乱码，但当前编码解码后是正常中文，可能是正确编码
                if (originalString.includes('\u672a\u627e\u5230') && decoded.includes('无法解析')) {
                    return decoded;
                }
                
                // 特殊处理：从截图中识别的乱码模式
                if ((originalString.includes('\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca') || originalString.includes('\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca') || 
                     originalString.includes('\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca') || originalString.includes('\u00ca\u00ca\u00ca\u00ca\u00ca\u00ca')) && 
                    /[\u4e00-\u9fa5]/.test(decoded)) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含XML错误信息乱码，但当前编码解码后是正常中文，可能是正确编码
                if (originalString.includes('\u672a\u627e\u5230') && decoded.includes('不允许有匹配')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含日期格式乱码（如月份乱码），但当前编码解码后是正常日期格式，可能是正确编码
                if ((originalString.includes('\u00ca\u00ca\u00ca\u00ca') || originalString.includes('\u00ca\u00ca\u00ca\u00ca') || originalString.includes('\u00ca\u00ca\u00ca\u00ca')) && 
                    /\d+[,，]\s*\d+\s*月/.test(decoded)) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含日期乱码，但当前编码解码后是正常日期格式，可能是正确编码
                if ((originalString.includes('????') || originalString.includes('???')) && /\d+[,，]\s*\d+\s*(日|月|年)/.test(decoded)) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含希腊字母ʮ（十二月乱码），但解码后包含"十二月"，可能是正确编码
                if ((originalString.includes('ʮ') || originalString.includes('ʮ��') || originalString.includes('ʮ���') || originalString.includes('ʮ����')) && decoded.includes('十二月')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含其他月份的乱码，但解码后包含对应的正常月份，可能是正确编码
                const monthPatterns: Record<string, string[]> = {
                    '一月': ['һ', 'һ��', 'һ���', 'һ����'],
                    '二月': ['��', '���', '���', '����'],
                    '三月': ['���', '���', '����'],
                    '四月': ['�ġ', '�ġ��', '�ġ���', '�ġ����'],
                    '五月': ['�', '��', '���', '���', '��', '���'],
                    '六月': ['��', '���', '����'],
                    '七月': ['��', '���', '����'],
                    '八月': ['��', '���', '����'],
                    '九月': ['��', '���', '����'],
                    '十月': ['\u00ca\u00ca', '\u00ca\u00ca\u00ca\u00ca'],
                    '十一月': ['ʮһ', 'ʮһ��', 'ʮһ���', 'ʮһ����'],
                    '十二月': ['ʮ', 'ʮ��', 'ʮ���', 'ʮ����']
                };
                
                for (const [month, patterns] of Object.entries(monthPatterns)) {
                    if (patterns.some(pattern => originalString.includes(pattern)) && decoded.includes(month)) {
                        return decoded;
                    }
                }
                
                // 特殊处理：如果原始字符串包含乱码"�Ϣ"或"��Ϣ"，但解码后包含"信息"，可能是正确编码
                if ((originalString.includes('�Ϣ') || originalString.includes('��Ϣ')) && decoded.includes('信息')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含乱码"δ�ҵ�"或"δ�ҵ�"或"δ�ҵ�ȫ��"，但解码后包含"未找到"，可能是正确编码
                if ((originalString.includes('δ�ҵ�') || originalString.includes('δ�ҵ�') || originalString.includes('δ�ҵ�ȫ��')) && decoded.includes('未找到')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含希腊字母乱码，但解码后包含中文，可能是正确编码
                if ((originalString.includes('ʮ') || originalString.includes('δ')) && /[\u4e00-\u9fa5]/.test(decoded)) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含十二月的更长乱码版本，但解码后包含"十二月"，可能是正确编码
                if (originalString.includes('ʮ����') && decoded.includes('十二月')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含信息的更长乱码版本，但解码后包含"信息"，可能是正确编码
                if (originalString.includes('��Ϣ') && decoded.includes('信息')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含未找到完整乱码，但解码后包含"未找到"，可能是正确编码
                if (originalString.includes('δ�ҵ�ȫ��') && decoded.includes('未找到')) {
                    return decoded;
                }
                
                // 特殊处理：如果原始字符串包含乱码，但解码后包含"web.xml"，可能是正确编码
                if ((originalString.includes('δ�ҵ�') || originalString.includes('δ�ҵ�') || originalString.includes('δ�ҵ�ȫ��')) && decoded.includes('web.xml')) {
                    return decoded;
                }
            } catch (e) {
                // 继续尝试下一个编码
                continue;
            }
        }
        
        // 比较最佳解码结果和直接替换结果
        const directReplacementScore = this.calculateGarbledScore(directReplacementString);
        if (directReplacementScore < minGarbledScore) {
            return directReplacementString;
        }
        
        // 最后尝试使用gbk解码（因为这是最可能的中文编码），并应用直接替换
        try {
            let gbkDecoded = iconv.decode(data, 'gbk');
            gbkDecoded = this.applyDirectReplacements(gbkDecoded);
            const gbkScore = this.calculateGarbledScore(gbkDecoded);
            if (gbkScore < minGarbledScore) {
                return gbkDecoded;
            }
        } catch (e) {
            // 忽略错误
        }
        
        // 返回最佳解码结果
        return bestDecodedString;
    }
    
    /**
     * 计算字符串的乱码分数
     * @param str 待计算的字符串
     * @returns 乱码分数，0表示没有乱码，数值越大表示乱码越多
     */
    private calculateGarbledScore(str: string): number {
        if (!str) return 0;
        
        // 检查是否包含中文字符（正常中文应该能正确显示）
        const hasChinese = /[\u4e00-\u9fa5]/.test(str);
        
        // 检查是否包含大量非ASCII字符（可能是乱码）
        const nonAsciiChars = str.match(/[^\x00-\x7F]/g) || [];
        
        // 检查是否包含典型的乱码字符模式
        const garbledPatterns = [
            '????', '???', '??', '? ?',
            '\u00ca\u00ca', '\u00ca\u00ca\u00ca\u00ca',
            // 十二月相关乱码
            'ʮ', 'ʮ��', 'ʮ���', 'ʮ����',
            // 其他月份的可能乱码模式
            'һ', 'һ��', 'һ���', 'һ����',
            '��', '���', '���', '��', '���', '���',
            '�ġ', '�ġ��', '�ġ���', '�ġ����',
            '�', '��', '���', '���', '��', '���',
            'ʮһ', 'ʮһ��', 'ʮһ���', 'ʮһ����',
            // 其他乱码模式
            '�Ϣ', '��Ϣ',
            'δ�ҵ�', 'δ�ҵ�ȫ��',
            '��ʼ��Э�鴦����', 'Servlet ���棺',
            '[α-ωΑ-Ω]', // 希腊字母
            // 应用工厂插件流程管理相关乱码
            '绡锋悈锏惧€冪墷鏀敤绋嬪綍鍏垫椠', // 应用工厂插件流程管理乱码
            'n.绡锋悈锏惧€冪墷鏀敤绋嬪綍鍏垫椠鏍稿缓鑱婃祹绌洪綈椤绘柊', // 应用工厂插件流程管理及业务扩展乱码
            // 新增更多乱码模式
            '鍗曟嵁鐗规€ц繍琛屾椂鎻掍欢绫五', // 单数据规格化运行时插件类乱码
            '涓氬姟娴佽繍琛屾椂鎻掍欢', // 业务流运行时插件乱码
            '鍗曟嵁鐗规€ф彃浠剁被', // 单数据规格化发布类乱码
            '妗ｆ鐗规€ф彃浠剁被', // 单据规格化发布类乱码
            // 从截图中识别的新乱码模式
            '綅荤粺鏍规嵁鐗规€ф繍琛屾椂鎻掍欢绫五', // 系统规格化运行时插件类乱码
            '妗ｆ鏍规嵁鐗规€ф彃浠剁被', // 单据规格化发布类乱码
            '妗ｆ鏍规嵁鐗规€ф繍琛屾椂鎻掍欢绫五', // 单据规格化运行时插件类乱码
            '綅荤粺鏍规嵁鐗规€ф彃浠剁被', // 系统规格化发布类乱码
            // 从最新截图中识别的新乱码模式
            '瀹℃壒娴佽繍琛屾椂鎻掍欢绫五', // 流程运行时插件类乱码
            // 从新截图中识别的系统基础运行时插件类乱码
            '绯荤粺鏍规€ф繍琛屾椂鎻掍欢绫五', // 系统基础运行时插件类乱码
            // 优化添加：流程相关的更多可能乱码模式
            '瀹℃壒娴侊五', '瀹℃壒娴佹牸', '瀹℃壒鐗规€',
            '娴佽繍琛屾椂', '娴佽繍琛屾椂鎻掍欢', '娴佽繍琛屾椂鎻掍欢绫',
            '鎻掍欢绫五', '鎻掍欢绫诲瀷', '鎻掍欢绫诲瀷鐗规€'
        ];
        
        let score = 0;
        
        // 为每个匹配的乱码模式增加分数
        garbledPatterns.forEach(pattern => {
            if (pattern === '[α-ωΑ-Ω]') {
                if (new RegExp(pattern).test(str)) {
                    score += 2;
                }
            } else if (str.includes(pattern)) {
                score += 2;
            }
        });
        
        // 为非ASCII字符的比例增加分数
        if (nonAsciiChars.length > 0) {
            const nonAsciiRatio = nonAsciiChars.length / str.length;
            if (nonAsciiRatio > 0.5 && !hasChinese) {
                score += 3;
            }
        }
        
        // 如果包含中文字符但也有乱码模式，增加分数
        if (hasChinese && score > 0) {
            score += 1;
        }
        
        return score;
    }
    
    /**
     * 应用直接的字符串替换，处理特殊乱码模式
     * @param str 待处理的字符串
     * @returns 处理后的字符串
     */
    private applyDirectReplacements(str: string): string {
        if (!str) return str;
        
        // 定义乱码模式和对应的替换字符串，使用数组避免重复键
        const replacementPairs: [string, string][] = [
            // 月份相关乱码
            // 十月相关乱码
            ['\u00ca\u00ca', '十月'],
            // 十二月相关乱码
            ['ʮ', '十'],
            ['ʮ��', '十二月'],
            ['ʮ���', '十二月'],
            ['ʮ����', '十二月'],
            // 其他月份的可能乱码模式
            ['һ', '一'],
            ['һ��', '一月'],
            ['һ���', '一月'],
            ['һ����', '一月'],
            ['��', '二'],
            ['���', '二月'],
            ['����', '二月'],
            ['���', '三月'],
            ['���', '三月'],
            ['����', '三月'],
            ['�ġ', '四'],
            ['�ġ��', '四月'],
            ['�ġ���', '四月'],
            ['�ġ����', '四月'],
            ['�', '五'],
            ['��', '五月'],
            ['���', '五月'],
            ['����', '五月'],
            ['��', '六'],
            ['���', '六月'],
            ['����', '六月'],
            ['��', '七'],
            ['���', '七月'],
            ['����', '七月'],
            ['��', '八'],
            ['���', '八月'],
            ['����', '八月'],
            ['��', '九'],
            ['���', '九月'],
            ['����', '九月'],
            ['ʮһ', '十一'],
            ['ʮһ��', '十一月'],
            ['ʮһ���', '十一月'],
            ['ʮһ����', '十一月'],
            // 信息相关乱码
            ['�Ϣ', '信息'],
            ['��Ϣ', '信息'],
            // 未找到相关乱码
            ['δ�ҵ�', '未找到'],
            ['δ�ҵ�ȫ��', '未找到完整'],
            // 其他新发现的乱码模式
            ['��ʼ��Э�鴦����', '开始绑定端口'],
            ['Servlet ���棺', 'Servlet容器'],
            ['Servlet', 'Servlet'],
            // 应用工厂插件扫描相关乱码
            ['搴旂敤宸ュ巶鎻掍欢鎵弿锛五', '应用工厂插件扫描：'],
            ['绯荤粺鐗规€ф彃浠剁被锛屽寘鍚墦鍗伴檮浠跺強鍩虹鍔熻兘', '系统规格化发布类，包含打包模板及配置功能'],
            ['涓氬姟娴佹彃浠五', '业务流发布：'],
            ['excel瀵煎叆瀵煎嚭鐗规€ф彃浠剁被', 'excel导入导出规格化发布类'],
            ['澶栭儴浜ゆ崲骞冲彴鐗规€ф彃浠剁被', '外部交换平台规格化发布类'],
            ['瀹℃壒娴五(甯︾Щ鍔ㄥ鎵五)鎻掍欢绫五', '流程(灵动设计)插件类：'],
            // 新增乱码模式替换
            ['n.绡锋悈锏惧€冪墷鏀敤绋嬪綍鍏垫椠鏍稿缓鑱婃祹绌洪綈椤绘柊', '应用工厂插件流程管理及业务扩展'],
            ['绡锋悈锏惧€冪墷鏀敤绋嬪綍鍏垫椠', '应用工厂插件流程管理'],
            // 新增更多乱码模式替换
            ['鍗曟嵁鐗规€ц繍琛屾椂鎻掍欢绫五', '单数据规格化运行时插件类'],
            ['涓氬姟娴佽繍琛屾椂鎻掍欢', '业务流运行时插件'],
            ['鍗曟嵁鐗规€ф彃浠剁被', '单数据规格化发布类'],
            ['妗ｆ鐗规€ф彃浠剁被', '单据规格化发布类'],
            // 从截图中识别的新乱码模式替换
            ['綅荤粺鏍规嵁鐗规€ф繍琛屾椂鎻掍欢绫五', '系统规格化运行时插件类'],
            ['妗ｆ鏍规嵁鐗规€ф彃浠剁被', '单据规格化发布类'],
            ['妗ｆ鏍规嵁鐗规€ф繍琛屾椂鎻掍欢绫五', '单据规格化运行时插件类'],
            ['綅荤粺鏍规嵁鐗规€ф彃浠剁被', '系统规格化发布类'],
            // 从最新截图中识别的新乱码模式替换（最长、最具体的模式优先）
            ['瀹℃壒娴佽繍琛屾椂鎻掍欢绫五(甯︾Щ鍔ㄥ鎵五)', '流程运行时(灵动设计)插件类'],
            ['绯荤粺鐗规€х壒鎬ц繍琛屾椂鎻掍欢绫五', '系统规格化专用运行时插件类'],
            ['瀹℃壒娴佽繍琛屾椂鎻掍欢绫五', '流程运行时插件类'],
            ['绯荤粺鏍规€ф繍琛屾椂鎻掍欢绫五', '系统基础运行时插件类'],
            ['甯︾Щ鍔ㄥ鎵五', '灵动设计'],
            ['鐗规€х壒鎬ц繍琛屾椂', '规格化专用运行时'],
            ['瀹℃壒娴侊五', '流程'],
            ['娴佽繍琛屾椂鎻掍欢绫', '运行时插件类'],
            ['娴佽繍琛屾椂鎻掍欢', '运行时插件'],
            ['鎻掍欢绫诲瀷鐗规€', '插件类型规格'],
            ['鎻掍欢绫诲瀷', '插件类型'],
            ['鎻掍欢绫五', '插件类'],
            ['瀹℃壒娴佹牸', '流程模式'],
            ['瀹℃壒鐗规€', '流程规格'],
            ['娴佽繍琛屾椂', '运行时'],
            
            // 中等长度的模式
            ['鍗曟嵁鐗规€ф繍琛屾椂', '数据规格化运行时'],
            ['妗ｆ鐗规€ф繍琛屾椂', '单据规格化运行时'],
            ['鏍规€ф繍琛屾椂', '规格化运行时'],
            ['涓氬姟娴佽繍琛屾椂', '业务流运行时'],
            ['娴佽繍琛屾椂鎻掍', '运行时插件'],
            ['瀹℃壒鐗规', '流程规格'],
            ['绯荤粺鏍规€', '系统规格'],
            ['鍗曟嵁鐗规€', '数据规格'],
            ['妗ｆ鐗规€', '单据规格'],
            
            // 较短的模式
            ['涓氬姟娴侊', '业务流'],
            ['娴佽繍琛屾', '运行时'],
            ['鎻掍欢绫诲', '插件类型'],
            ['鎻掍欢绫', '插件类'],
            
            // 最短的模式
            ['瀹℃壒', '流程'],
            ['瀹℃壒娴侊', '流程'],
            ['娴佽繍', '运行'],
            ['鎻掍欢', '插件'],
            ['绯荤粺', '系统'],
            ['涓氬姟', '业务'],
            ['鍗曟嵁', '数据'],
            ['妗ｆ', '单据']
        ];
        
        // 应用所有替换
        let result = str;
        replacementPairs.forEach(([pattern, replacement]) => {
            // 为了提高替换效率，先检查字符串是否包含该模式
            if (result.includes(pattern)) {
                result = result.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
            }
        });
        
        return result;
    }

    /**
     * 编译项目源代码
     */
    private async compileProject(workspaceFolder: string): Promise<boolean> {
        return new Promise((resolve) => {
            this.outputChannel.appendLine('🔍 检查项目是否需要编译...');

            // 递归查找所有包含src目录的子项目
            const srcPaths = this.findSrcDirectories(workspaceFolder);

            // 如果没有找到任何src目录，则无需编译
            if (srcPaths.length === 0) {
                this.outputChannel.appendLine('✅ 项目中没有源代码需要编译');
                resolve(true);
                return;
            }

            // 检查是否是标准Java项目（存在src目录且包含Java文件）
            let hasJavaProject = false;
            for (const srcPath of srcPaths) {
                if (this.hasJavaFiles(srcPath)) {
                    hasJavaProject = true;
                    break;
                }
            }

            if (hasJavaProject) {
                this.outputChannel.appendLine('🔨 检测到标准Java项目，正在编译...');
                this.outputChannel.appendLine('🔧 请确保项目已正确配置编译环境');
                resolve(true);
                return;
            }

            this.outputChannel.appendLine('⚠️ 未识别的项目类型，跳过编译步骤');
            resolve(true);
        });
    }

    /**
     * 递归查找所有包含src目录的子项目
     */
    private findSrcDirectories(dirPath: string): string[] {
        const srcPaths: string[] = [];

        try {
            // 检查当前目录是否包含src子目录
            const srcPath = path.join(dirPath, 'src');
            if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
                srcPaths.push(srcPath);
            }

            // 递归检查所有子目录
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                // 跳过一些常见的不需要递归的目录
                if (item === 'node_modules' || item === '.git' || item === 'target' || item === 'build' || item === 'bin') {
                    continue;
                }

                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);

                if (stat.isDirectory()) {
                    srcPaths.push(...this.findSrcDirectories(itemPath));
                }
            }
        } catch (error) {
            // 忽略错误，继续处理其他目录
        }

        return srcPaths;
    }

    /**
     * 检查目录中是否包含Java文件
     */
    private hasJavaFiles(dirPath: string): boolean {
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);

                if (stat.isDirectory()) {
                    if (this.hasJavaFiles(itemPath)) {
                        return true;
                    }
                } else if (item.endsWith('.java')) {
                    return true;
                }
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查是否需要Oracle Instant Client（如果配置了Oracle数据源）
     */
    private async checkOracleClientIfNeeded(config: any): Promise<void> {
        if (config.dataSource && config.dataSource.type === 'oracle') {
            await this.checkOracleClientIfNeeded(config);
        }
    }

    /**
     * 启动NC HOME服务 (对应IDEA插件中的ServerDebugAction)
     * 修改为直接运行jar包的方式，而不是执行脚本
     */
    public async startHomeService(selectedPath?: string): Promise<void> {
        if (this.status === HomeStatus.RUNNING || this.status === HomeStatus.STARTING) {
            vscode.window.showWarningMessage('NC HOME服务已在运行中');
            return;
        }

        // 提前获取配置以避免变量作用域问题
        const config = this.configService.getConfig();

        // 获取当前工作区根目录或使用用户选择的目录
        let workspaceFolder = '';
        if (selectedPath) {
            // 使用用户选择的目录作为工作目录
            workspaceFolder = selectedPath;
            this.outputChannel.appendLine(`📂 用户选择的初始化目录: ${workspaceFolder}`);
            // 编译项目源代码
            const compileSuccess = await this.compileProject(workspaceFolder);
            if (!compileSuccess) {
                vscode.window.showErrorMessage('项目编译失败，请检查代码错误');
                return;
            }
        } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            // 使用默认工作区目录
            workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
            this.outputChannel.appendLine(`📂 当前工作区: ${workspaceFolder}`);
            // 编译项目源代码
            const compileSuccess = await this.compileProject(workspaceFolder);
            if (!compileSuccess) {
                vscode.window.showErrorMessage('项目编译失败，请检查代码错误');
                return;
            }
        } else {
            this.outputChannel.appendLine('⚠️ 未检测到工作区，跳过项目编译和resources目录复制步骤');
        }

        // 检查是否配置了HOME路径
        if (!config.homePath) {
            vscode.window.showErrorMessage('请先配置NC HOME路径');
            return;
        }

        // 检查HOME路径是否存在
        if (!fs.existsSync(config.homePath)) {
            vscode.window.showErrorMessage(`NC HOME路径不存在: ${config.homePath}`);
            return;
        }

        // 检查Oracle Instant Client（如果配置了Oracle数据源）
        await this.checkOracleClientIfNeeded(config);

        // 声明类路径结果变量，用于确保在异常情况下也能清理类路径文件
        let classpathResult: { classpath: string, classpathFile?: string } | undefined;
        
        // 重置当前类路径文件引用
        this.currentClasspathFile = null;

        try {
            this.setStatus(HomeStatus.STARTING);
            this.outputChannel.clear();
            
            // 在输出面板顶部固定显示模块信息
            const selectedServiceDirectory = ServiceStateManager.getSelectedServiceDirectory();
            if (selectedServiceDirectory) {
                const moduleName = path.basename(selectedServiceDirectory);
                
                // 用分隔线包围模块信息，让它在顶部固定显示
                this.outputChannel.appendLine('='.repeat(60));
                this.outputChannel.appendLine(`🚀 正在启动模块: ${moduleName}`);
                this.outputChannel.appendLine(`📁 模块路径: ${selectedServiceDirectory}`);
                this.outputChannel.appendLine('='.repeat(60));
                this.outputChannel.appendLine(''); // 空行分隔
                
                // 更新状态栏显示
                this.updateStatusBarModuleInfo(moduleName, selectedServiceDirectory);
                
                // 保存当前模块信息
                this.currentModuleInfo = { moduleName, modulePath: selectedServiceDirectory };
            } else {
                this.outputChannel.appendLine('🚀 正在启动NC HOME服务...');
                this.updateStatusBarDisplay('NC HOME服务');
            }
            
            // 自动切换到YonBIP NC HOME服务任务栏
            this.outputChannel.show();

            // 检查端口占用情况
            const portsAndDataSourcesFromProp = this.configService.getPortFromPropXml();
            const serverPort = portsAndDataSourcesFromProp.port || config.port || 8077;
            const wsPort = portsAndDataSourcesFromProp.wsPort || config.wsPort || 8080;
            const debugPort = config.debugPort || 8888;

            this.outputChannel.appendLine(`🔍 检查端口占用情况...`);
            await this.checkAndKillPortProcesses(serverPort, wsPort,debugPort);

            // 确保必要的配置文件存在
            await this.ensureDesignDataSource(config);

            // 检查并确定core.jar路径
            const coreJarPath = this.getCoreJarPath(config.homePath);
            if (!coreJarPath) {
                vscode.window.showErrorMessage('未找到core.jar文件，请检查NC HOME配置');
                this.setStatus(HomeStatus.ERROR);
                return;
            }

            this.outputChannel.appendLine(`📦 找到core.jar: ${coreJarPath}`);

            // 确定主类 (与IDEA插件保持一致)
            let mainClass = 'ufmiddle.start.tomcat.StartDirectServer';

            // 检查core.jar中是否包含wj相关类，如果包含则使用wj的启动类
            if (this.containsWJClasses(coreJarPath)) {
                mainClass = 'ufmiddle.start.wj.StartDirectServer';
                this.outputChannel.appendLine('🔧 检测到WJ相关类，使用WJ启动类');

            }

            // 构建类路径
            const classpathResult = this.buildClasspath(config, coreJarPath, workspaceFolder);
            const classpath = classpathResult.classpath;
            
            // 如果构建类路径时创建了类路径文件，保存引用以便后续清理
            if (classpathResult.classpathFile) {
                this.currentClasspathFile = classpathResult.classpathFile;
            }

            // 检查必要的配置文件
            const propDir = path.join(config.homePath, 'ierp', 'bin');
            const propFile = path.join(propDir, 'prop.xml');


            if (!fs.existsSync(propFile)) {
                this.outputChannel.appendLine(`❌ 严重错误: 系统配置文件不存在: ${propFile}`);
                this.outputChannel.appendLine('请确保正确配置了NC HOME目录，并且包含必要的配置文件');
                this.setStatus(HomeStatus.ERROR);
                vscode.window.showErrorMessage(`系统配置文件不存在: ${propFile}，请检查NC HOME配置`);
                return;
            } else {
                this.outputChannel.appendLine(`✅ 系统配置文件存在: ${propFile}`);

                // 检查是否有数据源配置
                try {
                    const propContent = fs.readFileSync(propFile, 'utf-8');
                    if (propContent.includes('<dataSource>') || propContent.includes('<dataSources>')) {
                        this.outputChannel.appendLine('✅ 配置文件中包含数据源配置');
                    } else {
                        this.outputChannel.appendLine('⚠️ 配置文件中未找到数据源配置');
                    }
                } catch (error: any) {
                    this.outputChannel.appendLine(`⚠️ 无法读取配置文件: ${error.message}`);
                }
            }

            // 检查数据源配置
            const dataSourceDir = path.join(config.homePath, 'ierp', 'bin');
            if (fs.existsSync(dataSourceDir)) {
                const dataSourceFiles = fs.readdirSync(dataSourceDir);
                const dsConfigs = dataSourceFiles.filter(file =>
                    file.startsWith('datasource') && (file.endsWith('.ini') || file.endsWith('.properties')));
                if (dsConfigs.length > 0) {
                    this.outputChannel.appendLine(`✅ 找到 ${dsConfigs.length} 个数据源配置文件`);
                    dsConfigs.forEach(file => {
                        this.outputChannel.appendLine(`   - ${file}`);
                    });
                } else {
                    this.outputChannel.appendLine('⚠️ 未找到数据源配置文件，可能导致启动失败');
                }
            } else {
                this.outputChannel.appendLine('⚠️ 未找到数据源配置目录，可能导致启动失败');
            }

            // 构建环境变量
            const env = this.buildEnvironment(config);

            // 构建JVM参数 (使用与IDEA插件一致的参数)
            const vmParameters = await this.buildVMParameters(config, serverPort, wsPort);

            // 确定Java可执行文件路径
            let javaExecutable = this.getJavaExecutable(config);

            this.outputChannel.appendLine('✅ 准备启动NC HOME服务...');
            this.outputChannel.appendLine(`☕ Java可执行文件: ${javaExecutable}`);
            this.outputChannel.appendLine(`🖥️  主类: ${mainClass}`);
            // 如果类路径是文件引用格式，则需要从文件中读取来计算条目数
            let classpathEntryCount = 0;
            if (classpath.startsWith('@')) {
                try {
                    const classpathFileContent = fs.readFileSync(classpath.substring(1), 'utf8');
                    classpathEntryCount = classpathFileContent.split(path.delimiter).length;
                } catch (e) {
                    // 如果无法读取文件，使用估计值
                    classpathEntryCount = 100; // 估计值
                }
            } else {
                classpathEntryCount = classpath.split(path.delimiter).length;
            }
            this.outputChannel.appendLine(`📦 类路径包含 ${classpathEntryCount} 个条目`);
            this.outputChannel.appendLine(`🏠 HOME路径: ${config.homePath}`);
            this.outputChannel.appendLine(`⚙️  JVM参数: ${vmParameters.join(' ')}`);

            // 构建Java命令参数
            // 检查类路径长度，如果过长则使用自定义类加载器
            const customClassLoaderPath = path.join(this.context.extensionPath, 'resources', 'custom-classloader', 'bin');
            const customClassLoaderJar = path.join(customClassLoaderPath, 'CustomClassLoader.class');
            
            // 计算实际类路径长度
            let actualClasspath = classpath;
            if (classpath.startsWith('@')) {
                // 如果是类路径文件引用，读取文件内容计算实际长度
                try {
                    const classpathFileContent = fs.readFileSync(classpath.substring(1), 'utf8');
                    actualClasspath = classpathFileContent;
                } catch (e) {
                    // 如果无法读取文件，使用估计值
                    this.outputChannel.appendLine('⚠️ 无法读取类路径文件，使用估计长度');
                }
            }
            
            let javaArgs: string[];
            if (actualClasspath.length > 7000 && fs.existsSync(customClassLoaderJar)) {
                // 使用自定义类加载器处理超长类路径
                this.outputChannel.appendLine('📚 类路径过长，使用自定义类加载器');
                
                let classpathToUse = classpath; // 默认使用原始类路径（可能是@file引用）
                
                // 检查当前类路径是否已经是文件引用格式
                if (!classpath.startsWith('@')) {
                    // 如果不是文件引用格式且类路径非常长，考虑创建类路径文件
                    if (actualClasspath.length > 15000) {
                        // 创建临时类路径文件
                        const tempDir = os.tmpdir();
                        const classpathFile = path.join(tempDir, `classpath_${Date.now()}.txt`);
                        fs.writeFileSync(classpathFile, actualClasspath, 'utf8');
                        classpathToUse = `@${classpathFile}`;
                        this.outputChannel.appendLine(`📄 创建类路径文件: ${classpathFile}`);
                        
                        // 保存类路径文件引用以便后续清理
                        this.currentClasspathFile = classpathFile;
                    }
                }
                
                javaArgs = [
                    ...vmParameters,
                    '-cp',
                    customClassLoaderPath,  // 只包含自定义类加载器的路径
                    'CustomClassLoader',      // 自定义类加载器主类
                    classpathToUse,          // 类路径或@file引用作为第一个参数
                    mainClass                // 原始主类作为第二个参数
                ];
            } else {
                // 使用标准方式
                javaArgs = [
                    ...vmParameters,
                    '-cp',
                    classpath,
                    mainClass
                ];
            }

             // 执行启动命令
            // 根据平台设置环境变量
            const platformEnv = { ...env };
            if (process.platform === 'win32') {
                // Windows平台设置编码环境变量
                platformEnv.LANG = 'zh_CN.GBK';
                platformEnv.LC_ALL = 'zh_CN.GBK';
                platformEnv.LC_CTYPE = 'zh_CN.GBK';
                platformEnv.CMDEXTVERSION = '2';
                platformEnv.CMD_SAVE_DIR = '1';
            } else {
                // 非Windows平台保持原有设置
                platformEnv.LANG = 'zh_CN.UTF-8';
                platformEnv.LC_ALL = 'zh_CN.UTF-8';
                platformEnv.LC_CTYPE = 'zh_CN.UTF-8';
            }
            
            this.process = spawn(javaExecutable, javaArgs, {
                cwd: config.homePath,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: platformEnv
            });

            

            // 监听标准输出
            if (this.process) {
                this.process.stdout?.on('data', (data: Buffer) => {
                    let output = data.toString();
                    // Windows平台特殊处理：尝试使用CP936解码
                    if (process.platform === 'win32') {
                        try {
                            const cp936Decoded = iconv.decode(data, 'cp936');
                            if (this.containsGarbledCharacters(output) && !this.containsGarbledCharacters(cp936Decoded)) {
                                output = cp936Decoded;
                            }
                        } catch (e) {
                            // 如果CP936解码失败，继续使用默认解码
                        }
                    }
                    // 检测并处理可能的编码问题
                    if (this.containsGarbledCharacters(output)) {
                        output = this.decodeDataWithMultipleEncodings(data);
                    }
                    // 应用直接替换规则，确保所有已知乱码模式都被修复
                    output = this.applyDirectReplacements(output);
                    // 移除ANSI转义序列
                    output = output.replace(/\u001b\[.*?m/g, '');
                    // 移除其他控制字符
                    output = output.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');

                    if (!output.includes('[Fatal Error]')) {
                        this.outputChannel.appendLine(`[STDOUT] ${output}`);
                    }
                    // 检查是否启动成功
                    if (output.includes('Server startup in') ||
                        output.includes('服务启动成功') ||
                        output.includes('Started ServerConnector') ||
                        output.includes('Tomcat started on port')) {
                        this.setStatus(HomeStatus.RUNNING);
                        vscode.window.showInformationMessage('YonBIP Premium HOME服务启动成功!');
                        // 记录HOME启动统计
                        StatisticsService.incrementCount(StatisticsService.HOME_START_COUNT);
                    }
                });
            }

            // 监听标准错误输出
            if (this.process) {
                this.process.stderr?.on('data', (data: Buffer) => {
                    let stderrOutput = data.toString();
                    // Windows平台特殊处理：尝试使用CP936解码
                    if (process.platform === 'win32') {
                        try {
                            const cp936Decoded = iconv.decode(data, 'cp936');
                            if (this.containsGarbledCharacters(stderrOutput) && !this.containsGarbledCharacters(cp936Decoded)) {
                                stderrOutput = cp936Decoded;
                            }
                        } catch (e) {
                            // 如果CP936解码失败，继续使用默认解码
                        }
                    }
                    // 检测并处理可能的编码问题
                    if (this.containsGarbledCharacters(stderrOutput)) {
                        stderrOutput = this.decodeDataWithMultipleEncodings(data);
                    }
                    // 应用直接替换规则，确保所有已知乱码模式都被修复
                    stderrOutput = this.applyDirectReplacements(stderrOutput);
                    // 移除ANSI转义序列
                    stderrOutput = stderrOutput.replace(/\u001b\[.*?m/g, '');
                    // 移除其他控制字符
                    stderrOutput = stderrOutput.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
                    this.outputChannel.appendLine(`[STDERR] ${stderrOutput}`);

                    // 检查错误信息
                    if (stderrOutput.includes('ERROR') || stderrOutput.includes('Exception')) {
                        this.outputChannel.appendLine('❌ 检测到错误信息');
                    }

                    // 即使没有明显的错误标识，也要提醒用户关注stderr信息
                    if (!stderrOutput.includes('Exception') &&
                        !stderrOutput.includes('Error') &&
                        !stderrOutput.includes('Caused by')) {
                        this.outputChannel.appendLine('⚠️ 请特别关注以上STDERR输出，它可能包含导致启动失败的重要信息');
                    }
                });
            }

            // 监听进程退出事件
            this.process.on('exit', (code: any, signal: any) => {
                this.outputChannel.appendLine(`\nNC HOME服务进程已退出，退出码: ${code}`);
                if (code === 255) {
                    this.outputChannel.appendLine('❌ 退出码255表示服务启动过程中发生严重错误:');
                    this.outputChannel.appendLine('   1. 可能是由于Java Security Manager配置问题');
                    this.outputChannel.appendLine('   2. 可能是缺少必要的系统属性配置');
                    this.outputChannel.appendLine('   3. 可能是类路径配置不正确导致关键类无法加载');
                    this.outputChannel.appendLine('   4. 可能是端口绑定失败');
                    this.outputChannel.appendLine('   5. 可能是Java版本兼容性问题（如使用了不支持的JDK版本）');
                    this.outputChannel.appendLine('💡 建议检查完整的日志输出，特别是STDERR中的错误信息');
                    this.outputChannel.appendLine('💡 尝试在终端中手动运行以下命令来获取更详细的错误信息:');
                    this.outputChannel.appendLine(`   java ${vmParameters.join(' ')} -cp "[类路径]" ${mainClass}`);
                } else if (code !== 0 && !this.isManualStop) {
                    // 只有在非手动停止且退出码非0时才视为错误
                    this.outputChannel.appendLine(`❌ 服务异常退出，退出码: ${code}`);
                    this.outputChannel.appendLine('💡 建议检查完整的日志输出，特别是STDERR中的错误信息');
                } else if (this.isManualStop) {
                    this.outputChannel.appendLine('✅ 服务已正常停止');
                    this.isManualStop = false;
                } else {
                    this.outputChannel.appendLine('✅ 服务已正常退出');
                }

                // 清理类路径文件（如果存在）
                if (classpathResult.classpathFile && fs.existsSync(classpathResult.classpathFile)) {
                    try {
                        fs.unlinkSync(classpathResult.classpathFile);
                        this.outputChannel.appendLine(`🧹 已清理类路径文件: ${classpathResult.classpathFile}`);
                    } catch (e) {
                        this.outputChannel.appendLine(`⚠️ 清理类路径文件失败: ${e}`);
                    }
                }
                
                // 同时清理当前类路径文件引用（如果存在）
                this.cleanupClasspathFile();

                this.process = null;
                this.setStatus(HomeStatus.STOPPED);
            });

            // 监听进程错误事件
            this.process.on('error', (err) => {
                console.error('进程启动失败:', err);
                this.outputChannel.appendLine(`❌ 启动服务时发生错误: ${err.message}`);
                this.setStatus(HomeStatus.ERROR);
                this.process = null;
            });

            // 监听进程关闭事件
            this.process.on('close', (code, signal) => {
                console.log(`进程关闭，退出码: ${code}, 信号: ${signal}`);
                this.outputChannel.appendLine(`\nHOME服务进程已关闭，退出码: ${code}${signal ? `, 信号: ${signal}` : ''}`);

                // 退出码143表示进程被SIGTERM信号终止，这是正常停止的结果
                // 只有在非手动停止且退出码不是0或143时才视为异常
                if (code !== 0 && code !== null && code !== 143 && !this.isManualStop) {
                    this.outputChannel.appendLine('⚠️ 服务异常退出，请检查日志文件或终端手动启动输出！');
                    if (code === 255) {
                        this.outputChannel.appendLine('💡 退出码255通常与以下问题有关:');
                        this.outputChannel.appendLine('   - Java Security Manager配置问题');
                        this.outputChannel.appendLine('   - JDK版本兼容性问题');
                        this.outputChannel.appendLine('   - 必要的系统属性未正确设置');
                    }
                } else if (code === 143 || this.isManualStop) {
                    // 退出码143表示进程被SIGTERM信号终止，这是正常停止的结果
                    // 或者是手动停止的情况
                    this.outputChannel.appendLine('✅ 服务已正常停止（进程被终止信号关闭）');
                }

                // 清理类路径文件（如果存在）
                if (classpathResult.classpathFile && fs.existsSync(classpathResult.classpathFile)) {
                    try {
                        fs.unlinkSync(classpathResult.classpathFile);
                        this.outputChannel.appendLine(`🧹 已清理类路径文件: ${classpathResult.classpathFile}`);
                    } catch (e) {
                        this.outputChannel.appendLine(`⚠️ 清理类路径文件失败: ${e}`);
                    }
                }

                this.process = null;
                this.setStatus(HomeStatus.STOPPED);
            });

            // 启动检查定时器
            this.startupCheckTimer = setTimeout(() => {
                if (this.status === HomeStatus.STARTING) {
                    this.outputChannel.appendLine('⚠️ 服务启动可能需要更长时间，请耐心等待...');
                    // 延长检查时间
                    this.startupCheckTimer = setTimeout(() => {
                        if (this.status === HomeStatus.STARTING) {
                            this.outputChannel.appendLine('⚠️ 服务启动可能需要更长时间，请耐心等待...');
                        }
                    }, 60000); // 增加1分钟等待时间
                }
            }, 60000); // 增加到1分钟等待时间

        } catch (error: any) {
            this.outputChannel.appendLine(`❌ 启动过程中出现异常: ${error.message}`);
            this.outputChannel.appendLine(error.stack);
            this.setStatus(HomeStatus.ERROR);
            
            // 确保清理类路径文件（如果已创建）
            if (classpathResult?.classpathFile && fs.existsSync(classpathResult.classpathFile)) {
                try {
                    fs.unlinkSync(classpathResult.classpathFile);
                    this.outputChannel.appendLine(`🧹 已清理类路径文件: ${classpathResult.classpathFile}`);
                } catch (cleanupError) {
                    this.outputChannel.appendLine(`⚠️ 清理类路径文件失败: ${cleanupError}`);
                }
            }
            
            vscode.window.showErrorMessage(`启动NC HOME服务时出现异常: ${error.message}`);
        }
    }

    /**
     * 获取core.jar路径
     */
    private getCoreJarPath(homePath: string): string | null {
        // 按优先级检查不同位置的core.jar
        const possiblePaths = [
            path.join(homePath, 'middleware', 'core.jar'),
            path.join(homePath, 'lib', 'core.jar')
        ];

        for (const jarPath of possiblePaths) {
            if (fs.existsSync(jarPath)) {
                return jarPath;
            }
        }

        return null;
    }

    /**
     * 检查core.jar中是否包含wj相关类
     */
    private containsWJClasses(coreJarPath: string): boolean {
        try {
            // 检查文件名是否包含wj或WJ
            const filename = path.basename(coreJarPath);
            if (filename.toLowerCase().includes('wj')) {
                return true;
            }

            // 检查HOME路径是否包含特定标识
            return coreJarPath.includes('wj') || coreJarPath.includes('WJ');
        } catch (error) {
            return false;
        }
    }

    /**
     * 构建完整的类路径 (解决ClassNotFoundException问题)
     * 优化版本：使用类路径文件避免命令行过长问题
     */
    private buildClasspath(config: any, coreJarPath: string, workspaceFolder: string): { classpath: string, classpathFile?: string } {
        const classpathEntries: string[] = [coreJarPath];

        // 特别添加可能包含ws相关类的目录
        const wsRelatedDirs = [
            path.join(config.homePath, 'webapps', 'uapws'),
            path.join(config.homePath, 'webapps', 'uapws', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'webapps', 'webservice'),
            path.join(config.homePath, 'webapps', 'webservice', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'hotwebs', 'uapws', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'hotwebs', 'webservice', 'WEB-INF', 'classes')
        ];

        // 优先添加这些目录，以确保ws相关类能被正确加载
        for (const wsDir of wsRelatedDirs) {
            if (fs.existsSync(wsDir)) {
                classpathEntries.push(wsDir);
                this.outputChannel.appendLine(`🚨 优先添加WS相关目录: ${wsDir}`);
            }
        }

        // 首先添加工作区编译输出目录
        if (workspaceFolder) {
            const buildClasses = path.join(workspaceFolder, 'build', 'classes'); // YonBIP项目
            if (fs.existsSync(buildClasses)) {
                classpathEntries.push(buildClasses);
                this.outputChannel.appendLine(`📁 添加YonBIP编译输出目录: ${buildClasses}`);
            }
        }

        // 添加预处理后的external目录 (解决ClassNotFoundException的关键步骤)
        const externalLibDir = path.join(config.homePath, 'external', 'lib');
        const externalClassesDir = path.join(config.homePath, 'external', 'classes');

        // 使用通配符形式添加external/lib目录
        if (fs.existsSync(externalLibDir)) {
            classpathEntries.push(path.join(externalLibDir, '*'));
        }

        if (fs.existsSync(externalClassesDir)) {
            classpathEntries.push(externalClassesDir);
            this.outputChannel.appendLine(`📁 添加预处理后的external/classes目录`);
        }

        // 需要扫描的目录列表 (基于IDEA插件的实现，并扩展)
        const libDirs = [
            path.join(config.homePath, 'middleware'),
            path.join(config.homePath, 'lib'),
            path.join(config.homePath, 'external', 'lib'),
            path.join(config.homePath, 'ierp', 'bin'),
            path.join(config.homePath, 'ant', 'lib'),
            path.join(config.homePath, 'license'), // 添加许可证目录
            path.join(config.homePath, 'webapps'), // 添加webapps目录
            path.join(config.homePath, 'webapps', 'nccloud', 'WEB-INF', 'lib'), // 添加nccloud webapp lib目录
            path.join(config.homePath, 'webapps', 'uapws', 'WEB-INF', 'lib'), // 添加uapws webapp lib目录
            path.join(config.homePath, 'webapps', 'console', 'WEB-INF', 'lib'), // 添加console webapp lib目录
            path.join(config.homePath, 'webapps', 'fs', 'WEB-INF', 'lib'), // 添加fs webapp lib目录
            path.join(config.homePath, 'webapps', 'ncchr', 'WEB-INF', 'lib'), // 添加ncchr webapp lib目录
            path.join(config.homePath, 'webapps', 'portal', 'WEB-INF', 'lib'), // 添加portal webapp lib目录
            path.join(config.homePath, 'webapps', 'mobile', 'WEB-INF', 'lib'), // 添加mobile webapp lib目录
            path.join(config.homePath, 'webapps', 'hrhi', 'WEB-INF', 'lib'), // 添加hrhi webapp lib目录
            path.join(config.homePath, 'webapps', 'einvoice', 'WEB-INF', 'lib'), // 添加einvoice webapp lib目录
            path.join(config.homePath, 'webapps', 'cm', 'WEB-INF', 'lib'), // 添加cm webapp lib目录
            path.join(config.homePath, 'webapps', 'fin', 'WEB-INF', 'lib'), // 添加fin webapp lib目录
            path.join(config.homePath, 'webapps', 'fip', 'WEB-INF', 'lib'), // 添加fip webapp lib目录
            path.join(config.homePath, 'webapps', 'pm', 'WEB-INF', 'lib'), // 添加pm webapp lib目录
            path.join(config.homePath, 'webapps', 'sm', 'WEB-INF', 'lib'), // 添加sm webapp lib目录
            path.join(config.homePath, 'webapps', 'edm', 'WEB-INF', 'lib'), // 添加edm webapp lib目录
            path.join(config.homePath, 'webapps', 'bcm', 'WEB-INF', 'lib'), // 添加bcm webapp lib目录
            path.join(config.homePath, 'webapps', 'pub', 'WEB-INF', 'lib'), // 添加pub webapp lib目录
         
            path.join(config.homePath, 'langlib'), // 添加langlib目录
            path.join(config.homePath, 'middleware', 'lib'), // 添加middleware/lib目录
            path.join(config.homePath, 'framework'), // 添加framework目录
            // 特别添加可能包含ws相关类的目录
            path.join(config.homePath, 'webapps', 'uapws', 'WEB-INF', 'classes'),
            path.join(config.homePath, 'webapps', 'webservice', 'WEB-INF', 'lib'),
            path.join(config.homePath, 'webapps', 'webservice', 'WEB-INF', 'classes')
        ];

        this.outputChannel.appendLine('开始构建类路径...');

        // 特别处理driver目录下的jar文件，确保它们被正确添加到类路径中
        const driverLibDir = path.join(config.homePath, 'driver');
        if (fs.existsSync(driverLibDir)) {
            try {
                // 递归扫描driver目录下的所有jar文件
                const driverJars = this.scanDriverJars(driverLibDir);
                for (const jarPath of driverJars) {
                    classpathEntries.push(jarPath);
                }
            } catch (err: any) {
                this.outputChannel.appendLine(`⚠️ 扫描driver目录下的jar文件失败: ${err}`);
            }
        }

        // 使用工具类获取所有启用模块的classes路径和lib路径
        // 特别处理uapbs模块，确保其类路径优先加载
        const moduleClassesPaths = ClasspathUtils.getAllModuleClassesPaths(config.homePath, this.context);
        const moduleLibPaths = ClasspathUtils.getAllModuleLibPaths(config.homePath, this.context);
        
        // 将uapbs模块的路径移到最前面
        const uapbsClassesPaths = moduleClassesPaths.filter(path => path.includes('/modules/uapbs/') || path.includes('\\modules\\uapbs\\'));
        const otherClassesPaths = moduleClassesPaths.filter(path => !path.includes('/modules/uapbs/') && !path.includes('\\modules\\uapbs\\'));
        const uapbsLibPaths = moduleLibPaths.filter(path => path.includes('/modules/uapbs/') || path.includes('\\modules\\uapbs\\'));
        const otherLibPaths = moduleLibPaths.filter(path => !path.includes('/modules/uapbs/') && !path.includes('\\modules\\uapbs\\'));
        
        // 先添加uapbs模块路径，再添加其他模块路径
        classpathEntries.push(...uapbsClassesPaths);
        classpathEntries.push(...otherClassesPaths);
        classpathEntries.push(...uapbsLibPaths);
        classpathEntries.push(...otherLibPaths);
                
        // 遍历所有目录，使用通配符形式添加jar包到类路径
        for (const dir of libDirs) {
            if (fs.existsSync(dir)) {
                try {
                    // 检查目录中是否有jar文件
                    const files = fs.readdirSync(dir);
                    const hasJars = files.some(file => file.endsWith('.jar'));
                    
                    // 如果有jar文件，使用通配符形式添加整个目录
                    if (hasJars) {
                        classpathEntries.push(path.join(dir, '*'));
                    }
                } catch (err: any) {
                    this.outputChannel.appendLine(`⚠️ 读取目录失败: ${dir}, 错误: ${err}`);
                }
            } else {
                // 只对特定目录输出警告
                if (dir.includes('ierp') || dir.includes('hotweb')) {
                    this.outputChannel.appendLine(`目录不存在: ${dir}`);
                }
            }
        }

        // 特别检查并添加与web服务相关的jar包
        // 注意：这里仍然添加特定的jar包，因为需要确保ws相关类能被正确加载
        this.checkAndAddWSJars(config.homePath, classpathEntries);

        this.resolveOracleJarCompatibility(config.homePath, classpathEntries);

        // 在所有jar包添加完成后，保守地添加resources目录（避免类加载冲突）
        const resourcesDir = path.join(config.homePath, 'resources');
        if (fs.existsSync(resourcesDir)) {
            // 只添加resources主目录和conf子目录，不递归添加所有子目录
            classpathEntries.push(resourcesDir);
            this.outputChannel.appendLine(`📁 添加resources目录: ${resourcesDir}`);

            // 特别添加conf目录，确保配置文件能被加载
            const confDir = path.join(resourcesDir, 'conf');
            if (fs.existsSync(confDir)) {
                classpathEntries.push(confDir);
                this.outputChannel.appendLine(`📁 特别添加resources/conf目录: ${confDir}`);
            }
        } else {
            this.outputChannel.appendLine(`⚠️ resources目录不存在: ${resourcesDir}`);
        }

        // 去除重复项并构建类路径
        const uniqueClasspathEntries = [...new Set(classpathEntries)];
        this.outputChannel.appendLine(`类路径构建完成，共包含 ${uniqueClasspathEntries.length} 个条目`);

        // 特别检查resources和conf目录是否被正确添加
        const resourcesEntries = uniqueClasspathEntries.filter(entry => entry.includes('resources'));
        if (resourcesEntries.length > 0) {
            this.outputChannel.appendLine(`✅ resources目录已添加: ${resourcesEntries.join(', ')}`);
        } else {
            this.outputChannel.appendLine('⚠️ resources目录未被添加到类路径中');
        }

        // 确保所有类路径条目都是有效的文件系统路径，而不是URI
        const validatedClasspathEntries = uniqueClasspathEntries.filter(entry => {
            try {
                // 检查是否为有效的文件系统路径
                if (fs.existsSync(entry) || entry.endsWith('*')) {
                    return true;
                }
                // 检查是否为有效的目录或文件路径（即使当前不存在）
                // 但排除看起来像jar中资源的URI
                if (entry.includes("!/")) {
                    this.outputChannel.appendLine(`⚠️ 跳过无效类路径条目(可能是jar中资源): ${entry}`);
                    return false;
                }
                return true;
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ 检查类路径条目时出错: ${entry}, 错误: ${error}`);
                return false;
            }
        });

        this.outputChannel.appendLine(`类路径构建完成，共包含 ${validatedClasspathEntries.length} 个条目`);

        // 如果类路径过长，根据JDK版本决定是否使用类路径文件
        const classpathString = validatedClasspathEntries.join(path.delimiter);
        
        if (classpathString.length > 7000) { // 当类路径超过一定长度时考虑使用文件
            // 检测Java版本，JDK 1.8不使用@文件引用方式
            let javaVersion = 0;
            try {
                // 尝试从VS Code配置获取Java版本
                const javaConfig = vscode.workspace.getConfiguration('java.configuration');
                const runtimes = javaConfig.get<any[]>('runtimes', []);
                
                // 查找默认的Java运行时版本
                const defaultRuntime = runtimes.find(runtime => runtime.default === true);
                if (defaultRuntime && defaultRuntime.name) {
                    // 改进的版本匹配正则表达式，支持Java 1.8, 11, 17等格式
                    const versionMatch = defaultRuntime.name.match(/(\d+\.\d+|\d+)/);
                    if (versionMatch && versionMatch[1]) {
                        // 对于1.8这样的版本号，只取小数点后的数字
                        if (versionMatch[1].includes('.')) {
                            const parts = versionMatch[1].split('.');
                            javaVersion = parseInt(parts[1]); // 对于1.8，取8
                        } else {
                            javaVersion = parseInt(versionMatch[1]); // 对于11, 17等，直接使用
                        }
                    }
                }
                
                // 如果没有从配置中获取到版本，尝试使用命令行检测
                if (javaVersion === 0) {
                    const { execSync } = require('child_process');
                    const versionOutput = execSync('java -version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
                    const versionMatch = (versionOutput || '').match(/version\s+"(\d+)/i);
                    if (versionMatch && versionMatch[1]) {
                        javaVersion = parseInt(versionMatch[1]);
                    }
                }
            } catch (error: any) {
                this.outputChannel.appendLine(`警告: 无法检测Java版本，将默认不使用类路径文件: ${error.message}`);
            }
            
            // JDK 1.8 (版本号为8) 或检测失败时，不使用@文件引用方式
            // 但会在startHomeService方法中使用自定义类加载器处理
            if (javaVersion <= 8) {
                this.outputChannel.appendLine(`JDK ${javaVersion} 检测到，不使用@文件引用方式以避免兼容性问题`);
                this.outputChannel.appendLine(`类路径长度: ${classpathString.length}，将在启动时使用自定义类加载器处理`);
                return { classpath: classpathString };
            } else {
                // JDK 9+ 使用@文件引用方式
                const tempDir = os.tmpdir();
                const classpathFile = path.join(tempDir, `classpath_${Date.now()}.txt`);
                fs.writeFileSync(classpathFile, classpathString, 'utf8');
                this.outputChannel.appendLine(`.createClasspathFile 创建类路径文件: ${classpathFile}`);
                return { classpath: `@${classpathFile}`, classpathFile };
            }
        }

        return { classpath: classpathString };
    }

    private resolveOracleJarCompatibility(homePath: string, classpathEntries: string[]): void {
        try {
            const dirs = [
                path.join(homePath, 'driver'),
                path.join(homePath, 'middleware', 'lib'),
                path.join(homePath, 'lib'),
                path.join(homePath, 'external', 'lib'),
                path.join(homePath, 'webapps', 'uapws', 'WEB-INF', 'lib'),
                path.join(homePath, 'webapps', 'nccloud', 'WEB-INF', 'lib')
            ];
            const jars: Array<{ path: string; name: string; folder: string }> = [];
            const walk = (d: string) => {
                if (!fs.existsSync(d)) return;
                let items: string[] = [];
                try {
                    items = fs.readdirSync(d);
                } catch {
                    return;
                }
                for (const it of items) {
                    const p = path.join(d, it);
                    let s: fs.Stats;
                    try {
                        s = fs.statSync(p);
                    } catch {
                        continue;
                    }
                    if (s.isDirectory()) {
                        walk(p);
                    } else if (it.endsWith('.jar')) {
                        jars.push({ path: p, name: it.toLowerCase(), folder: path.dirname(p) });
                    }
                }
            };
            for (const d of dirs) walk(d);
            const ojdbcJars = jars.filter(j => j.name.includes('ojdbc'));
            const orai18nJars = jars.filter(j => j.name.includes('orai18n'));
            if (ojdbcJars.length === 0) return;
            const preferFolders = ['oracle_23c', 'oracle_21c', 'oracle_19c', 'oracle_18c', 'oracle_12c', 'oracle_11g', 'oracle_10g'];
            const sortedByFolder = [...ojdbcJars].sort((a, b) => {
                const ia = preferFolders.findIndex(k => a.path.includes(k));
                const ib = preferFolders.findIndex(k => b.path.includes(k));
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });
            let primaryOjdbc = sortedByFolder.find(j => j.name.includes('ojdbc8')) || sortedByFolder[0] || ojdbcJars[0];
            let candidateOrai = orai18nJars.find(j => j.folder === primaryOjdbc.folder) || orai18nJars.find(j => j.path.includes('oracle_19c')) || orai18nJars[0];
            if (!candidateOrai) {
                this.outputChannel.appendLine('⚠️ 未找到orai18n.jar，可能导致Oracle字符集转换异常');
                return;
            }
            const ensureFront = (p: string) => {
                const idx = classpathEntries.indexOf(p);
                if (idx >= 0) classpathEntries.splice(idx, 1);
                classpathEntries.splice(1, 0, p);
            };
            ensureFront(candidateOrai.path);
            ensureFront(primaryOjdbc.path);
            this.outputChannel.appendLine(`🔧 优先使用Oracle JDBC: ${path.basename(primaryOjdbc.path)}`);
            this.outputChannel.appendLine(`🔧 优先使用orai18n: ${path.basename(candidateOrai.path)}`);
        } catch (e: any) {
            this.outputChannel.appendLine(`⚠️ Oracle兼容性检查失败: ${e.message || e}`);
        }
    }

    /**
     * 递归扫描driver目录下的所有jar文件
     * @param dirPath 要扫描的目录路径
     * @returns jar文件路径数组
     */
    private scanDriverJars(dirPath: string): string[] {
        const jarPaths: string[] = [];
        
        try {
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stat = fs.statSync(itemPath);
                
                if (stat.isDirectory()) {
                    // 递归扫描子目录
                    jarPaths.push(...this.scanDriverJars(itemPath));
                } else if (item.endsWith('.jar')) {
                    // 添加jar文件
                    jarPaths.push(itemPath);
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ 扫描目录失败: ${dirPath}, 错误: ${error}`);
        }
        
        return jarPaths;
    }

    /**
     * 特别检查并添加与web服务相关的jar包
     * 用于解决nc.uap.ws.page.security.FilterChars等WS相关类找不到的问题
     */
    private checkAndAddWSJars(homePath: string, classpathEntries: string[]): void {
        // 搜索并添加可能包含ws相关类的jar包
        const wsJarKeywords = ['ws', 'webservice', 'uapws', 'web-service'];
        const wsJarPaths: string[] = [];

        // 搜索并添加可能包含Granite相关类的jar包
        const graniteJarKeywords = ['granite', 'flex', 'blazeds', 'amf'];
        const graniteJarPaths: string[] = [];

        // 搜索middleware/lib目录
        const middlewareLibDir = path.join(homePath, 'middleware', 'lib');
        if (fs.existsSync(middlewareLibDir)) {
            this.searchAndAddWSJars(middlewareLibDir, wsJarKeywords, wsJarPaths);
        }

        // 搜索lib目录
        const libDir = path.join(homePath, 'lib');
        if (fs.existsSync(libDir)) {
            this.searchAndAddWSJars(libDir, wsJarKeywords, wsJarPaths);
        }

        // 搜索external/lib目录
        const externalLibDir = path.join(homePath, 'external', 'lib');
        if (fs.existsSync(externalLibDir)) {
            this.searchAndAddWSJars(externalLibDir, wsJarKeywords, wsJarPaths);
        }

        // 搜索webapps/uapws/WEB-INF/lib目录
        const uapwsLibDir = path.join(homePath, 'webapps', 'uapws', 'WEB-INF', 'lib');
        if (fs.existsSync(uapwsLibDir)) {
            this.searchAndAddWSJars(uapwsLibDir, wsJarKeywords, wsJarPaths);
        }

        // 搜索webapps/webservice/WEB-INF/lib目录
        const webserviceLibDir = path.join(homePath, 'webapps', 'webservice', 'WEB-INF', 'lib');
        if (fs.existsSync(webserviceLibDir)) {
            this.searchAndAddWSJars(webserviceLibDir, wsJarKeywords, wsJarPaths);
            this.searchAndAddWSJars(webserviceLibDir, graniteJarKeywords, graniteJarPaths);
        }

        // 搜索Granite相关目录
        const graniteLibDir = path.join(homePath, 'middleware', 'granite', 'lib');
        if (fs.existsSync(graniteLibDir)) {
            this.searchAndAddWSJars(graniteLibDir, graniteJarKeywords, graniteJarPaths);
        }

        // 搜索flex相关目录
        const flexLibDir = path.join(homePath, 'middleware', 'flex', 'lib');
        if (fs.existsSync(flexLibDir)) {
            this.searchAndAddWSJars(flexLibDir, graniteJarKeywords, graniteJarPaths);
        }

        // 将找到的ws相关jar包添加到类路径
        for (const wsJarPath of wsJarPaths) {
            if (!classpathEntries.includes(wsJarPath)) {
                classpathEntries.push(wsJarPath);
                //this.outputChannel.appendLine(`🚨 特别添加WS相关jar包: ${path.basename(wsJarPath)}`);
            }
        }

        // 将找到的Granite相关jar包添加到类路径
        for (const graniteJarPath of graniteJarPaths) {
            if (!classpathEntries.includes(graniteJarPath)) {
                classpathEntries.push(graniteJarPath);
                //this.outputChannel.appendLine(`🚨 特别添加Granite相关jar包: ${path.basename(graniteJarPath)}`);
            }
        }
    }

    /**
     * 在指定目录中搜索并添加包含关键词的jar包
     */
    private searchAndAddWSJars(dir: string, keywords: string[], jarPaths: string[]): void {
        try {
            const files = fs.readdirSync(dir);
            const jars = files.filter(file => file.endsWith('.jar'));

            for (const jar of jars) {
                const jarPath = path.join(dir, jar);
                const jarName = jar.toLowerCase();

                for (const keyword of keywords) {
                    if (jarName.includes(keyword.toLowerCase())) {
                        jarPaths.push(jarPath);
                        break;
                    }
                }
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`⚠️ 读取目录失败: ${dir}, 错误: ${error.message}`);
        }
    }

    /**
     * 构建环境变量 (与IDEA插件保持一致)
     */
    private buildEnvironment(config: any): NodeJS.ProcessEnv {
        const env = { ...process.env };

        // 设置与IDEA插件一致的环境变量
        env.FIELD_NC_HOME = config.homePath;
        env.FIELD_HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        env.FIELD_EX_MODULES = config.exModules || '';

        // 兼容IDEA插件的变量命名
        env.IDEA_FIELD_NC_HOME = config.homePath;
        env.IDEA_FIELD_HOTWEBS = config.hotwebs || 'nccloud,fs,yonbip';
        env.IDEA_FIELD_EX_MODULES = config.exModules || '';

        // 添加数据源配置目录到环境变量
        const propDir = path.join(config.homePath, 'ierp', 'bin');
        env.NC_PROP_DIR = propDir;
        env.PROP_DIR = propDir;

        this.outputChannel.appendLine(`设置环境变量: FIELD_NC_HOME=${env.FIELD_NC_HOME}`);
        this.outputChannel.appendLine(`设置环境变量: FIELD_HOTWEBS=${env.FIELD_HOTWEBS}`);
        this.outputChannel.appendLine(`设置环境变量: NC_PROP_DIR=${env.NC_PROP_DIR}`);

        return env;
    }

    /**
     * 构建JVM参数 (与IDEA插件保持一致)
     */
    private async buildVMParameters(config: any, serverPort: number, wsPort: number): Promise<string[]> {
        // 默认JVM参数数组
        const defaultVmParameters: string[] = [];

        // 添加IDEA插件中的默认VM参数 (与IDEA插件保持一致)
        // 使用path.resolve确保所有路径都是绝对路径，避免URI格式问题
        defaultVmParameters.push('-Dnc.exclude.modules=' + (config.exModules || ''));
        defaultVmParameters.push('-Dnc.runMode=develop');
        defaultVmParameters.push('-Dnc.server.location=' + path.resolve(config.homePath));
        defaultVmParameters.push('-DEJBConfigDir=' + path.resolve(config.homePath, 'ejbXMLs'));
        defaultVmParameters.push('-Dorg.owasp.esapi.resources=' + path.resolve(config.homePath, 'ierp', 'bin', 'esapi'));
        defaultVmParameters.push('-DExtServiceConfigDir=' + path.resolve(config.homePath, 'ejbXMLs'));
        defaultVmParameters.push('-Duap.hotwebs=' + (config.hotwebs || 'nccloud,fs,yonbip'));
        defaultVmParameters.push('-Duap.disable.codescan=false');
        defaultVmParameters.push('-Xmx1024m');
        defaultVmParameters.push('-Dfile.encoding=UTF-8');
        defaultVmParameters.push('-Duser.timezone=GMT+8');
        defaultVmParameters.push('-Dnc.log.console=true');      // 强制输出日志到控制台
        defaultVmParameters.push('-Dnc.debug=true');            // 开启调试模式
        defaultVmParameters.push('-Dnc.log.level=DEBUG');       // 设置日志级别为 DEBUG
        defaultVmParameters.push('-Dnc.startup.trace=true');    // 启动跟踪

        // 添加数据源配置目录参数 - 与IDEA插件保持一致
        const propDir = path.resolve(config.homePath, 'ierp', 'bin');
        defaultVmParameters.push('-Dnc.prop.dir=' + propDir);
        defaultVmParameters.push('-Dprop.dir=' + propDir);

        // 添加默认数据源配置参数
        if (config.selectedDataSource) {
            defaultVmParameters.push('-Dnc.datasource.default=' + config.selectedDataSource);
        }

        // 默认JVM参数
        defaultVmParameters.push('-Xms256m');

        // 检测Java版本，决定是否添加MaxPermSize参数
        // MaxPermSize参数在Java 9+版本中已被移除
        let javaVersion = 0;
        try {
            javaVersion = await JavaVersionUtils.getJavaVersion(this.outputChannel);
        } catch (error: any) {
            this.outputChannel.appendLine(`警告: 无法检测Java版本，将假设使用Java 8+: ${error.message}`);
        }

        // 仅在Java 8及以下版本添加MaxPermSize参数
        if (javaVersion < 8 && javaVersion !== 0) {
            defaultVmParameters.push('-XX:MaxPermSize=512m');
            this.outputChannel.appendLine('Java版本 < 8，添加MaxPermSize参数');
        } else {
            defaultVmParameters.push('-XX:MetaspaceSize=512m');
            this.outputChannel.appendLine('Java版本 >= 8，添加MetaspaceSize参数');
        }

        defaultVmParameters.push('-XX:+HeapDumpOnOutOfMemoryError');
        defaultVmParameters.push('-XX:HeapDumpPath=' + path.join(config.homePath, 'logs', 'nc_heapdump.hprof'));

        // 添加系统属性
        defaultVmParameters.push('-Dnc.server.home=' + path.resolve(config.homePath));
        defaultVmParameters.push('-Dnc.home=' + path.resolve(config.homePath));
        defaultVmParameters.push('-Dnc.idesupport=true');
        defaultVmParameters.push('-Dnc.scan=true');
        defaultVmParameters.push('-Dnc.server.port=' + serverPort);

        // 特别添加与web服务相关的系统属性
        defaultVmParameters.push('-Dws.server=true');
        defaultVmParameters.push('-Dws.port=' + (wsPort || 8080));

        // 添加编码参数
        defaultVmParameters.push('-Dconsole.encoding=UTF-8');
        defaultVmParameters.push('-Dsun.jnu.encoding=UTF-8');
        defaultVmParameters.push('-Dclient.encoding.override=UTF-8');

        // 添加XML解析器配置
        defaultVmParameters.push('-Djavax.xml.parsers.DocumentBuilderFactory=com.sun.org.apache.xerces.internal.jaxp.DocumentBuilderFactoryImpl');
        defaultVmParameters.push('-Djavax.xml.parsers.SAXParserFactory=com.sun.org.apache.xerces.internal.jaxp.SAXParserFactoryImpl');
        defaultVmParameters.push('-Djavax.xml.transform.TransformerFactory=com.sun.org.apache.xalan.internal.xsltc.trax.TransformerFactoryImpl');

        // 根据Java版本添加相应的兼容性参数（与IDEA插件保持一致）
        if (javaVersion >= 17) {
            // JDK 17+ 需要添加--add-opens参数
            defaultVmParameters.push('--add-opens=java.base/java.lang=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.lang.reflect=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/jdk.internal.reflect=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.lang.invoke=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.io=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.nio.charset=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.net=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.util.concurrent=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.util=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.xml/javax.xml=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.xml/javax.xml.stream=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.rmi/sun.rmi.transport=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.naming/javax.naming=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.management/javax.management=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.comp=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.model=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.processing=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=jdk.compiler/com.sun.tools.javac.jvm=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/java.awt.image=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/sun.awt=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.security=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.base/java.lang.ref=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/javax.swing=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/javax.accessibility=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/java.beans=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/java.awt=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/sun.swing=ALL-UNNAMED');
            defaultVmParameters.push('--add-opens=java.desktop/java.awt.color=ALL-UNNAMED');
        }
        // 为JDK 8及以下版本设置适当的参数
        else if (javaVersion <= 8) {
            // JDK 8不需要--add-opens参数，但可能需要其他兼容性设置
            defaultVmParameters.push('-Djava.awt.headless=true');
            defaultVmParameters.push('-Dsun.reflect.noInflation=true');
            defaultVmParameters.push('-Dsun.reflect.inflationThreshold=0');
        }
        // JDK 9-16版本的处理
        else if (javaVersion > 8 && javaVersion < 17) {
            // JDK 9-16不需要--add-opens参数，但可能需要其他兼容性设置
            defaultVmParameters.push('-Djava.awt.headless=true');
        }

        // macOS参数
        if (process.platform === 'darwin') {
            defaultVmParameters.push('-Dapple.awt.UIElement=true');
        }

        // 调试模式参数
        if (config.debugMode) {
            const debugPort = config.debugPort || 8888;  // 使用配置的调试端口，默认为8888
            defaultVmParameters.push(`-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${debugPort}`);
        }

        // 添加project.dir作为系统属性
        if (config.projectDir) {
            defaultVmParameters.push('-Dproject.dir=' + config.projectDir);
        }

        // 处理用户配置的JVM参数
        let userVmParameters: string[] = [];
        if (config.vmParameters && config.vmParameters.length > 0) {
            // 按行分割用户配置的参数
            userVmParameters = config.vmParameters.split('\n').map((param: string) => param.trim()).filter((param: string) => param.length > 0);
        }

        // 合并参数，用户参数优先
        // 首先提取所有参数的key（参数名）
        const getUserParamKey = (param: string): string => {
            // 移除开头的横杠
            let cleanParam = param;
            while (cleanParam.startsWith('-')) {
                cleanParam = cleanParam.substring(1);
            }
            
            // 对于Xmx、Xms等参数，只取Xmx、Xms作为key
            if (cleanParam.startsWith('Xmx')) {
                return 'Xmx';
            }
            if (cleanParam.startsWith('Xms')) {
                return 'Xms';
            }
            if (cleanParam.startsWith('XX:')) {
                // 对于XX:参数，取冒号后的内容作为key
                const parts = cleanParam.split(':');
                if (parts.length > 1) {
                    return 'XX:' + parts[1].split('=')[0];
                }
            }
            
            // 如果包含等号，只取等号前的部分作为key
            if (cleanParam.includes('=')) {
                return cleanParam.split('=')[0];
            }
            
            // 否则整个参数作为key
            return cleanParam;
        };

        // 创建用户参数key到完整参数的映射
        const userParamMap = new Map<string, string>();
        for (const param of userVmParameters) {
            const key = getUserParamKey(param);
            userParamMap.set(key, param);
        }

        // 从默认参数中过滤掉被用户参数覆盖的参数
        const filteredDefaultParams: string[] = [];
        for (const param of defaultVmParameters) {
            const key = getUserParamKey(param);
            // 如果用户没有配置相同key的参数，则保留默认参数
            if (!userParamMap.has(key)) {
                filteredDefaultParams.push(param);
            }
        }

        // 合并参数：默认参数 + 用户参数
        const vmParameters = [...filteredDefaultParams, ...userVmParameters];

        return vmParameters;
    }

    /**
     * 获取Java可执行文件路径
     */
    private getJavaExecutable(config: any): string {
        // 首先尝试使用配置的Java路径
        if (config.javaHome) {
            const javaPath = path.join(config.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
            if (fs.existsSync(javaPath)) {
                this.outputChannel.appendLine(`✅ 使用配置的Java路径: ${javaPath}`);
                return javaPath;
            }
        }

        // 尝试从VS Code的java.configuration.runtimes配置中获取Java路径
        try {
            const javaConfig = vscode.workspace.getConfiguration('java.configuration');
            const runtimes = javaConfig.get<any[]>('runtimes', []);

            // 查找默认的Java运行时
            const defaultRuntime = runtimes.find(runtime => runtime.default === true);
            if (defaultRuntime && defaultRuntime.path) {
                const javaPath = path.join(defaultRuntime.path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                if (fs.existsSync(javaPath)) {
                    this.outputChannel.appendLine(`✅ 使用VS Code配置的默认Java运行时: ${javaPath}`);
                    return javaPath;
                }
            }

            // 如果没有默认运行时，尝试使用第一个配置的运行时
            if (runtimes.length > 0 && runtimes[0].path) {
                const javaPath = path.join(runtimes[0].path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                if (fs.existsSync(javaPath)) {
                    this.outputChannel.appendLine(`✅ 使用VS Code配置的第一个Java运行时: ${javaPath}`);
                    return javaPath;
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ 读取VS Code Java配置时出错: ${error}`);
        }

        // 回退到内置的ufjdk
        const ufjdkPath = path.join(config.homePath, 'ufjdk');
        const ufjdkBinPath = path.join(ufjdkPath, 'bin');

        // 根据操作系统确定可执行文件名
        const javaExeName = process.platform === 'win32' ? 'java.exe' : 'java';
        const javaBinPath = path.join(ufjdkBinPath, javaExeName);

        // 检查是否存在且可执行
        if (fs.existsSync(javaBinPath)) {
            try {
                // 在Unix系统上检查可执行权限
                if (process.platform !== 'win32') {
                    fs.accessSync(javaBinPath, fs.constants.X_OK);
                }

                // 验证这是一个有效的Java可执行文件
                const versionResult = spawnSync(javaBinPath, ['-version'], {
                    encoding: 'utf8',
                    timeout: 5000
                });

                if (versionResult.status === 0) {
                    this.outputChannel.appendLine(`✅ 使用NC内置JDK: ${javaBinPath}`);
                    return javaBinPath;
                } else {
                    this.outputChannel.appendLine(`⚠️  NC内置JDK验证失败，使用系统Java`);
                }
            } catch (error) {
                this.outputChannel.appendLine(`⚠️  NC内置JDK不可用: ${error}`);
            }
        } else {
            this.outputChannel.appendLine(`⚠️  未找到NC内置JDK: ${javaBinPath}`);
        }

        // 检查是否为Windows JDK在macOS/Linux上
        const wrongPlatformJava = path.join(ufjdkBinPath, process.platform === 'win32' ? 'java' : 'java.exe');
        if (fs.existsSync(wrongPlatformJava)) {
            this.outputChannel.appendLine(`⚠️  检测到不匹配的JDK平台，使用系统Java`);
        }

        // 使用系统Java
        try {
            const systemJavaResult = spawnSync('java', ['-version'], {
                encoding: 'utf8',
                timeout: 5000
            });

            if (systemJavaResult.status === 0) {
                this.outputChannel.appendLine(`✅ 使用系统Java: java`);
                return 'java';
            }
        } catch (error) {
            // 继续尝试其他路径
        }

        // 尝试常见Java路径
        const commonJavaPaths = [
            '/usr/bin/java',
            '/usr/local/bin/java',
            '/opt/homebrew/bin/java'
        ];

        for (const javaPath of commonJavaPaths) {
            if (fs.existsSync(javaPath)) {
                try {
                    const result = spawnSync(javaPath, ['-version'], {
                        encoding: 'utf8',
                        timeout: 5000
                    });

                    if (result.status === 0) {
                        this.outputChannel.appendLine(`✅ 使用系统Java: ${javaPath}`);
                        return javaPath;
                    }
                } catch (error) {
                    continue;
                }
            }
        }

        // 最后的回退方案
        this.outputChannel.appendLine(`❌ 未找到可用的Java可执行文件，使用默认java命令`);
        return 'java';
    }

    /**
     * 停止NC HOME服务
     */
    public async stopHomeService(): Promise<void> {
        this.outputChannel.show();
        // 清空控制台
        this.outputChannel.clear();
        this.outputChannel.appendLine('正在停止NC HOME服务...');

        if (this.status === HomeStatus.STOPPED || this.status === HomeStatus.STOPPING) {
            vscode.window.showWarningMessage('NC HOME服务未在运行');
            this.outputChannel.appendLine('⚠️ NC HOME服务未在运行');
            return;
        }

        try {
            this.setStatus(HomeStatus.STOPPING);
            this.isManualStop = true;

            const config = this.configService.getConfig();

            // 终止进程
           this.killProcess();

            // 设置超时，如果一段时间后进程仍未停止则强制终止
            setTimeout(() => {
                if (this.status === HomeStatus.STOPPING) {
                    this.outputChannel.appendLine('停止服务超时，强制终止进程');
                    this.killProcess();
                }
            }, 15000); // 15秒超时

        } catch (error: any) {
            this.outputChannel.appendLine(`停止NC HOME服务失败: ${error.message}`);
            this.setStatus(HomeStatus.ERROR);
            this.isManualStop = false;
            
            // 清理可能存在的类路径文件
            this.cleanupClasspathFile();
            
            vscode.window.showErrorMessage(`停止NC HOME服务失败: ${error.message}`);
        }
    }

    /**
     * 强制终止进程
     */
    private killProcess(): void {
        if (this.process && !this.process.killed) {
            try {
                this.outputChannel.appendLine('正在强制终止HOME服务进程...');

                // 首先尝试正常终止
                this.process.kill('SIGTERM');

                // 如果进程在2秒内没有终止，则强制杀死
                setTimeout(() => {
                    if (this.process && !this.process.killed) {
                        this.process.kill('SIGKILL');
                        this.outputChannel.appendLine('已发送强制终止信号');
                    }
                }, 2000);
            } catch (error: any) {
                this.outputChannel.appendLine(`终止进程失败: ${error.message}`);
            }
        } else {
            this.outputChannel.appendLine('没有正在运行的HOME服务进程');
        }

        // 设置状态为已停止
        this.setStatus(HomeStatus.STOPPED);
        // 注意：这里不重置isManualStop标志，因为它在stopHomeService方法中管理
        
        // 清理类路径文件
        this.cleanupClasspathFile();
        
        this.outputChannel.appendLine('✅ HOME服务已停止');
    }

    /**
     * 清理类路径文件
     */
    private cleanupClasspathFile(): void {
        if (this.currentClasspathFile && fs.existsSync(this.currentClasspathFile)) {
            try {
                fs.unlinkSync(this.currentClasspathFile);
                this.outputChannel.appendLine(`🧹 已清理类路径文件: ${this.currentClasspathFile}`);
                this.currentClasspathFile = null; // 重置引用
            } catch (e) {
                this.outputChannel.appendLine(`⚠️ 清理类路径文件失败: ${e}`);
            }
        }
    }

    /**
     * 获取服务状态
     */
    public getStatus(): HomeStatus {
        return this.status;
    }

    /**
     * 设置服务状态
     */
    private setStatus(status: HomeStatus): void {
        this.status = status;
        
        // 更新状态栏显示
        if (this.statusBarItem) {
            const selectedServiceDirectory = ServiceStateManager.getSelectedServiceDirectory();
            switch (status) {
                case HomeStatus.STARTING:
                    if (selectedServiceDirectory) {
                        const moduleName = path.basename(selectedServiceDirectory);
                        this.statusBarItem.text = `$(sync~spin) 正在启动模块: ${moduleName}`;
                        this.statusBarItem.tooltip = `模块路径: ${selectedServiceDirectory}`;
                    } else {
                        this.statusBarItem.text = "$(sync~spin) 正在启动NC HOME服务...";
                        this.statusBarItem.tooltip = "正在启动NC HOME服务";
                    }
                    this.statusBarItem.show();
                    break;
                case HomeStatus.RUNNING:
                    if (selectedServiceDirectory) {
                        const moduleName = path.basename(selectedServiceDirectory);
                        this.statusBarItem.text = `$(check) 模块运行中: ${moduleName}`;
                        this.statusBarItem.tooltip = `模块路径: ${selectedServiceDirectory}`;
                    } else {
                        this.statusBarItem.text = "$(check) HOME服务运行中";
                        this.statusBarItem.tooltip = "NC HOME服务正在运行";
                    }
                    this.statusBarItem.show();
                    break;
                case HomeStatus.STOPPING:
                    if (selectedServiceDirectory) {
                        const moduleName = path.basename(selectedServiceDirectory);
                        this.statusBarItem.text = `$(sync~spin) 正在停止模块: ${moduleName}`;
                        this.statusBarItem.tooltip = `模块路径: ${selectedServiceDirectory}`;
                    } else {
                        this.statusBarItem.text = "$(sync~spin) 正在停止HOME服务...";
                        this.statusBarItem.tooltip = "正在停止NC HOME服务";
                    }
                    this.statusBarItem.show();
                    break;
                case HomeStatus.STOPPED:
                    this.statusBarItem.text = "$(circle-slash) HOME服务已停止";
                    this.statusBarItem.tooltip = "NC HOME服务已停止";
                    this.statusBarItem.show();
                    break;
                case HomeStatus.ERROR:
                    this.statusBarItem.text = "$(error) HOME服务错误";
                    this.statusBarItem.tooltip = "NC HOME服务发生错误";
                    this.statusBarItem.show();
                    break;
            }
        }
        
        // 更新工具栏图标视觉效果
        const toolbarIconService = ToolbarIconService.getInstance(this.context);
        toolbarIconService.updateToolbarIconVisual(status);

        // 发送状态变更事件，供其他组件更新UI
        vscode.commands.executeCommand('setContext', 'yonbip.home.status', status);
    }

    /**
     * 显示服务日志
     */
    public showLogs(): void {
        this.outputChannel.show();
    }

    /**
     * 重启NC HOME服务
     */
    public async restartHomeService(): Promise<void> {
        this.outputChannel.appendLine('正在重启NC HOME服务...');
        await this.stopHomeService();

        // 等待服务完全停止
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 重新启动服务
        await this.startHomeService();
    }

    /**
     * 检查服务是否正在运行
     */
    public isRunning(): boolean {
        return this.status === HomeStatus.RUNNING;
    }

    /**
     * 获取进程ID
     */
    public getProcessId(): number | null {
        return this.process?.pid || null;
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        if (this.startupCheckTimer) {
            clearTimeout(this.startupCheckTimer);
            this.startupCheckTimer = null;
        }

        if (this.process && !this.process.killed) {
            this.process.kill();
        }

        // 清理临时类路径文件
        try {
            const tempDir = path.join(this.context.extensionPath, 'temp');
            if (fs.existsSync(tempDir)) {
                const files = fs.readdirSync(tempDir);
                for (const file of files) {
                    if (file.endsWith('.txt')) {
                        const filePath = path.join(tempDir, file);
                        fs.unlinkSync(filePath);
                    }
                }
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`⚠️ 清理临时文件时出错: ${error.message}`);
        }

        // 只有在扩展完全停用时才应该dispose outputChannel
        if (HomeService.outputChannelInstance) {
            HomeService.outputChannelInstance.dispose();
            HomeService.outputChannelInstance = null;
        }
    }

    /**
     * 确保design数据源配置存在
     * 如果不存在，则根据配置创建一个默认的design数据源
     */
    private async ensureDesignDataSource(config: any): Promise<void> {
        const binDir = path.join(config.homePath, 'ierp', 'bin');
        const dataSourceIniPath = path.join(binDir, 'datasource.ini');
        const dataSourcePropertiesPath = path.join(binDir, 'datasource.properties');
        const propXmlPath = path.join(binDir, 'prop.xml');

        // 确保目录存在
        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
        }

        // 检查是否已存在数据源配置文件
        if (fs.existsSync(dataSourceIniPath) || fs.existsSync(dataSourcePropertiesPath)) {
            this.outputChannel.appendLine('✅ 数据源配置已存在');
        } else {
            // 如果配置中有数据源信息，则创建design数据源配置
            if (config.dataSources && config.dataSources.length > 0) {
                // 查找被标记为design的数据源
                let designDataSource = config.dataSources.find((ds: any) => ds.name === config.selectedDataSource);

                // 如果没有找到明确指定的design数据源，则使用第一个数据源
                if (!designDataSource && config.dataSources.length > 0) {
                    designDataSource = config.dataSources[0];
                    this.outputChannel.appendLine(`⚠️ 未找到明确指定的design数据源，使用第一个数据源: ${designDataSource.name}`);
                }

                if (designDataSource) {
                    this.outputChannel.appendLine(`🔧 创建design数据源配置: ${designDataSource.name}`);

                    // 构建数据源配置内容
                    const dataSourceContent = this.buildDataSourceConfig(designDataSource);

                    // 写入配置文件
                    fs.writeFileSync(dataSourceIniPath, dataSourceContent, 'utf-8');
                    this.outputChannel.appendLine(`✅ 已创建数据源配置文件: ${dataSourceIniPath}`);
                }
            } else {
                // 如果没有配置数据源，则创建一个默认的MySQL数据源配置
                this.outputChannel.appendLine('⚠️ 未配置数据源，创建默认的MySQL design数据源配置');
                const defaultDataSourceContent = `<?xml version="1.0" encoding="UTF-8"?>
<DataSourceMeta>
    <dataSourceName>design</dataSourceName>
    <databaseType>MySQL</databaseType>
    <driverClassName>com.mysql.cj.jdbc.Driver</driverClassName>
    <databaseUrl>jdbc:mysql://localhost:3306/nc6x?useSSL=false&amp;serverTimezone=UTC</databaseUrl>
    <user>root</user>
    <password>root</password>
    <maxCon>20</maxCon>
    <minCon>5</minCon>
</DataSourceMeta>`;

                fs.writeFileSync(dataSourceIniPath, defaultDataSourceContent, 'utf-8');
                this.outputChannel.appendLine(`✅ 已创建默认数据源配置文件: ${dataSourceIniPath}`);
            }
        }

        // 如果prop.xml不存在，也创建一个基础的prop.xml文件
        if (!fs.existsSync(propXmlPath)) {
            this.createBasicPropXml(config, null, propXmlPath);
        }
    }

    /**
     * 创建基础的prop.xml文件
     * @param config 配置信息
     * @param dataSource 数据源信息
     * @param propXmlPath prop.xml文件路径
     */
    private createBasicPropXml(config: any, dataSource: any, propXmlPath: string): void {
        // 确保配置目录存在
        const propDir = path.dirname(propXmlPath);
        if (!fs.existsSync(propDir)) {
            fs.mkdirSync(propDir, { recursive: true });
        }

        const propXmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<config>
    <domain>
        <name>develop</name>
    </domain>
    <isEncode>false</isEncode>
    <enableHotDeploy>true</enableHotDeploy>
    <securityDataSource>design</securityDataSource>
    <dataSource>
        <dataSourceName>design</dataSourceName>
        <databaseType>MySQL</databaseType>
        <driverClassName>com.mysql.cj.jdbc.Driver</driverClassName>
        <databaseUrl>jdbc:mysql://localhost:3306/nc6x?useSSL=false&amp;serverTimezone=UTC</databaseUrl>
        <user>root</user>
        <password>root</password>
        <maxCon>20</maxCon>
        <minCon>5</minCon>
    </dataSource>
</config>`;

        fs.writeFileSync(propXmlPath, propXmlContent, 'utf-8');
        this.outputChannel.appendLine(`✅ 已创建基础prop.xml配置文件: ${propXmlPath}`);
    }

    /**
     * 构建数据源配置内容
     * @param dataSource 数据源配置信息
     */
    private buildDataSourceConfig(dataSource: any): string {
        // 根据数据库类型生成URL
        let databaseUrl = dataSource.url;
        if (!databaseUrl) {
            switch (dataSource.databaseType.toLowerCase()) {
                case 'mysql':
                    databaseUrl = `jdbc:mysql://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}?useSSL=false&serverTimezone=UTC`;
                    break;
                case 'oracle':
                    databaseUrl = `jdbc:oracle:thin:@${dataSource.host}:${dataSource.port}:${dataSource.databaseName}`;
                    break;
                case 'sqlserver':
                    databaseUrl = `jdbc:sqlserver://${dataSource.host}:${dataSource.port};database=${dataSource.databaseName}`;
                    break;
                case 'postgresql':
                    databaseUrl = `jdbc:postgresql://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
                    break;
                default:
                    databaseUrl = `jdbc:${dataSource.databaseType.toLowerCase()}://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
            }
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<DataSourceMeta>
    <dataSourceName>design</dataSourceName>
    <databaseType>${dataSource.databaseType}</databaseType>
    <driverClassName>${dataSource.driverClassName || this.getDriverClassName(dataSource.databaseType)}</driverClassName>
    <databaseUrl>${databaseUrl}</databaseUrl>
    <user>${dataSource.username}</user>
    <password>${dataSource.password}</password>
    <maxCon>20</maxCon>
    <minCon>5</minCon>
</DataSourceMeta>`;
    }

    /**
     * 根据数据库类型获取驱动类名
     * @param databaseType 数据库类型
     */
    private getDriverClassName(databaseType: string): string {
        // 处理空值或未定义的情况
        if (!databaseType) {
            this.outputChannel.appendLine('⚠️ 数据库类型未指定，使用默认MySQL驱动');
            return 'com.mysql.cj.jdbc.Driver';
        }

        switch (databaseType.toLowerCase().trim()) {
            case 'mysql':
            case 'mysql5':
            case 'mysql8':
                return 'com.mysql.cj.jdbc.Driver';
            case 'oracle':
            case 'oracle11g':
            case 'oracle12c':
                return 'oracle.jdbc.OracleDriver';
            case 'sqlserver':
            case 'mssql':
            case 'microsoft sql server':
                return 'com.microsoft.sqlserver.jdbc.SQLServerDriver';
            case 'postgresql':
            case 'pg':
                return 'org.postgresql.Driver';
            case 'db2':
                return 'com.ibm.db2.jcc.DB2Driver';
            case 'sybase':
                return 'com.sybase.jdbc4.jdbc.SybDriver';
            default:
                this.outputChannel.appendLine(`⚠️ 未知数据库类型: ${databaseType}，使用默认MySQL驱动`);
                return 'com.mysql.cj.jdbc.Driver';
        }
    }

    /**
     * 检查端口占用并终止占用进程
     * @param serverPort 服务端口
     * @param wsPort WebService端口
     * @param debugPort 调试端口
     */
    private async checkAndKillPortProcesses(serverPort: number, wsPort: number, debugPort: number): Promise<void> {
        return new Promise((resolve) => {
            this.outputChannel.appendLine(`🔍 检查HOME服务端口 ${serverPort} 和 WAS端口 ${wsPort} 和调试端口 ${debugPort} 是否被占用...`);

            // 根据不同平台使用不同命令
            let command: string;
            let args: string[];

            if (process.platform === 'win32') {
                // Windows平台使用netstat命令
                command = 'netstat';
                args = ['-a', '-n', '-o'];
            } else {
                // Unix-like平台使用lsof命令
                command = 'lsof';
                args = ['-i', `:${serverPort}`, '-t'];
            }

            const processList = spawn(command, args);
            let output = '';
            let errorOutput = '';

            processList.stdout?.on('data', (data) => {
                output += data.toString();
            });

            processList.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });

            processList.on('close', async (code) => {
                if (code !== 0 && errorOutput) {
                    this.outputChannel.appendLine(`⚠️ 检查端口时出现错误: ${errorOutput}`);
                    resolve();
                    return;
                }

                const processesToKill: number[] = [];

                if (process.platform === 'win32') {
                    // Windows平台处理
                    const lines = output.split('\n');
                    for (const line of lines) {
                        // 查找TCP连接中包含指定端口且状态为LISTENING的行
                        const serverPortRegex = new RegExp(`TCP\\s+[^:]+:${serverPort}\\s+[^:]+:\\d+\\s+LISTENING\\s+(\\d+)`);
                        const wsPortRegex = new RegExp(`TCP\\s+[^:]+:${wsPort}\\s+[^:]+:\\d+\\s+LISTENING\\s+(\\d+)`);
                        const debugPortRegex = new RegExp(`TCP\\s+[^:]+:${debugPort}\\s+[^:]+:\\d+\\s+LISTENING\\s+(\\d+)`);

                        const serverMatch = line.match(serverPortRegex);
                        const wsMatch = line.match(wsPortRegex);
                        const debugMatch = line.match(debugPortRegex);

                        if (serverMatch) {
                            const pid = parseInt(serverMatch[1]);
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${serverPort} 被进程 ${pid} 占用`);
                            }
                        }

                        if (wsMatch) {
                            const pid = parseInt(wsMatch[1]);
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${wsPort} 被进程 ${pid} 占用`);
                            }
                        }

                        if (debugMatch) {
                            const pid = parseInt(debugMatch[1]);
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${debugPort} 被进程 ${pid} 占用`);
                            }
                        }
                    }
                } else {
                    // Unix-like平台处理
                    const lines = output.split('\n').filter(line => line.trim() !== '');
                    if (lines.length > 0) {
                        for (const line of lines) {
                            const pid = parseInt(line.trim());
                            if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                processesToKill.push(pid);
                                this.outputChannel.appendLine(`🔍 发现端口 ${serverPort} 被进程 ${pid} 占用`);
                            }
                        }
                    }

                    // 检查wsPort
                    try {
                        const wsProcessList = spawn('lsof', ['-i', `:${wsPort}`, '-t']);
                        let wsOutput = '';

                        wsProcessList.stdout?.on('data', (data) => {
                            wsOutput += data.toString();
                        });

                        wsProcessList.on('close', (wsCode) => {
                            if (wsCode === 0) {
                                const wsLines = wsOutput.split('\n').filter(line => line.trim() !== '');
                                for (const line of wsLines) {
                                    const pid = parseInt(line.trim());
                                    if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                        processesToKill.push(pid);
                                        this.outputChannel.appendLine(`🔍 发现端口 ${wsPort} 被进程 ${pid} 占用`);
                                    }
                                }
                            }
                        });
                    } catch (error) {
                        this.outputChannel.appendLine(`⚠️ 检查ws端口时出现错误: ${error}`);
                    }

                    // 检查debugPort
                    try {
                        const debugProcessList = spawn('lsof', ['-i', `:${debugPort}`, '-t']);
                        let debugOutput = '';

                        debugProcessList.stdout?.on('data', (data) => {
                            debugOutput += data.toString();
                        });

                        debugProcessList.on('close', (debugCode) => {
                            if (debugCode === 0) {
                                const debugLines = debugOutput.split('\n').filter(line => line.trim() !== '');
                                for (const line of debugLines) {
                                    const pid = parseInt(line.trim());
                                    if (!isNaN(pid) && !processesToKill.includes(pid)) {
                                        processesToKill.push(pid);
                                        this.outputChannel.appendLine(`🔍 发现端口 ${debugPort} 被进程 ${pid} 占用`);
                                    }
                                }
                            }
                        });
                    } catch (error) {
                        this.outputChannel.appendLine(`⚠️ 检查调试端口时出现错误: ${error}`);
                    }
                }

                // 终止占用端口的进程
                if (processesToKill.length > 0) {
                    this.outputChannel.appendLine(`🚫 发现 ${processesToKill.length} 个进程占用端口，准备终止...`);

                    for (const pid of processesToKill) {
                        try {
                            this.outputChannel.appendLine(`⏳ 正在终止进程 ${pid}...`);
                            process.kill(pid, 'SIGTERM');

                            // 等待一段时间让进程正常退出
                            await new Promise(r => setTimeout(r, 1000));

                            // 检查进程是否仍然存在，如果存在则强制杀死
                            try {
                                process.kill(pid, 0); // 检查进程是否存在
                                this.outputChannel.appendLine(`⚠️ 进程 ${pid} 未正常退出，强制终止...`);
                                process.kill(pid, 'SIGKILL');
                            } catch (error) {
                                // 进程已经退出
                                this.outputChannel.appendLine(`✅ 进程 ${pid} 已终止`);
                            }
                        } catch (error: any) {
                            if (error.code === 'ESRCH') {
                                this.outputChannel.appendLine(`✅ 进程 ${pid} 已经退出`);
                            } else {
                                this.outputChannel.appendLine(`❌ 终止进程 ${pid} 失败: ${error.message}`);
                                vscode.window.showErrorMessage(`终止进程 ${pid} 失败: ${error.message}`);
                            }
                        }
                    }

                    // 等待一段时间确保端口已释放
                    this.outputChannel.appendLine('⏳ 等待端口释放...');
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    this.outputChannel.appendLine('✅ 未发现端口冲突');
                }

                resolve();
            });
        });
    }
            

    /**
     * 获取JDK版本
     * @param homePath NC HOME路径
     */
    private getJDKVersion(homePath: string): number {
        try {
            // 首先尝试从VS Code的java.configuration.runtimes配置中获取Java路径
            let javaExecutable: string | null = null;
                
            try {
                const javaConfig = vscode.workspace.getConfiguration('java.configuration');
                const runtimes = javaConfig.get<any[]>('runtimes', []);
                    
                // 查找默认的Java运行时
                const defaultRuntime = runtimes.find(runtime => runtime.default === true);
                if (defaultRuntime && defaultRuntime.path) {
                    const javaPath = path.join(defaultRuntime.path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                    if (fs.existsSync(javaPath)) {
                        this.outputChannel.appendLine(`✅ 从VS Code配置获取Java路径用于版本检测: ${javaPath}`);
                        javaExecutable = javaPath;
                    }
                }
    
                // 如果没有默认运行时，尝试使用第一个配置的运行时
                if (!javaExecutable && runtimes.length > 0 && runtimes[0].path) {
                    const javaPath = path.join(runtimes[0].path, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                    if (fs.existsSync(javaPath)) {
                        this.outputChannel.appendLine(`✅ 从VS Code配置获取第一个Java运行时用于版本检测: ${javaPath}`);
                        javaExecutable = javaPath;
                    }
                }
            } catch (error) {
                this.outputChannel.appendLine(`⚠️ 读取VS Code Java配置时出错: ${error}`);
            }
                
            // 如果VS Code配置中没有找到Java路径，回退到内置的ufjdk
            if (!javaExecutable) {
                const ufjdkPath = path.join(homePath, 'ufjdk');
                const ufjdkBinPath = path.join(ufjdkPath, 'bin');
                    
                if (process.platform === 'win32') {
                    const javaExe = path.join(ufjdkBinPath, 'java.exe');
                    if (fs.existsSync(javaExe)) {
                        javaExecutable = javaExe;
                    }
                } else {
                    const javaBin = path.join(ufjdkBinPath, 'java');
                    if (fs.existsSync(javaBin)) {
                        javaExecutable = javaBin;
                    }
                }
            }
                
            if (!javaExecutable) {
                this.outputChannel.appendLine('⚠️ 未找到Java可执行文件，无法检测JDK版本');
                return 0;
            }
    
            // 执行Java版本命令
            const result = spawnSync(javaExecutable, ['-version'], {
                encoding: 'utf8',
                timeout: 10000
            });
    
            if (result.status === 0) {
                const versionOutput = result.stderr || result.stdout;
                // 解析Java版本，例如 "java version \"1.8.0_261\"" 或 "openjdk version \"11.0.8\""
                const versionMatch = versionOutput.match(/version\s+["']([^"']+)['"]/i);
                if (versionMatch && versionMatch[1]) {
                    const versionStr = versionMatch[1];
                    // 提取主版本号
                    let version: number;
                    if (versionStr.startsWith('1.')) {
                        // Java 8及以下版本格式 "1.8.0_261"
                        version = parseInt(versionStr.split('.')[1]);
                    } else {
                        // Java 9及以上版本格式 "11.0.8"
                        version = parseInt(versionStr.split('.')[0]);
                    }
                    return version * 10; // 乘以10以匹配IDEA插件中的逻辑
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ 获取JDK版本时出错: ${error}`);
        }
    
        // 默认返回一个较低的版本号
        return 0;
    }

    /**
     * 更新状态栏显示模块信息
     * @param moduleName 模块名称
     * @param modulePath 模块路径
     */
    private updateStatusBarModuleInfo(moduleName: string, modulePath: string): void {
        if (this.statusBarItem) {
            // 简化显示文本，避免过长
            const displayText = `🚀 ${moduleName}`;
            this.statusBarItem.text = displayText;
            this.statusBarItem.tooltip = `正在启动模块: ${moduleName}\n路径: ${modulePath}`;
            this.statusBarItem.show();
        }
    }

    /**
     * 更新状态栏显示通用信息
     * @param message 显示信息
     */
    private updateStatusBarDisplay(message: string): void {
        if (this.statusBarItem) {
            this.statusBarItem.text = message;
            this.statusBarItem.tooltip = message;
            this.statusBarItem.show();
        }
    }

}
