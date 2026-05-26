---
name: agent-contract
description: Simplified agent contract for Nazhua Gate v2. Use when you need a subagent to produce verifiable output with real file reads, checked attack patterns, and completed security test steps.
---

# Agent Contract Skill

> 简化版 Agent 合约，目标是让 subagent 的输出更容易被 gate 验证。

## 核心要求

每个 specialist state 只要求 7 组信息：

- `agent`
- `files_read`
- `checked_patterns`
- `completed_steps`
- `findings`
- `unfinished`
- `self_status`

## Gate 只检查 3 件事

1. 文件覆盖度
2. 关键攻击模式覆盖
3. 安全测试步骤是否正确

## 统一约束

- 搜索路径必须来自 dispatcher 分配的 scope
- `files_read` 只能写真实读过的关键文件
- `checked_patterns` 必须体现本方向的关键攻击模式
- `completed_steps` 必须体现本方向最基本的验证步骤
- 没做完或没证实的内容必须放进 `unfinished`
- 不要用摘要替代覆盖证明

## 推荐输出骨架

```json
{
  "agent": "audit-spec-injection",
  "files_read": [],
  "checked_patterns": [],
  "completed_steps": [],
  "findings": [],
  "unfinished": [],
  "self_status": {
    "status": "PASS|SOFT_FAIL|HARD_FAIL",
    "reasons": []
  }
}
```

## 什么时候必须判定为不过

- 关键文件覆盖明显不足
- 本方向主攻击模式漏掉
- 本方向关键测试步骤缺失
- 没有 state 文件

## 什么时候允许 SOFT_FAIL

- 有真实工作结果
- 但缺少少量次级模式覆盖
- 或存在未完成项需要 synthesis 标注
