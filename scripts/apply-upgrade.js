/**
 * 数据库升级脚本执行器
 * 使用 Prisma 执行 SQL 升级脚本
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function executeSqlFile(sqlFilePath) {
  const sql = fs.readFileSync(sqlFilePath, 'utf-8');
  
  // 按分号分割 SQL 语句（排除注释中的分号）
  const statements = sql
    .split('\n')
    .filter(line => !line.startsWith('--') && line.trim() !== '')
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`Found ${statements.length} SQL statements to execute`);

  let successCount = 0;
  let errorCount = 0;

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
      successCount++;
      
      // 提取表名或索引名用于日志
      const tableMatch = statement.match(/CREATE TABLE IF NOT EXISTS "(\w+)"/);
      const indexMatch = statement.match(/CREATE INDEX IF NOT EXISTS "(\w+)"/);
      const insertMatch = statement.match(/INSERT OR IGNORE INTO "(\w+)"/);
      
      if (tableMatch) {
        console.log(`✓ Created table: ${tableMatch[1]}`);
      } else if (indexMatch) {
        console.log(`✓ Created index: ${indexMatch[1]}`);
      } else if (insertMatch) {
        console.log(`✓ Inserted data into: ${insertMatch[1]}`);
      }
    } catch (error) {
      errorCount++;
      
      // 检查是否是因为表/索引已存在（这不是真正的错误）
      if (error.message.includes('already exists')) {
        console.log(`○ Skipped (already exists): ${statement.substring(0, 50)}...`);
      } else {
        console.error(`✗ Error executing: ${statement.substring(0, 80)}...`);
        console.error(`  Message: ${error.message}`);
      }
    }
  }

  console.log(`\nExecution complete: ${successCount} successful, ${errorCount} errors/skipped`);
}

async function verifyUpgrade() {
  console.log('\n=== Verifying Upgrade ===');
  
  // 检查新表是否存在
  const tablesToCheck = [
    'SkillGovernanceConfig',
    'SkillMergeRecord',
    'SkillNewImpactAnalysis',
    'SkillObservationLog',
    'SkillObservationStats',
    'AgentDefinition',
    'AgentTeam',
    'AgentTeamExecution',
    'AgentTeamMember',
    'AgentMemberExecution',
    'SkillPredictionTask'
  ];

  for (const tableName of tablesToCheck) {
    try {
      const result = await prisma.$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`
      );
      if (result.length > 0) {
        console.log(`✓ Table exists: ${tableName}`);
      } else {
        console.log(`✗ Table missing: ${tableName}`);
      }
    } catch (e) {
      console.log(`? Error checking table ${tableName}: ${e.message}`);
    }
  }

  // 检查旧数据是否保留
  const skillCount = await prisma.skill.count();
  const userCount = await prisma.user.count();
  console.log(`\nExisting data: Skills=${skillCount}, Users=${userCount}`);
}

async function main() {
  console.log('=== Database Upgrade Script ===');
  console.log('Target database: prisma/dev.db');
  
  const sqlPath = path.join(__dirname, 'db-upgrade.sql');
  console.log(`SQL file: ${sqlPath}`);
  
  if (!fs.existsSync(sqlPath)) {
    console.error('SQL file not found!');
    process.exit(1);
  }

  await executeSqlFile(sqlPath);
  await verifyUpgrade();
  
  await prisma.$disconnect();
  console.log('\nUpgrade complete!');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});