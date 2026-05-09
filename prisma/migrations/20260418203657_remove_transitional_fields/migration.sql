-- CreateTable
CREATE TABLE "AgentDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "modelConfigId" TEXT,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "allowedTools" TEXT,
    "skills" TEXT,
    "mcpServers" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentDefinition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentDefinition_modelConfigId_fkey" FOREIGN KEY ("modelConfigId") REFERENCES "ModelConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMemberExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamExecutionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentMemberExecution_teamExecutionId_fkey" FOREIGN KEY ("teamExecutionId") REFERENCES "AgentTeamExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentMemberExecution_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "AgentTeamMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentTeam" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTeam_leadAgentId_fkey" FOREIGN KEY ("leadAgentId") REFERENCES "AgentDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentTeamExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTeamExecution_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AgentTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTeamExecution_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "EvaluationSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentTeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "overrideModel" TEXT,
    "overrideTools" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AgentTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentTeamMember_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AgentDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "message" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "threshold" REAL NOT NULL,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "acknowledgedAt" DATETIME,
    "acknowledgedBy" TEXT,
    "details" TEXT,
    "notifiedChannels" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlertInstance_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metricType" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownPeriod" INTEGER NOT NULL DEFAULT 300,
    "notificationChannels" TEXT NOT NULL,
    "tags" TEXT,
    "lastTriggeredAt" DATETIME,
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AutonomousEvolutionExperience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "errorCategory" TEXT NOT NULL,
    "errorPatterns" TEXT NOT NULL,
    "sourceModel" TEXT NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "sourceProjectId" TEXT,
    "attemptSequence" TEXT NOT NULL,
    "directSolution" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "isInjected" BOOLEAN NOT NULL DEFAULT false,
    "injectedAt" DATETIME,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "savedAttempts" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AutonomousEvolutionRunLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "newFiles" INTEGER NOT NULL DEFAULT 0,
    "sequences" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "merged" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "CodeKnowledge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER,
    "parentId" TEXT,
    "calls" TEXT,
    "calledBy" TEXT,
    "signature" TEXT,
    "docstring" TEXT,
    "code" TEXT,
    "summary" TEXT,
    "riskScore" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodeKnowledge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sinkId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sinkName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "isUserInput" BOOLEAN NOT NULL DEFAULT false,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataFlow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvaluationIteration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationSessionId" TEXT NOT NULL,
    "iterationNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "duration" INTEGER,
    "responseText" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "verificationComplete" BOOLEAN,
    "verificationReason" TEXT,
    "errorMessage" TEXT,
    "modelConfigId" TEXT,
    "modelName" TEXT,
    "roleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvaluationIteration_evaluationSessionId_fkey" FOREIGN KEY ("evaluationSessionId") REFERENCES "EvaluationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvaluationIteration_modelConfigId_fkey" FOREIGN KEY ("modelConfigId") REFERENCES "ModelConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationId" TEXT NOT NULL,
    "totalVulns" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "mediumCount" INTEGER NOT NULL DEFAULT 0,
    "lowCount" INTEGER NOT NULL DEFAULT 0,
    "infoCount" INTEGER NOT NULL DEFAULT 0,
    "skillsUsed" TEXT,
    "rawReport" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationResult_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "EvaluationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvaluationSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "workflowId" TEXT,
    "agentTeamId" TEXT,
    "modelConfigId" TEXT,
    "roleModels" TEXT,
    "skillsUsed" TEXT,
    "opencodeSessionId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'claude',
    "title" TEXT,
    "summary" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastActivity" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "port" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    "modelName" TEXT,
    "providerType" TEXT,
    "todoList" TEXT,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" REAL,
    CONSTRAINT "EvaluationSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvaluationSession_agentTeamId_fkey" FOREIGN KEY ("agentTeamId") REFERENCES "AgentTeam" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EvaluationSession_modelConfigId_fkey" FOREIGN KEY ("modelConfigId") REFERENCES "ModelConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpectedOutputTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "example" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExperienceUsageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experienceId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "projectId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'pre_injected',
    "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LogFileRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequenceCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "McpServerConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "command" TEXT,
    "args" TEXT,
    "url" TEXT,
    "env" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoStart" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "McpServerConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "McpServerConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "providerType" TEXT NOT NULL DEFAULT 'openai',
    "apiBaseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "models" TEXT NOT NULL,
    "routeType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ModelConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NodeExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationSessionId" TEXT NOT NULL,
    "workflowNodeId" TEXT NOT NULL,
    "nodeLabel" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "order" INTEGER NOT NULL DEFAULT 0,
    "modelConfigId" TEXT,
    "modelName" TEXT,
    "roleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NodeExecution_evaluationSessionId_fkey" FOREIGN KEY ("evaluationSessionId") REFERENCES "EvaluationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NodeExecution_modelConfigId_fkey" FOREIGN KEY ("modelConfigId") REFERENCES "ModelConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OpencodeConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseURL" TEXT NOT NULL DEFAULT 'http://localhost:54321',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mcpServers" TEXT,
    "keybinds" TEXT,
    "modelPreferences" TEXT,
    "projectUploadDir" TEXT,
    "taskDescription" TEXT,
    "workflowConfig" TEXT,
    "customSystemPrompt" TEXT,
    "claudemdPath" TEXT,
    "resumeSession" BOOLEAN NOT NULL DEFAULT false,
    "permissionMode" TEXT,
    "settingSources" TEXT,
    "progressQuestion" TEXT,
    "skillOutputTemplate" TEXT,
    "claudemdTemplate" TEXT,
    "maxConcurrentEvaluations" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "defaultToolPermissions" TEXT,
    CONSTRAINT "OpencodeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Plugin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "config" TEXT,
    "pluginPath" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "icon" TEXT,
    "homepage" TEXT,
    "repository" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "configId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "fullPath" TEXT,
    "description" TEXT,
    "projectPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "environmentUrl" TEXT,
    "adminUsername" TEXT,
    "adminPassword" TEXT,
    "normalUsername" TEXT,
    "normalPassword" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "techStack" TEXT,
    CONSTRAINT "Project_configId_fkey" FOREIGN KEY ("configId") REFERENCES "OpencodeConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" REAL NOT NULL,
    "fileType" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectStructure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "structure" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "codeCount" INTEGER NOT NULL DEFAULT 0,
    "languageStats" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "analyzedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectStructure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScanReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanTaskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'json',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanReport_scanTaskId_fkey" FOREIGN KEY ("scanTaskId") REFERENCES "ScanTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "skillIds" TEXT NOT NULL,
    "schedule" TEXT,
    "nextRunAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentSkill" TEXT,
    "totalSkills" INTEGER NOT NULL DEFAULT 0,
    "completedSkills" INTEGER NOT NULL DEFAULT 0,
    "findingsCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScanTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationSessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionMessage_evaluationSessionId_fkey" FOREIGN KEY ("evaluationSessionId") REFERENCES "EvaluationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "hasMore" BOOLEAN NOT NULL DEFAULT false,
    "claudeCount" INTEGER NOT NULL DEFAULT 0,
    "cursorCount" INTEGER NOT NULL DEFAULT 0,
    "codexCount" INTEGER NOT NULL DEFAULT 0,
    "geminiCount" INTEGER NOT NULL DEFAULT 0,
    "runningCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SessionMeta_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT,
    "content" TEXT NOT NULL,
    "cwe" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "successRate" REAL,
    "avgDuration" INTEGER,
    "execCount" INTEGER NOT NULL DEFAULT 0,
    "referenceCount" INTEGER NOT NULL DEFAULT 0,
    "vulnerabilityCount" INTEGER NOT NULL DEFAULT 0,
    "successExecCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "techStackId" TEXT,
    "vulnerabilityPatternId" TEXT,
    CONSTRAINT "Skill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Skill_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Skill" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Skill_techStackId_fkey" FOREIGN KEY ("techStackId") REFERENCES "TechStackOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Skill_vulnerabilityPatternId_fkey" FOREIGN KEY ("vulnerabilityPatternId") REFERENCES "VulnerabilityPattern" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillEvolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "fromVersion" INTEGER NOT NULL,
    "toVersion" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "changeDesc" TEXT NOT NULL,
    "beforeData" TEXT NOT NULL,
    "afterData" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeRate" REAL,
    "afterRate" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillEvolution_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scanTaskId" TEXT,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "duration" INTEGER,
    "error" TEXT,
    "findingsCount" INTEGER NOT NULL DEFAULT 0,
    "confirmedCount" INTEGER NOT NULL DEFAULT 0,
    "falsePositiveCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillExecution_scanTaskId_fkey" FOREIGN KEY ("scanTaskId") REFERENCES "ScanTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SkillExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillExecution_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillGovernanceConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configKey" TEXT NOT NULL,
    "thresholdValue" REAL NOT NULL,
    "configValue" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SkillMergeRecord" (
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
    "sourceOwnerConsent" BOOLEAN NOT NULL DEFAULT false,
    "targetOwnerConsent" BOOLEAN NOT NULL DEFAULT false,
    "mergedBy" TEXT,
    "mergedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillMergeRecord_sourceSkillId_fkey" FOREIGN KEY ("sourceSkillId") REFERENCES "Skill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SkillMergeRecord_targetSkillId_fkey" FOREIGN KEY ("targetSkillId") REFERENCES "Skill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillNewImpactAnalysis" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillNewImpactAnalysis_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillObservationLog" (
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillObservationLog_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillObservationStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillObservationStats_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillPrediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT,
    "taskName" TEXT NOT NULL,
    "taskDescription" TEXT NOT NULL,
    "matches" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "workflowTechStack" TEXT,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillPrediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillPredictionTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workflowId" TEXT,
    "taskName" TEXT NOT NULL,
    "taskDescription" TEXT NOT NULL,
    "topK" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "matches" TEXT,
    "method" TEXT,
    "matchCount" INTEGER,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "duration" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "nodeId" TEXT,
    "governanceWarning" TEXT,
    CONSTRAINT "SkillPredictionTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SystemMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "tags" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VulnerabilityCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TechStackOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "username" TEXT,
    "evaluationId" TEXT,
    "projectId" TEXT,
    "apiProvider" TEXT NOT NULL,
    "modelName" TEXT,
    "callType" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER,
    "requestPreview" TEXT,
    "responsePreview" TEXT,
    "requestStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestCompletedAt" DATETIME,
    "durationMs" INTEGER,
    "estimatedCost" REAL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenUsage_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "EvaluationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "parameters" TEXT NOT NULL,
    "executor" TEXT NOT NULL,
    "executorConfig" TEXT,
    "requiresPermission" BOOLEAN NOT NULL DEFAULT false,
    "allowedInSandbox" BOOLEAN NOT NULL DEFAULT true,
    "timeout" INTEGER NOT NULL DEFAULT 600000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ToolPermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "toolPattern" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ToolPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "avatar" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vulnerability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "skillExecutionId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cwe" TEXT,
    "severity" TEXT NOT NULL,
    "skill" TEXT,
    "filePath" TEXT,
    "lineStart" INTEGER,
    "lineEnd" INTEGER,
    "codeSnippet" TEXT,
    "details" TEXT,
    "aiAnalysis" TEXT,
    "fixSuggestion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "fixedBy" TEXT,
    "fixedAt" DATETIME,
    "verifiedBy" TEXT,
    "verifiedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vulnerability_skillExecutionId_fkey" FOREIGN KEY ("skillExecutionId") REFERENCES "SkillExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Vulnerability_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "EvaluationSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Vulnerability_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VulnerabilityPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "cwe" TEXT,
    "cve" TEXT,
    "patterns" TEXT NOT NULL,
    "languages" TEXT NOT NULL,
    "exampleVulnerable" TEXT,
    "exampleFixed" TEXT,
    "fixGuidance" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VulnerabilityPattern_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VulnerabilityCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "relatedSkillId" TEXT,
    "analysisType" TEXT NOT NULL,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "overlapType" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0,
    "llmReason" TEXT,
    "keyDifferences" TEXT,
    "sharedFunctionality" TEXT,
    "recommendation" TEXT,
    "entryPointComparison" TEXT,
    "inferredLanguage" TEXT,
    "inferredVulnPatternId" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "reviewNotes" TEXT,
    "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analyzedBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillAnalysis_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillDuplicateGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "language" TEXT NOT NULL,
    "vulnerabilityType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "resolutionNotes" TEXT,
    "skillCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SkillDuplicateGroupMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "similarityScore" REAL NOT NULL DEFAULT 0,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillDuplicateGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SkillDuplicateGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillDuplicateGroupMember_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "techStack" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workflow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowRole_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "roleId" TEXT,
    "type" TEXT NOT NULL,
    "positionX" REAL NOT NULL,
    "positionY" REAL NOT NULL,
    "data" TEXT NOT NULL,
    "vulnerabilityCategory" TEXT,
    "skills" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowNode_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "WorkflowRole" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowNode_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sourceHandle" TEXT,
    "targetHandle" TEXT,
    "label" TEXT,
    "data" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowEdge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "WorkflowNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowEdge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WorkflowNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowEdge_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "roleModels" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "error" TEXT,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowExecution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowExecutionStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "input" TEXT,
    "output" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "sharedWith" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'read',
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowShare_sharedWith_fkey" FOREIGN KEY ("sharedWith") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowShare_sharedBy_fkey" FOREIGN KEY ("sharedBy") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowShare_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillVulnerabilityMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "skillId" TEXT NOT NULL,
    "vulnerabilityId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "skillNameReported" TEXT,
    "matchType" TEXT NOT NULL DEFAULT 'exact',
    "matchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillVulnerabilityMapping_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillVulnerabilityMapping_vulnerabilityId_fkey" FOREIGN KEY ("vulnerabilityId") REFERENCES "Vulnerability" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillVulnerabilityMapping_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "EvaluationSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillVulnerabilityMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_PermissionToRole" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_PermissionToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_PermissionToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentDefinition_name_key" ON "AgentDefinition"("name");

