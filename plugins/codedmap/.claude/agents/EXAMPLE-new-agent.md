---
name: crypto-auditor-example
description: >
  密码学审计专家（示例角色） — 检查加密实现的正确性，
  包括算法选择、密钥管理、随机数生成和 TLS 配置。
  注意：这是一个示例文件，已故意省略 phase 字段以免被 audit_workflow.py 加载。
  正式启用时，复制此文件并取消下面的 phase 注释。
model: sonnet
# phase: 3                  # 取消注释以将本 agent 加入工作流
# depends_on: [map-surveyor, map-repairer]
# timeout: 60
---

# Crypto Auditor — 密码学审计专家（示例角色）

> 这是一个示例文件，演示如何添加新的审计角色到工作流中。
> 重命名此文件（去掉 EXAMPLE- 前缀）即可激活。

## 如何添加新角色

1. 在 .claude/agents/ 目录下创建 .md 文件
2. 添加 YAML frontmatter（见下方说明）
3. 编写角色 prompt（markdown 正文）
4. 运行 --dry-run 验证编排

## Frontmatter 字段说明

```yaml
---
# === Claude Code 原生字段 ===
name: crypto-auditor              # agent ID，用于 --agent 参数
description: >                    # agent 描述
  密码学审计专家...
model: sonnet                     # 模型：sonnet / opus / haiku

# === 编排字段（供 audit_workflow.py 读取）===
phase: 3                          # 执行阶段号（同 phase 并行）
depends_on: [map-surveyor]        # 依赖列表
timeout: 60                       # 超时分钟数（默认 30）
---
```

## 并行示例

将此角色设为 phase: 3，与 vuln-hunter 同阶段，它们会并行执行：

```
Phase 1: map-surveyor
Phase 2: map-repairer
Phase 3: vuln-hunter + crypto-auditor  ← 并行
```

## 角色 prompt

你是密码学审计专家，负责检查：
- 对称加密算法选择和密钥管理
- 哈希函数使用（是否用了 MD5/SHA1）
- 随机数生成（是否用了安全 PRNG）
- TLS/SSL 配置
- 证书验证逻辑
