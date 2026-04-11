# 准确率（Pass Rate）计算详解

## 🎯 核心公式

```
准确率 (Pass Rate) = 通过的断言数 / 总断言数
```

---

## 📊 实际案例演示

### 案例 1: Eval-1 (文件检测)

#### Grading.json 内容
```json
{
  "expectations": [
    {
      "text": "检测到 os.system 中的命令注入漏洞",
      "passed": true,  ✅
      "evidence": "漏洞 #1 明确指出了第10-11行..."
    },
    {
      "text": "检测到 subprocess.call 中的命令注入漏洞",
      "passed": true,  ✅
      "evidence": "漏洞 #2 明确指出了第17-18行..."
    },
    {
      "text": "检测到 eval 执行用户输入的安全问题",
      "passed": true,  ✅
      "evidence": "漏洞 #3 明确指出了第24-25行..."
    },
    {
      "text": "提供了具体的修复建议",
      "passed": true,  ✅
      "evidence": "每个漏洞都提供了详细的修复代码示例..."
    },
    {
      "text": "正确识别了 safe_list_files 函数是安全的实现",
      "passed": true,  ✅
      "evidence": "报告中明确标注第31-32行为安全实现示例..."
    }
  ],
  "summary": {
    "passed": 5,      // ✅ 通过 5 个
    "failed": 0,      // ❌ 失败 0 个
    "total": 5,       // 📊 总共 5 个
    "pass_rate": 1.0  // 5 / 5 = 1.0 = 100%
  }
}
```

#### 计算过程
```
断言总数 = 5
通过数量 = 5
失败数量 = 0

Pass Rate = 5 / 5 = 1.0 = 100%
```

---

### 案例 2: Eval-2 (代码片段检测)

#### Grading.json 内容
```json
{
  "expectations": [
    {
      "text": "Correctly identified command injection",
      "passed": true,  ✅
      "evidence": "Identified high-risk vulnerability"
    },
    {
      "text": "Explained exploitation methods",
      "passed": true,  ✅
      "evidence": "Provided 4 detailed attack scenarios"
    },
    {
      "text": "Provided fix suggestions",
      "passed": true,  ✅
      "evidence": "Provided subprocess and shlex.quote solutions"
    }
  ],
  "summary": {
    "passed": 3,      // ✅ 通过 3 个
    "failed": 0,      // ❌ 失败 0 个
    "total": 3,       // 📊 总共 3 个
    "pass_rate": 1.0  // 3 / 3 = 1.0 = 100%
  }
}
```

---

## 🔄 完整的准确率计算流程

### 步骤 1: 定义断言 (Assertions)

**文件**: `eval_metadata.json`

```json
{
  "eval_id": 1,
  "eval_name": "检测文件中的命令注入漏洞",
  "prompt": "检测文件 vulnerable_code.py 中的命令注入漏洞...",
  "assertions": [
    {
      "text": "检测到 os.system 中的命令注入漏洞",
      "type": "detection"
    },
    {
      "text": "检测到 subprocess.call 中的命令注入漏洞",
      "type": "detection"
    },
    {
      "text": "检测到 eval 执行用户输入的安全问题",
      "type": "detection"
    },
    {
      "text": "提供了具体的修复建议",
      "type": "remediation"
    },
    {
      "text": "正确识别了 safe_list_files 函数是安全的实现",
      "type": "accuracy"
    }
  ]
}
```

**说明**: 
- 这是**测试标准**
- 定义了 5 个断言，每个断言都要被评估
- 不同的 `type` 表示不同类型的检查

---

### 步骤 2: AI 执行并生成输出

**Executor Agent 运行**:
```
输入: vulnerable_code.py + 提示词
执行: AI 分析代码，生成漏洞报告
输出: vulnerability_report.md
```

