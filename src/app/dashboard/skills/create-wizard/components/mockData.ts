// 示例评估数据 - 用于测试 EvaluationStep 组件
import type { SkillEvaluationResult } from '@/types/evaluation';

export const mockEvaluationResult: SkillEvaluationResult = {
  metadata: {
    skill_name: 'code-audit-skill',
    skill_path: '/skills/code-audit/SKILL.md',
    executor_model: 'claude-3-opus',
    timestamp: new Date().toISOString(),
    evals_run: [1, 2, 3],
    runs_per_configuration: 1,
  },
  runs: [
    {
      eval_id: 1,
      eval_name: 'detect-command-injection-file',
      configuration: 'with_skill',
      run_number: 1,
      result: {
        pass_rate: 100,
        passed: 5,
        failed: 0,
        total: 5,
        time_seconds: 125.3,
        tokens: 85000,
      },
      expectations: [
        {
          text: '检测到 os.system 命令注入',
          passed: true,
          evidence: '在第 42 行发现 os.system(user_input) 调用，存在命令注入风险',
          type: 'detection',
        },
        {
          text: '检测到 subprocess.call 命令注入',
          passed: true,
          evidence: '在第 58 行发现 subprocess.call(cmd, shell=True)，存在命令注入风险',
          type: 'detection',
        },
        {
          text: '检测到 eval 代码注入',
          passed: true,
          evidence: '在第 73 行发现 eval(user_data)，存在代码注入风险',
          type: 'detection',
        },
        {
          text: '提供了修复建议',
          passed: true,
          evidence: '建议使用 subprocess.run 替代 os.system，并设置 shell=False',
          type: 'remediation',
        },
        {
          text: '分析了风险等级',
          passed: true,
          evidence: '评估为高危漏洞，建议立即修复',
          type: 'accuracy',
        },
      ],
      timing: {
        executor_duration_seconds: 120.5,
        total_duration_seconds: 125.3,
      },
      outputs: {
        vulnerability_report: `# 漏洞报告

## 检测到的漏洞

### 1. 命令注入 - os.system
- **位置**: 第 42 行
- **严重程度**: 高危
- **描述**: 使用 os.system 执行用户输入，存在命令注入风险
- **修复建议**: 使用 subprocess.run 并设置 shell=False

### 2. 命令注入 - subprocess.call
- **位置**: 第 58 行
- **严重程度**: 高危
- **描述**: subprocess.call 使用 shell=True 参数
- **修复建议**: 移除 shell=True 或使用列表形式传参

### 3. 代码注入 - eval
- **位置**: 第 73 行
- **严重程度**: 严重
- **描述**: eval 函数执行用户数据
- **修复建议**: 使用 ast.literal_eval 或白名单验证
`,
        security_analysis: `# 安全分析报告

## 执行摘要

本次审计发现 3 个高危漏洞，需要立即修复。

## 详细分析

### 命令注入漏洞

Python 中的命令注入漏洞通常出现在以下场景：

1. **os.system**: 直接执行 shell 命令
2. **subprocess with shell=True**: 使用 shell 解释器执行命令
3. **eval/exec**: 动态执行代码

### 风险评估

- **CVSS 评分**: 9.8 (严重)
- **可利用性**: 高
- **影响范围**: 完全控制服务器

## 修复优先级

1. **紧急**: eval 代码注入
2. **高**: os.system 命令注入
3. **高**: subprocess.call 命令注入
`,
      },
    },
    {
      eval_id: 1,
      eval_name: 'detect-command-injection-file',
      configuration: 'without_skill',
      run_number: 1,
      result: {
        pass_rate: 100,
        passed: 5,
        failed: 0,
        total: 5,
        time_seconds: 115.7,
        tokens: 72000,
      },
      expectations: [
        {
          text: '检测到 os.system 命令注入',
          passed: true,
          evidence: '发现了 os.system 调用',
          type: 'detection',
        },
        {
          text: '检测到 subprocess.call 命令注入',
          passed: true,
          evidence: '发现了 subprocess.call 调用',
          type: 'detection',
        },
        {
          text: '检测到 eval 代码注入',
          passed: true,
          evidence: '发现了 eval 调用',
          type: 'detection',
        },
        {
          text: '提供了修复建议',
          passed: true,
          evidence: '建议修复这些漏洞',
          type: 'remediation',
        },
        {
          text: '分析了风险等级',
          passed: true,
          evidence: '这些是高风险漏洞',
          type: 'accuracy',
        },
      ],
      timing: {
        executor_duration_seconds: 112.0,
        total_duration_seconds: 115.7,
      },
      outputs: {
        vulnerability_report: `# 漏洞报告

发现了一些安全问题，建议检查相关代码。

- os.system 调用
- subprocess.call 调用
- eval 调用
`,
      },
    },
    {
      eval_id: 2,
      eval_name: 'detect-sql-injection-database',
      configuration: 'with_skill',
      run_number: 1,
      result: {
        pass_rate: 80,
        passed: 4,
        failed: 1,
        total: 5,
        time_seconds: 98.5,
        tokens: 76000,
      },
      expectations: [
        {
          text: '检测到字符串拼接 SQL',
          passed: true,
          evidence: '第 15 行: "SELECT * FROM users WHERE id=" + userId',
          type: 'detection',
        },
        {
          text: '检测到 f-string SQL',
          passed: true,
          evidence: '第 23 行: f"SELECT * FROM products WHERE name=\'{name}\'"',
          type: 'detection',
        },
        {
          text: '检测到 format SQL',
          passed: false,
          evidence: '未检测到 format 方法的 SQL 注入',
          type: 'detection',
        },
        {
          text: '提供了参数化查询建议',
          passed: true,
          evidence: '建议使用 ? 占位符或参数化查询',
          type: 'remediation',
        },
        {
          text: '分析了注入点',
          passed: true,
          evidence: '识别出 2 个主要注入点',
          type: 'accuracy',
        },
      ],
      timing: {
        executor_duration_seconds: 95.2,
        total_duration_seconds: 98.5,
      },
      outputs: {},
    },
    {
      eval_id: 2,
      eval_name: 'detect-sql-injection-database',
      configuration: 'without_skill',
      run_number: 1,
      result: {
        pass_rate: 60,
        passed: 3,
        failed: 2,
        total: 5,
        time_seconds: 88.3,
        tokens: 65000,
      },
      expectations: [
        {
          text: '检测到字符串拼接 SQL',
          passed: true,
          evidence: '检测到字符串拼接',
          type: 'detection',
        },
        {
          text: '检测到 f-string SQL',
          passed: false,
          evidence: '未明确识别为 SQL 注入',
          type: 'detection',
        },
        {
          text: '检测到 format SQL',
          passed: false,
          evidence: '未检测到',
          type: 'detection',
        },
        {
          text: '提供了参数化查询建议',
          passed: true,
          evidence: '建议使用参数化查询',
          type: 'remediation',
        },
        {
          text: '分析了注入点',
          passed: true,
          evidence: '识别出部分注入点',
          type: 'accuracy',
        },
      ],
      timing: {
        executor_duration_seconds: 85.1,
        total_duration_seconds: 88.3,
      },
      outputs: {},
    },
  ],
  run_summary: {
    with_skill: {
      pass_rate: { mean: 90, stddev: 14.14, min: 80, max: 100 },
      time_seconds: { mean: 111.9, stddev: 19.01, min: 98.5, max: 125.3 },
      tokens: { mean: 80500, stddev: 6363.96, min: 76000, max: 85000 },
    },
    without_skill: {
      pass_rate: { mean: 80, stddev: 28.28, min: 60, max: 100 },
      time_seconds: { mean: 102, stddev: 19.4, min: 88.3, max: 115.7 },
      tokens: { mean: 68500, stddev: 4949.75, min: 65000, max: 72000 },
    },
    delta: {
      pass_rate: '+10.0%',
      time_seconds: '+9.9s',
      tokens: '+12.0K',
    },
  },
  comparisons: [
    {
      eval_id: 1,
      eval_name: 'detect-command-injection-file',
      with_skill_run: {
        eval_id: 1,
        eval_name: 'detect-command-injection-file',
        configuration: 'with_skill',
        run_number: 1,
        result: {
          pass_rate: 100,
          passed: 5,
          failed: 0,
          total: 5,
          time_seconds: 125.3,
          tokens: 85000,
        },
        expectations: [],
        timing: {
          executor_duration_seconds: 120.5,
          total_duration_seconds: 125.3,
        },
        outputs: {
          vulnerability_report: `# 漏洞报告

## 检测到的漏洞

### 1. 命令注入 - os.system
- **位置**: 第 42 行
- **严重程度**: 高危
- **描述**: 使用 os.system 执行用户输入，存在命令注入风险
- **修复建议**: 使用 subprocess.run 并设置 shell=False

### 2. 命令注入 - subprocess.call
- **位置**: 第 58 行
- **严重程度**: 高危
- **描述**: subprocess.call 使用 shell=True 参数
- **修复建议**: 移除 shell=True 或使用列表形式传参

### 3. 代码注入 - eval
- **位置**: 第 73 行
- **严重程度**: 严重
- **描述**: eval 函数执行用户数据
- **修复建议**: 使用 ast.literal_eval 或白名单验证
`,
          security_analysis: `# 安全分析报告

## 执行摘要

本次审计发现 3 个高危漏洞，需要立即修复。

## 详细分析

### 命令注入漏洞

Python 中的命令注入漏洞通常出现在以下场景：

1. **os.system**: 直接执行 shell 命令
2. **subprocess with shell=True**: 使用 shell 解释器执行命令
3. **eval/exec**: 动态执行代码

### 风险评估

- **CVSS 评分**: 9.8 (严重)
- **可利用性**: 高
- **影响范围**: 完全控制服务器

## 修复优先级

1. **紧急**: eval 代码注入
2. **高**: os.system 命令注入
3. **高**: subprocess.call 命令注入
`,
        },
      },
      without_skill_run: {
        eval_id: 1,
        eval_name: 'detect-command-injection-file',
        configuration: 'without_skill',
        run_number: 1,
        result: {
          pass_rate: 100,
          passed: 5,
          failed: 0,
          total: 5,
          time_seconds: 115.7,
          tokens: 72000,
        },
        expectations: [],
        timing: {
          executor_duration_seconds: 112.0,
          total_duration_seconds: 115.7,
        },
        outputs: {
          vulnerability_report: `# 漏洞报告

发现了一些安全问题，建议检查相关代码。

- os.system 调用
- subprocess.call 调用
- eval 调用
`,
        },
      },
      expectation_comparisons: [
        {
          text: '检测到 os.system 命令注入',
          type: 'detection',
          with_skill_passed: true,
          with_skill_evidence: '在第 42 行发现 os.system(user_input) 调用，存在命令注入风险',
          without_skill_passed: true,
          without_skill_evidence: '发现了 os.system 调用',
          status_change: 'both_pass',
        },
        {
          text: '检测到 subprocess.call 命令注入',
          type: 'detection',
          with_skill_passed: true,
          with_skill_evidence: '在第 58 行发现 subprocess.call(cmd, shell=True)，存在命令注入风险',
          without_skill_passed: true,
          without_skill_evidence: '发现了 subprocess.call 调用',
          status_change: 'both_pass',
        },
        {
          text: '检测到 eval 代码注入',
          type: 'detection',
          with_skill_passed: true,
          with_skill_evidence: '在第 73 行发现 eval(user_data)，存在代码注入风险',
          without_skill_passed: true,
          without_skill_evidence: '发现了 eval 调用',
          status_change: 'both_pass',
        },
        {
          text: '提供了修复建议',
          type: 'remediation',
          with_skill_passed: true,
          with_skill_evidence: '建议使用 subprocess.run 替代 os.system，并设置 shell=False',
          without_skill_passed: true,
          without_skill_evidence: '建议修复这些漏洞',
          status_change: 'both_pass',
        },
        {
          text: '分析了风险等级',
          type: 'accuracy',
          with_skill_passed: true,
          with_skill_evidence: '评估为高危漏洞，建议立即修复',
          without_skill_passed: true,
          without_skill_evidence: '这些是高风险漏洞',
          status_change: 'both_pass',
        },
      ],
      pass_rate_delta: 0,
      time_delta: 9.6,
      token_delta: 13000,
      improved_count: 0,
      regressed_count: 0,
      both_pass_count: 5,
      both_fail_count: 0,
    },
    {
      eval_id: 2,
      eval_name: 'detect-sql-injection-database',
      with_skill_run: {
        eval_id: 2,
        eval_name: 'detect-sql-injection-database',
        configuration: 'with_skill',
        run_number: 1,
        result: {
          pass_rate: 80,
          passed: 4,
          failed: 1,
          total: 5,
          time_seconds: 98.5,
          tokens: 76000,
        },
        expectations: [],
        timing: {
          executor_duration_seconds: 95.2,
          total_duration_seconds: 98.5,
        },
        outputs: {},
      },
      without_skill_run: {
        eval_id: 2,
        eval_name: 'detect-sql-injection-database',
        configuration: 'without_skill',
        run_number: 1,
        result: {
          pass_rate: 60,
          passed: 3,
          failed: 2,
          total: 5,
          time_seconds: 88.3,
          tokens: 65000,
        },
        expectations: [],
        timing: {
          executor_duration_seconds: 85.1,
          total_duration_seconds: 88.3,
        },
        outputs: {},
      },
      expectation_comparisons: [
        {
          text: '检测到字符串拼接 SQL',
          type: 'detection',
          with_skill_passed: true,
          with_skill_evidence: '第 15 行: "SELECT * FROM users WHERE id=" + userId',
          without_skill_passed: true,
          without_skill_evidence: '检测到字符串拼接',
          status_change: 'both_pass',
        },
        {
          text: '检测到 f-string SQL',
          type: 'detection',
          with_skill_passed: true,
          with_skill_evidence: '第 23 行: f"SELECT * FROM products WHERE name=\'{name}\'"',
          without_skill_passed: false,
          without_skill_evidence: '未明确识别为 SQL 注入',
          status_change: 'improved',
        },
        {
          text: '检测到 format SQL',
          type: 'detection',
          with_skill_passed: false,
          with_skill_evidence: '未检测到 format 方法的 SQL 注入',
          without_skill_passed: false,
          without_skill_evidence: '未检测到',
          status_change: 'both_fail',
        },
        {
          text: '提供了参数化查询建议',
          type: 'remediation',
          with_skill_passed: true,
          with_skill_evidence: '建议使用 ? 占位符或参数化查询',
          without_skill_passed: true,
          without_skill_evidence: '建议使用参数化查询',
          status_change: 'both_pass',
        },
        {
          text: '分析了注入点',
          type: 'accuracy',
          with_skill_passed: true,
          with_skill_evidence: '识别出 2 个主要注入点',
          without_skill_passed: true,
          without_skill_evidence: '识别出部分注入点',
          status_change: 'both_pass',
        },
      ],
      pass_rate_delta: 20,
      time_delta: 10.2,
      token_delta: 11000,
      improved_count: 1,
      regressed_count: 0,
      both_pass_count: 3,
      both_fail_count: 1,
    },
  ],
  notes: [
    'Skill 在 SQL 注入检测上表现更好',
    '命令注入检测两者表现相当',
    '建议增强 format 方法的检测能力',
  ],
};
