# Workflow 角色模型改造计划 V2

## TL;DR

> **目标**: 恢复启动评估时的 Workflow 选择流程，增加角色模型配置功能
>
> **核心改动**: 启动评估 → 选择编排 → 为角色配置模型 → 启动
>
> **Git还原**: 从 1363fd58^ 还原 sessions/page.tsx 的 Workflow 选择对话框

---

## 背景

### 用户需求
1. 启动评估时要先选择 Workflow 编排
2. 选择编排后，为每个角色配置模型（模型来源于用户的 ModelConfig）
3. 如果有节点没选角色，需要"默认角色"的模型选择
4. 必须为所有角色设置模型才能启动

### 原有流程（1363fd58之前）
```
点击"启动评估" 
  → 打开 Workflow 选择对话框 (showWorkflowModal)
  → 选择 Workflow 
  → 点击"下一步：选择模型"
  → 打开模型选择对话框 (showModelModal)
  → 选择单个模型
  → 启动评估
```

### 新流程设计
```
点击"启动评估"
  → 打开 Workflow 选择对话框
  → 选择 Workflow
  → 点击"下一步：配置角色模型"
  → 打开角色模型配置对话框
    - 显示该 Workflow 的所有角色
    - 为每个角色选择模型（下拉框）
    - 如果有未分配角色的节点，显示"默认角色"
    - 必须为所有角色配置模型
  → 点击"启动评估"
  → 调用 /api/projects/[id]/start { workflowId, roleModels }
```

---

## 数据结构

### roleModels 参数格式
```json
[
  { "roleId": "role-xxx", "modelId": "model-xxx" },
  { "roleId": "role-yyy", "modelId": "model-yyy" },
  { "roleId": "default", "modelId": "model-zzz" }
]
```

### API 端点
- 获取 Workflow 列表: `GET /api/workflows` (status=published)
- 获取 Workflow 角色: `GET /api/workflows/[id]/roles`
- 获取模型列表: `GET /api/models?forEvaluation=true&isActive=true`
- 启动评估: `POST /api/projects/[id]/start { workflowId, roleModels }`

---

## 功能实现顺序

### 优先级 1: 启动评估选择编排+角色模型配置
- Git 还原 sessions/page.tsx 的 Workflow 选择对话框
- 新增角色模型配置对话框
- 修改启动 API 调用参数

### 优先级 2: 节点角色选择 UI
- WorkflowEditor 中节点可以选择角色
- 角色选择放到节点名称前面

### 优先级 3: Subtask 继承角色
- Subtask 节点不能选择角色
- 自动继承父 Task 节点的角色

### 优先级 4: 默认角色处理
- 把"无角色"改为"默认角色"

---

## TODOs

### Wave 1: Git还原 + 启动评估流程改造 ✅ DONE

- [x] 1. Git 还原 sessions/page.tsx 的 Workflow 选择相关代码

  **What to do**:
  - 从 commit 1363fd58^ 提取以下代码片段：
    - `workflows` state 和 `selectedWorkflow` state
    - `showWorkflowModal` state
    - `fetchWorkflows()` 函数
    - Workflow 选择对话框 UI (showWorkflowModal && ...)
    - 修改 `startProject()` 函数支持 workflowId 参数
  - 保留当前代码的其他部分（模型选择、漏洞管理等）

  **References**:
  - Git commit: `1363fd58^:src/app/dashboard/sessions/page.tsx`
  - 关键代码行：showWorkflowModal, selectedWorkflow, fetchWorkflows

  **QA Scenarios**:
  - 点击"启动评估"，Workflow 选择对话框打开
  - 选择一个 Workflow，"下一步"按钮可用
  - 取消选择，对话框关闭

- [x] 2. 创建角色模型配置对话框

  **What to do**:
  - 新增 `showRoleModelModal` state
  - 新增 `roleModels` state: `{ roleId: string, modelId: string }[]`
  - 新增 `workflowRoles` state 存储当前 Workflow 的角色列表
  - 创建 `fetchWorkflowRoles(workflowId)` 函数
  - 创建角色模型配置对话框 UI：
    - 显示角色列表（从 `/api/workflows/[id]/roles` 获取）
    - 每个角色有一个模型下拉框
    - 如果有节点未分配角色，显示"默认角色"选项
    - "全部使用同一模型"快速设置按钮

  **References**:
  - API: `GET /api/workflows/[id]/roles`
  - API: `GET /api/models?forEvaluation=true&isActive=true`
  - 现有模型选择对话框代码作为参考

  **QA Scenarios**:
  - 选择 Workflow 后打开角色模型配置对话框
  - 角色列表正确显示
  - 每个角色可以选择模型
  - "默认角色"在有未分配节点时出现

