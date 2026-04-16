-- ============================================================
-- 数据库升级脚本 - 从昨天版本升级到最新版本
-- 创建时间: 2026-04-17
-- 用途: 将旧数据库结构升级到支持 Skills Governance 和 AgentTeam 功能
-- ============================================================

-- 注意事项:
-- 1. 此脚本假设旧数据库已有基础表（User, Role, Permission, Skill 等）
-- 2. 运行前请备份旧数据库
-- 3. 使用方法: sqlite3 your_old_db.db < db-upgrade.sql
-- 4. 或使用 Prisma: npx prisma db push --force-reset (会清空数据，不推荐)

-- ============================================================
-- 第一部分: Skills Governance 新增表
-- ============================================================

-- 1. SkillGovernanceConfig - 治理配置表
CREATE TABLE IF NOT EXISTS "SkillGovernanceConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configKey" TEXT NOT NULL UNIQUE,
    "thresholdValue" REAL NOT NULL,
    "configValue" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT 1,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "SkillGovernanceConfig_isActive_idx" ON "SkillGovernanceConfig"("isActive");
CREATE INDEX IF NOT EXISTS "SkillGovernanceConfig_configKey_idx" ON "SkillGovernanceConfig"("configKey");

-- 2. SkillMergeRecord - Skill合并记录表
CREATE TABLE IF NOT EXISTS "SkillMergeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceSkillId" TEXT NOT NULL,
    "targetSkillId" TEXT NOT NULL,
    "mergeReason" TEXT NOT NULL,
    "mergeDetails" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "completedAt" DATETIME,
    "revertedAt" DATETIME,
    "sourceOwnerConsent" BOOLEAN NOT NULL DEFAULT 0,
    "targetOwnerConsent" BOOLEAN NOT NULL DEFAULT 0,
    "mergedBy" TEXT,
    "mergedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("sourceSkillId") REFERENCES "Skill"("id") ON DELETE CASCADE,
    FOREIGN KEY ("targetSkillId") REFERENCES "Skill"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "SkillMergeRecord_sourceSkillId_targetSkillId_idx" ON "SkillMergeRecord"("sourceSkillId", "targetSkillId");
CREATE INDEX IF NOT EXISTS "SkillMergeRecord_createdAt_idx" ON "SkillMergeRecord"("createdAt");
CREATE INDEX IF NOT EXISTS "SkillMergeRecord_status_idx" ON "SkillMergeRecord"("status");
CREATE INDEX IF NOT EXISTS "SkillMergeRecord_targetSkillId_idx" ON "SkillMergeRecord"("targetSkillId");
CREATE INDEX IF NOT EXISTS "SkillMergeRecord_sourceSkillId_idx" ON "SkillMergeRecord"("sourceSkillId");

-- 3. SkillNewImpactAnalysis - 新增Skill影响分析表
CREATE TABLE IF NOT EXISTS "SkillNewImpactAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "similarSkills" TEXT,
    "overlapScore" REAL,
    "affectedWorkflows" TEXT,
    "recommendation" TEXT,
    "recommendationReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "analyzedAt" DATETIME,
    "actionedAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "SkillNewImpactAnalysis_createdAt_idx" ON "SkillNewImpactAnalysis"("createdAt");
CREATE INDEX IF NOT EXISTS "SkillNewImpactAnalysis_status_idx" ON "SkillNewImpactAnalysis"("status");
CREATE INDEX IF NOT EXISTS "SkillNewImpactAnalysis_overlapScore_idx" ON "SkillNewImpactAnalysis"("overlapScore");
CREATE INDEX IF NOT EXISTS "SkillNewImpactAnalysis_skillId_idx" ON "SkillNewImpactAnalysis"("skillId");

-- 4. SkillObservationLog - Skill观测日志表
CREATE TABLE IF NOT EXISTS "SkillObservationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerContext" TEXT,
    "matches" TEXT,
    "issues" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "SkillObservationLog_skillId_createdAt_idx" ON "SkillObservationLog"("skillId", "createdAt");
