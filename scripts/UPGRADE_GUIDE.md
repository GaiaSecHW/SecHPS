# 生产环境数据库升级指南

## 概述

本指南用于将生产环境数据库升级到当前最新表结构。

## 升级脚本修复说明 (v2)

原脚本存在以下问题，已修复：

| 问题 | 修复内容 |
|------|----------|
| 缺少 21 个新模型处理 | 添加了所有新模型的数据导出和保留逻辑 |
| 缺少 VulnerabilityCategory 导入 | 添加了漏洞分类种子数据导入 |
| ToolPermission/ScanReport/SessionMeta 未处理 | 添加了这些用户数据的保留逻辑 |
| Agent 相关模型未处理 | 添加了 AgentDefinition/AgentTeam 等数据保留 |
| Skill 治理模型未处理 | 添加了 SkillAnalysis/DuplicateGroup 等数据保留 |
| 新增字段检查不完整 | 添加了 Skill.isPublic、ModelConfig.isPublic、McpServerConfig.isShared 字段检查 |

## 升级前检查清单

- [ ] 生产服务器已停止
- [ ] 已手动备份数据库 `e:\dev.db`
- [ ] 确认开发数据库 `prisma/dev.db` 存在且是最新的
- [ ] 确认 Node.js 环境可用

## 执行步骤

### 1. 停止生产服务

```bash
# 停止所有相关服务
pm2 stop all
# 或
systemctl stop your-service
```

### 2. 手动备份（强烈建议）

```bash
# Windows
copy e:\dev.db e:\dev.db.manual.backup

# Linux
cp /path/to/dev.db /path/to/dev.db.manual.backup
```

### 3. 执行升级脚本

```bash
# 进入项目目录
cd /path/to/claude-web-platform

# 执行升级
node scripts/upgrade-prod-db.js
```

### 4. 验证升级结果

脚本会自动输出：
- 数据保留验证（before -> after 对比）
- 最终数据统计

**关键验证点：**
- Users 数量是否一致
- Projects 数量是否一致
- Vulnerabilities 数量是否一致
- TokenUsages 数量是否一致

### 5. 启动服务并测试

```bash
# 启动服务
npm run start
# 或
pm2 start all

# 测试关键功能
# 1. 用户登录
# 2. 项目列表
# 3. 漏洞查看
# 4. 权限控制
```

## 数据保留清单

| 数据类型 | 表名 | 处理方式 |
|----------|------|----------|
| 用户数据 | User, UserRole | ✅ 保留 |
| 项目数据 | Project, ProjectFile, ProjectStructure | ✅ 保留 |
| 漏洞数据 | Vulnerability | ✅ 保留 |
| MCP服务器 | McpServerConfig | ✅ 保留 |
| 模型配置 | ModelConfig | ✅ 保留 |
| Token统计 | TokenUsage | ✅ 保留 |
| 评估会话 | EvaluationSession, EvaluationIteration, EvaluationResult, SessionMessage, NodeExecution, AnalysisReport | ✅ 保留 |
| 技能数据 | Skill, SkillExecution | ✅ 保留 |
| 工作流数据 | Workflow, WorkflowNode, WorkflowEdge, WorkflowExecution, WorkflowExecutionStep, WorkflowShare, WorkflowRole | ✅ 保留 |
| 审计日志 | AuditLog | ✅ 保留 |
| 扫描数据 | ScanTask, ScanReport, ToolPermission, SessionMeta | ✅ 保留 |
| Agent数据 | AgentDefinition, AgentTeam, AgentTeamMember, AgentTeamExecution, AgentMemberExecution | ✅ 保留 |
| Skill治理 | SkillEvolution, SkillMergeRecord, SkillAnalysis, SkillDuplicateGroup, etc. | ✅ 保留 |
| 其他数据 | CodeKnowledge, DataFlow, SkillPrediction, etc. | ✅ 保留 |

## 重建的系统数据

| 数据类型 | 表名 | 来源 |
|----------|------|------|
| 角色权限 | Role, Permission, _PermissionToRole | 开发库导入 |
| 技术栈选项 | TechStackOption | 开发库导入 |
| 漏洞分类 | VulnerabilityCategory | 开发库导入 |
| 漏洞模式 | VulnerabilityPattern | 开发库导入 |
| 工具定义 | Tool | 开发库导入 |
| 治理配置 | SkillGovernanceConfig | 开发库导入 |
| OpenCode配置 | OpencodeConfig | 开发库导入 |

## 回滚方案

如果升级失败：

```bash
# 恢复备份
copy e:\dev.db.backup e:\dev.db

# 重启服务
pm2 start all
```

## 注意事项

1. **必须停止服务**：升级期间数据库文件被占用会导致失败
2. **开发库必须存在**：脚本从 `prisma/dev.db` 读取种子数据
3. **验证数据完整性**：升级后务必检查用户数据是否完整
4. **测试权限功能**：权限系统已重建，需要验证用户权限是否正确

## 常见问题

### Q: 脚本报错 "database is locked"
A: 生产服务未停止，请先停止所有访问数据库的服务

### Q: 脚本报错 "no such table: xxx"
A: 正常情况，脚本会自动跳过不存在的表

### Q: 用户数据数量不一致
A: 请检查备份文件，可能需要回滚并重新升级

### Q: 权限功能异常
A: 检查用户角色关联是否正确，可能需要手动分配角色
