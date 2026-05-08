/**
 * SQLite → PostgreSQL 数据迁移脚本
 *
 * 从 backup_pre_migration.db 读取数据，写入 PG
 * - 自动匹配当前 Prisma schema 的字段（忽略已删除/新增的列）
 * - 自动处理 SQLite int→PG bool 类型转换
 * - 自动处理 SQLite timestamp(ms) → PG DateTime
 * - 按外键依赖顺序插入
 * - 使用 PG session_replication_role 绕过 FK 检查，避免顺序问题
 *
 * 前置条件: PG 数据库为空（已 prisma migrate reset）
 * 用法: npx tsx db/migrate-sqlite-to-pg.ts
 */

import Database from 'better-sqlite3';
import { PrismaClient, Prisma } from '@prisma/client';

const SQLITE_PATH = './prisma/backup_pre_migration.db';

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pg = new PrismaClient();

// Prisma DMMF — 获取每个 model 的字段定义
const dmmf = Prisma.dmmf;
const modelFields = new Map<string, Set<string>>();
const boolFieldsMap = new Map<string, Set<string>>();
const dateFieldsMap = new Map<string, Set<string>>();

for (const model of dmmf.datamodel.models) {
  const fields = new Set<string>();
  const boolFields = new Set<string>();
  const dateFields = new Set<string>();

  for (const field of model.fields) {
    if (field.kind === 'scalar') {
      fields.add(field.name);
      if (field.type === 'Boolean') boolFields.add(field.name);
      if (field.type === 'DateTime') dateFields.add(field.name);
    }
  }

  modelFields.set(model.name, fields);
  boolFieldsMap.set(model.name, boolFields);
  dateFieldsMap.set(model.name, dateFields);
}

// 迁移表配置: [SQLite表名, Prisma model名, Prisma accessor名]
const TABLES: [string, string, string][] = [
  // 层0: 无外键依赖
  ['OpencodeConfig', 'OpencodeConfig', 'opencodeConfig'],
  ['SystemConfig', 'SystemConfig', 'systemConfig'],
  ['TechStackOption', 'TechStackOption', 'techStackOption'],
  ['SkillGovernanceConfig', 'SkillGovernanceConfig', 'skillGovernanceConfig'],
  ['LogFileRecord', 'LogFileRecord', 'logFileRecord'],
  ['AutonomousEvolutionRunLog', 'AutonomousEvolutionRunLog', 'autonomousEvolutionRunLog'],
  ['VulnerabilityPattern', 'VulnerabilityPattern', 'vulnerabilityPattern'],
  ['Plugin', 'Plugin', 'plugin'],
  ['ExpectedOutputTemplate', 'ExpectedOutputTemplate', 'expectedOutputTemplate'],

  // 层1: 角色、权限
  ['Role', 'Role', 'role'],
  ['Permission', 'Permission', 'permission'],

  // 层2: 用户
  ['User', 'User', 'user'],

  // 层3: 用户角色关联
  ['UserRole', 'UserRole', 'userRole'],

  // 层4: 配置
  ['ModelConfig', 'ModelConfig', 'modelConfig'],
  ['AgentDefinition', 'AgentDefinition', 'agentDefinition'],

  // 层5: 项目、工作流
  ['Project', 'Project', 'project'],
  ['McpServerConfig', 'McpServerConfig', 'mcpServerConfig'],
  ['Workflow', 'Workflow', 'workflow'],
  ['AgentTeam', 'AgentTeam', 'agentTeam'],

  // 层6: 工作流节点
  ['WorkflowRole', 'WorkflowRole', 'workflowRole'],
  ['WorkflowNode', 'WorkflowNode', 'workflowNode'],
  ['WorkflowEdge', 'WorkflowEdge', 'workflowEdge'],
  ['EvaluationSession', 'EvaluationSession', 'evaluationSession'],
  ['AgentTeamMember', 'AgentTeamMember', 'agentTeamMember'],

  // 层7: 子表
  ['NodeExecution', 'NodeExecution', 'nodeExecution'],
  ['EvaluationIteration', 'EvaluationIteration', 'evaluationIteration'],
  ['EvaluationResult', 'EvaluationResult', 'evaluationResult'],
  ['SessionMessage', 'SessionMessage', 'sessionMessage'],
  ['Vulnerability', 'Vulnerability', 'vulnerability'],

  // 层8: Skill 相关
  ['Skill', 'Skill', 'skill'],
  ['SkillAnalysis', 'SkillAnalysis', 'skillAnalysis'],
  ['SkillObservationStats', 'SkillObservationStats', 'skillObservationStats'],
  ['SkillPrediction', 'SkillPrediction', 'skillPrediction'],
  ['SkillPredictionTask', 'SkillPredictionTask', 'skillPredictionTask'],

  // 层9: 日志
  ['ExperienceUsageLog', 'ExperienceUsageLog', 'experienceUsageLog'],
  ['AuditLog', 'AuditLog', 'auditLog'],
  ['TokenUsage', 'TokenUsage', 'tokenUsage'],
  ['ProjectFile', 'ProjectFile', 'projectFile'],
];

