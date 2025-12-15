"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TableRuleParser = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const xml2js = __importStar(require("xml2js"));
class TableRuleParser {
    resourcesPath;
    constructor(extensionPath) {
        this.resourcesPath = path.join(extensionPath, 'resources');
    }
    async parseTableRule(tableName) {
        try {
            let tableRuleFilePath = '';
            const directPath = path.join(this.resourcesPath, 'tables', 'common', 'tablerule', `${tableName}.xml`);
            if (fs.existsSync(directPath)) {
                tableRuleFilePath = directPath;
            }
            else {
                const mapping = this.getTableMapping();
                for (const [key, value] of Object.entries(mapping)) {
                    if (value === tableName) {
                        const mappedPath = path.join(this.resourcesPath, 'tables', 'common', 'tablerule', `${key}.xml`);
                        if (fs.existsSync(mappedPath)) {
                            tableRuleFilePath = mappedPath;
                            break;
                        }
                    }
                }
            }
            if (!tableRuleFilePath) {
                const mapping = this.getTableMapping();
                const mappedFileName = mapping[tableName];
                if (mappedFileName) {
                    const mappedPath = path.join(this.resourcesPath, 'tables', 'common', 'tablerule', `${mappedFileName}.xml`);
                    if (fs.existsSync(mappedPath)) {
                        tableRuleFilePath = mappedPath;
                    }
                }
            }
            if (!tableRuleFilePath) {
                console.warn(`Table rule file not found for table: ${tableName}`);
                return null;
            }
            const xmlContent = fs.readFileSync(tableRuleFilePath, 'utf-8');
            const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
            const result = await parser.parseStringPromise(xmlContent);
            return this.convertToTableStructure(result.hierarchy);
        }
        catch (error) {
            console.error(`Error parsing table rule for ${tableName}:`, error);
            return null;
        }
    }
    getTableMapping() {
        try {
            const mappingPath = path.join(this.resourcesPath, 'tables', 'common', 'mapping.properties');
            if (!fs.existsSync(mappingPath)) {
                return {};
            }
            const content = fs.readFileSync(mappingPath, 'utf-8');
            const lines = content.split('\n');
            const mapping = {};
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('#') || trimmedLine.length === 0) {
                    continue;
                }
                const [key, value] = trimmedLine.split('=');
                if (key && value) {
                    mapping[key.trim()] = value.trim();
                }
            }
            return mapping;
        }
        catch (error) {
            console.error('Error reading mapping.properties:', error);
            return {};
        }
    }
    convertToTableStructure(hierarchy) {
        const tableStructure = {
            table: hierarchy.tableName,
            sqlNo: hierarchy.sqlNo,
            primaryKey: hierarchy.pk || '',
            subTables: []
        };
        if (hierarchy.subTableGroup && hierarchy.subTableGroup.subTable) {
            const subTables = Array.isArray(hierarchy.subTableGroup.subTable)
                ? hierarchy.subTableGroup.subTable
                : [hierarchy.subTableGroup.subTable];
            tableStructure.subTables = subTables.map((subTable) => this.convertSubTable(subTable));
        }
        return tableStructure;
    }
    convertSubTable(subTable) {
        const subTableStructure = {
            table: subTable.tableName,
            foreignKeyColumn: subTable.foreignKeyColumn,
            sqlNo: subTable.sqlNo,
            subTables: []
        };
        if (subTable.subTableGroup && subTable.subTableGroup.subTable) {
            const nestedSubTables = Array.isArray(subTable.subTableGroup.subTable)
                ? subTable.subTableGroup.subTable
                : [subTable.subTableGroup.subTable];
            subTableStructure.subTables = nestedSubTables.map((nestedSubTable) => this.convertSubTable(nestedSubTable));
        }
        return subTableStructure;
    }
    getAvailableTableRules() {
        try {
            const tableruleDir = path.join(this.resourcesPath, 'tables', 'common', 'tablerule');
            if (!fs.existsSync(tableruleDir)) {
                return [];
            }
            const files = fs.readdirSync(tableruleDir);
            return files
                .filter(file => file.endsWith('.xml'))
                .map(file => path.basename(file, '.xml'));
        }
        catch (error) {
            console.error('Error reading table rules directory:', error);
            return [];
        }
    }
    getTableRulesFromList() {
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
        }
        catch (error) {
            console.error('Error reading tableruleFile.txt:', error);
            return [];
        }
    }
    getExcludeTimestampTables() {
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
        }
        catch (error) {
            console.error('Error reading excludeTimestamp.txt:', error);
            return [];
        }
    }
}
exports.TableRuleParser = TableRuleParser;
//# sourceMappingURL=TableRuleParser.js.map