-- CreateIndex
CREATE INDEX "AgentDefinition_name_idx" ON "AgentDefinition"("name");

-- CreateIndex
CREATE INDEX "AgentDefinition_category_idx" ON "AgentDefinition"("category");

-- CreateIndex
CREATE INDEX "AgentDefinition_isActive_idx" ON "AgentDefinition"("isActive");

-- CreateIndex
CREATE INDEX "AgentMemberExecution_teamExecutionId_idx" ON "AgentMemberExecution"("teamExecutionId");

-- CreateIndex
CREATE INDEX "AgentMemberExecution_memberId_idx" ON "AgentMemberExecution"("memberId");

-- CreateIndex
CREATE INDEX "AgentMemberExecution_status_idx" ON "AgentMemberExecution"("status");

-- CreateIndex
CREATE INDEX "AgentTeam_userId_idx" ON "AgentTeam"("userId");

-- CreateIndex
CREATE INDEX "AgentTeam_status_idx" ON "AgentTeam"("status");

-- CreateIndex
CREATE INDEX "AgentTeam_leadAgentId_idx" ON "AgentTeam"("leadAgentId");

-- CreateIndex
CREATE INDEX "AgentTeamExecution_teamId_idx" ON "AgentTeamExecution"("teamId");

-- CreateIndex
CREATE INDEX "AgentTeamExecution_evaluationId_idx" ON "AgentTeamExecution"("evaluationId");

