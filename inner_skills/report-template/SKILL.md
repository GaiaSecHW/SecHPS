---
name: report-template
description: "结构化安全审计报告模板，包含执行摘要、严重度统计、证据链细节、攻击链分析与修复路线图。用于在综合阶段生成或整理最终报告。"
---

# 报告模板技能

仅当 `state_audit-phase-synthesis.json` 已通过且综合阶段允许产出最终报告时使用。

## 使用时机

- 需要基于 `state_audit-phase-synthesis.json` 生成最终中文审计报告
- 需要统一报告结构、证据表达、攻击链整理和修复建议

## 不要在以下场景使用

- 仍在探索、补证、重试被 gate 拦截的 specialist
- `gate/audit-phase-synthesis.json` 不是 `PASS`
- `state_audit-phase-synthesis.json` 缺失或仍未通过证据校验

## 必读文件

- `.opencode/run/plan.json`
- `.opencode/run/gate/audit-phase-synthesis.json`
- `.opencode/run/state_audit-phase-synthesis.json`
- `synthesis_findings[*].upstream_refs` 引用到的所有上游 specialist `state_*.json`

## 预期输出

- 中文执行摘要
- 按严重度统计的发现概览
- gate 与流程遵循情况
- 未覆盖区域与低置信度区域
- 基于上游证据的漏洞细节
- 基于 `attack_chains[*].finding_refs` 的攻击链分析
- 修复优先级建议
- 已验证有效的正向安全控制

## 常见失败模式

- 报告里写入上游 specialist state 中并不存在的发现
- 没有来源证据就宣称存在完整数据流或控制流链路
- 用润色后的语言掩盖 gate 阻塞、覆盖缺口或未完成验证

## 证据模型要求

每个高置信度发现都必须能回溯到上游 specialist finding：

- 流式漏洞：`source -> propagation -> sink`
- 认证、授权、业务流漏洞：`entrypoint -> control_chain -> missing guard`
- 配置、基础设施类漏洞：`artifact -> runtime_impact -> exposure boundary`

如果上游 state 中不存在完整证据链，不要把它写成已确认漏洞；应降级表达，或放入未覆盖 / 待验证区域。

## 跨 agent 合并规则

当多个 specialist 命中了同一个根因时：

- 依据“同文件同位置”“同文件近邻位置 + 同类 sink”“明显同一根因”进行去重
- 保留证据链最强的一条，而不是保留文字最漂亮的一条
- 以重新校准后、且有证据支持的最高严重度为准
- 合并互补的 source、sink、control、artifact 与传播信息
- 如果同一根因支持多条利用路径，可在同一个 finding 下描述，并在攻击链章节中拆开说明

## 严重度重校准

最终报告前，对每个 synthesis finding 再做一次严重度判断：

- 可达性：
  - 未认证 / 公网可达，优先级上升
  - 低权限用户可达，优先级上升
  - 仅管理员可达，相比公网问题应适当下调
- 影响面：
  - RCE、认证绕过、签名密钥泄露、跨租户突破属于最高优先级
  - 部分数据访问、SSRF、存储型 XSS、受限写入能力次之
  - 低敏感度泄露、弱配置卫生问题更低
- 利用复杂度：
  - 单请求、直接触发路径更高
  - 多步链路、竞争条件、强环境约束更低
- 防护状态：
  - 控制缺失或明显可绕过时更高
  - 若存在有效保护且显著提高利用门槛，应降低置信度或严重度

如果最终严重度与上游 finding 不一致，必须在报告中说明原因，不能静默漂移。

## 置信度标签

统一使用以下标签：

- `[已验证]`：存在完整可利用链路，或存在明确运行时证明
- `[高置信度]`：存在完整 source-to-sink / control bypass 证据链，但没有完整利用证明
- `[中置信度]`：代码证据较强，但仍缺少一个关键验证环节
- `[待验证]`：只是可疑模式，不应写成已确认高危漏洞

Critical / High 级别发现必须达到 `[高置信度]` 或 `[已验证]`。

## 报告结构

```text
1. 执行摘要
2. 发现统计
3. Gate 与流程遵循情况
4. 未覆盖与低置信度区域
5. 按严重度排序的漏洞详情
6. 攻击链分析
7. 修复优先级建议
8. 已验证有效的安全控制
```

## 发现编号规则

使用稳定前缀：

- `C-XX`：严重
- `H-XX`：高危
- `M-XX`：中危
- `L-XX`：低危

排序优先级：先按严重度，再按可利用性与业务影响排序。

## 按严重度展开证据链

- 严重：
  - 必须展开完整证据链，包括 source、关键中间传播 / 控制节点，以及 sink 或缺失防护点
  - 必须有相关数据流和附上关键代码片段
