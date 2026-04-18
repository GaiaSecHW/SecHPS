# 硬编码 URL 清理工作计划

## TL;DR

> **目标**: 清理确认废弃的硬编码 URL 默认值，保留功能逻辑，配置缺失时报错
> 
> **清理项**: baseURL、api.anthropic.com、claude-proxy fallback
> 
> **变更数量**: 8 处代码修改

---

## Context

### 原始需求
用户请求全面排查系统硬编码场景。经排查发现约 700+ 处硬编码，大部分已确认可接受。

### 确认废弃的硬编码
1. **baseURL (localhost:54321)** - OpenCode SDK 遗留，系统已切换到 Claude SDK
2. **api.anthropic.com 默认值** - 无此业务场景
3. **localhost:3000/api/claude-proxy fallback** - 内部调用不应走 HTTP

### 用户决策
- 其他硬编码（admin角色名、魔法数字、文件路径、错误消息、状态值、日期Locale等）：**可接受**
- 清理方式：**保留逻辑，删除默认值，配置缺失时报错**

---

## Work Objectives

### Core Objective
删除硬编码 URL 默认值，强制从配置获取，配置缺失时抛出明确错误。

### Concrete Deliverables
- 删除 2 处自动创建配置逻辑
- 修改 5 处默认值为空或报错
- 前端 1 处默认值改为空

### Definition of Done
- [x] 所有硬编码 URL 默认值已删除
- [x] 配置缺失时抛出明确错误消息
- [x] npm run build 成功
- [x] 无 TypeScript 类型错误

### Must Have
- 保留原有功能逻辑
- 配置缺失时有明确的错误提示

### Must NOT Have
- 删除其他 OpencodeConfig 相关代码（暂不动）
- 修改 apiBaseUrl 字段含义
- 破坏现有正常使用配置的用户

---

## Verification Strategy

### QA Policy
每个修改后验证：
1. TypeScript 编译无错误
2. 受影响文件语法正确
3. 错误消息清晰可读

---

## Execution Strategy

### Sequential Execution（按文件逐个修改）

```
Task 1: 删除 auth/register 自动创建配置
Task 2: 删除 users 自动创建配置
Task 3: 修改 config/route.ts baseURL 默认值
Task 4: 修改 services/ai/claude.ts 默认值+报错
Task 5: 修改 lib/scan-executor.ts 默认值+报错
Task 6: 修改 dashboard/models/page.tsx 前端默认值
Task 7: 修改 evaluation/enhanced-caller.ts fallback+报错
Task FINAL: 构建验证
```

---

## TODOs