function getRows(tableName: string): any[] {
  try {
    return sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
  } catch {
    return [];
  }
}

function transformRow(modelName: string, row: any): any {
  const validFields = modelFields.get(modelName);
  if (!validFields) return null;

  const boolFields = boolFieldsMap.get(modelName) || new Set();
  const dateFields = dateFieldsMap.get(modelName) || new Set();

  const result: any = {};

  for (const [key, value] of Object.entries(row)) {
    if (!validFields.has(key)) continue;

    if (value === null || value === undefined) {
      result[key] = null;
    } else if (boolFields.has(key)) {
      result[key] = Boolean(value);
    } else if (dateFields.has(key)) {
      result[key] = typeof value === 'number' ? new Date(value) : new Date(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

async function migrateTable(tableName: string, modelName: string, accessor: string) {
  const rows = getRows(tableName);
  if (rows.length === 0) {
    console.log(`  ⏭️  ${tableName}: 0 rows`);
    return;
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const data = transformRow(modelName, row);
    if (!data || !data.id) {
      skipped++;
      continue;
    }

    try {
      // @ts-ignore — dynamic model access
      await pg[accessor].create({ data });
      created++;
    } catch (e: any) {
      if (e.code === 'P2002') {
        skipped++;
      } else {
        failed++;
        if (failed <= 2) {
          console.error(`  ❌ ${tableName}[${data.id}]: ${e.message?.substring(0, 300)}`);
        }
      }
    }
  }

  const status = failed > 0 ? '⚠️' : '✅';
  console.log(`  ${status} ${tableName}: ${created} created, ${skipped} skipped, ${failed} failed`);
}

async function migrateRelationTable(sqliteTable: string, columns: string[]) {
  const rows = getRows(sqliteTable);
  if (rows.length === 0) {
    console.log(`  ⏭️  ${sqliteTable}: 0 rows`);
    return;
  }

  // _PermissionToRole: A=permissionId, B=roleId
  let created = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Use raw SQL for implicit many-to-many relation table
      await pg.$executeRawUnsafe(
        `INSERT INTO "_PermissionToRole" ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        row.A,
        row.B
      );
      created++;
    } catch (e: any) {
      failed++;
      if (failed <= 2) {
        console.error(`  ❌ ${sqliteTable}: ${e.message?.substring(0, 200)}`);
      }
    }
  }

  console.log(`  ✅ ${sqliteTable}: ${created} created, ${failed} failed`);
}

async function migrate() {
  console.log('🚀 开始 SQLite → PG 数据迁移...\n');
  console.log('📋 前置: 禁用 FK 检查...\n');

  // 临时禁用 FK 检查以允许无序插入
  await pg.$executeRawUnsafe(`SET session_replication_role = 'replica'`);

  for (const [tableName, modelName, accessor] of TABLES) {
    await migrateTable(tableName, modelName, accessor);
  }

  // 迁移 _PermissionToRole 关联表
  console.log('\n📦 关联表');
  await migrateRelationTable('_PermissionToRole', ['A', 'B']);

  // 恢复 FK 检查
  await pg.$executeRawUnsafe(`SET session_replication_role = 'DEFAULT'`);

  console.log('\n🎉 迁移完成！');
}

migrate()
  .catch((e) => {
    console.error('❌ 迁移失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    sqlite.close();
    await pg.$disconnect();
  });