**输出内容示例**:
```markdown
# 命令注入漏洞检测报告

## 检测到的漏洞

### 漏洞 #1: os.system 命令注入
**位置**: 第10-11行  
**风险等级**: 高  
**漏洞代码**:
```python
os.system('ls -la ' + directory)
```
**修复建议**:
```python
subprocess.run(['ls', '-la', directory], shell=False)
```

### 漏洞 #2: subprocess.call 命令注入
**位置**: 第17-18行  
...

### 漏洞 #3: eval 代码注入
**位置**: 第24-25行  
...

## 安全实现示例
### safe_list_files 函数 ✅
第31-32行使用 subprocess.run 并设置 shell=False...
```

---

### 步骤 3: Grader Agent 评估断言

**Grader 的工作**:

#### 断言 1: "检测到 os.system 中的命令注入漏洞"

```
Grader 检查:
  ├─ 读取输出报告
  ├─ 搜索关键词: "os.system"
  ├─ 找到内容: "漏洞 #1: os.system 命令注入"
  ├─ 验证位置: 第10-11行 ✓
  ├─ 验证描述: 命令注入 ✓
  └─ 判断: ✅ PASSED

证据: "漏洞 #1 明确指出了第10-11行存在os.system命令注入..."
```

#### 断言 2: "检测到 subprocess.call 中的命令注入漏洞"

```
Grader 检查:
  ├─ 搜索关键词: "subprocess.call"
  ├─ 找到内容: "漏洞 #2: subprocess.call 命令注入"
  ├─ 验证位置: 第17-18行 ✓
  └─ 判断: ✅ PASSED

证据: "漏洞 #2 明确指出了第17-18行..."
```

#### 断言 3-5: 同样检查

```
断言 3: ✅ PASSED (找到 eval 相关内容)
断言 4: ✅ PASSED (输出包含修复建议)
断言 5: ✅ PASSED (识别了安全实现)
```

---

### 步骤 4: 计算 Pass Rate

**Grader Agent 输出**:
```json
{
  "expectations": [
    { "text": "...", "passed": true, "evidence": "..." },
    { "text": "...", "passed": true, "evidence": "..." },
    { "text": "...", "passed": true, "evidence": "..." },
    { "text": "...", "passed": true, "evidence": "..." },
    { "text": "...", "passed": true, "evidence": "..." }
  ],
  "summary": {
    "passed": 5,    // count(passed == true)
    "failed": 0,    // count(passed == false)
    "total": 5,     // len(expectations)
    "pass_rate": 1.0  // passed / total
  }
}
```

---

## 📈 多次运行的准确率聚合

### 场景: 每个配置运行多次

**假设**:
```
iteration-1/
├── eval-1/
│   ├── with_skill/
│   │   ├── run-1/ (pass_rate: 1.0)
│   │   ├── run-2/ (pass_rate: 0.8)
│   │   └── run-3/ (pass_rate: 1.0)
│   └── without_skill/
│       ├── run-1/ (pass_rate: 1.0)
│       ├── run-2/ (pass_rate: 1.0)
│       └── run-3/ (pass_rate: 0.8)
```

### 聚合计算 (aggregate_benchmark.py)

```python
def calculate_stats(values: list[float]) -> dict:
    """
    计算多次运行的统计数据
    """
    n = len(values)
    mean = sum(values) / n
    
    if n > 1:
        variance = sum((x - mean) ** 2 for x in values) / (n - 1)
        stddev = math.sqrt(variance)
    else:
        stddev = 0.0
    
    return {
        "mean": round(mean, 4),      # 平均准确率
        "stddev": round(stddev, 4),  # 标准差
        "min": round(min(values), 4),
        "max": round(max(values), 4)
    }

# With Skill 的准确率
with_skill_rates = [1.0, 0.8, 1.0]  # 3 次运行
stats = calculate_stats(with_skill_rates)

结果:
{
  "mean": 0.9333,    # 平均 93.33%
  "stddev": 0.1155,  # 标准差
  "min": 0.8,
  "max": 1.0
}
```

---

## 🎯 Pass Rate 的含义

### 100% Pass Rate
```
所有断言都通过了
✅ Skill 完全符合预期
✅ 没有漏检
✅ 没有误检
```

### 80% Pass Rate
```
80% 的断言通过了
⚠️ 有 20% 的断言失败
❌ 可能漏检了某些漏洞
❌ 可能误检了安全的代码
```

