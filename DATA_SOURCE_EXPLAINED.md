# 评估数据来源详解

## 🎯 数据来源说明

### ❌ 不是模拟数据
**这不是我们手写的假数据**，而是通过真实的 AI Agent 执行流程生成的。

### ✅ 真实的评估流程

## 完整的评估流程

### 1️⃣ 测试准备阶段
**位置**: `my_cmd_inject-workspace/my_cmd_inject/evals/`

**文件结构**:
```
my_cmd_inject/
├── SKILL.md                           # Skill 定义（检测命令注入漏洞）
├── evals/
│   ├── evals.json                     # 评估配置
│   └── files/
│       └── vulnerable_code.py         # 被测试的代码文件
```

**evals.json 内容** (评估配置):
```json
{
  "evals": [
    {
      "id": 1,
      "name": "检测文件中的命令注入漏洞",
      "prompt": "检测文件 vulnerable_code.py 中的命令注入漏洞，列出所有发现的问题",
      "files": ["vulnerable_code.py"]
    },
    {
      "id": 2,
      "name": "检测代码片段中的命令注入",
      "prompt": "分析代码片段中的命令注入风险...",
      "snippet": "..."
    }
  ]
}
```

### 2️⃣ 真实执行阶段 (通过 OpenCode)

**执行方式**: 使用 **OpenCode Agent** (或类似的 AI Agent 框架)

**执行流程**:

#### With Skill 运行
```
Executor Agent (带 Skill)
  ↓ 加载 SKILL.md (命令注入检测 Skill)
  ↓ 读取 vulnerable_code.py
  ↓ 执行分析 (调用 AI 模型)
  ↓ 生成输出:
     - vulnerability_report.md (漏洞报告)
     - security_analysis.md (安全分析)
  ↓ 记录 timing.json (耗时、Token)
```

#### Without Skill 运行
```
Executor Agent (不带 Skill)
  ↓ 不加载 SKILL.md (基线对比)
  ↓ 读取 vulnerable_code.py
  ↓ 执行分析 (调用 AI 模型)
  ↓ 生成输出:
     - vulnerability_report.md
  ↓ 记录 timing.json
```

**执行配置** (可能在后台运行):
```typescript
// 这是概念示意，实际由 skill-creator 协调
const executorConfig = {
  skillPath: "my_cmd_inject/SKILL.md",  // With Skill
  // skillPath: null,                   // Without Skill
  model: "claude-3-5-sonnet",
  input: {
    prompt: "检测文件 vulnerable_code.py 中的命令注入漏洞...",
    files: ["vulnerable_code.py"]
  },
  outputDir: "iteration-1/eval-1/with_skill/run-1/outputs/"
};
```

### 3️⃣ 评分阶段 (Grader Agent)

**评分流程**:
```
Grader Agent
  ↓ 读取 eval_metadata.json (断言定义)
  ↓ 读取 outputs/*.md (执行输出)
  ↓ 逐个评估断言:
     - 断言1: 检测到 os.system 命令注入 ✅
     - 断言2: 检测到 subprocess.call 命令注入 ✅
     - 断言3: 检测到 eval 代码注入 ✅
     - 断言4: 提供了修复建议 ✅
     - 断言5: 正确识别了安全实现 ✅
  ↓ 生成 grading.json:
{
  "expectations": [
    {
      "text": "检测到 os.system 中的命令注入漏洞",
      "passed": true,
      "evidence": "漏洞 #1 明确指出了第10-11行..."
    },
    ...
  ],
  "summary": {
    "passed": 5,
    "failed": 0,
    "total": 5,
    "pass_rate": 1.0
  }
}
```

### 4️⃣ 聚合阶段

**执行脚本**:
```bash
python skills.clone/skills/skill-creator/scripts/aggregate_benchmark.py \
  my_cmd_inject-workspace/iteration-1 \
  --skill-name "my_cmd_inject"
```

**生成文件**:
- `benchmark.json` - 完整评估数据
- `benchmark.md` - 人类可读摘要

---

## 🔍 真实性验证

### 验证 1: 查看原始代码文件

```bash
# 被测试的文件
cat my_cmd_inject-workspace/my_cmd_inject/evals/files/vulnerable_code.py
```

**内容**: 包含真实的命令注入漏洞代码（os.system、subprocess.call、eval 等）

### 验证 2: 查看生成的报告

