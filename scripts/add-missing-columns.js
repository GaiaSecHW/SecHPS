/**
 * 添加缺失字段到生产环境数据库
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:e:\\dev.db' } } });

async function getColumns(tableName) {
  const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`);
  return cols.map(c => c.name);
}

async function addColumn(table, col, def) {
  const cols = await getColumns(table);
  if (!cols.includes(col)) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${col}" ${def}`);
      console.log(`  + ${table}.${col}`);
    } catch (e) {
      console.log(`  ! ${table}.${col}: ${e.message}`);
    }
  }
}

async function main() {
  console.log('=== 添加缺失字段 ===\n');
  
  // WorkflowExecution
  console.log('WorkflowExecution:');
  await addColumn('WorkflowExecution', 'roleModels', 'TEXT');
  await addColumn('WorkflowExecution', 'error', 'TEXT');
  await addColumn('WorkflowExecution', 'result', 'TEXT');
  
  // Workflow
  console.log('\nWorkflow:');
  await addColumn('Workflow', 'thumbnail', 'TEXT');
  await addColumn('Workflow', 'techStack', 'TEXT');
  await addColumn('Workflow', 'version', 'INTEGER NOT NULL DEFAULT 1');
  await addColumn('Workflow', 'isActive', 'BOOLEAN NOT NULL DEFAULT 0');
  await addColumn('Workflow', 'isPublic', 'BOOLEAN NOT NULL DEFAULT 0');
  
  // WorkflowNode
  console.log('\nWorkflowNode:');
  await addColumn('WorkflowNode', 'roleId', 'TEXT');
  await addColumn('WorkflowNode', 'vulnerabilityCategories', 'TEXT');
  await addColumn('WorkflowNode', 'skills', 'TEXT');
  
  // WorkflowExecutionStep
  console.log('\nWorkflowExecutionStep:');
  await addColumn('WorkflowExecutionStep', 'input', 'TEXT');
  await addColumn('WorkflowExecutionStep', 'output', 'TEXT');
  await addColumn('WorkflowExecutionStep', 'error', 'TEXT');
  
  // EvaluationSession
  console.log('\nEvaluationSession:');
  await addColumn('EvaluationSession', 'agentTeamId', 'TEXT');
  await addColumn('EvaluationSession', 'roleModels', 'TEXT');
  await addColumn('EvaluationSession', 'skillsUsed', 'TEXT');
  await addColumn('EvaluationSession', 'endReason', 'TEXT');
  await addColumn('EvaluationSession', 'endMessage', 'TEXT');
  await addColumn('EvaluationSession', 'providerType', 'TEXT');
  await addColumn('EvaluationSession', 'todoList', 'TEXT');
  await addColumn('EvaluationSession', 'totalInputTokens', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('EvaluationSession', 'totalOutputTokens', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('EvaluationSession', 'totalTokens', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('EvaluationSession', 'estimatedCost', 'REAL');
  
  // EvaluationIteration
  console.log('\nEvaluationIteration:');
  await addColumn('EvaluationIteration', 'modelConfigId', 'TEXT');
  await addColumn('EvaluationIteration', 'modelName', 'TEXT');
  await addColumn('EvaluationIteration', 'roleId', 'TEXT');
  await addColumn('EvaluationIteration', 'toolCallCount', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('EvaluationIteration', 'verificationComplete', 'BOOLEAN');
  await addColumn('EvaluationIteration', 'verificationReason', 'TEXT');
  
  // NodeExecution
  console.log('\nNodeExecution:');
  await addColumn('NodeExecution', 'modelConfigId', 'TEXT');
  await addColumn('NodeExecution', 'modelName', 'TEXT');
  await addColumn('NodeExecution', 'roleId', 'TEXT');
  
  // SkillExecution
  console.log('\nSkillExecution:');
  await addColumn('SkillExecution', 'evaluationId', 'TEXT');
  await addColumn('SkillExecution', 'inputTokens', 'INTEGER');
  await addColumn('SkillExecution', 'outputTokens', 'INTEGER');
  
  // ScanTask
  console.log('\nScanTask:');
  await addColumn('ScanTask', 'skillIds', 'TEXT');
  await addColumn('ScanTask', 'nextRunAt', 'DATETIME');
  await addColumn('ScanTask', 'currentSkill', 'TEXT');
  await addColumn('ScanTask', 'totalSkills', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('ScanTask', 'completedSkills', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('ScanTask', 'findingsCount', 'INTEGER NOT NULL DEFAULT 0');
  
  // Vulnerability
  console.log('\nVulnerability:');
  await addColumn('Vulnerability', 'evaluationId', 'TEXT');
  await addColumn('Vulnerability', 'skillExecutionId', 'TEXT');
  
  // TokenUsage
  console.log('\nTokenUsage:');
  await addColumn('TokenUsage', 'userId', 'TEXT');
  await addColumn('TokenUsage', 'username', 'TEXT');
  await addColumn('TokenUsage', 'evaluationId', 'TEXT');
  await addColumn('TokenUsage', 'projectId', 'TEXT');
  await addColumn('TokenUsage', 'modelName', 'TEXT');
  await addColumn('TokenUsage', 'cachedTokens', 'INTEGER');
  await addColumn('TokenUsage', 'requestPreview', 'TEXT');
  await addColumn('TokenUsage', 'responsePreview', 'TEXT');
  await addColumn('TokenUsage', 'requestStartedAt', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await addColumn('TokenUsage', 'requestCompletedAt', 'DATETIME');
  await addColumn('TokenUsage', 'durationMs', 'INTEGER');
  await addColumn('TokenUsage', 'estimatedCost', 'REAL');
  await addColumn('TokenUsage', 'status', 'TEXT DEFAULT \'success\'');
  await addColumn('TokenUsage', 'errorMessage', 'TEXT');
  
  // Skill
  console.log('\nSkill:');
  await addColumn('Skill', 'userId', 'TEXT');
  await addColumn('Skill', 'isPublic', 'BOOLEAN NOT NULL DEFAULT 0');
  await addColumn('Skill', 'techStackId', 'TEXT');
  await addColumn('Skill', 'vulnerabilityPatternId', 'TEXT');
  await addColumn('Skill', 'parentId', 'TEXT');
  await addColumn('Skill', 'isLatest', 'BOOLEAN NOT NULL DEFAULT 1');
  await addColumn('Skill', 'successRate', 'REAL');
  await addColumn('Skill', 'avgDuration', 'INTEGER');
  await addColumn('Skill', 'execCount', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('Skill', 'referenceCount', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('Skill', 'vulnerabilityCount', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('Skill', 'successExecCount', 'INTEGER NOT NULL DEFAULT 0');
  
  // Project
  console.log('\nProject:');
  await addColumn('Project', 'isPublic', 'BOOLEAN NOT NULL DEFAULT 0');
  await addColumn('Project', 'displayName', 'TEXT');
  await addColumn('Project', 'fullPath', 'TEXT');
  await addColumn('Project', 'techStack', 'TEXT');
  
  // ModelConfig
  console.log('\nModelConfig:');
  await addColumn('ModelConfig', 'userId', 'TEXT');
  await addColumn('ModelConfig', 'isPublic', 'BOOLEAN NOT NULL DEFAULT 0');
  await addColumn('ModelConfig', 'routeType', 'TEXT');
  
  // McpServerConfig
  console.log('\nMcpServerConfig:');
  await addColumn('McpServerConfig', 'projectId', 'TEXT');
  await addColumn('McpServerConfig', 'isShared', 'BOOLEAN NOT NULL DEFAULT 0');
  await addColumn('McpServerConfig', 'autoStart', 'BOOLEAN NOT NULL DEFAULT 0');
  
  // OpencodeConfig
  console.log('\nOpencodeConfig:');
  await addColumn('OpencodeConfig', 'projectUploadDir', 'TEXT');
  await addColumn('OpencodeConfig', 'taskDescription', 'TEXT');
  await addColumn('OpencodeConfig', 'workflowConfig', 'TEXT');
  await addColumn('OpencodeConfig', 'customSystemPrompt', 'TEXT');
  await addColumn('OpencodeConfig', 'claudemdPath', 'TEXT');
  await addColumn('OpencodeConfig', 'resumeSession', 'BOOLEAN NOT NULL DEFAULT 0');
  await addColumn('OpencodeConfig', 'permissionMode', 'TEXT');
  await addColumn('OpencodeConfig', 'settingSources', 'TEXT');
  await addColumn('OpencodeConfig', 'progressQuestion', 'TEXT');
  await addColumn('OpencodeConfig', 'skillOutputTemplate', 'TEXT');
  await addColumn('OpencodeConfig', 'claudemdTemplate', 'TEXT');
  await addColumn('OpencodeConfig', 'maxConcurrentEvaluations', 'INTEGER NOT NULL DEFAULT 3');
  await addColumn('OpencodeConfig', 'defaultToolPermissions', 'TEXT');
  
  await prisma.$disconnect();
  console.log('\n✓ 完成');
}

main();