CREATE INDEX IF NOT EXISTS "SkillObservationLog_createdAt_idx" ON "SkillObservationLog"("createdAt");
CREATE INDEX IF NOT EXISTS "SkillObservationLog_status_idx" ON "SkillObservationLog"("status");
CREATE INDEX IF NOT EXISTS "SkillObservationLog_severity_idx" ON "SkillObservationLog"("severity");
CREATE INDEX IF NOT EXISTS "SkillObservationLog_triggerType_idx" ON "SkillObservationLog"("triggerType");
CREATE INDEX IF NOT EXISTS "SkillObservationLog_skillId_idx" ON "SkillObservationLog"("skillId");

-- 5. SkillObservationStats - Skill观测统计表
CREATE TABLE IF NOT EXISTS "SkillObservationStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL UNIQUE,
    "totalObservations" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "overlapCount" INTEGER NOT NULL DEFAULT 0,
    "matchRate" REAL,
    "warningRate" REAL,
    "avgResponseTime" INTEGER,
    "avgMatchScore" REAL,
    "firstObservedAt" DATETIME,
    "lastObservedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "SkillObservationStats_matchRate_idx" ON "SkillObservationStats"("matchRate");
CREATE INDEX IF NOT EXISTS "SkillObservationStats_warningCount_idx" ON "SkillObservationStats"("warningCount");
CREATE INDEX IF NOT EXISTS "SkillObservationStats_skillId_idx" ON "SkillObservationStats"("skillId");

-- ============================================================
-- 第二部分: AgentTeam 新增表
-- ============================================================

-- 6. AgentDefinition - Agent定义表
CREATE TABLE IF NOT EXISTS "AgentDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL UNIQUE,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "modelConfigId" TEXT,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "allowedTools" TEXT,
    "skills" TEXT,
    "mcpServers" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT 1,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    FOREIGN KEY ("modelConfigId") REFERENCES "ModelConfig"("id")
);

CREATE INDEX IF NOT EXISTS "AgentDefinition_isActive_idx" ON "AgentDefinition"("isActive");
CREATE INDEX IF NOT EXISTS "AgentDefinition_name_idx" ON "AgentDefinition"("name");
CREATE INDEX IF NOT EXISTS "AgentDefinition_category_idx" ON "AgentDefinition"("category");
CREATE INDEX IF NOT EXISTS "AgentDefinition_userId_idx" ON "AgentDefinition"("userId");

-- 7. AgentTeam - Agent团队表
CREATE TABLE IF NOT EXISTS "AgentTeam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "leadAgentId" TEXT NOT NULL,
    "taskStrategy" TEXT DEFAULT 'parallel',
    "maxTeammates" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "ralphConfig" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    FOREIGN KEY ("leadAgentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AgentTeam_leadAgentId_idx" ON "AgentTeam"("leadAgentId");
CREATE INDEX IF NOT EXISTS "AgentTeam_status_idx" ON "AgentTeam"("status");
CREATE INDEX IF NOT EXISTS "AgentTeam_userId_idx" ON "AgentTeam"("userId");

-- 8. AgentTeamExecution - Agent团队执行表
CREATE TABLE IF NOT EXISTS "AgentTeamExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("teamId") REFERENCES "AgentTeam"("id") ON DELETE CASCADE,
    FOREIGN KEY ("evaluationId") REFERENCES "EvaluationSession"("id")
);

CREATE INDEX IF NOT EXISTS "AgentTeamExecution_status_idx" ON "AgentTeamExecution"("status");
CREATE INDEX IF NOT EXISTS "AgentTeamExecution_evaluationId_idx" ON "AgentTeamExecution"("evaluationId");
CREATE INDEX IF NOT EXISTS "AgentTeamExecution_teamId_idx" ON "AgentTeamExecution"("teamId");

-- 9. AgentTeamMember - Agent团队成员表
CREATE TABLE IF NOT EXISTS "AgentTeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "overrideModel" TEXT,
    "overrideTools" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("teamId") REFERENCES "AgentTeam"("id") ON DELETE CASCADE,
    FOREIGN KEY ("agentId") REFERENCES "AgentDefinition"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AgentTeamMember_agentId_idx" ON "AgentTeamMember"("agentId");
