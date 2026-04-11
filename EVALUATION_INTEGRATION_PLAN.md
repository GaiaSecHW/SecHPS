# 评估结果集成方案

## 问题分析

**当前状态**：
- ✅ 已有基础展示：测试用例列表、状态、耗时、tokens
- ❌ 缺少详细内容：输出文件、断言结果、评分证据
- ❌ 需要打开外部HTML查看完整结果

**用户期望**：
- 评估完成后，**直接在平台内**查看所有详细信息
- 不需要打开外部文件
- 可以对比With Skill和Without Skill的详细输出

---

## 解决方案

### 方案1：增强现有EvaluationStep组件（推荐）

在当前界面基础上，添加：

#### 1. 点击展开详情
```tsx
// 在每个测试用例下方添加可展开区域
<div className="mt-4 pl-8 space-y-2">
  <details className="bg-gray-50 rounded p-3">
    <summary className="cursor-pointer font-medium text-sm">
      查看详细输出和评分
    </summary>
    
    {/* 断言列表 */}
    <div className="mt-3 space-y-2">
      <h5 className="font-medium text-sm">断言结果</h5>
      {expectations.map(exp => (
        <div className="flex items-start gap-2">
          {exp.passed ? <CheckCircle /> : <XCircle />}
          <div>
            <div className="text-sm">{exp.text}</div>
            <div className="text-xs text-gray-500">{exp.evidence}</div>
          </div>
        </div>
      ))}
    </div>
    
    {/* 完整输出 */}
    <div className="mt-3">
      <h5 className="font-medium text-sm mb-2">输出内容</h5>
      <div className="bg-white border rounded p-3 max-h-96 overflow-y-auto">
        <ReactMarkdown>{output}</ReactMarkdown>
      </div>
    </div>
  </details>
</div>
```

#### 2. 添加总体统计卡片
```tsx
<div className="grid grid-cols-4 gap-4 mb-6">
  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4">
    <div className="text-sm text-green-600">总体通过率</div>
    <div className="text-3xl font-bold text-green-700">
      {totalPassRate}%
    </div>
    <div className="text-xs text-green-600 mt-1">
      With Skill vs Baseline
    </div>
  </div>
  
  <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
    <div className="text-sm text-blue-600">平均耗时</div>
    <div className="text-3xl font-bold text-blue-700">
      {avgDuration}秒
    </div>
    <div className="text-xs text-blue-600 mt-1">
      vs {baselineDuration}秒 (baseline)
    </div>
  </div>
  
  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4">
    <div className="text-sm text-purple-600">Token消耗</div>
    <div className="text-3xl font-bold text-purple-700">
      {avgTokens}K
    </div>
    <div className="text-xs text-purple-600 mt-1">
      vs {baselineTokens}K (baseline)
    </div>
  </div>
  
  <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4">
    <div className="text-sm text-orange-600">改进幅度</div>
    <div className="text-3xl font-bold text-orange-700">
      {improvement}%
    </div>
    <div className="text-xs text-orange-600 mt-1">
      准确率提升
    </div>
  </div>
</div>
```

#### 3. 对比视图
```tsx
<div className="grid grid-cols-2 gap-4 mt-4">
  {/* With Skill */}
  <div className="border-2 border-blue-200 rounded-lg overflow-hidden">
    <div className="bg-blue-600 text-white px-4 py-2 font-medium">
      With Skill
    </div>
    <div className="p-4">
      <div className="mb-3">
        <span className="text-sm font-medium">通过率:</span>
        <span className="ml-2 text-green-600 font-bold">
          {withSkill.passRate}%
        </span>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-blue-600">
          查看完整输出
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto bg-gray-50 p-3 rounded">
          <ReactMarkdown>{withSkill.output}</ReactMarkdown>
        </div>
      </details>
    </div>
  </div>
  
  {/* Without Skill */}
  <div className="border-2 border-gray-200 rounded-lg overflow-hidden">
    <div className="bg-gray-600 text-white px-4 py-2 font-medium">
      Without Skill (Baseline)
    </div>
    <div className="p-4">
      <div className="mb-3">
        <span className="text-sm font-medium">通过率:</span>
        <span className="ml-2 text-green-600 font-bold">
          {withoutSkill.passRate}%
        </span>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-gray-600">
          查看完整输出
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto bg-gray-50 p-3 rounded">
          <ReactMarkdown>{withoutSkill.output}</ReactMarkdown>
        </div>
      </details>
    </div>
  </div>
</div>
```

---

### 方案2：修改API返回完整数据

#### 修改 `/api/skills/test-runs` 

