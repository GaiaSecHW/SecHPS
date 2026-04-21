/**
 * 完整表结构同步脚本 v2
 * 使用 better-sqlite3 直接操作数据库
 */

const Database = require('better-sqlite3');
const path = require('path');

const PROD_DB = '/home/web/data/dev3.db';
const DEV_DB = './prisma/dev.db';

console.log('================================================');
console.log('完整表结构同步 v2');
console.log('================================================\n');

// 打开数据库
const prodDb = new Database(PROD_DB);
const devDb = new Database(DEV_DB);

// 获取所有表
function getTables(db) {
  return db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_migrations'
    ORDER BY name
  `).all().map(r => r.name);
}

// 获取表结构
function getTableInfo(db, tableName) {
  return db.prepare(`PRAGMA table_info("${tableName}")`).all();
}

// 获取建表语句
function getCreateSql(db, tableName) {
  const result = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`).get();
  return result?.sql;
}

// 主流程
const devTables = getTables(devDb);
const prodTables = getTables(prodDb);

console.log('开发库表数量:', devTables.length);
console.log('生产库表数量:', prodTables.length);

// 1. 找出缺失的表并创建
const missingTables = devTables.filter(t => !prodTables.includes(t));
console.log('\n缺失的表:', missingTables.length > 0 ? missingTables.join(', ') : '无');

if (missingTables.length > 0) {
  console.log('\n创建缺失的表...');
  for (const table of missingTables) {
    try {
      const createSql = getCreateSql(devDb, table);
      if (createSql) {
        prodDb.exec(createSql);
        console.log(`  + ${table}`);
      }
    } catch (e) {
      console.log(`  ! ${table}: ${e.message}`);
    }
  }
}

// 2. 检查每个表的字段差异
console.log('\n检查字段差异...');

const commonTables = devTables.filter(t => prodTables.includes(t));

for (const table of commonTables) {
  const devCols = getTableInfo(devDb, table);
  const prodCols = getTableInfo(prodDb, table);
  const prodColNames = prodCols.map(c => c.name);
  
  const missingCols = devCols.filter(c => !prodColNames.includes(c.name));
  
  if (missingCols.length > 0) {
    console.log(`\n${table} 缺失字段:`);
    for (const col of missingCols) {
      // 构建字段定义
      let def = col.type;
      if (col.notnull) {
        def += ' NOT NULL';
        if (col.dflt_value) {
          def += ` DEFAULT ${col.dflt_value}`;
        } else if (col.type.includes('TEXT')) {
          def += ` DEFAULT ''`;
        } else if (col.type.includes('INT')) {
          def += ` DEFAULT 0`;
        } else if (col.type.includes('BOOL')) {
          def += ` DEFAULT 0`;
        } else if (col.type.includes('REAL')) {
          def += ` DEFAULT 0`;
        }
      }
      
      try {
        prodDb.exec(`ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${def}`);
        console.log(`  + ${col.name} (${col.type})`);
      } catch (e) {
        console.log(`  ! ${col.name}: ${e.message}`);
      }
    }
  }
}

// 验证
console.log('\n================================================');
console.log('验证结果');
console.log('================================================');

const finalProdTables = getTables(prodDb);
const stillMissing = devTables.filter(t => !finalProdTables.includes(t));

console.log(`开发库表: ${devTables.length}`);
console.log(`生产库表: ${finalProdTables.length}`);

if (stillMissing.length > 0) {
  console.log(`仍然缺失的表: ${stillMissing.join(', ')}`);
} else {
  console.log('✓ 表结构已完全同步');
}

prodDb.close();
devDb.close();

console.log('\n完成');