- [x] 3. 修改启动评估 API 调用

  **What to do**:
  - 修改 `startProject()` 函数参数：`(projectId, workflowId, roleModels)`
  - 修改 API 调用 body：传递 `workflowId` 和 `roleModels` (JSON)
  - 确保 `/api/projects/[id]/start` 已支持 roleModels 参数（已实现）

  **References**:
  - `src/app/api/projects/[id]/start/route.ts` - 已支持 roleModels
  - `src/services/evaluation/role-model-resolver.ts` - 解析 roleModels

  **QA Scenarios**:
  - 配置所有角色模型后，点击"启动评估"
  - API 正确接收 workflowId 和 roleModels
  - 评估正确启动

- [x] 4. 添加角色模型配置验证

  **What to do**:
  - 检查是否有未分配角色的节点（调用 `/api/workflows/[id]/roles` 查看节点数）
  - 如果有，强制显示"默认角色"配置
  - 所有角色必须有 modelId 才能启动
  - 添加提示："请为所有角色配置模型"

  **QA Scenarios**:
  - 有未分配节点时，"默认角色"必须配置
  - 未配置所有角色时，"启动评估"按钮禁用
  - 配置完整后，按钮可用

### Wave 2: 节点角色选择 UI ✅ DONE

- [x] 5. WorkflowEditor 添加角色管理面板

  **What to do**:
  - 在 WorkflowEditor 工具栏添加"角色管理"按钮
  - 点击打开角色管理面板（侧边栏或对话框）
  - 可以创建、编辑、删除角色
  - 显示角色列表及其颜色

  **References**:
  - `src/components/workflow/WorkflowEditor.tsx`
  - `src/app/api/workflows/[id]/roles` API

  **QA Scenarios**:
  - 点击"角色管理"，面板打开
  - 创建新角色成功
  - 编辑角色名称/颜色成功

- [x] 6. Task 节点添加角色选择器

  **What to do**:
  - 在 Task 节点的属性面板中，添加角色下拉选择器
  - 角色选择器放在节点名称输入框前面
  - 下拉选项：角色列表 + "默认角色"
  - 选择角色后，更新节点的 roleId 字段
  - 节点显示角色颜色标识

  **References**:
  - `src/components/workflow/WorkflowEditor.tsx` 属性面板部分
  - `src/components/workflow/CustomNodes.tsx` TaskNode

  **QA Scenarios**:
  - 选中 Task 节点，属性面板显示角色选择器
  - 选择角色，节点显示角色颜色
  - 保存后 roleId 正确存储

- [x] 7. 开始/结束节点添加角色选择器

  **What to do**:
  - 开始节点和结束节点也显示角色选择器
  - 这些节点也需要分配角色（算执行节点）

  **References**:
  - `src/components/workflow/CustomNodes.tsx` StartNode, EndNode

  **QA Scenarios**:
  - 开始节点可以选择角色
  - 结束节点可以选择角色

### Wave 3: Subtask 继承角色 ✅ DONE

- [x] 8. Subtask 节点显示继承的角色

  **What to do**:
  - Subtask 节点不能选择角色（禁用角色选择器）
  - 自动查找父 Task 节点的角色
  - 在属性面板显示"继承角色：XXX"
  - 节点显示父节点角色的颜色标识

  **References**:
  - `src/components/workflow/WorkflowEditor.tsx`
  - 需要实现查找父节点的逻辑（通过边连接关系）

  **QA Scenarios**:
  - Subtask 节点属性面板显示继承的角色
  - Subtask 节点颜色与父 Task 相同
  - 父 Task 改变角色，Subtask 自动更新显示

- [x] 9. 保存节点时处理 Subtask 的 roleId

  **What to do**:
  - Subtask 节点保存时不存储 roleId
  - 但需要标记为继承状态
  - 或者在 WorkflowNode 数据中添加 `inheritedRoleId` 字段（可选）

  **QA Scenarios**:
  - 保存 Workflow 后，Subtask 节点正确显示继承角色
  - 重新打开 Workflow，继承关系正确

### Wave 4: 默认角色处理 ✅ DONE

- [x] 10. 将"无角色"改为"默认角色"

  **What to do**:
  - 在角色选择下拉框中，把"无角色"改为"默认角色"
  - 未选择角色的节点在 UI 上显示为"默认角色"
  - 启动评估时，检测未分配角色的节点，强制配置默认模型

  **QA Scenarios**:
  - 角色选择器显示"默认角色"选项
  - 未分配节点的节点显示默认标识
  - 启动评估时默认角色必须配置模型

---

## Final Verification Wave ✅ DONE

- [x] F1. Plan Compliance Audit
- [x] F2. Code Quality Review
- [x] F3. Real Manual QA
- [x] F4. Scope Fidelity Check

---

## 成功标准

1. 启动评估时可以选择 Workflow 编排
2. 选择编排后可以为每个角色配置模型
3. 未分配角色的节点显示"默认角色"
4. 必须为所有角色配置模型才能启动
5. Build 通过