```typescript
// 当前只返回基本信息
return {
  output: data.output,
  duration: data.duration,
  tokens: data.tokens,
}

// 改为返回完整评估数据
return {
  // 基本信息
  output: data.output,
  duration: data.duration,
  tokens: data.tokens,
  
  // 评分详情
  grading: {
    expectations: [
      {
        text: "检测到 os.system 中的命令注入漏洞",
        passed: true,
        evidence: "漏洞 #1 明确指出了第10-11行..."
      },
      // ...
    ],
    summary: {
      passed: 5,
      failed: 0,
      total: 5,
      pass_rate: 1.0
    }
  },
  
  // 测试元数据
  metadata: {
    eval_id: 1,
    eval_name: "检测文件中的命令注入漏洞",
    prompt: "检测文件 vulnerable_code.py...",
  }
}
```

---

## 实施步骤

### 第1步：安装Markdown渲染器

```bash
npm install react-markdown
```

### 第2步：修改EvaluationStep组件

添加以下内容：

1. **展开/收起功能** - 查看详细输出
2. **断言列表** - 显示每个断言的通过情况
3. **Markdown渲染** - 美化输出内容
4. **对比视图** - 并排显示With/Without Skill

### 第3步：修改API

让`/api/skills/test-runs`返回完整的评估数据，包括：
- grading.json的内容
- eval_metadata.json的内容
- 输出文件的内容

### 第4步：添加数据持久化

将评估结果保存到数据库，包括：
- 测试用例信息
- 运行结果
- 评分数据
- 输出内容

---

## 数据流设计

```
用户点击"开始评估"
    ↓
前端并行调用API (每个测试用例2次)
    ↓
API执行测试，返回完整数据
    ↓
前端实时更新状态（pending → running → completed）
    ↓
完成后，在界面内展示：
  - 统计卡片（总体通过率、耗时、tokens）
  - 测试列表（带展开功能）
  - 详细对比（With Skill vs Without Skill）
  - 断言评分（每个断言的通过情况和证据）
```

---

## 界面布局建议

```
┌─────────────────────────────────────────────────┐
│ 评估结果                                         │
├─────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐          │
│ │通过率│ │耗时  │ │Tokens│ │改进  │          │
│ │100% │ │97s   │ │65K   │ │+20%  │          │
│ └──────┘ └──────┘ └──────┘ └──────┘          │
├─────────────────────────────────────────────────┤
│ 测试用例列表                                      │
│ ┌─────────────────────────────────────────────┐│
│ │ Eval 1: 检测文件漏洞              [展开▼]   ││
│ │ With Skill: ✓ 通过 (125s, 85K)              ││
│ │ Without Skill: ✓ 通过 (115s, 72K)           ││
│ │                                              ││
│ │ [展开后显示]                                  ││
│ │ 断言结果:                                     ││
│ │  ✓ 检测到os.system漏洞                       ││
│ │  ✓ 检测到subprocess漏洞                      ││
│ │  ✓ 检测到eval漏洞                            ││
│ │                                              ││
│ │ [查看完整输出]                                ││
│ │ With Skill输出 | Without Skill输出           ││
│ └─────────────────────────────────────────────┘│
│ ┌─────────────────────────────────────────────┐│
│ │ Eval 2: 分析代码片段              [展开▼]   ││
│ │ ...                                          ││
│ └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

---

## 为什么需要"Without Skill（基线）"？

### 对比验证Skill的真实价值

| 场景 | With Skill | Without Skill | 结论 |
|------|-----------|---------------|------|
| **Skill有效** | 95%准确率 | 75%准确率 | ✅ Skill提升20%，有价值 |
| **Skill无效** | 85%准确率 | 85%准确率 | ❌ Skill没提升，需改进 |
| **Skill有害** | 70%准确率 | 90%准确率 | ❌ Skill反而降低了质量 |

**没有基线对比，你无法知道Skill是否真的有用！**

---

## 总结

**你的需求是正确的**：评估结果应该直接在平台内展示，不需要打开外部HTML。

**实现方式**：
1. ✅ 修改EvaluationStep组件，添加展开/收起功能
2. ✅ 修改API，返回完整的评估数据
3. ✅ 使用ReactMarkdown渲染输出内容
4. ✅ 提供详细的对比视图

**关键改进**：
- 不只是显示"已完成、耗时、tokens"
- 而是显示完整的输出内容、断言结果、评分证据
- 让用户可以对比With Skill和Without Skill的差异
- 直接在平台内完成所有查看和决策

**"Without Skill（基线）"的意义**：
- 科学对比，证明Skill的价值
- 发现Skill的不足之处
- 指导Skill的改进方向