-- CreateIndex
CREATE INDEX "AgentTeamExecution_status_idx" ON "AgentTeamExecution"("status");

-- CreateIndex
CREATE INDEX "AgentTeamMember_teamId_idx" ON "AgentTeamMember"("teamId");

-- CreateIndex
CREATE INDEX "AgentTeamMember_agentId_idx" ON "AgentTeamMember"("agentId");

-- CreateIndex
CREATE INDEX "AlertInstance_triggeredAt_idx" ON "AlertInstance"("triggeredAt");

-- CreateIndex
CREATE INDEX "AlertInstance_severity_idx" ON "AlertInstance"("severity");

-- CreateIndex
CREATE INDEX "AlertInstance_status_idx" ON "AlertInstance"("status");

-- CreateIndex
CREATE INDEX "AlertInstance_ruleId_idx" ON "AlertInstance"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertRule_name_key" ON "AlertRule"("name");

-- CreateIndex
CREATE INDEX "AlertRule_severity_idx" ON "AlertRule"("severity");

-- CreateIndex
CREATE INDEX "AlertRule_enabled_idx" ON "AlertRule"("enabled");

-- CreateIndex
CREATE INDEX "AlertRule_metricType_idx" ON "AlertRule"("metricType");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AutonomousEvolutionExperience_hitCount_idx" ON "AutonomousEvolutionExperience"("hitCount");