- [x] 1. 删除 auth/register 自动创建配置

  **What to do**:
  删除 `src/app/api/auth/register/route.ts` 第 84-93 行的自动创建配置代码。

  **当前代码**（删除整段）:
  ```typescript
    // 创建默认 AI4WEB 配置
    await prisma.opencodeConfig.create({
      data: {
        id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: user.id,
        name: 'Default',
        baseURL: 'http://localhost:54321',
        updatedAt: new Date(),
      },
    });
  ```

  **Must NOT do**:
  - 不要删除用户创建逻辑
  - 不要删除角色分配逻辑
  - 不要删除 Token 生成逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/api/auth/register/route.ts:84-93` - 需删除的代码段

  **QA Scenarios**:
  - 用户注册流程仍能正常完成
  - JWT Token 正常生成返回

  **Commit**: NO (groups with all changes)

---

- [x] 2. 删除 users 自动创建配置

  **What to do**:
  删除 `src/app/api/users/route.ts` 第 211-219 行的自动创建配置代码。

  **当前代码**（删除整段）:
  ```typescript
      // 创建默认 AI4WEB 配置
      await tx.opencodeConfig.create({
        data: {
          id: `config-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          userId: newUser.id,
          name: 'Default',
          baseURL: 'http://localhost:54321',
          updatedAt: new Date(),
        },
      });
  ```

  **Must NOT do**:
  - 不要删除事务内的用户创建逻辑
  - 不要删除角色分配逻辑
  - 不要删除审计日志逻辑

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/api/users/route.ts:211-219` - 需删除的代码段（在事务内）

  **QA Scenarios**:
  - 管理员创建用户流程仍能正常完成
  - 用户角色分配正常

  **Commit**: NO (groups with all changes)

---

- [x] 3. 修改 config/route.ts baseURL 默认值

  **What to do**:
  修改 `src/app/api/config/route.ts` 第 102 行，将默认值改为空字符串。

  **当前代码**:
  ```typescript
  baseURL: baseURL || 'http://localhost:54321',
  ```

  **改为**:
  ```typescript
  baseURL: baseURL || '',
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/app/api/config/route.ts:102` - 需修改的行

  **QA Scenarios**:
  - 创建配置时不传 baseURL 时存储空字符串
  - 传入 baseURL 时正常存储

  **Commit**: NO (groups with all changes)

---

- [x] 4. 修改 services/ai/claude.ts 默认值 + 报错

  **What to do**:
  删除 `https://api.anthropic.com/v1/messages` 默认值，配置缺失时抛出错误。

  **当前代码**:
  ```typescript
  let baseUrl = this.config.baseUrl || 'https://api.anthropic.com/v1/messages';
  ```

  **改为**:
  ```typescript
  let baseUrl = this.config.baseUrl;
  if (!baseUrl) {
    throw new Error('Claude API baseUrl 未配置，请在模型配置中设置 apiBaseUrl');
  }
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: None
  - **Blocked By**: Wave 1

  **References**:
  - `src/services/ai/claude.ts:19` - 需修改的行

  **QA Scenarios**:
  - 有配置时正常调用
  - 无配置时抛出明确错误

  **Commit**: NO (groups with all changes)

---

- [x] 5. 修改 lib/scan-executor.ts 默认值 + 报错

  **What to do**:
  删除 `https://api.anthropic.com/v1/messages` 默认值，配置缺失时抛出错误。

  **当前代码**:
  ```typescript
  apiBaseUrl: modelConfig.apiBaseUrl || 'https://api.anthropic.com/v1/messages',
  ```

  **改为**:
  ```typescript
  apiBaseUrl: modelConfig.apiBaseUrl,
  // 在使用前添加检查
  if (!modelConfig.apiBaseUrl) {
    throw new Error('模型配置缺少 apiBaseUrl，无法执行扫描');
  }
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6)
  - **Blocks**: None
  - **Blocked By**: Wave 1

  **References**:
  - `src/lib/scan-executor.ts:171` - 需修改的行

  **QA Scenarios**:
  - 有配置时正常执行扫描
  - 无配置时抛出明确错误

  **Commit**: NO (groups with all changes)

---

- [x] 6. 修改 dashboard/models/page.tsx 前端默认值

  **What to do**:
  删除前端 Claude provider 的默认 URL，改为空字符串让用户手动填写。

  **当前代码** (第 746-747 行):
  ```typescript
  const defaultBaseUrl = providerType === 'claude'
    ? 'https://api.anthropic.com/v1/messages'
    : formData.apiBaseUrl;
  ```

  **改为**:
  ```typescript
  const defaultBaseUrl = providerType === 'claude'
    ? ''  // Claude 原生需要用户手动填写 apiBaseUrl
    : formData.apiBaseUrl;
  ```

  同样修改第 797 行的类似代码。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: None
  - **Blocked By**: Wave 1

  **References**:
  - `src/app/dashboard/models/page.tsx:746-747` - 第一处
  - `src/app/dashboard/models/page.tsx:797` - 第二处

  **QA Scenarios**:
  - 选择 Claude provider 时，apiBaseUrl 输入框为空
  - 用户需要手动填写 URL

  **Commit**: NO (groups with all changes)

---

- [x] 7. 修改 evaluation/enhanced-caller.ts fallback + 报错

  **What to do**:
  删除 localhost fallback，环境变量缺失时抛出错误。

  **当前代码** (第 113-115 行):
  ```typescript
  agentBaseUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/claude-proxy`
    : 'http://localhost:3000/api/claude-proxy';
  ```

  **改为**:
  ```typescript
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    throw new Error('NEXT_PUBLIC_APP_URL 未配置，无法使用内部 claude-proxy');
  }
  agentBaseUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/claude-proxy`;
  ```

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 6)
  - **Blocks**: None
  - **Blocked By**: Wave 1

  **References**:
  - `src/services/evaluation/enhanced-caller.ts:113-115` - 需修改的代码段

  **QA Scenarios**:
  - 有 NEXT_PUBLIC_APP_URL 时正常构造代理 URL
  - 无环境变量时抛出明确错误

  **Commit**: NO (groups with all changes)

---

## Final Verification Wave

- [x] F1. 构建验证 - `npm run build` 成功
- [x] F2. TypeScript 检查 - `tsc --noEmit` 无错误

---

## Commit Strategy

单次提交所有清理变更：
- Message: `refactor: remove hardcoded URL defaults, require explicit config`
- Files: 所有修改的 7 个文件

---

## Success Criteria

- [x] 无硬编码 URL 默认值残留
- [x] 构建成功
- [x] 配置缺失时有明确错误提示