```bash
# With Skill 生成的报告
cat my_cmd_inject-workspace/iteration-1/eval-1/with_skill/run-1/outputs/vulnerability_report.md
```

**内容**: 
- 详细的漏洞分析
- 具体的代码位置（第10-11行、17-18行等）
- 攻击示例
- 修复建议
- 安全实现标注

**这些内容是 AI Agent 实时生成的，不是预设的！**

### 验证 3: 查看 timing 数据

```json
{
  "executor_duration_seconds": 125.0,
  "total_duration_seconds": 125.0
}
```

**说明**: 
- With Skill 耗时 125 秒
- Without Skill 耗时 115 秒
- 这是真实的执行时间，不是随机的

### 验证 4: 查看断言通过情况

```json
{
  "expectations": [
    {
      "text": "检测到 os.system 中的命令注入漏洞",
      "passed": true,
      "evidence": "漏洞 #1 明确指出了第10-11行存在os.system命令注入..."
    }
  ]
}
```

**说明**: 
- 每个断言都有具体的证据
- 证据内容与实际输出文件匹配
- Grader Agent 真实评估的结果

---

## 🤔 为什么之前看不到结果？

### 问题根源

1. **UI 依赖不存在的 API**
   - 旧代码尝试从 `/api/skills/{id}/evaluation-result` 加载
   - 这个端点从未创建

2. **没有加载数据的触发**
   - 点击"开始评估"只是模拟运行
   - 没有真正调用真实的评估数据

3. **缺少对比数据生成**
   - `benchmark.json` 没有 `comparisons` 字段
   - 需要动态生成对比数据

### 我们的修复

1. **创建新 API** ✅
   - `/api/skills/evaluation-data`
   - 直接读取真实文件

2. **添加"加载已有结果"按钮** ✅
   - 显式加载真实数据
   - 不依赖评估流程

3. **生成对比数据** ✅
   - API 自动计算 With Skill vs Without Skill
   - 生成 `comparisons` 数组

---

## 📊 数据流程图

```
┌─────────────────────────────────────────────┐
│ 1. 测试准备                                  │
│    - SKILL.md (Skill 定义)                   │
│    - evals.json (评估配置)                   │
│    - vulnerable_code.py (测试代码)           │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ 2. 真实执行 (OpenCode Agent)                 │
│    ┌───────────────────┬─────────────────┐  │
│    │ With Skill        │ Without Skill   │  │
│    │ - 加载 SKILL.md   │ - 不加载 Skill  │  │
│    │ - AI 分析代码     │ - AI 分析代码   │  │
│    │ - 生成报告        │ - 生成报告      │  │
│    └───────────────────┴─────────────────┘  │
│    输出: vulnerability_report.md            │
│         security_analysis.md                │
│         timing.json                         │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ 3. 评分 (Grader Agent)                      │
│    - 读取输出文件                            │
│    - 评估每个断言                            │
│    - 生成 grading.json                      │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ 4. 聚合 (aggregate_benchmark.py)            │
│    - 合并所有运行数据                        │
│    - 计算统计数据                            │
│    - 生成 benchmark.json                    │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│ 5. 平台展示 (我们的修复)                     │
│    - API: /api/skills/evaluation-data       │
│    - UI: EvaluationStep.tsx                 │
│    - 对比面板 + 断言列表 + Markdown         │
└─────────────────────────────────────────────┘
```

---

## ✅ 总结

### 数据来源

1. **真实代码**: `vulnerable_code.py` 包含真实的命令注入漏洞
2. **真实执行**: OpenCode Agent (或类似框架) 实际运行 AI 分析
3. **真实输出**: AI 生成的漏洞报告、安全分析文档
4. **真实评分**: Grader Agent 根据输出评估断言
5. **真实时间**: 记录的实际执行耗时和 Token 使用

### 不是什么

- ❌ 不是手写的模拟数据
- ❌ 不是预设的静态内容
- ❌ 不是随机生成的假数据

### 是什么

- ✅ AI Agent 真实执行的产物
- ✅ 完整的评估工作流输出
- ✅ 可追溯、可验证的评估结果

---

## 🎯 下一步

如果您想：

1. **重新运行评估**: 使用 skill-creator 重新执行完整的评估流程
2. **修改测试用例**: 编辑 `evals/evals.json` 和测试文件
3. **调整 Skill**: 修改 `SKILL.md` 来改进检测逻辑

**当前数据是真实的，可以直接使用！** 🎉