-- CreateIndex
CREATE INDEX "AutonomousEvolutionExperience_sourceModel_idx" ON "AutonomousEvolutionExperience"("sourceModel");

-- CreateIndex
CREATE INDEX "AutonomousEvolutionExperience_isInjected_idx" ON "AutonomousEvolutionExperience"("isInjected");

-- CreateIndex
CREATE INDEX "AutonomousEvolutionExperience_errorCategory_idx" ON "AutonomousEvolutionExperience"("errorCategory");

-- CreateIndex
CREATE INDEX "AutonomousEvolutionRunLog_trigger_idx" ON "AutonomousEvolutionRunLog"("trigger");

-- CreateIndex
CREATE INDEX "AutonomousEvolutionRunLog_startedAt_idx" ON "AutonomousEvolutionRunLog"("startedAt");

-- CreateIndex
CREATE INDEX "CodeKnowledge_name_idx" ON "CodeKnowledge"("name");

-- CreateIndex
CREATE INDEX "CodeKnowledge_entityType_idx" ON "CodeKnowledge"("entityType");

-- CreateIndex
CREATE INDEX "CodeKnowledge_projectId_idx" ON "CodeKnowledge"("projectId");

-- CreateIndex
CREATE INDEX "DataFlow_sinkId_idx" ON "DataFlow"("sinkId");

-- CreateIndex
CREATE INDEX "DataFlow_sourceId_idx" ON "DataFlow"("sourceId");

-- CreateIndex
CREATE INDEX "DataFlow_projectId_idx" ON "DataFlow"("projectId");

-- CreateIndex
CREATE INDEX "EvaluationIteration_iterationNumber_idx" ON "EvaluationIteration"("iterationNumber");

-- CreateIndex
CREATE INDEX "EvaluationIteration_status_idx" ON "EvaluationIteration"("status");

-- CreateIndex
CREATE INDEX "EvaluationIteration_evaluationSessionId_idx" ON "EvaluationIteration"("evaluationSessionId");

