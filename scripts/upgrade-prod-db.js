/**
 * 生产环境数据库升级脚本 v4
 * 
 * 核心策略：使用原始 SQL 进行所有表结构修改，避免 Prisma Client 与旧数据库不兼容的问题
 * 
 * 使用方法：
 * 1. 停止生产服务
 * 2. 备份: copy e:\dev.db e:\dev.db.manual.backup
 * 3. 执行: node scripts/upgrade-prod-db.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

// 生产数据库路径
const PROD_DB_PATH = 'e:\\dev.db';
const PROD_DB_BACKUP_PATH = 'e:\\dev.db.backup';

// 使用生产数据库
const prisma = new PrismaClient({
  datasources: {
    db: { url: `file:${PROD_DB_PATH}` }
  }
});

// 开发数据库
const devPrisma = new PrismaClient({
  datasources: {
    db: { url: `file:./prisma/dev.db` }
  }
});

// ============================================
// 辅助函数
// ============================================

async function getExistingTables(prisma) {
  const tables = await prisma.$queryRaw`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    AND name NOT LIKE 'sqlite_%' 
    AND name NOT LIKE '_prisma_migrations'
    ORDER BY name
  `;
  return tables.map(t => t.name);
}

async function getTableColumns(prisma, tableName) {
  try {
    const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`);
    return columns.map(c => c.name);
  } catch (e) {
    return [];
  }
}

async function addColumnIfMissing(prisma, tableName, columnName, columnDef) {
  const columns = await getTableColumns(prisma, tableName);
  if (!columns.includes(columnName)) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDef}`);
      console.log(`    + ${tableName}.${columnName}`);
      return true;
    } catch (e) {
      console.log(`    ! 失败 ${tableName}.${columnName}: ${e.message}`);
      return false;
    }
  }
  return true; // 已存在
}

async function rawQuery(prisma, sql) {
  try {
    return await prisma.$queryRawUnsafe(sql);
  } catch (e) {
    return [];
  }
}

async function rawExecute(prisma, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
    return true;
  } catch (e) {
    return false;
  }
}

function escapeSql(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/'/g, "''");
}

// ============================================
// 表结构定义 - 所有需要检查的字段
// ============================================

const SCHEMA_FIELDS = {
  // 项目相关
  Project: [
    ['isPublic', 'BOOLEAN NOT NULL DEFAULT 0'],
    ['displayName', 'TEXT'],
    ['fullPath', 'TEXT'],
    ['techStack', 'TEXT'],
  ],
  ProjectFile: [],
  ProjectStructure: [],
  
  // 模型配置
  ModelConfig: [
    ['userId', 'TEXT'],
    ['isPublic', 'BOOLEAN NOT NULL DEFAULT 0'],
    ['routeType', 'TEXT'],
  ],
  
  // MCP服务器
  McpServerConfig: [
    ['projectId', 'TEXT'],
    ['isShared', 'BOOLEAN NOT NULL DEFAULT 0'],
    ['autoStart', 'BOOLEAN NOT NULL DEFAULT 0'],
  ],
  
  // 技能
  Skill: [
    ['userId', 'TEXT'],
    ['isPublic', 'BOOLEAN NOT NULL DEFAULT 0'],
    ['techStackId', 'TEXT'],
    ['vulnerabilityPatternId', 'TEXT'],
    ['parentId', 'TEXT'],
    ['isLatest', 'BOOLEAN NOT NULL DEFAULT 1'],
    ['successRate', 'REAL'],
    ['avgDuration', 'INTEGER'],
    ['execCount', 'INTEGER NOT NULL DEFAULT 0'],
    ['referenceCount', 'INTEGER NOT NULL DEFAULT 0'],
    ['vulnerabilityCount', 'INTEGER NOT NULL DEFAULT 0'],
    ['successExecCount', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  
  // 评估会话
  EvaluationSession: [
    ['agentTeamId', 'TEXT'],
    ['roleModels', 'TEXT'],
    ['skillsUsed', 'TEXT'],
    ['endReason', 'TEXT'],
    ['endMessage', 'TEXT'],
    ['providerType', 'TEXT'],
    ['todoList', 'TEXT'],
    ['totalInputTokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['totalOutputTokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['totalTokens', 'INTEGER NOT NULL DEFAULT 0'],
    ['estimatedCost', 'REAL'],
  ],
  
  // 评估迭代
  EvaluationIteration: [
    ['modelConfigId', 'TEXT'],
    ['modelName', 'TEXT'],
    ['roleId', 'TEXT'],
    ['toolCallCount', 'INTEGER NOT NULL DEFAULT 0'],
    ['verificationComplete', 'BOOLEAN'],
    ['verificationReason', 'TEXT'],
  ],
  
  // 节点执行
  NodeExecution: [
    ['modelConfigId', 'TEXT'],
    ['modelName', 'TEXT'],
    ['roleId', 'TEXT'],
  ],
  
  // Token使用
  TokenUsage: [
    ['userId', 'TEXT'],
    ['username', 'TEXT'],
    ['evaluationId', 'TEXT'],
    ['projectId', 'TEXT'],
    ['modelName', 'TEXT'],
    ['cachedTokens', 'INTEGER'],
    ['requestPreview', 'TEXT'],
    ['responsePreview', 'TEXT'],
    ['requestStartedAt', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['requestCompletedAt', 'DATETIME'],
    ['durationMs', 'INTEGER'],
    ['estimatedCost', 'REAL'],
    ['status', 'TEXT DEFAULT \'success\''],
    ['errorMessage', 'TEXT'],
  ],
  
  // 漏洞
  Vulnerability: [
    ['evaluationId', 'TEXT'],
    ['skillExecutionId', 'TEXT'],
    ['cwe', 'TEXT'],
    ['skill', 'TEXT'],
    ['codeSnippet', 'TEXT'],
    ['details', 'TEXT'],
    ['aiAnalysis', 'TEXT'],
    ['fixSuggestion', 'TEXT'],
    ['confirmedBy', 'TEXT'],
    ['confirmedAt', 'DATETIME'],
    ['fixedBy', 'TEXT'],
    ['fixedAt', 'DATETIME'],
    ['verifiedBy', 'TEXT'],
    ['verifiedAt', 'DATETIME'],
    ['notes', 'TEXT'],
  ],
  
  // 工作流
  Workflow: [
    ['thumbnail', 'TEXT'],
    ['techStack', 'TEXT'],
    ['version', 'INTEGER NOT NULL DEFAULT 1'],
    ['isActive', 'BOOLEAN NOT NULL DEFAULT 0'],
    ['isPublic', 'BOOLEAN NOT NULL DEFAULT 0'],
  ],
  
  // 工作流节点
  WorkflowNode: [
    ['roleId', 'TEXT'],
    ['vulnerabilityCategories', 'TEXT'],
    ['skills', 'TEXT'],
  ],
  
  // 技能执行
  SkillExecution: [
    ['evaluationId', 'TEXT'],
    ['inputTokens', 'INTEGER'],
    ['outputTokens', 'INTEGER'],
  ],
  
  // 扫描任务
  ScanTask: [
    ['skillIds', 'TEXT'],
    ['nextRunAt', 'DATETIME'],
    ['currentSkill', 'TEXT'],
    ['totalSkills', 'INTEGER NOT NULL DEFAULT 0'],
    ['completedSkills', 'INTEGER NOT NULL DEFAULT 0'],
    ['findingsCount', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  
  // OpenCode配置
  OpencodeConfig: [
    ['projectUploadDir', 'TEXT'],
    ['taskDescription', 'TEXT'],
    ['workflowConfig', 'TEXT'],
    ['customSystemPrompt', 'TEXT'],
    ['claudemdPath', 'TEXT'],
    ['resumeSession', 'BOOLEAN NOT NULL DEFAULT 0'],
    ['permissionMode', 'TEXT'],
    ['settingSources', 'TEXT'],
    ['progressQuestion', 'TEXT'],
    ['skillOutputTemplate', 'TEXT'],
    ['claudemdTemplate', 'TEXT'],
    ['maxConcurrentEvaluations', 'INTEGER NOT NULL DEFAULT 3'],
    ['defaultToolPermissions', 'TEXT'],
  ],
};

// ============================================
// 主流程
// ============================================

async function main() {
  console.log('================================================');
  console.log('生产环境数据库升级脚本 v4');
  console.log('================================================\n');

  // Step 1: 备份
  console.log('Step 1: 备份数据库...');
  if (fs.existsSync(PROD_DB_BACKUP_PATH)) {
    console.log(`  ! 备份已存在: ${PROD_DB_BACKUP_PATH}`);
    console.log('  如需重新备份，请先删除现有备份文件。');
  } else {
    fs.copyFileSync(PROD_DB_PATH, PROD_DB_BACKUP_PATH);
    console.log(`  ✓ 备份完成: ${PROD_DB_BACKUP_PATH}`);
  }

  // Step 2: 获取现有表
  console.log('\nStep 2: 检查现有表结构...');
  const existingTables = await getExistingTables(prisma);
  console.log(`  现有表: ${existingTables.length} 个`);

  // Step 3: 添加所有缺失字段
  console.log('\nStep 3: 添加缺失字段...');
  for (const [tableName, fields] of Object.entries(SCHEMA_FIELDS)) {
    if (!existingTables.includes(tableName)) {
      console.log(`  - 跳过不存在的表: ${tableName}`);
      continue;
    }
    
    console.log(`  检查 ${tableName}...`);
    for (const [fieldName, fieldDef] of fields) {
      await addColumnIfMissing(prisma, tableName, fieldName, fieldDef);
    }
  }
  console.log('  ✓ 字段检查完成');

  // Step 4: 使用原始SQL导出数据计数
  console.log('\nStep 4: 统计现有数据...');
  const dataCounts = {};
  const importantTables = [
    'User', 'UserRole', 'Project', 'ProjectFile', 'Vulnerability',
    'McpServerConfig', 'ModelConfig', 'TokenUsage', 'Skill', 'SkillExecution',
    'Workflow', 'WorkflowNode', 'WorkflowEdge', 'EvaluationSession',
    'EvaluationIteration', 'EvaluationResult', 'SessionMessage', 'AuditLog',
    'ScanTask', 'ScanReport', 'ToolPermission', 'SessionMeta',
    'AgentDefinition', 'AgentTeam', 'AgentTeamMember',
    'CodeKnowledge', 'DataFlow', 'NodeExecution',
  ];
  
  for (const table of importantTables) {
    if (existingTables.includes(table)) {
      const result = await rawQuery(prisma, `SELECT COUNT(*) as count FROM "${table}"`);
      dataCounts[table] = result[0]?.count || 0;
      console.log(`  ${table}: ${dataCounts[table]}`);
    }
  }

  // Step 5: 清空系统表
  console.log('\nStep 5: 清空系统表...');
  const systemTables = [
    '_PermissionToRole', 'Permission', 'Role',
    'AlertInstance', 'AlertRule',
    'AutonomousEvolutionExperience', 'ExpectedOutputTemplate',
    'NotificationChannel', 'SystemConfig', 'SystemMetric',
    'Tool', 'VulnerabilityPattern', 'VulnerabilityCategory',
    'TechStackOption', 'Plugin', 'SkillGovernanceConfig',
  ];
  
  for (const table of systemTables) {
    if (existingTables.includes(table)) {
      const deleted = await rawExecute(prisma, `DELETE FROM "${table}"`);
      console.log(`  ${deleted ? '✓' : '!'} 清空 ${table}`);
    }
  }

  // Step 6: 导入种子数据
  console.log('\nStep 6: 导入种子数据...');

  // 6.1 角色
  console.log('  导入角色...');
  const devRoles = await devPrisma.role.findMany();
  for (const role of devRoles) {
    await rawExecute(prisma,
      `INSERT OR IGNORE INTO Role (id, name, description, isSystem, createdAt, updatedAt)
       VALUES ('${role.id}', '${role.name}', '${escapeSql(role.description)}', ${role.isSystem ? 1 : 0},
               '${role.createdAt.toISOString()}', '${role.updatedAt.toISOString()}')`
    );
  }
  console.log(`    ✓ 角色: ${devRoles.length}`);

  // 6.2 权限
  console.log('  导入权限...');
  const devPermissions = await devPrisma.permission.findMany();
  for (const perm of devPermissions) {
    await rawExecute(prisma,
      `INSERT OR IGNORE INTO Permission (id, name, description, module, action, resource, createdAt, updatedAt)
       VALUES ('${perm.id}', '${perm.name}', '${escapeSql(perm.description)}', '${perm.module}', '${perm.action}',
               '${escapeSql(perm.resource)}', '${perm.createdAt.toISOString()}', '${perm.updatedAt.toISOString()}')`
    );
  }
  console.log(`    ✓ 权限: ${devPermissions.length}`);

  // 6.3 权限角色关联
  console.log('  导入权限角色关联...');
  try {
    const devPermRoles = await devPrisma.$queryRaw`SELECT * FROM "_PermissionToRole"`;
    for (const pr of devPermRoles) {
      await rawExecute(prisma, `INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B") VALUES ('${pr.A}', '${pr.B}')`);
    }
    console.log(`    ✓ 关联: ${devPermRoles.length}`);
  } catch (e) {
    console.log(`    ! 导入关联失败: ${e.message}`);
  }

  // 6.4 技术栈
  console.log('  导入技术栈...');
  const devTechStack = await devPrisma.techStackOption.findMany();
  for (const tso of devTechStack) {
    await rawExecute(prisma,
      `INSERT OR IGNORE INTO TechStackOption (id, name, category, description, isActive, isBuiltin, sortOrder, createdAt, updatedAt)
       VALUES ('${tso.id}', '${tso.name}', '${tso.category}', '${escapeSql(tso.description)}',
               ${tso.isActive ? 1 : 0}, ${tso.isBuiltin ? 1 : 0}, ${tso.sortOrder || 0},
               '${tso.createdAt.toISOString()}', '${tso.updatedAt.toISOString()}')`
    );
  }
  console.log(`    ✓ 技术栈: ${devTechStack.length}`);

  // 6.5 漏洞分类
  console.log('  导入漏洞分类...');
  try {
    const devVulnCats = await devPrisma.vulnerabilityCategory.findMany();
    for (const vc of devVulnCats) {
      await rawExecute(prisma,
        `INSERT OR IGNORE INTO VulnerabilityCategory (id, value, label, description, sortOrder, isActive, createdAt, updatedAt)
         VALUES ('${vc.id}', '${vc.value}', '${vc.label}', '${escapeSql(vc.description)}',
                 ${vc.sortOrder || 0}, ${vc.isActive ? 1 : 0},
                 '${vc.createdAt.toISOString()}', '${vc.updatedAt.toISOString()}')`
      );
    }
    console.log(`    ✓ 漏洞分类: ${devVulnCats.length}`);
  } catch (e) {
    console.log(`    ! 漏洞分类表不存在或导入失败`);
  }

  // 6.6 漏洞模式
  console.log('  导入漏洞模式...');
  const devVulnPatterns = await devPrisma.vulnerabilityPattern.findMany();
  for (const vp of devVulnPatterns) {
    await rawExecute(prisma,
      `INSERT OR IGNORE INTO VulnerabilityPattern 
       (id, name, displayName, description, categoryId, cwe, cve, patterns, languages, 
        exampleVulnerable, exampleFixed, fixGuidance, isActive, isBuiltin, createdAt, updatedAt)
       VALUES ('${vp.id}', '${vp.name}', '${escapeSql(vp.displayName)}', '${escapeSql(vp.description)}',
               '${vp.categoryId || ''}', '${vp.cwe || ''}', '${vp.cve || ''}',
               '${escapeSql(vp.patterns)}', '${escapeSql(vp.languages)}', 
               '${escapeSql(vp.exampleVulnerable)}', '${escapeSql(vp.exampleFixed)}', '${escapeSql(vp.fixGuidance)}',
               ${vp.isActive ? 1 : 0}, ${vp.isBuiltin ? 1 : 0},
               '${vp.createdAt.toISOString()}', '${vp.updatedAt.toISOString()}')`
    );
  }
  console.log(`    ✓ 漏洞模式: ${devVulnPatterns.length}`);

  // 6.7 工具定义
  console.log('  导入工具定义...');
  try {
    const devTools = await devPrisma.tool.findMany();
    for (const tool of devTools) {
      await rawExecute(prisma,
        `INSERT OR IGNORE INTO Tool 
         (id, name, displayName, description, category, parameters, executor, executorConfig,
          requiresPermission, allowedInSandbox, timeout, isActive, isBuiltin, createdAt, updatedAt)
         VALUES ('${tool.id}', '${tool.name}', '${escapeSql(tool.displayName)}', '${escapeSql(tool.description)}',
                 '${tool.category}', '${escapeSql(tool.parameters)}',
                 '${tool.executor}', '${escapeSql(tool.executorConfig)}',
                 ${tool.requiresPermission ? 1 : 0}, ${tool.allowedInSandbox ? 1 : 0}, ${tool.timeout || 600000},
                 ${tool.isActive ? 1 : 0}, ${tool.isBuiltin ? 1 : 0},
                 '${tool.createdAt.toISOString()}', '${tool.updatedAt.toISOString()}')`
      );
    }
    console.log(`    ✓ 工具: ${devTools.length}`);
  } catch (e) {
    console.log(`    ! 工具表不存在或导入失败`);
  }

  // 6.8 Skill治理配置
  console.log('  导入Skill治理配置...');
  try {
    const devGovConfigs = await devPrisma.skillGovernanceConfig.findMany();
    for (const gc of devGovConfigs) {
      await rawExecute(prisma,
        `INSERT OR IGNORE INTO SkillGovernanceConfig 
         (id, configKey, thresholdValue, configValue, description, isActive, isBuiltin, createdAt, updatedAt)
         VALUES ('${gc.id}', '${gc.configKey}', ${gc.thresholdValue}, '${escapeSql(gc.configValue)}',
                 '${escapeSql(gc.description)}', ${gc.isActive ? 1 : 0}, ${gc.isBuiltin ? 1 : 0},
                 '${gc.createdAt.toISOString()}', '${gc.updatedAt.toISOString()}')`
      );
    }
    console.log(`    ✓ 治理配置: ${devGovConfigs.length}`);
  } catch (e) {
    console.log(`    ! 治理配置表不存在或导入失败`);
  }

  // 6.9 OpenCode配置
  console.log('  导入OpenCode配置...');
  try {
    const devOpencode = await devPrisma.opencodeConfig.findMany();
    for (const oc of devOpencode) {
      await rawExecute(prisma,
        `INSERT OR IGNORE INTO OpencodeConfig 
         (id, userId, name, baseURL, description, isActive, mcpServers, keybinds, modelPreferences,
          projectUploadDir, taskDescription, workflowConfig, customSystemPrompt, claudemdPath,
          resumeSession, permissionMode, settingSources, progressQuestion, skillOutputTemplate,
          claudemdTemplate, maxConcurrentEvaluations, defaultToolPermissions, createdAt, updatedAt)
         VALUES ('${oc.id}', '${oc.userId}', '${oc.name}', '${oc.baseURL}', '${escapeSql(oc.description)}',
                 ${oc.isActive ? 1 : 0}, '${escapeSql(oc.mcpServers)}', '${escapeSql(oc.keybinds)}', '${escapeSql(oc.modelPreferences)}',
                 '${escapeSql(oc.projectUploadDir)}', '${escapeSql(oc.taskDescription)}', '${escapeSql(oc.workflowConfig)}',
                 '${escapeSql(oc.customSystemPrompt)}', '${escapeSql(oc.claudemdPath)}',
                 ${oc.resumeSession ? 1 : 0}, '${escapeSql(oc.permissionMode)}', '${escapeSql(oc.settingSources)}',
                 '${escapeSql(oc.progressQuestion)}', '${escapeSql(oc.skillOutputTemplate)}', '${escapeSql(oc.claudemdTemplate)}',
                 ${oc.maxConcurrentEvaluations || 3}, '${escapeSql(oc.defaultToolPermissions)}',
                 '${oc.createdAt.toISOString()}', '${oc.updatedAt.toISOString()}')`
      );
    }
    console.log(`    ✓ OpenCode配置: ${devOpencode.length}`);
  } catch (e) {
    console.log(`    ! OpenCode配置导入失败: ${e.message}`);
  }

  // Step 7: 更新用户角色
  console.log('\nStep 7: 更新用户角色关联...');
  try {
    const userRole = await rawQuery(prisma, `SELECT id FROM Role WHERE name = 'user' LIMIT 1`);
    if (userRole.length > 0) {
      const userRoleId = userRole[0].id;
      const usersWithoutRole = await rawQuery(prisma,
        `SELECT u.id, u.email FROM User u 
         WHERE NOT EXISTS (SELECT 1 FROM UserRole ur WHERE ur.userId = u.id)`
      );
      for (const user of usersWithoutRole) {
        await rawExecute(prisma,
          `INSERT OR IGNORE INTO UserRole (id, userId, roleId, createdAt)
           VALUES ('${generateId()}', '${user.id}', '${userRoleId}', datetime('now'))`
        );
        console.log(`    + 为 ${user.email} 分配 user 角色`);
      }
    }
  } catch (e) {
    console.log(`    ! 角色更新失败: ${e.message}`);
  }

  // Step 8: 验证
  console.log('\nStep 8: 验证数据完整性...');
  const finalCounts = {};
  for (const table of importantTables) {
    if (existingTables.includes(table)) {
      const result = await rawQuery(prisma, `SELECT COUNT(*) as count FROM "${table}"`);
      finalCounts[table] = result[0]?.count || 0;
    }
  }

  console.log('\n  数据对比:');
  const compareTables = ['User', 'Project', 'Vulnerability', 'McpServerConfig', 'ModelConfig', 'TokenUsage', 'Skill', 'Workflow'];
  let allOk = true;
  for (const table of compareTables) {
    const before = dataCounts[table] || 0;
    const after = finalCounts[table] || 0;
    const ok = before === after;
    if (!ok) allOk = false;
    console.log(`    ${ok ? '✓' : '✗'} ${table}: ${before} -> ${after}`);
  }

  console.log('\n================================================');
  console.log(allOk ? '✓ 升级完成！数据完整' : '⚠ 升级完成，请检查数据');
  console.log('================================================');
  console.log(`\n备份: ${PROD_DB_BACKUP_PATH}`);
  console.log('如需回滚，将备份复制回原位置即可。');
}

function generateId() {
  return 'c' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await devPrisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('\n❌ 升级失败:', e.message);
    console.error(e.stack);
    await prisma.$disconnect();
    await devPrisma.$disconnect();
    process.exit(1);
  });
