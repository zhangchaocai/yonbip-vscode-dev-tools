const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');

async function parse(filePath) {
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

(async () => {
   const filePath = process.argv[2] || path.resolve(__dirname, '../resources/item.xml');
   const items = await parse(filePath);
   console.log('File:', filePath);
   console.log('Items parsed:', items.length);
   console.log('First 5 items:', items.slice(0, 5));
   // Sample SQL preview for first 3 entries:
   items.slice(0,3).forEach(it => {
      const table = it.tableName;
      const where = it.whereCondition;
      if (table) {
        if (where) console.log(`DELETE FROM ${table} WHERE ${where};`);
        else console.log(`-- No where for ${table}`);
        console.log(`SELECT * FROM ${table}${where ? ' WHERE ' + where : ''};`);
      }
   });
})();