-- CreateIndex
CREATE INDEX "EvaluationIteration_modelConfigId_idx" ON "EvaluationIteration"("modelConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationIteration_evaluationSessionId_iterationNumber_key" ON "EvaluationIteration"("evaluationSessionId", "iterationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationResult_evaluationId_key" ON "EvaluationResult"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationSession_opencodeSessionId_key" ON "EvaluationSession"("opencodeSessionId");

-- CreateIndex
CREATE INDEX "EvaluationSession_projectId_idx" ON "EvaluationSession"("projectId");

-- CreateIndex
CREATE INDEX "EvaluationSession_agentTeamId_idx" ON "EvaluationSession"("agentTeamId");

-- CreateIndex
CREATE INDEX "EvaluationSession_workflowId_idx" ON "EvaluationSession"("workflowId");

-- CreateIndex
CREATE INDEX "EvaluationSession_modelConfigId_idx" ON "EvaluationSession"("modelConfigId");

-- CreateIndex
CREATE INDEX "EvaluationSession_opencodeSessionId_idx" ON "EvaluationSession"("opencodeSessionId");

-- CreateIndex
CREATE INDEX "EvaluationSession_status_idx" ON "EvaluationSession"("status");

-- CreateIndex
CREATE INDEX "EvaluationSession_provider_idx" ON "EvaluationSession"("provider");

-- CreateIndex
CREATE INDEX "EvaluationSession_lastActivity_idx" ON "EvaluationSession"("lastActivity");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedOutputTemplate_name_key" ON "ExpectedOutputTemplate"("name");

-- CreateIndex
CREATE INDEX "ExpectedOutputTemplate_isActive_idx" ON "ExpectedOutputTemplate"("isActive");

-- CreateIndex
CREATE INDEX "ExpectedOutputTemplate_category_idx" ON "ExpectedOutputTemplate"("category");

-- CreateIndex
CREATE INDEX "ExpectedOutputTemplate_name_idx" ON "ExpectedOutputTemplate"("name");

-- CreateIndex
CREATE INDEX "ExperienceUsageLog_experienceId_idx" ON "ExperienceUsageLog"("experienceId");

-- CreateIndex
CREATE INDEX "ExperienceUsageLog_evaluationId_idx" ON "ExperienceUsageLog"("evaluationId");

-- CreateIndex
CREATE INDEX "ExperienceUsageLog_usedAt_idx" ON "ExperienceUsageLog"("usedAt");

-- CreateIndex
CREATE INDEX "ExperienceUsageLog_source_idx" ON "ExperienceUsageLog"("source");

-- CreateIndex
CREATE UNIQUE INDEX "LogFileRecord_filePath_key" ON "LogFileRecord"("filePath");

-- CreateIndex
CREATE INDEX "LogFileRecord_filePath_idx" ON "LogFileRecord"("filePath");

-- CreateIndex
CREATE INDEX "McpServerConfig_isShared_idx" ON "McpServerConfig"("isShared");

-- CreateIndex
CREATE INDEX "McpServerConfig_name_idx" ON "McpServerConfig"("name");

-- CreateIndex
CREATE INDEX "McpServerConfig_projectId_idx" ON "McpServerConfig"("projectId");

-- CreateIndex
CREATE INDEX "McpServerConfig_userId_idx" ON "McpServerConfig"("userId");

-- CreateIndex
CREATE INDEX "ModelConfig_routeType_idx" ON "ModelConfig"("routeType");

-- CreateIndex
CREATE INDEX "ModelConfig_providerType_idx" ON "ModelConfig"("providerType");

-- CreateIndex
CREATE INDEX "ModelConfig_isPublic_idx" ON "ModelConfig"("isPublic");

-- CreateIndex
CREATE INDEX "ModelConfig_isDefault_idx" ON "ModelConfig"("isDefault");

-- CreateIndex
CREATE INDEX "ModelConfig_isActive_idx" ON "ModelConfig"("isActive");

-- CreateIndex
CREATE INDEX "ModelConfig_userId_idx" ON "ModelConfig"("userId");

-- CreateIndex
CREATE INDEX "NodeExecution_status_idx" ON "NodeExecution"("status");

-- CreateIndex
CREATE INDEX "NodeExecution_workflowNodeId_idx" ON "NodeExecution"("workflowNodeId");

-- CreateIndex
CREATE INDEX "NodeExecution_evaluationSessionId_idx" ON "NodeExecution"("evaluationSessionId");

-- CreateIndex
CREATE INDEX "NodeExecution_modelConfigId_idx" ON "NodeExecution"("modelConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeExecution_evaluationSessionId_workflowNodeId_key" ON "NodeExecution"("evaluationSessionId", "workflowNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_name_key" ON "NotificationChannel"("name");

-- CreateIndex
CREATE INDEX "NotificationChannel_enabled_idx" ON "NotificationChannel"("enabled");

-- CreateIndex
CREATE INDEX "NotificationChannel_type_idx" ON "NotificationChannel"("type");

-- CreateIndex
CREATE INDEX "OpencodeConfig_userId_idx" ON "OpencodeConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE INDEX "Permission_module_idx" ON "Permission"("module");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_module_action_key" ON "Permission"("module", "action");

-- CreateIndex
CREATE UNIQUE INDEX "Plugin_name_key" ON "Plugin"("name");

-- CreateIndex
CREATE INDEX "Plugin_isEnabled_idx" ON "Plugin"("isEnabled");

-- CreateIndex
CREATE INDEX "Plugin_status_idx" ON "Plugin"("status");

-- CreateIndex
CREATE INDEX "Plugin_type_idx" ON "Plugin"("type");

-- CreateIndex
CREATE INDEX "Plugin_name_idx" ON "Plugin"("name");

-- CreateIndex
CREATE INDEX "Project_name_idx" ON "Project"("name");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_configId_idx" ON "Project"("configId");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStructure_projectId_key" ON "ProjectStructure"("projectId");

-- CreateIndex
CREATE INDEX "ProjectStructure_projectId_idx" ON "ProjectStructure"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "Role_name_idx" ON "Role"("name");

-- CreateIndex
CREATE INDEX "ScanReport_projectId_idx" ON "ScanReport"("projectId");

-- CreateIndex
CREATE INDEX "ScanReport_scanTaskId_idx" ON "ScanReport"("scanTaskId");

-- CreateIndex
CREATE INDEX "ScanTask_userId_status_idx" ON "ScanTask"("userId", "status");

-- CreateIndex
CREATE INDEX "ScanTask_createdAt_idx" ON "ScanTask"("createdAt");

-- CreateIndex
CREATE INDEX "ScanTask_status_idx" ON "ScanTask"("status");

-- CreateIndex
CREATE INDEX "ScanTask_projectId_idx" ON "ScanTask"("projectId");

-- CreateIndex
CREATE INDEX "SessionMessage_evaluationSessionId_idx" ON "SessionMessage"("evaluationSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionMeta_projectId_key" ON "SessionMeta"("projectId");

-- CreateIndex
CREATE INDEX "SessionMeta_projectId_idx" ON "SessionMeta"("projectId");

-- CreateIndex
CREATE INDEX "Skill_userId_idx" ON "Skill"("userId");

-- CreateIndex
CREATE INDEX "Skill_name_idx" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "Skill_isLatest_idx" ON "Skill"("isLatest");

-- CreateIndex
CREATE INDEX "Skill_version_idx" ON "Skill"("version");

-- CreateIndex
CREATE INDEX "Skill_isActive_idx" ON "Skill"("isActive");

-- CreateIndex
CREATE INDEX "Skill_isPublic_idx" ON "Skill"("isPublic");

-- CreateIndex
CREATE INDEX "Skill_techStackId_idx" ON "Skill"("techStackId");

-- CreateIndex
CREATE INDEX "Skill_vulnerabilityPatternId_idx" ON "Skill"("vulnerabilityPatternId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_userId_name_key" ON "Skill"("userId", "name");

-- CreateIndex
CREATE INDEX "SkillEvolution_createdAt_idx" ON "SkillEvolution"("createdAt");

-- CreateIndex
CREATE INDEX "SkillEvolution_skillId_idx" ON "SkillEvolution"("skillId");

-- CreateIndex
CREATE INDEX "SkillExecution_skillId_status_idx" ON "SkillExecution"("skillId", "status");

-- CreateIndex
CREATE INDEX "SkillExecution_projectId_status_idx" ON "SkillExecution"("projectId", "status");

-- CreateIndex
CREATE INDEX "SkillExecution_createdAt_idx" ON "SkillExecution"("createdAt");

-- CreateIndex
CREATE INDEX "SkillExecution_status_idx" ON "SkillExecution"("status");

-- CreateIndex
CREATE INDEX "SkillExecution_projectId_idx" ON "SkillExecution"("projectId");

-- CreateIndex
CREATE INDEX "SkillExecution_skillId_idx" ON "SkillExecution"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillGovernanceConfig_configKey_key" ON "SkillGovernanceConfig"("configKey");

-- CreateIndex
CREATE INDEX "SkillGovernanceConfig_configKey_idx" ON "SkillGovernanceConfig"("configKey");

-- CreateIndex
CREATE INDEX "SkillGovernanceConfig_isActive_idx" ON "SkillGovernanceConfig"("isActive");

-- CreateIndex
CREATE INDEX "SkillMergeRecord_sourceSkillId_idx" ON "SkillMergeRecord"("sourceSkillId");

-- CreateIndex
CREATE INDEX "SkillMergeRecord_targetSkillId_idx" ON "SkillMergeRecord"("targetSkillId");

-- CreateIndex
CREATE INDEX "SkillMergeRecord_status_idx" ON "SkillMergeRecord"("status");

-- CreateIndex
CREATE INDEX "SkillMergeRecord_createdAt_idx" ON "SkillMergeRecord"("createdAt");

-- CreateIndex
CREATE INDEX "SkillMergeRecord_sourceSkillId_targetSkillId_idx" ON "SkillMergeRecord"("sourceSkillId", "targetSkillId");

-- CreateIndex
CREATE INDEX "SkillNewImpactAnalysis_skillId_idx" ON "SkillNewImpactAnalysis"("skillId");

-- CreateIndex
CREATE INDEX "SkillNewImpactAnalysis_overlapScore_idx" ON "SkillNewImpactAnalysis"("overlapScore");

-- CreateIndex
CREATE INDEX "SkillNewImpactAnalysis_status_idx" ON "SkillNewImpactAnalysis"("status");

-- CreateIndex
CREATE INDEX "SkillNewImpactAnalysis_createdAt_idx" ON "SkillNewImpactAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "SkillObservationLog_skillId_idx" ON "SkillObservationLog"("skillId");

-- CreateIndex
CREATE INDEX "SkillObservationLog_triggerType_idx" ON "SkillObservationLog"("triggerType");

-- CreateIndex
CREATE INDEX "SkillObservationLog_severity_idx" ON "SkillObservationLog"("severity");

-- CreateIndex
CREATE INDEX "SkillObservationLog_status_idx" ON "SkillObservationLog"("status");

-- CreateIndex
CREATE INDEX "SkillObservationLog_createdAt_idx" ON "SkillObservationLog"("createdAt");

-- CreateIndex
CREATE INDEX "SkillObservationLog_skillId_createdAt_idx" ON "SkillObservationLog"("skillId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SkillObservationStats_skillId_key" ON "SkillObservationStats"("skillId");

-- CreateIndex
CREATE INDEX "SkillObservationStats_skillId_idx" ON "SkillObservationStats"("skillId");

-- CreateIndex
CREATE INDEX "SkillObservationStats_warningCount_idx" ON "SkillObservationStats"("warningCount");

-- CreateIndex
CREATE INDEX "SkillObservationStats_matchRate_idx" ON "SkillObservationStats"("matchRate");

-- CreateIndex
CREATE INDEX "SkillPrediction_userId_idx" ON "SkillPrediction"("userId");

-- CreateIndex
CREATE INDEX "SkillPrediction_workflowId_idx" ON "SkillPrediction"("workflowId");

-- CreateIndex
CREATE INDEX "SkillPrediction_createdAt_idx" ON "SkillPrediction"("createdAt");

-- CreateIndex
CREATE INDEX "SkillPrediction_userId_createdAt_idx" ON "SkillPrediction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SkillPredictionTask_userId_idx" ON "SkillPredictionTask"("userId");

-- CreateIndex
CREATE INDEX "SkillPredictionTask_workflowId_idx" ON "SkillPredictionTask"("workflowId");

-- CreateIndex
CREATE INDEX "SkillPredictionTask_status_idx" ON "SkillPredictionTask"("status");

-- CreateIndex
CREATE INDEX "SkillPredictionTask_createdAt_idx" ON "SkillPredictionTask"("createdAt");

-- CreateIndex
CREATE INDEX "SkillPredictionTask_userId_status_idx" ON "SkillPredictionTask"("userId", "status");

-- CreateIndex
CREATE INDEX "SkillPredictionTask_nodeId_idx" ON "SkillPredictionTask"("nodeId");

-- CreateIndex
CREATE INDEX "SkillPredictionTask_workflowId_nodeId_idx" ON "SkillPredictionTask"("workflowId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE INDEX "SystemConfig_key_idx" ON "SystemConfig"("key");

-- CreateIndex
CREATE INDEX "SystemMetric_recordedAt_idx" ON "SystemMetric"("recordedAt");

-- CreateIndex
CREATE INDEX "SystemMetric_name_idx" ON "SystemMetric"("name");

-- CreateIndex
CREATE INDEX "SystemMetric_type_idx" ON "SystemMetric"("type");

-- CreateIndex
CREATE UNIQUE INDEX "VulnerabilityCategory_value_key" ON "VulnerabilityCategory"("value");

-- CreateIndex
CREATE INDEX "VulnerabilityCategory_isActive_idx" ON "VulnerabilityCategory"("isActive");

-- CreateIndex
CREATE INDEX "VulnerabilityCategory_value_idx" ON "VulnerabilityCategory"("value");

-- CreateIndex
CREATE UNIQUE INDEX "TechStackOption_name_key" ON "TechStackOption"("name");

-- CreateIndex
CREATE INDEX "TechStackOption_isActive_idx" ON "TechStackOption"("isActive");

-- CreateIndex
CREATE INDEX "TechStackOption_category_idx" ON "TechStackOption"("category");

-- CreateIndex
CREATE INDEX "TechStackOption_name_idx" ON "TechStackOption"("name");

-- CreateIndex
CREATE INDEX "TokenUsage_userId_createdAt_idx" ON "TokenUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_projectId_createdAt_idx" ON "TokenUsage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_evaluationId_createdAt_idx" ON "TokenUsage"("evaluationId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_createdAt_idx" ON "TokenUsage"("createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_modelName_idx" ON "TokenUsage"("modelName");

-- CreateIndex
CREATE INDEX "TokenUsage_apiProvider_idx" ON "TokenUsage"("apiProvider");

-- CreateIndex
CREATE INDEX "TokenUsage_projectId_idx" ON "TokenUsage"("projectId");

-- CreateIndex
CREATE INDEX "TokenUsage_evaluationId_idx" ON "TokenUsage"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_name_key" ON "Tool"("name");

-- CreateIndex
CREATE INDEX "Tool_isActive_idx" ON "Tool"("isActive");

-- CreateIndex
CREATE INDEX "Tool_category_idx" ON "Tool"("category");

-- CreateIndex
CREATE INDEX "ToolPermission_projectId_idx" ON "ToolPermission"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolPermission_projectId_toolPattern_key" ON "ToolPermission"("projectId", "toolPattern");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "Vulnerability_severity_status_idx" ON "Vulnerability"("severity", "status");

-- CreateIndex
CREATE INDEX "Vulnerability_projectId_status_idx" ON "Vulnerability"("projectId", "status");

-- CreateIndex
CREATE INDEX "Vulnerability_createdAt_idx" ON "Vulnerability"("createdAt");

-- CreateIndex
CREATE INDEX "Vulnerability_type_idx" ON "Vulnerability"("type");

-- CreateIndex
CREATE INDEX "Vulnerability_severity_idx" ON "Vulnerability"("severity");

-- CreateIndex
CREATE INDEX "Vulnerability_status_idx" ON "Vulnerability"("status");

-- CreateIndex
CREATE INDEX "Vulnerability_evaluationId_idx" ON "Vulnerability"("evaluationId");

-- CreateIndex
CREATE INDEX "Vulnerability_projectId_idx" ON "Vulnerability"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "VulnerabilityPattern_name_key" ON "VulnerabilityPattern"("name");

-- CreateIndex
CREATE INDEX "VulnerabilityPattern_isActive_idx" ON "VulnerabilityPattern"("isActive");

-- CreateIndex
CREATE INDEX "VulnerabilityPattern_categoryId_idx" ON "VulnerabilityPattern"("categoryId");

-- CreateIndex
CREATE INDEX "SkillAnalysis_skillId_idx" ON "SkillAnalysis"("skillId");

-- CreateIndex
CREATE INDEX "SkillAnalysis_reviewStatus_idx" ON "SkillAnalysis"("reviewStatus");

-- CreateIndex
CREATE INDEX "SkillAnalysis_analysisType_idx" ON "SkillAnalysis"("analysisType");

-- CreateIndex
CREATE INDEX "SkillAnalysis_analysisType_reviewStatus_idx" ON "SkillAnalysis"("analysisType", "reviewStatus");

-- CreateIndex
CREATE INDEX "SkillDuplicateGroup_status_idx" ON "SkillDuplicateGroup"("status");

-- CreateIndex
CREATE INDEX "SkillDuplicateGroup_language_idx" ON "SkillDuplicateGroup"("language");

-- CreateIndex
CREATE INDEX "SkillDuplicateGroup_vulnerabilityType_idx" ON "SkillDuplicateGroup"("vulnerabilityType");

-- CreateIndex
CREATE INDEX "SkillDuplicateGroupMember_groupId_idx" ON "SkillDuplicateGroupMember"("groupId");

-- CreateIndex
CREATE INDEX "SkillDuplicateGroupMember_skillId_idx" ON "SkillDuplicateGroupMember"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillDuplicateGroupMember_groupId_skillId_key" ON "SkillDuplicateGroupMember"("groupId", "skillId");

-- CreateIndex
CREATE INDEX "Workflow_status_isActive_idx" ON "Workflow"("status", "isActive");

-- CreateIndex
CREATE INDEX "Workflow_userId_status_idx" ON "Workflow"("userId", "status");

-- CreateIndex
CREATE INDEX "Workflow_isPublic_idx" ON "Workflow"("isPublic");

-- CreateIndex
CREATE INDEX "Workflow_isActive_idx" ON "Workflow"("isActive");

-- CreateIndex
CREATE INDEX "Workflow_status_idx" ON "Workflow"("status");

-- CreateIndex
CREATE INDEX "Workflow_userId_idx" ON "Workflow"("userId");

-- CreateIndex
CREATE INDEX "WorkflowRole_workflowId_idx" ON "WorkflowRole"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowNode_type_idx" ON "WorkflowNode"("type");

-- CreateIndex
CREATE INDEX "WorkflowNode_workflowId_idx" ON "WorkflowNode"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowNode_roleId_idx" ON "WorkflowNode"("roleId");

-- CreateIndex
CREATE INDEX "WorkflowEdge_targetId_idx" ON "WorkflowEdge"("targetId");

-- CreateIndex
CREATE INDEX "WorkflowEdge_sourceId_idx" ON "WorkflowEdge"("sourceId");

-- CreateIndex
CREATE INDEX "WorkflowEdge_workflowId_idx" ON "WorkflowEdge"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowEdge_sourceId_targetId_sourceHandle_key" ON "WorkflowEdge"("sourceId", "targetId", "sourceHandle");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflowId_status_idx" ON "WorkflowExecution"("workflowId", "status");

-- CreateIndex
CREATE INDEX "WorkflowExecution_startedAt_idx" ON "WorkflowExecution"("startedAt");

-- CreateIndex
CREATE INDEX "WorkflowExecution_status_idx" ON "WorkflowExecution"("status");

-- CreateIndex
CREATE INDEX "WorkflowExecution_userId_idx" ON "WorkflowExecution"("userId");

-- CreateIndex
CREATE INDEX "WorkflowExecution_workflowId_idx" ON "WorkflowExecution"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowExecutionStep_status_idx" ON "WorkflowExecutionStep"("status");

-- CreateIndex
CREATE INDEX "WorkflowExecutionStep_nodeId_idx" ON "WorkflowExecutionStep"("nodeId");

-- CreateIndex
CREATE INDEX "WorkflowExecutionStep_executionId_idx" ON "WorkflowExecutionStep"("executionId");

-- CreateIndex
CREATE INDEX "WorkflowShare_sharedWith_idx" ON "WorkflowShare"("sharedWith");

-- CreateIndex
CREATE INDEX "WorkflowShare_sharedBy_idx" ON "WorkflowShare"("sharedBy");

-- CreateIndex
CREATE INDEX "WorkflowShare_workflowId_idx" ON "WorkflowShare"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowShare_workflowId_sharedWith_key" ON "WorkflowShare"("workflowId", "sharedWith");

-- CreateIndex
CREATE INDEX "SkillVulnerabilityMapping_skillId_idx" ON "SkillVulnerabilityMapping"("skillId");

-- CreateIndex
CREATE INDEX "SkillVulnerabilityMapping_vulnerabilityId_idx" ON "SkillVulnerabilityMapping"("vulnerabilityId");

-- CreateIndex
CREATE INDEX "SkillVulnerabilityMapping_evaluationId_idx" ON "SkillVulnerabilityMapping"("evaluationId");

-- CreateIndex
CREATE INDEX "SkillVulnerabilityMapping_projectId_idx" ON "SkillVulnerabilityMapping"("projectId");

-- CreateIndex
CREATE INDEX "SkillVulnerabilityMapping_matchType_idx" ON "SkillVulnerabilityMapping"("matchType");

-- CreateIndex
CREATE UNIQUE INDEX "SkillVulnerabilityMapping_skillId_vulnerabilityId_key" ON "SkillVulnerabilityMapping"("skillId", "vulnerabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "_PermissionToRole_AB_unique" ON "_PermissionToRole"("A", "B");

-- CreateIndex
CREATE INDEX "_PermissionToRole_B_index" ON "_PermissionToRole"("B");
