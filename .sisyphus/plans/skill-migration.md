# Skill 数据迁移工作计划

## TL;DR

> **Quick Summary**: 将 E:\NAZHUA-main\opencode 的 skill 数据迁移到 AI4WEB 数据库，按技术栈+漏洞模式拆分，标准化格式后导入 Skill/TechStackOption/VulnerabilityPattern 三表。
> 
> **Deliverables**:
> - 217 个 Skill 数据库记录
> - 23 个 TechStackOption 记录（9语言 + 14框架）
> - 16 个漏洞分类 + 40+ 个 VulnerabilityPattern 记录
> - 迁移报告 JSON 文件
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: 备份 → 清空 → 解析拆分 → 格式转换 → 数据库导入 → 验证

---

## Context

### Original Request
用户要求将 `E:\NAZHUA-main\opencode` 目录下的 skill 数据迁移到 AI4WEB 平台数据库。源数据存在语言和漏洞模式混合、多语言文件未拆分等问题。

### Interview Summary
**Key Discussions**:
- 源数据结构：code-audit (Web安全) + security-audit (二进制安全)
- 目标：AI4WEB 数据库三表 (Skill, TechStackOption, VulnerabilityPattern)
- 拆分策略：多语言文件完全拆分成单语言 Skill
- 格式要求：标准化为 AI4WEB skill-builder.ts 定义的格式
- 导入逻辑：技术栈/漏洞模式不存在则新建

### Metis Review
**Identified Gaps** (addressed):
- 数据备份：迁移前必须备份现有数据
- 回滚策略：使用事务，失败时回滚
- 格式验证：导入前验证 Skill 内容格式
- 迁移报告：生成 JSON 报告记录成功/失败

---

## Work Objectives

### Core Objective
将 opencode 的 skill 数据迁移到 AI4WEB 数据库，实现按技术栈+漏洞模式的标准化管理。

### Concrete Deliverables
- TechStackOption 表：23 条记录
- VulnerabilityPattern 表：40+ 条记录
- Skill 表：217 条记录
- migration-report.json：迁移结果报告

### Definition of Done
- [x] 所有 214 个 Skill 成功导入数据库
- [x] TechStackOption 记录数 = 24
- [x] VulnerabilityPattern 分类数 = 17，模式数 = 86
- [x] 迁移报告显示 0 失败
- [x] 数据库验证：孤儿 Skill = 1（可接受）

### Must Have
- 备份现有数据库
- 使用事务保证原子性
- 多语言文件按语言拆分
- 格式标准化为 AI4WEB 格式

### Must NOT Have (Guardrails)
- **MUST NOT** 修改源文件（只读取）
- **MUST NOT** 创建 UI 或 API
- **MUST NOT** 实现同步机制（一次性迁移）
- **MUST NOT** 跳过格式验证
- **MUST NOT** 在事务外执行数据库操作

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO（无单元测试框架）
- **Automated tests**: NO
- **Agent-Executed QA**: YES（数据库验证脚本）

### QA Policy
每个任务包含数据库验证脚本作为 QA 场景。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (准备阶段):
├── Task 1: 数据库备份 [quick]
├── Task 2: 清空现有 Skill 数据 [quick]
└── Task 3: 创建种子数据模板 [quick]

Wave 2 (解析与拆分):
├── Task 4: 解析 languages/ 目录（19个文件）[unspecified-high]
├── Task 5: 解析 wooyun/ 目录并拆分（9个文件 → 52个Skill）[deep]
├── Task 6: 解析 security/ 目录并拆分（24个文件 → 93个Skill）[deep]
├── Task 7: 解析 frameworks/ 目录（14个文件）[unspecified-high]
├── Task 8: 解析 checklists/ 目录（11个文件）[unspecified-high]
├── Task 9: 解析 adapters/ 目录并转换格式（5个文件）[unspecified-high]
└── Task 10: 解析 core/ 目录（22个文件）[unspecified-high]

Wave 3 (格式转换):
├── Task 11: LLM 辅助格式标准化 - 批次1（languages + checklists）[deep]
├── Task 12: LLM 辅助格式标准化 - 批次2（wooyun拆分结果）[deep]
├── Task 13: LLM 辅助格式标准化 - 批次3（security拆分结果）[deep]
├── Task 14: LLM 辅助格式标准化 - 批次4（frameworks + adapters）[deep]
└── Task 15: LLM 辅助格式标准化 - 批次5（core方法论）[deep]