- 高危 / 中危：
  - 至少包含 source、sink，以及关键中间节点或净化 / 校验逻辑 / 关键代码片段
  - 如果链路过长，必须明确概述中间关键节点
- 低危：
  - 一般可只给出 sink 位置与简要原因
  - 若该问题参与攻击链，则仍需补充链路上下文

对已确认的高影响问题，不得在最终报告中省略 sink / missing guard / runtime impact 细节。

## 单条发现模板

```markdown
## [严重度] [C-01/H-01/M-01/L-01] 漏洞标题

### 漏洞概述
用一段话说明问题是什么、为什么重要。

### 元信息
- **置信度**：`[已验证|高置信度|中置信度|待验证]`
- **CWE**：
- **CVSS / 严重度理由**：

### 位置
- **文件**：`path/to/file.ext:42`
- **函数 / 组件**：`name`

### 证据链
- **Source / 入口点**：
- **Propagation / Control Chain**：
- **Sink / 缺失防护 / 运行时影响**：

### 关键代码
引用上游证据中最关键的代码片段或节点。

### 影响
说明具体业务影响或技术影响。

### 利用思路
说明攻击者将如何触发。

### PoC 思路
在证据允许的前提下，给出最小复现或 payload 思路。

### 修复建议
- 修复步骤 1
- 修复步骤 2

### 参考
- CWE-XXX
```

## 最终输出语言

- 最终生成的 `AUDIT_REPORT.md` 必须为中文
- 标题、摘要、漏洞说明、攻击链、修复建议都必须使用中文表达
- 代码、路径、接口名、类名、函数名保持原文，不要强行翻译

Critical 与 High 级别发现若没有上游证据链支撑，不得进入最终报告。
## Sink Chain Addendum

Apply these rules to the final `AUDIT_REPORT.md`:

- Replace generic "data flow" or "evidence chain" wording with an explicit `Sink 链` subsection for every `MEDIUM`, `HIGH`, and `CRITICAL` finding.
- `MEDIUM` and above findings must not be prose-only. The decisive path to sink, missing guard, or runtime impact must stay visible.
- If upstream evidence is too thin to support a real `Sink 链`, do not silently invent one. Downgrade the presentation, reduce confidence, or move the item out of confirmed `MEDIUM+` findings.

Required severity-specific shape:

- `CRITICAL`: must expand the full code chain.
- `HIGH`: must include a clear `Source -> key transform/check -> Sink` chain.
- `MEDIUM`: must include a compact but explicit `Source -> decisive check/transform -> Sink` chain.

Critical format:

```text
[SINK-CHAIN] Source → Transform1 → Transform2 → ... → Sink
├── Source: {file}:{line} | {code_snippet 3-5行}
├── Transform1: {file}:{line} | {code_snippet 3-5行} | 转换说明
├── Transform2: {file}:{line} | {code_snippet 3-5行} | 净化检查结果
└── Sink: {file}:{line} | {code_snippet 3-5行} | 危险函数+影响
```

High / Medium format:

```text
[SINK-CHAIN] Source → {关键变换/缺失检查} → Sink
├── Source: {file}:{line} | {code_snippet 3-5行}
├── Transform / Check: {file}:{line} | {code_snippet 3-5行} | 说明净化、控制或缺失点
└── Sink: {file}:{line} | {code_snippet 3-5行} | 危险函数/缺失防护/运行时影响
```

Use this `Sink 链` block to replace the older generic vulnerability data-flow description in the final report.

## Prompt Addendum: Synthesis Output Requirements

Apply these rules whenever this skill is used by `audit-phase-synthesis`:

- The final report must include a dedicated `Attack Chains` section built only from upstream-backed findings.
- The final report must include a dedicated `Remediation Priority` section using `P0 / P1 / P2 / P3`.
- The final report must include a dedicated `PoC Candidates` section for safe validation planning, not default exploit generation.
- For each high-impact finding, keep the strongest upstream evidence chain visible instead of collapsing everything into summary prose.
- If multiple findings share the same root cause, merge them and describe the extra scope as affected paths, endpoints, assets, or variants.
- Replace generic vulnerability data-flow prose with a `Sink 链` subsection for every `MEDIUM+` finding.
- Every `CRITICAL` finding must use the full `[SINK-CHAIN] Source → Transform... → Sink` structure when upstream evidence allows it.

For each finding entry, prefer this additional structure:

- remediation priority
- why that priority is justified
- whether the finding is a good PoC candidate
- what minimum evidence-backed validation path exists
- for `CRITICAL` and `HIGH`, detailed code blocks and data flow must remain visible in the report
- for `MEDIUM`, key code blocks and data flow must remain visible in the report
- for `MEDIUM` and above, keep that evidence under a `Sink 链` subsection rather than a vague prose-only summary
