const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');

function timestamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

async function parseItems(filePath) {
  const buf = fs.readFileSync(filePath);
  let text = buf.toString('utf-8');
  if (/encoding\s*=\s*['"]gb2312['"]|encoding\s*=\s*['"]gbk['"]/i.test(text)) {
    text = iconv.decode(buf, 'gb2312');
  }
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false, trim: true });
  const obj = await parser.parseStringPromise(text);
  const itemsNode = obj?.items;
  const docType = itemsNode?.$?.docType || itemsNode?.docType;
  let rawItems = [];
  if ((docType || '').toString().toUpperCase() === 'SDP_SCRIPT_ITEM') {
     const it = itemsNode?.item;
     if (Array.isArray(it)) rawItems = it; else if (it) rawItems = [it];
  }
  if (rawItems.length === 0) {
     const candidates = [];
     const tryPush = arr => { if (!arr) return; if (Array.isArray(arr)) candidates.push(...arr); else candidates.push(arr); };
     tryPush(obj?.InitDataCfgs?.item);
     tryPush(obj?.InitDataCfgs?.InitDataCfg);
     tryPush(obj?.items?.item);
     tryPush(obj?.InitDataCfgs?.items?.item);
     tryPush(obj?.root?.items?.item);
     rawItems = candidates;
  }
  const mapped = rawItems.map(it => {
     const tableName = it?.itemRule || it?.tableName || it?.table || it?.TableName;
     const where = it?.fixedWhere || it?.whereCondition || it?.where || it?.WhereCondition;
     const itemKey = it?.itemKey || it?.ItemKey;
     return { itemKey, tableName, whereCondition: typeof where === 'string' ? where.trim() : undefined };
  }).filter(x => !!x.tableName);
  return mapped;
}

async function main() {
  const xmlPath = process.argv[2] || path.resolve(__dirname, '../resources/item.xml');
  const outputDir = process.argv[3] || path.resolve(__dirname, '..');
  if (!fs.existsSync(xmlPath)) {
    console.error('XML file not found:', xmlPath);
    process.exit(1);
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const items = await parseItems(xmlPath);
  let sql = `-- 预置脚本导出\n-- 来源: ${path.basename(xmlPath)}\n\n`;
  for (const it of items) {
    const table = it.tableName;
    const where = it.whereCondition;
    if (!table) continue;
    if (where) {
      sql += `-- 删除 ${table}\nDELETE FROM ${table} WHERE ${where};\n\n`;
    } else {
      sql += `-- 删除 ${table}（无 where 条件，跳过）\n\n`;
    }
    sql += `-- 查询 ${table}\nSELECT * FROM ${table}${where ? ' WHERE ' + where : ''};\n\n`;
    sql += `-- 插入 ${table}（需数据库查询生成；VSCode扩展内将自动生成）\n\n`;
  }
  const fileName = `allsql_${timestamp()}.sql`;
  const outPath = path.join(outputDir, fileName);
  fs.writeFileSync(outPath, sql, 'utf-8');
  console.log('SQL written to:', outPath);
}

main().catch(err => { console.error(err); process.exit(1); });