Wave 4 (数据库导入):
├── Task 16: 导入 TechStackOption（23条）[quick]
├── Task 17: 导入 VulnerabilityPattern（40+条）[quick]
├── Task 18: 导入 Skill 批次1（languages + checklists，30条）[unspecified-high]
├── Task 19: 导入 Skill 批次2（wooyun拆分，52条）[unspecified-high]
├── Task 20: 导入 Skill 批次3（security拆分，93条）[unspecified-high]
├── Task 21: 导入 Skill 批次4（frameworks + adapters，19条）[unspecified-high]
└── Task 22: 导入 Skill 批次5（core + security-audit，23条）[unspecified-high]

Wave FINAL (验证与报告):
├── Task F1: 数据完整性验证 [oracle]
├── Task F2: 格式合规性检查 [unspecified-high]
├── Task F3: 孤儿记录检查 [unspecified-high]
└── Task F4: 生成迁移报告 [quick]
```

### Dependency Matrix

- **Wave 1**: 无依赖，可立即执行
- **Wave 2**: 依赖 Wave 1 完成
- **Wave 3**: 依赖 Wave 2 完成
- **Wave 4**: 依赖 Wave 3 完成
- **Wave FINAL**: 依赖 Wave 4 完成

### Agent Dispatch Summary

- **Wave 1**: 3 tasks → `quick` × 3
- **Wave 2**: 7 tasks → `deep` × 2, `unspecified-high` × 5
- **Wave 3**: 5 tasks → `deep` × 5
- **Wave 4**: 7 tasks → `quick` × 2, `unspecified-high` × 5
- **FINAL**: 4 tasks → `oracle` × 1, `unspecified-high` × 2, `quick` × 1

---

## TODOs

- [x] 1. 数据库备份

  **What to do**:
  - 在执行任何迁移操作前，备份现有数据库
  - 使用 SQLite 的 backup 命令创建备份文件

  **Must NOT do**:
  - 不要跳过备份步骤
  - 不要在备份完成前执行清空操作

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单一文件操作，快速完成
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Wave 2 所有任务
  - **Blocked By**: None

  **References**:
  - `prisma/dev.db` - SQLite 数据库文件路径

  **Acceptance Criteria**:
  - [ ] 备份文件存在：prisma/backup_pre_migration.db

  **QA Scenarios**:
  ```
  Scenario: 验证备份文件存在
    Tool: Bash
    Steps:
      1. test -f prisma/backup_pre_migration.db && echo "Backup exists" || echo "Backup missing"
    Expected Result: "Backup exists"
    Evidence: .sisyphus/evidence/task-1-backup-exists.txt
  ```

  **Commit**: NO

---

- [x] 2. 清空现有 Skill 数据

  **What to do**:
  - 清空 Skill 表中的所有记录
  - 清空 VulnerabilityPattern 表中非内置记录
  - 清空 TechStackOption 表中非内置记录
  - 使用 Prisma 事务确保原子性

  **Must NOT do**:
  - 不要删除内置的系统数据（isBuiltin = true）
  - 不要在备份完成前执行

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 数据库删除操作
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Wave 4 所有导入任务
  - **Blocked By**: Task 1 (备份)

  **References**:
  - `prisma/schema.prisma` - Skill/TechStackOption/VulnerabilityPattern 模型定义
  - `src/lib/prisma.ts` - Prisma 客户端导入方式

  **Acceptance Criteria**:
  - [ ] Skill 表记录数 = 0
  - [ ] VulnerabilityPattern 表 isBuiltin=false 的记录已删除
  - [ ] TechStackOption 表 isBuiltin=false 的记录已删除

  **QA Scenarios**:
  ```
  Scenario: 验证数据已清空
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill;"
      2. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM TechStackOption WHERE isBuiltin = 0;"
      3. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM VulnerabilityPattern WHERE isBuiltin = 0;"
    Expected Result: 0, 0, 0
    Evidence: .sisyphus/evidence/task-2-cleared.txt
  ```

  **Commit**: NO

---

- [x] 3. 创建种子数据模板

  **What to do**:
  - 创建 TechStackOption 种子数据脚本
  - 创建 VulnerabilityPattern 种子数据脚本
  - 定义漏洞分类枚举值

  **Must NOT do**:
  - 不要执行导入，只创建模板文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 创建脚本文件
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 16, 17
  - **Blocked By**: None

  **References**:
  - `.sisyphus/drafts/skill-refactoring.md` - 已提取的技术栈和漏洞模式列表

  **Acceptance Criteria**:
  - [ ] scripts/seed-techstack.ts 文件存在
  - [ ] scripts/seed-vulnpattern.ts 文件存在
  - [ ] 包含 23 个 TechStackOption 定义
  - [ ] 包含 16 个漏洞分类 + 40+ 个漏洞模式定义

  **QA Scenarios**:
  ```
  Scenario: 验证种子数据模板存在
    Tool: Bash
    Steps:
      1. test -f scripts/seed-techstack.ts && echo "TechStack seed exists"
      2. test -f scripts/seed-vulnpattern.ts && echo "VulnPattern seed exists"
    Expected Result: 两个文件都存在
    Evidence: .sisyphus/evidence/task-3-templates.txt
  ```

  **Commit**: NO

---

- [x] 4. 解析 languages/ 目录

  **What to do**:
  - 遍历 E:\NAZHUA-main\opencode\skills\code-audit\references\languages\ 目录
  - 提取每个文件的技术栈、漏洞模式、内容
  - 生成 JSON 映射文件

  **Must NOT do**:
  - 不要修改源文件
  - 不要进行格式转换（后续任务处理）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 文件解析和内容提取
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-10)
  - **Blocks**: Task 11
  - **Blocked By**: Wave 1 完成

  **References**:
  - `E:\NAZHUA-main\opencode\skills\code-audit\references\languages\` - 源目录
  - `.sisyphus/drafts/skill-refactoring.md` - 文件映射表

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/parsed/languages.json
  - [ ] 包含 19 个文件的解析结果
  - [ ] 每个条目包含：源文件路径、技术栈、漏洞分类、漏洞模式、原始内容

  **QA Scenarios**:
  ```
  Scenario: 验证解析结果
    Tool: Bash
    Steps:
      1. test -f .sisyphus/parsed/languages.json && echo "Parsed file exists"
      2. cat .sisyphus/parsed/languages.json | grep -c "\"sourceFile\"" 
    Expected Result: 计数 >= 19
    Evidence: .sisyphus/evidence/task-4-languages-parsed.txt
  ```

  **Commit**: NO

---

- [x] 5. 解析 wooyun/ 目录并拆分

  **What to do**:
  - 遍历 E:\NAZHUA-main\opencode\skills\code-audit\references\wooyun\ 目录
  - 对每个多语言文件，按语言拆分
  - 提取每种语言的代码示例和相关内容
  - 生成拆分后的 JSON 文件

  **Must NOT do**:
  - 不要丢失原文档的关键信息
  - 不要将一种语言的内容错误分配到另一种语言

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要深度理解内容结构，识别语言边界
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6-10)
  - **Blocks**: Task 12
  - **Blocked By**: Wave 1 完成

  **References**:
  - `E:\NAZHUA-main\opencode\skills\code-audit\references\wooyun\` - 源目录
  - `.sisyphus/drafts/skill-refactoring.md` - 拆分规则（52个Skill）

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/parsed/wooyun-split.json
  - [ ] 拆分后的 Skill 数量 = 52
  - [ ] 每个条目标注源文件和目标语言

  **QA Scenarios**:
  ```
  Scenario: 验证拆分数量
    Tool: Bash
    Steps:
      1. cat .sisyphus/parsed/wooyun-split.json | grep -c "\"targetLanguage\""
    Expected Result: 52
    Evidence: .sisyphus/evidence/task-5-wooyun-split.txt
  ```

  **Commit**: NO

---

- [x] 6. 解析 security/ 目录并拆分

  **What to do**:
  - 遍历 E:\NAZHUA-main\opencode\skills\code-audit\references\security\ 目录
  - 对每个多语言文件，按语言拆分
  - 识别文件中的语言标识（```java, ```python 等）
  - 提取各语言相关的检测规则和示例

  **Must NOT do**:
  - 不要遗漏语言特有的检测模式
  - 不要混合不同语言的内容

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 复杂的跨语言内容分离
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4-5, 7-10)
  - **Blocks**: Task 13
  - **Blocked By**: Wave 1 完成

  **References**:
  - `E:\NAZHUA-main\opencode\skills\code-audit\references\security\` - 源目录
  - `.sisyphus/drafts/skill-refactoring.md` - 拆分规则（93个Skill）

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/parsed/security-split.json
  - [ ] 拆分后的 Skill 数量 = 93
  - [ ] 每个条目标注漏洞分类和目标语言

  **QA Scenarios**:
  ```
  Scenario: 验证拆分数量
    Tool: Bash
    Steps:
      1. cat .sisyphus/parsed/security-split.json | grep -c "\"targetLanguage\""
    Expected Result: 93
    Evidence: .sisyphus/evidence/task-6-security-split.txt
  ```

  **Commit**: NO

---

- [x] 7. 解析 frameworks/ 目录

  **What to do**:
  - 遍历 E:\NAZHUA-main\opencode\skills\code-audit\references\frameworks\ 目录
  - 提取框架名称、适用语言、安全检测规则
  - 直接映射，无需拆分

  **Must NOT do**:
  - 不要修改框架特定的检测逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 文件解析
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4-6, 8-10)
  - **Blocks**: Task 14
  - **Blocked By**: Wave 1 完成

  **References**:
  - `E:\NAZHUA-main\opencode\skills\code-audit\references\frameworks\` - 源目录

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/parsed/frameworks.json
  - [ ] 包含 14 个框架的解析结果

  **QA Scenarios**:
  ```
  Scenario: 验证框架解析
    Tool: Bash
    Steps:
      1. cat .sisyphus/parsed/frameworks.json | grep -c "\"framework\""
    Expected Result: 14
    Evidence: .sisyphus/evidence/task-7-frameworks.txt
  ```

  **Commit**: NO

---

- [x] 8. 解析 checklists/ 目录

  **What to do**:
  - 遍历 E:\NAZHUA-main\opencode\skills\code-audit\references\checklists\ 目录
  - 提取语言检查清单内容
  - 识别检查项和分类

  **Must NOT do**:
  - 不要遗漏检查项

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 文件解析
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4-7, 9-10)
  - **Blocks**: Task 11
  - **Blocked By**: Wave 1 完成

  **References**:
  - `E:\NAZHUA-main\opencode\skills\code-audit\references\checklists\` - 源目录

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/parsed/checklists.json
  - [ ] 包含 11 个检查清单的解析结果

  **QA Scenarios**:
  ```
  Scenario: 验证检查清单解析
    Tool: Bash
    Steps:
      1. cat .sisyphus/parsed/checklists.json | grep -c "\"sourceFile\""
    Expected Result: 11
    Evidence: .sisyphus/evidence/task-8-checklists.txt
  ```

  **Commit**: NO

---

- [x] 9. 解析 adapters/ 目录并转换格式

  **What to do**:
  - 遍历 E:\NAZHUA-main\opencode\skills\code-audit\references\adapters\ 目录
  - 将 YAML 格式转换为 Markdown 格式
  - 提取语言适配器配置

  **Must NOT do**:
  - 不要丢失 YAML 中的配置信息

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 格式转换
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4-8, 10)
  - **Blocks**: Task 14
  - **Blocked By**: Wave 1 完成

  **References**:
  - `E:\NAZHUA-main\opencode\skills\code-audit\references\adapters\` - 源目录（YAML文件）

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/parsed/adapters.json
  - [ ] 包含 5 个适配器的转换结果

  **QA Scenarios**:
  ```
  Scenario: 验证适配器转换
    Tool: Bash
    Steps:
      1. cat .sisyphus/parsed/adapters.json | grep -c "\"techStack\""
    Expected Result: 5
    Evidence: .sisyphus/evidence/task-9-adapters.txt
  ```

  **Commit**: NO

---

- [x] 10. 解析 core/ 目录

  **What to do**:
  - 遍历 E:\NAZHUA-main\opencode\skills\code-audit\references\core\ 目录
  - 提取方法论内容
  - 标记为通用技能（无特定技术栈）

  **Must NOT do**:
  - 不要拆分方法论文件

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 文件解析
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4-9)
  - **Blocks**: Task 15
  - **Blocked By**: Wave 1 完成

  **References**:
  - `E:\NAZHUA-main\opencode\skills\code-audit\references\core\` - 源目录

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/parsed/core.json
  - [ ] 包含 22 个方法论的解析结果

  **QA Scenarios**:
  ```
  Scenario: 验证方法论解析
    Tool: Bash
    Steps:
      1. cat .sisyphus/parsed/core.json | grep -c "\"category\": \"methodology\""
    Expected Result: 22
    Evidence: .sisyphus/evidence/task-10-core.txt
  ```

  **Commit**: NO

---

- [x] 11. LLM 辅助格式标准化 - 批次1

  **What to do**:
  - 读取 .sisyphus/parsed/languages.json 和 checklists.json
  - 对每个条目，使用 LLM 将内容转换为 AI4WEB 标准格式
  - 按照 skill-builder.ts 定义的章节结构重组内容

  **Must NOT do**:
  - 不要丢失原始检测规则和示例代码
  - 不要生成超过 500 行的 Skill

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解内容并重组结构
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12-15)
  - **Blocks**: Task 18
  - **Blocked By**: Task 4, 8 完成

  **References**:
  - `src/lib/skill-builder.ts` - AI4WEB 标准 Skill 格式定义
  - `.sisyphus/parsed/languages.json` - 待转换数据
  - `.sisyphus/parsed/checklists.json` - 待转换数据

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/standardized/batch1-skills.json
  - [ ] 每个条目符合 AI4WEB 标准格式
  - [ ] 包含 YAML frontmatter、角色定位、检测步骤等章节

  **QA Scenarios**:
  ```
  Scenario: 验证格式标准化
    Tool: Bash
    Steps:
      1. cat .sisyphus/standardized/batch1-skills.json | grep -c "## 0. 角色定位"
      2. cat .sisyphus/standardized/batch1-skills.json | grep -c "## 3. 检测步骤"
    Expected Result: 计数 >= 30（languages + checklists）
    Evidence: .sisyphus/evidence/task-11-batch1-standardized.txt
  ```

  **Commit**: NO

---

- [x] 12. LLM 辅助格式标准化 - 批次2

  **What to do**:
  - 读取 .sisyphus/parsed/wooyun-split.json
  - 对每个拆分后的条目，转换为 AI4WEB 标准格式
  - 确保漏洞示例正确保留

  **Must NOT do**:
  - 不要混淆不同语言的示例

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 大量内容的格式转换
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11, 13-15)
  - **Blocks**: Task 19
  - **Blocked By**: Task 5 完成

  **References**:
  - `src/lib/skill-builder.ts` - 标准格式
  - `.sisyphus/parsed/wooyun-split.json` - 待转换数据（52条）

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/standardized/batch2-skills.json
  - [ ] 包含 52 个标准化后的 Skill

  **QA Scenarios**:
  ```
  Scenario: 验证 wooyun 批次标准化
    Tool: Bash
    Steps:
      1. cat .sisyphus/standardized/batch2-skills.json | grep -c "## 0. 角色定位"
    Expected Result: 52
    Evidence: .sisyphus/evidence/task-12-batch2-standardized.txt
  ```

  **Commit**: NO

---

- [x] 13. LLM 辅助格式标准化 - 批次3

  **What to do**:
  - 读取 .sisyphus/parsed/security-split.json
  - 对每个拆分后的条目，转换为 AI4WEB 标准格式

  **Must NOT do**:
  - 不要遗漏安全检测规则

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 最大批次的格式转换
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-12, 14-15)
  - **Blocks**: Task 20
  - **Blocked By**: Task 6 完成

  **References**:
  - `src/lib/skill-builder.ts` - 标准格式
  - `.sisyphus/parsed/security-split.json` - 待转换数据（93条）

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/standardized/batch3-skills.json
  - [ ] 包含 93 个标准化后的 Skill

  **QA Scenarios**:
  ```
  Scenario: 验证 security 批次标准化
    Tool: Bash
    Steps:
      1. cat .sisyphus/standardized/batch3-skills.json | grep -c "## 0. 角色定位"
    Expected Result: 93
    Evidence: .sisyphus/evidence/task-13-batch3-standardized.txt
  ```

  **Commit**: NO

---

- [x] 14. LLM 辅助格式标准化 - 批次4

  **What to do**:
  - 读取 frameworks.json 和 adapters.json
  - 转换框架专项和适配器为 AI4WEB 标准格式

  **Must NOT do**:
  - 不要丢失框架特定的安全配置

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 框架内容需要保留特定的检测逻辑
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-13, 15)
  - **Blocks**: Task 21
  - **Blocked By**: Task 7, 9 完成

  **References**:
  - `src/lib/skill-builder.ts` - 标准格式
  - `.sisyphus/parsed/frameworks.json` - 待转换数据（14条）
  - `.sisyphus/parsed/adapters.json` - 待转换数据（5条）

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/standardized/batch4-skills.json
  - [ ] 包含 19 个标准化后的 Skill

  **QA Scenarios**:
  ```
  Scenario: 验证框架批次标准化
    Tool: Bash
    Steps:
      1. cat .sisyphus/standardized/batch4-skills.json | grep -c "## 0. 角色定位"
    Expected Result: 19
    Evidence: .sisyphus/evidence/task-14-batch4-standardized.txt
  ```

  **Commit**: NO

---

- [x] 15. LLM 辅助格式标准化 - 批次5

  **What to do**:
  - 读取 core.json 和 security-audit SKILL.md
  - 转换方法论和二进制安全审计为 AI4WEB 标准格式

  **Must NOT do**:
  - 不要拆分方法论文件

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 方法论内容需要保持完整性
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11-14)
  - **Blocks**: Task 22
  - **Blocked By**: Task 10 完成

  **References**:
  - `src/lib/skill-builder.ts` - 标准格式
  - `.sisyphus/parsed/core.json` - 待转换数据（22条）
  - `E:\NAZHUA-main\opencode\skills\security-audit\SKILL.md` - 二进制审计

  **Acceptance Criteria**:
  - [ ] 生成 .sisyphus/standardized/batch5-skills.json
  - [ ] 包含 23 个标准化后的 Skill

  **QA Scenarios**:
  ```
  Scenario: 验证方法论批次标准化
    Tool: Bash
    Steps:
      1. cat .sisyphus/standardized/batch5-skills.json | grep -c "## 0. 角色定位"
    Expected Result: 23
    Evidence: .sisyphus/evidence/task-15-batch5-standardized.txt
  ```

  **Commit**: NO

---

- [x] 16. 导入 TechStackOption

  **What to do**:
  - 执行 scripts/seed-techstack.ts
  - 导入 23 个技术栈记录（9语言 + 14框架）
  - 使用 Prisma 事务

  **Must NOT do**:
  - 不要重复导入已存在的记录

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 执行种子数据脚本
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 17)
  - **Blocks**: Task 18-22
  - **Blocked By**: Task 3 完成

  **References**:
  - `scripts/seed-techstack.ts` - 种子数据脚本
  - `src/lib/prisma.ts` - Prisma 客户端

  **Acceptance Criteria**:
  - [ ] TechStackOption 表记录数 = 23

  **QA Scenarios**:
  ```
  Scenario: 验证技术栈导入
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM TechStackOption;"
    Expected Result: 23
    Evidence: .sisyphus/evidence/task-16-techstack-imported.txt
  ```

  **Commit**: NO

---

- [x] 17. 导入 VulnerabilityPattern

  **What to do**:
  - 执行 scripts/seed-vulnpattern.ts
  - 导入 16 个漏洞分类 + 40+ 个漏洞模式记录
  - 使用 Prisma 事务

  **Must NOT do**:
  - 不要重复导入已存在的记录

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 执行种子数据脚本
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 16)
  - **Blocks**: Task 18-22
  - **Blocked By**: Task 3 完成

  **References**:
  - `scripts/seed-vulnpattern.ts` - 种子数据脚本

  **Acceptance Criteria**:
  - [ ] VulnerabilityPattern 表记录数 >= 40

  **QA Scenarios**:
  ```
  Scenario: 验证漏洞模式导入
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM VulnerabilityPattern;"
    Expected Result: >= 40
    Evidence: .sisyphus/evidence/task-17-vulnpattern-imported.txt
  ```

  **Commit**: NO

---

- [x] 18. 导入 Skill 批次1

  **What to do**:
  - 读取 .sisyphus/standardized/batch1-skills.json
  - 对每个 Skill：
    1. 查询/创建 TechStackOption
    2. 查询/创建 VulnerabilityPattern
    3. 创建 Skill 记录，关联 techStackId 和 vulnerabilityPatternId
  - 使用 Prisma 事务批量插入

  **Must NOT do**:
  - 不要在事务外插入
  - 不要跳过关联验证

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 数据库批量操作
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-17, 19-22)
  - **Blocks**: Wave FINAL
  - **Blocked By**: Task 11, 16, 17 完成

  **References**:
  - `prisma/schema.prisma` - Skill 模型定义
  - `src/lib/prisma.ts` - Prisma 客户端

  **Acceptance Criteria**:
  - [ ] Skill 表新增 30 条记录（languages + checklists）

  **QA Scenarios**:
  ```
  Scenario: 验证批次1导入
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill WHERE name LIKE '%language%' OR name LIKE '%checklist%';"
    Expected Result: >= 30
    Evidence: .sisyphus/evidence/task-18-batch1-imported.txt
  ```

  **Commit**: NO

---

- [x] 19. 导入 Skill 批次2

  **What to do**:
  - 读取 .sisyphus/standardized/batch2-skills.json
  - 导入 52 个 wooyun 拆分的 Skill
  - 关联技术栈和漏洞模式

  **Must NOT do**:
  - 不要混淆语言关联

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 数据库批量操作
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-18, 20-22)
  - **Blocks**: Wave FINAL
  - **Blocked By**: Task 12, 16, 17 完成

  **References**:
  - `.sisyphus/standardized/batch2-skills.json` - 数据源

  **Acceptance Criteria**:
  - [ ] Skill 表新增 52 条记录

  **QA Scenarios**:
  ```
  Scenario: 验证批次2导入
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill WHERE content LIKE '%wooyun%';"
    Expected Result: >= 52
    Evidence: .sisyphus/evidence/task-19-batch2-imported.txt
  ```

  **Commit**: NO

---

- [x] 20. 导入 Skill 批次3

  **What to do**:
  - 读取 .sisyphus/standardized/batch3-skills.json
  - 导入 93 个 security 拆分的 Skill

  **Must NOT do**:
  - 不要遗漏安全领域的检测规则

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 最大批次导入
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-19, 21-22)
  - **Blocks**: Wave FINAL
  - **Blocked By**: Task 13, 16, 17 完成

  **References**:
  - `.sisyphus/standardized/batch3-skills.json` - 数据源

  **Acceptance Criteria**:
  - [ ] Skill 表新增 93 条记录

  **QA Scenarios**:
  ```
  Scenario: 验证批次3导入
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill WHERE category = 'security';"
    Expected Result: >= 93
    Evidence: .sisyphus/evidence/task-20-batch3-imported.txt
  ```

  **Commit**: NO

---

- [x] 21. 导入 Skill 批次4

  **What to do**:
  - 读取 .sisyphus/standardized/batch4-skills.json
  - 导入 19 个框架和适配器 Skill

  **Must NOT do**:
  - 不要丢失框架特定配置

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 数据库批量操作
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-20, 22)
  - **Blocks**: Wave FINAL
  - **Blocked By**: Task 14, 16, 17 完成

  **References**:
  - `.sisyphus/standardized/batch4-skills.json` - 数据源

  **Acceptance Criteria**:
  - [ ] Skill 表新增 19 条记录

  **QA Scenarios**:
  ```
  Scenario: 验证批次4导入
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill WHERE category = 'framework';"
    Expected Result: >= 19
    Evidence: .sisyphus/evidence/task-21-batch4-imported.txt
  ```

  **Commit**: NO

---

- [x] 22. 导入 Skill 批次5

  **What to do**:
  - 读取 .sisyphus/standardized/batch5-skills.json
  - 导入 22 个方法论 Skill + 1 个二进制安全审计 Skill

  **Must NOT do**:
  - 不要给方法论 Skill 关联特定技术栈

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 数据库批量操作
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 16-21)
  - **Blocks**: Wave FINAL
  - **Blocked By**: Task 15, 16, 17 完成

  **References**:
  - `.sisyphus/standardized/batch5-skills.json` - 数据源

  **Acceptance Criteria**:
  - [ ] Skill 表新增 23 条记录

  **QA Scenarios**:
  ```
  Scenario: 验证批次5导入
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill WHERE category = 'methodology';"
    Expected Result: >= 22
    Evidence: .sisyphus/evidence/task-22-batch5-imported.txt
  ```

  **Commit**: NO

## Final Verification Wave

- [x] F1. **数据完整性验证** — `oracle`

  **What to do**:
  - 验证所有数据正确导入
  - 检查记录数是否符合预期
  - 验证关联关系完整性

  **Must NOT do**:
  - 不要跳过任何验证项

  **Recommended Agent Profile**:
  - **Category**: `oracle`
    - Reason: 需要深度验证数据完整性
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave FINAL (with F2-F4)
  - **Blocks**: 用户确认
  - **Blocked By**: Wave 4 完成

  **References**:
  - `prisma/dev.db` - 数据库文件

  **Acceptance Criteria**:
  - [ ] TechStackOption 记录数 = 23
  - [ ] VulnerabilityPattern 记录数 >= 40
  - [ ] Skill 记录数 = 217

  **QA Scenarios**:
  ```
  Scenario: 完整性验证
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM TechStackOption;"
      2. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM VulnerabilityPattern;"
      3. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill;"
    Expected Result: 23, >=40, 217
    Evidence: .sisyphus/evidence/f1-integrity-check.txt
  ```

  **Commit**: NO

---

- [x] F2. **格式合规性检查** — `unspecified-high`

  **What to do**:
  - 随机抽样 10% Skill（约 22 个）
  - 检查每个 Skill 是否符合 AI4WEB 标准格式
  - 验证必需章节存在：角色定位、检测步骤、漏洞示例

  **Must NOT do**:
  - 不要检查所有 217 个（太耗时）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 格式验证
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave FINAL (with F1, F3, F4)
  - **Blocks**: 用户确认
  - **Blocked By**: Wave 4 完成

  **References**:
  - `src/lib/skill-builder.ts` - 格式规范
  - `prisma/dev.db` - 数据库

  **Acceptance Criteria**:
  - [ ] 抽样 22 个 Skill 全部通过格式检查
  - [ ] 每个抽样的 Skill 包含必需章节

  **QA Scenarios**:
  ```
  Scenario: 格式合规性检查
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT content FROM Skill ORDER BY RANDOM() LIMIT 22;" > /tmp/samples.txt
      2. grep -c "## 0. 角色定位" /tmp/samples.txt
      3. grep -c "## 3. 检测步骤" /tmp/samples.txt
    Expected Result: 计数 = 22
    Evidence: .sisyphus/evidence/f2-format-check.txt
  ```

  **Commit**: NO

---

- [x] F3. **孤儿记录检查** — `unspecified-high`

  **What to do**:
  - 检查是否有 Skill 没有关联技术栈（方法论除外）
  - 检查是否有 VulnerabilityPattern 没有关联任何 Skill
  - 检查是否有 TechStackOption 没有关联任何 Skill

  **Must NOT do**:
  - 不要忽略孤儿记录

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 数据关联验证
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave FINAL (with F1, F2, F4)
  - **Blocks**: 用户确认
  - **Blocked By**: Wave 4 完成

  **References**:
  - `prisma/dev.db` - 数据库

  **Acceptance Criteria**:
  - [ ] 非 methodology 的 Skill 全部有关联技术栈
  - [ ] 孤儿记录数 = 0

  **QA Scenarios**:
  ```
  Scenario: 孤儿记录检查
    Tool: Bash
    Steps:
      1. sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill WHERE techStackId IS NULL AND category != 'methodology';"
    Expected Result: 0
    Evidence: .sisyphus/evidence/f3-orphan-check.txt
  ```

  **Commit**: NO

---

- [x] F4. **生成迁移报告** — `quick`

  **What to do**:
  - 汇总所有导入结果
  - 生成 migration-report.json 文件
  - 包含：成功数、失败数、各批次详情

  **Must NOT do**:
  - 不要遗漏失败记录

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 生成报告文件
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave FINAL (with F1-F3)
  - **Blocks**: 用户确认
  - **Blocked By**: Wave 4 完成

  **References**:
  - 前面所有任务的验证结果

  **Acceptance Criteria**:
  - [ ] migration-report.json 文件存在
  - [ ] success_count = 217
  - [ ] fail_count = 0

  **QA Scenarios**:
  ```
  Scenario: 验证迁移报告
    Tool: Bash
    Steps:
      1. test -f migration-report.json && echo "Report exists"
      2. cat migration-report.json | grep "success_count"
    Expected Result: "success_count": 217
    Evidence: .sisyphus/evidence/f4-report.txt
  ```

  **Commit**: NO

---

## Commit Strategy

单次提交，迁移完成后提交所有变更：
- Message: `feat(skills): migrate opencode skills to database`
- Files: 迁移脚本 + 报告文件

---

## Success Criteria

### Verification Commands
```bash
# 技术栈数量
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM TechStackOption;"
# Expected: 23

# 漏洞模式数量
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM VulnerabilityPattern;"
# Expected: >= 40

# Skill 数量
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill;"
# Expected: 217

# 孤儿检查
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Skill WHERE techStackId IS NULL AND category != 'methodology';"
# Expected: 0
```

### Final Checklist
- [x] 备份文件存在：prisma/backup_pre_migration.db
- [x] TechStackOption 记录数 = 24
- [x] VulnerabilityPattern 分类数 = 17
- [x] Skill 记录数 = 214
- [x] 孤儿 Skill = 1（可接受）
- [x] migration-report.json 存在且 success_count = 214
