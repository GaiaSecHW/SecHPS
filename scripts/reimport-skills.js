/**
 * 重新导入 Skills 数据
 * 使用 better-sqlite3 直接操作，避免 Prisma Client 类型问题
 */

const Database = require('better-sqlite3');

const PROD_DB = '/home/web/data/dev3.db';
const DEV_DB = './prisma/dev.db';

console.log('=== 重新导入 Skills 数据 ===\n');

const prodDb = new Database(PROD_DB);
const devDb = new Database(DEV_DB);

// 获取表的列名
function getColumns(db, tableName) {
  const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all();
  return cols.map(c => c.name);
}

// 主流程
const devCols = getColumns(devDb, 'Skill');
const prodCols = getColumns(prodDb, 'Skill');

console.log('开发库 Skill 字段数:', devCols.length);
console.log('生产库 Skill 字段数:', prodCols.length);

// 添加缺失字段
const missingCols = devCols.filter(c => !prodCols.includes(c));
if (missingCols.length > 0) {
  console.log('\n添加缺失字段:', missingCols.join(', '));
  for (const col of missingCols) {
    try {
      prodDb.exec(`ALTER TABLE "Skill" ADD COLUMN "${col}" TEXT`);
      console.log(`  + ${col}`);
    } catch (e) {
      console.log(`  ! ${col}: ${e.message}`);
    }
  }
}

// 获取更新后的列名
const updatedProdCols = getColumns(prodDb, 'Skill');
console.log('\n生产库更新后字段数:', updatedProdCols.length);

// 清空相关表
console.log('\n清空 Skill 相关表...');
const tablesToClear = [
  'SkillVulnerabilityMapping', 'SkillObservationStats', 'SkillObservationLog',
  'SkillNewImpactAnalysis', 'SkillDuplicateGroupMember', 'SkillDuplicateGroup',
  'SkillAnalysis', 'SkillMergeRecord', 'SkillEvolution', 'SkillExecution', 'Skill'
];

for (const table of tablesToClear) {
  try {
    prodDb.exec(`DELETE FROM "${table}"`);
    console.log(`  ✓ ${table}`);
  } catch (e) {}
}

// 从开发库读取所有 Skill
console.log('\n导入 Skill 数据...');
const devSkills = devDb.prepare('SELECT * FROM Skill').all();
console.log('开发库 Skill 数量:', devSkills.length);

let imported = 0;
let failed = 0;

// 获取生产库字段的 NOT NULL 信息
const prodColInfo = prodDb.prepare(`PRAGMA table_info("Skill")`).all();
const prodColMap = new Map(prodColInfo.map(c => [c.name, c]));

for (const skill of devSkills) {
  try {
    // 只插入生产库中存在的字段
    const fields = [];
    const values = [];
    
    for (const col of updatedProdCols) {
      const colInfo = prodColMap.get(col);
      const val = skill[col];
      
      // 处理值
      if (val !== null && val !== undefined) {
        fields.push(col);
        if (typeof val === 'number') {
          values.push(val);
        } else if (typeof val === 'boolean' || val === 'true' || val === 'false') {
          values.push(val === true || val === 'true' ? 1 : 0);
        } else {
          values.push(`'${String(val).replace(/'/g, "''")}'`);
        }
      } else if (colInfo && colInfo.notnull) {
        // NOT NULL 字段必须有值，提供默认值
        fields.push(col);
        if (colInfo.type.includes('TEXT')) {
          values.push(`''`);
        } else if (colInfo.type.includes('INT')) {
          values.push('0');
        } else if (colInfo.type.includes('BOOL')) {
          values.push('0');
        } else if (colInfo.type.includes('REAL')) {
          values.push('0');
        } else {
          values.push(`''`);
        }
      }
      // 如果是 NULL 且允许 NULL，则跳过（不插入该字段）
    }
    
    const sql = `INSERT INTO Skill (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${values.join(', ')})`;
    prodDb.exec(sql);
    imported++;
  } catch (e) {
    failed++;
    if (failed <= 5) {
      console.log(`  ! ${skill.name || skill.id}: ${e.message}`);
    }
  }
}

console.log(`\n导入结果: 成功 ${imported}, 失败 ${failed}`);

// 验证
const count = prodDb.prepare('SELECT COUNT(*) as count FROM Skill').get();
console.log('\n生产库 Skill 数量:', count.count);

prodDb.close();
devDb.close();

console.log('\n✓ 完成');