### 50% Pass Rate
```
只有一半断言通过
❌ Skill 质量堪忧
❌ 需要大幅改进
```

---

## 🔍 实际案例分析

### 当前项目的准确率

#### With Skill
```
Eval-1:
  - 5 个断言，5 个通过
  - Pass Rate: 100%

Eval-2:
  - 3 个断言，3 个通过
  - Pass Rate: 100%

聚合结果:
{
  "with_skill": {
    "pass_rate": {
      "mean": 1.0,      # 平均 100%
      "stddev": 0.0,    # 无波动
      "min": 1.0,
      "max": 1.0
    }
  }
}
```

#### Without Skill (基线)
```
Eval-1:
  - 5 个断言，5 个通过
  - Pass Rate: 100%

Eval-2:
  - 3 个断言，3 个通过
  - Pass Rate: 100%

聚合结果:
{
  "without_skill": {
    "pass_rate": {
      "mean": 1.0,
      "stddev": 0.0,
      "min": 1.0,
      "max": 1.0
    }
  }
}
```

#### Delta (差异)
```
Delta = With Skill - Without Skill
     = 1.0 - 1.0
     = 0.0

结论: With Skill 和 Without Skill 准确率相同
      (都达到了 100%)
```

---

## 💡 关键概念区分

### 1. Pass Rate vs 误报率 vs 漏报率

```
Pass Rate (准确率):
  - 通过的断言数 / 总断言数
  - 衡量 Skill 是否达到了测试标准

误报率 (False Positive Rate):
  - 错误标记为漏洞的安全代码数 / 总安全代码数
  - 衡量 Skill 是否过于敏感

漏报率 (False Negative Rate):
  - 未检测到的真实漏洞数 / 总真实漏洞数
  - 衡量 Skill 是否遗漏问题
```

### 2. 单次运行 vs 聚合统计

```
单次运行:
  - pass_rate: 1.0 (100%)
  - 只代表这一次执行的结果

聚合统计 (3 次运行):
  - mean: 0.93 (93%)
  - stddev: 0.12
  - 表示平均水平和稳定性
```

---

## 📝 手动验证方法

### 如何验证 Pass Rate 是否正确？

#### 方法 1: 查看 grading.json
```bash
cat my_cmd_inject-workspace/iteration-1/eval-1/with_skill/run-1/grading.json
```

**检查**:
```json
{
  "summary": {
    "passed": 5,      # 数一数 passed: true 的数量
    "failed": 0,      # 数一数 passed: false 的数量
    "total": 5,       # passed + failed
    "pass_rate": 1.0  # passed / total
  }
}
```

#### 方法 2: 手动计算
```python
# 读取 grading.json
import json

with open('grading.json', 'r') as f:
    grading = json.load(f)

# 计算
expectations = grading['expectations']
passed = sum(1 for e in expectations if e['passed'])
total = len(expectations)
pass_rate = passed / total

print(f"Passed: {passed}")
print(f"Total: {total}")
print(f"Pass Rate: {pass_rate:.2%}")

# 输出:
# Passed: 5
# Total: 5
# Pass Rate: 100.00%
```

---

## 🎯 总结

### Pass Rate 计算公式
```
Pass Rate = 通过的断言数 / 总断言数
```

### 计算流程
```
1. 定义断言 (eval_metadata.json)
   ↓
2. AI 执行生成输出
   ↓
3. Grader 评估每个断言
   ↓
4. 统计通过/失败数量
   ↓
5. 计算 pass_rate
   ↓
6. 多次运行则计算 mean, stddev
```

### 实际意义
```
100%: ✅ 所有测试标准都达标
 90%: ✅ 大部分达标，有小问题
 70%: ⚠️ 有明显缺陷
 50%: ❌ 质量堪忧，需改进
```

### 当前项目
```
With Skill:    100% ✅
Without Skill: 100% ✅
Delta:         0%

结论: 两者都达到了测试标准
```

---

**准确率是衡量 Skill 质量的核心指标，通过断言评估量化 Skill 的实际表现！** 🎯
