import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';

/**
 * 表规则解析器
 * 用于解析resources/tables目录下的tablerule文件
 */
export class TableRuleParser {
    private resourcesPath: string;

    constructor(extensionPath: string) {
        this.resourcesPath = path.join(extensionPath, 'resources');
    }

    /**
     * 解析指定表的规则文件
     * @param tableName 表名
     * @returns 表结构信息
     */
    public async parseTableRule(tableName: string): Promise<TableStructure | null> {
        try {
            let tableRuleFilePath = '';
            
            // 首先尝试直接使用表名查找对应的XML文件
            const directPath = path.join(
                this.resourcesPath, 
                'tables', 
                'common', 
                'tablerule', 
                `${tableName}.xml`
            );
            
            if (fs.existsSync(directPath)) {
                tableRuleFilePath = directPath;
            } else {
                // 如果直接查找失败，尝试通过mapping.properties映射查找
                const mapping = this.getTableMapping();
                // 查找是否有表名映射到这个表名
                for (const [key, value] of Object.entries(mapping)) {
                    if (value === tableName) {
                        const mappedPath = path.join(
                            this.resourcesPath, 
                            'tables', 
                            'common', 
                            'tablerule', 
                            `${key}.xml`
                        );
                        if (fs.existsSync(mappedPath)) {
                            tableRuleFilePath = mappedPath;
                            break;
                        }
                    }
                }
            }

            // 如果还是没找到，尝试反向映射（表名映射到文件名）
            if (!tableRuleFilePath) {
                const mapping = this.getTableMapping();
                const mappedFileName = mapping[tableName];
                if (mappedFileName) {
                    const mappedPath = path.join(
                        this.resourcesPath, 
                        'tables', 
                        'common', 
                        'tablerule', 
                        `${mappedFileName}.xml`
                    );
                    if (fs.existsSync(mappedPath)) {
                        tableRuleFilePath = mappedPath;
                    }
                }
            }

            // 检查文件是否存在
            if (!tableRuleFilePath) {
                console.warn(`Table rule file not found for table: ${tableName}`);
                return null;
            }

            // 读取文件内容
            const xmlContent = fs.readFileSync(tableRuleFilePath, 'utf-8');
            
            // 解析XML
            const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
            const result = await parser.parseStringPromise(xmlContent);
            
            // 转换为TableStructure对象
            return this.convertToTableStructure(result.hierarchy);
        } catch (error) {
            console.error(`Error parsing table rule for ${tableName}:`, error);
            return null;
        }
    }

    /**
     * 获取表映射关系
     * @returns 表映射对象
     */
    public getTableMapping(): Record<string, string> {
        try {
            const mappingPath = path.join(this.resourcesPath, 'tables', 'common', 'mapping.properties');
            
            if (!fs.existsSync(mappingPath)) {
                return {};
            }

            const content = fs.readFileSync(mappingPath, 'utf-8');
            const lines = content.split('\n');
            const mapping: Record<string, string> = {};

            for (const line of lines) {
                const trimmedLine = line.trim();
                // 跳过注释行和空行
                if (trimmedLine.startsWith('#') || trimmedLine.length === 0) {
                    continue;
                }

                const [key, value] = trimmedLine.split('=');
                if (key && value) {
                    mapping[key.trim()] = value.trim();
                }
            }

            return mapping;
        } catch (error) {
            console.error('Error reading mapping.properties:', error);
            return {};
        }
    }

    /**
     * 根据解析的XML对象构建TableStructure
     * @param hierarchy XML解析后的hierarchy对象
     * @returns TableStructure对象
     */
    private convertToTableStructure(hierarchy: any): TableStructure {
        const tableStructure: TableStructure = {
            table: hierarchy.tableName,
            sqlNo: hierarchy.sqlNo,
            subTables: []
        };

        // 处理子表
        if (hierarchy.subTableGroup && hierarchy.subTableGroup.subTable) {
            const subTables = Array.isArray(hierarchy.subTableGroup.subTable) 
                ? hierarchy.subTableGroup.subTable 
                : [hierarchy.subTableGroup.subTable];
            
            tableStructure.subTables = subTables.map((subTable: any) => 
                this.convertSubTable(subTable)
            );
        }

        return tableStructure;
    }

    /**
     * 转换子表结构
     * @param subTable XML解析后的子表对象
     * @returns SubTableStructure对象
     */
    private convertSubTable(subTable: any): SubTableStructure {
        const subTableStructure: SubTableStructure = {
            table: subTable.tableName,
            foreignKeyColumn: subTable.foreignKeyColumn,
            sqlNo: subTable.sqlNo,
            subTables: []
        };

        // 递归处理子表的子表
        if (subTable.subTableGroup && subTable.subTableGroup.subTable) {
            const nestedSubTables = Array.isArray(subTable.subTableGroup.subTable) 
                ? subTable.subTableGroup.subTable 
                : [subTable.subTableGroup.subTable];
            
            subTableStructure.subTables = nestedSubTables.map((nestedSubTable: any) => 
                this.convertSubTable(nestedSubTable)
            );
        }

        return subTableStructure;
    }

    /**
     * 获取所有可用的表规则文件
     * @returns 表名列表
     */
    public getAvailableTableRules(): string[] {
        try {
            const tableruleDir = path.join(this.resourcesPath, 'tables', 'common', 'tablerule');
            
            if (!fs.existsSync(tableruleDir)) {
                return [];
            }

            const files = fs.readdirSync(tableruleDir);
            return files
                .filter(file => file.endsWith('.xml'))
                .map(file => path.basename(file, '.xml'));
        } catch (error) {
            console.error('Error reading table rules directory:', error);
            return [];
        }
    }

    /**
     * 根据tableruleFile.txt获取需要处理的表规则文件
     * @returns 表名列表
     */
    public getTableRulesFromList(): string[] {
        try {
            const tableruleListPath = path.join(this.resourcesPath, 'tables', 'tableruleFile.txt');
            
            if (!fs.existsSync(tableruleListPath)) {
                return [];
            }

            const content = fs.readFileSync(tableruleListPath, 'utf-8');
            return content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(filename => path.basename(filename, '.xml'));
        } catch (error) {
            console.error('Error reading tableruleFile.txt:', error);
            return [];
        }
    }

    /**
     * 获取需要排除时间戳的表列表
     * @returns 需要排除时间戳的表名列表
     */
    public getExcludeTimestampTables(): string[] {
        try {
            const excludeTimestampPath = path.join(this.resourcesPath, 'tables', 'excludeTimestamp.txt');
            
            if (!fs.existsSync(excludeTimestampPath)) {
                return [];
            }

            const content = fs.readFileSync(excludeTimestampPath, 'utf-8');
            return content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
        } catch (error) {
            console.error('Error reading excludeTimestamp.txt:', error);
            return [];
        }
    }
}

/**
 * 表结构定义
 */
export interface TableStructure {
    /** 主表名 */
    table: string;
    /** SQL编号 */
    sqlNo: string;
    /** 子表列表 */
    subTables: SubTableStructure[];
}

/**
 * 子表结构定义
 */
export interface SubTableStructure {
    /** 子表名 */
    table: string;
    /** 外键列名 */
    foreignKeyColumn: string;
    /** SQL编号 */
    sqlNo: string;
    /** 嵌套子表列表 */
    subTables: SubTableStructure[];
}