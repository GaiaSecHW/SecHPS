# Draft: 空回调全面排查

## 用户请求
对项目进行全面排查，找出所有空回调的地方，案例：`onXxxx: () => {}` 空回调

## 排查目标
识别所有可能导致功能缺失或潜在 bug 的空回调位置

## 排查维度

### 1. 空箭头函数回调
- 模式: `() => {}`, `() => { }`
- 重点: `onClick`, `onChange`, `onSubmit`, `onHover` 等以 `on` 开头的属性

### 2. 显式 undefined/null 回调
- 模式: `onXxxx: undefined`, `onXxxx: null`
- 模式: `handler: undefined`, `callback: undefined`

### 3. 占位/TODO 回调
- 回调体内只有注释（TODO/FIXME）
- 回调体内只有 console.log
- 函数名暗示需要实现但内容为空（handleSave, handleDelete 等）

## 正在进行
- [x] 启动探索任务 1: 搜索空箭头函数回调 (bg_dd8c3ace)
- [x] 启动探索任务 2: 搜索 undefined/null 回调 (bg_4b253bf0)
- [x] 启动探索任务 3: 搜索占位/TODO 回调 (bg_adbecbf8)
- [ ] 收集所有结果
- [ ] 分类整理（关键操作 vs 非关键）
- [ ] 生成排查报告

## 排查范围
- `src/**/*.tsx` - React 组件
- `src/**/*.ts` - TypeScript 文件
- 排除: 测试文件（可能有故意 mock）
- 排除: 类型定义文件（可能是示例）

## 期望输出
完整列表包含：
- 文件路径
- 行号
- 具体代码片段
- 上下文分析
- 紧急程度评级

---

## 排查结果汇总

### ✅ 已完成全面搜索

| 搜索维度 | 结果 | 状态 |
|---------|------|------|
| 空箭头函数 `() => {}` | 1处 | 已确认 |
| undefined/null 回调 | 1处（条件性） | 已确认 |
| 回退空函数 `|| (() => {})` | 2处 | 已确认 |
| 可选回调接口 | 多处 | 已确认 |

---

### 发现详情

#### 🔍 发现 1: 条件性 undefined 回调（低风险 - 合理设计）

**文件**: `src/app/dashboard/workflows/[id]/page.tsx`  
**行号**: 449, 464  
**代码**:
```tsx
<WorkflowEditor
  onSave={canEdit ? handleSave : undefined}  // 条件性 undefined
  readOnly={!canEdit}
/>
```
**分析**: 权限控制设计正确。WorkflowEditor 内部通过 `if (!onSave) return;` 正确处理。

---

#### 🔍 发现 2: 空箭头函数（低风险 - 可优化）

**文件**: `src/app/dashboard/sessions/[id]/page.tsx`  
**行号**: 1682  
**代码**:
```tsx
<MessageBubble
  onClick={() => {}}  // 空回调！
/>
```
**分析**: MessageBubble 需要 onClick 但当前无实际操作。建议改为可选属性。

---

#### 🔍 发现 3: 回退空函数（良好实践）

**文件**: `src/components/chat/ChatMessage.tsx`  
**行号**: 192-193  
**代码**:
```tsx
<PermissionRequest
  onApprove={onApprovePermission || (() => {})}  // 回退空函数
  onReject={onRejectPermission || (() => {})}    // 回退空函数
/>
```
**分析**: 防御性编程，避免运行时错误。良好实践。

---

#### 🔍 发现 4: 可选回调接口（正确设计）

**文件**: `src/components/workflow/WorkflowEditor.tsx`  
**行号**: 136-142  
**代码**:
```tsx
interface WorkflowEditorProps {
  onSave?: (data: WorkflowData) => Promise<void>;    // 可选回调
  onExecute?: () => Promise<void>;
  onToggleEnabled?: () => void;
  onRolesChange?: () => void;
}
```
**分析**: TypeScript 可选属性设计，正确。

---

### 其他组件可选回调（参考）

| 组件 | 可选回调 |
|------|---------|
| ChatContainer.tsx | `onApprovePermission?`, `onRejectPermission?` |
| EvaluationHeader.tsx | `onViewReport?`, `onAskProgress?`, `onDelete?` |
| TerminalComponent.tsx | `onDisconnect?`, `onConnected?`, `onError?` |
| Alert.tsx | `onDismiss?` |

---

### 未发现的问题模式

✅ 无以下高风险模式：
- `handler: undefined` 或 `handler: null`
- `callback: undefined` 或 `callback: null`
- 直接的 `onClick: undefined` / `onChange: undefined`

---

## 结论

**🎉 项目空回调情况良好！**

| 类型 | 数量 | 风险 | 建议 |
|-----|------|------|------|
| 条件性 undefined | 1 | ✅ 低 | 无需修改 |
| 空箭头函数 | 1 | ⚠️ 低 | 可优化为可选属性 |
| 回退空函数 | 2 | ✅ 低 | 保持（良好实践） |
| 可选接口 | 多个 | ✅ 无 | 正确设计 |

**总发现**: 4处相关位置，**0处真正问题**

---

## 可选优化建议

1. **MessageBubble 的 onClick**: 可改为可选属性而非强制空函数
2. **代码风格一致性**: 可考虑统一空回调处理方式