CREATE INDEX IF NOT EXISTS "AgentTeamMember_teamId_idx" ON "AgentTeamMember"("teamId");

-- 10. AgentMemberExecution - Agent成员执行表
CREATE TABLE IF NOT EXISTS "AgentMemberExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("executionId") REFERENCES "AgentTeamExecution"("id") ON DELETE CASCADE,
    FOREIGN KEY ("memberId") REFERENCES "AgentTeamMember"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AgentMemberExecution_status_idx" ON "AgentMemberExecution"("status");
CREATE INDEX IF NOT EXISTS "AgentMemberExecution_executionId_idx" ON "AgentMemberExecution"("executionId");
CREATE INDEX IF NOT EXISTS "AgentMemberExecution_memberId_idx" ON "AgentMemberExecution"("memberId");

-- ============================================================
-- 第三部分: Skill表新增字段
-- ============================================================

-- 检查并添加 Skill 表的新字段（如果不存在）
-- SQLite 不支持 IF NOT EXISTS for columns，需要用其他方式

-- 添加 referenceCount 字段（如果不存在）
-- ALTER TABLE "Skill" ADD COLUMN "referenceCount" INTEGER NOT NULL DEFAULT 0;

-- 添加 vulnerabilityCount 字段（如果不存在）
-- ALTER TABLE "Skill" ADD COLUMN "vulnerabilityCount" INTEGER NOT NULL DEFAULT 0;

-- 注意: SQLite ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS
-- 需要先检查列是否存在，如果不存在则添加
-- 这里提供手动添加的语句，运行时需要根据实际情况决定是否执行

-- ============================================================
-- 第四部分: 其他可能缺失的表
-- ============================================================

-- SkillPredictionTask 表（如果不存在）
CREATE TABLE IF NOT EXISTS "SkillPredictionTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT,
    "taskName" TEXT NOT NULL,
    "taskDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "SkillPredictionTask_userId_idx" ON "SkillPredictionTask"("userId");
CREATE INDEX IF NOT EXISTS "SkillPredictionTask_status_idx" ON "SkillPredictionTask"("status");
CREATE INDEX IF NOT EXISTS "SkillPredictionTask_createdAt_idx" ON "SkillPredictionTask"("createdAt");

-- AlertRule 表（如果不存在）
CREATE TABLE IF NOT EXISTS "AlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "condition" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "isActive" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AlertInstance 表（如果不存在）
CREATE TABLE IF NOT EXISTS "AlertInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "message" TEXT,
    "context" TEXT,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AlertInstance_status_idx" ON "AlertInstance"("status");
CREATE INDEX IF NOT EXISTS "AlertInstance_severity_idx" ON "AlertInstance"("severity");
CREATE INDEX IF NOT EXISTS "AlertInstance_triggeredAt_idx" ON "AlertInstance"("triggeredAt");

-- ============================================================
-- 第五部分: 初始化治理配置默认数据
-- ============================================================

-- 插入默认治理配置（仅在表为空时）
INSERT OR IGNORE INTO "SkillGovernanceConfig" ("id", "configKey", "thresholdValue", "description", "isActive", "isBuiltin")
VALUES 
    ('gov-config-1', 'similarity_threshold_high', 0.85, '高相似度阈值，超过此值建议合并', 1, 1),
    ('gov-config-2', 'similarity_threshold_medium', 0.75, '中等相似度阈值，需要关注', 1, 1),
    ('gov-config-3', 'similarity_threshold_low', 0.60, '低相似度阈值，仅需记录', 1, 1),
    ('gov-config-4', 'overlap_frequency_threshold', 5, '重复出现次数阈值，超过此值列入高频', 1, 1),
    ('gov-config-5', 'warning_display_limit', 10, '预警显示数量上限', 1, 1);

-- ============================================================
-- 完成提示
-- ============================================================
-- 升级完成后，请运行以下命令验证:
-- 1. npx prisma generate
-- 2. npm run db:seed (可选，添加种子数据)
-- ============================================================