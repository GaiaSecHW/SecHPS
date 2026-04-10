# 测试指南 - EvaluationStep 组件

## 快速开始

### 1. 使用 Mock 数据测试

在开发环境中，可以使用提供的 mock 数据快速测试组件：

```tsx
import EvaluationStep from './EvaluationStep';
import { mockEvaluationResult } from './components/mockData';

function TestPage() {
  const [evaluationData, setEvaluationData] = useState({
    runs: [],
  });

  return (
    <EvaluationStep
      skillData={{ id: 'test-skill' }}
      testCases={[
        {
          id: '1',
          name: '命令注入检测',
          prompt: '检测这段代码中的命令注入漏洞',
        },
        {
          id: '2',
          name: 'SQL 注入检测',
          prompt: '检测这段代码中的 SQL 注入漏洞',
        },
      ]}
      evaluationData={evaluationData}
      onChange={setEvaluationData}
      onNext={() => console.log('Next')}
      onPrevious={() => console.log('Previous')}
    />
  );
}
```

### 2. 模拟 API 响应

创建一个测试 API 端点返回 mock 数据：

```typescript
// src/app/api/skills/[id]/evaluation-result/route.ts
import { NextResponse } from 'next/server';
import { mockEvaluationResult } from '@/app/dashboard/skills/create-wizard/components/mockData';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  // 返回 mock 数据
  return NextResponse.json({
    result: mockEvaluationResult,
  });
}
```

### 3. 测试各个功能点

#### 测试对比面板

1. 启动开发服务器：`npm run dev`
2. 访问 Skill 创建向导
3. 进入评估步骤
4. 点击"开始评估"
5. 查看对比面板是否正确显示：
   - ✓ 通过率对比
   - ✓ 耗时对比
   - ✓ Token 使用对比
   - ✓ 改进/回退指示器

#### 测试断言列表

1. 点击对比卡片上的"展开"按钮
2. 查看断言列表：
   - ✓ 每个断言的状态（通过/失败）
   - ✓ 对比指示器（改进/回退/都通过/都失败）
   - ✓ 证据展示功能

#### 测试 Markdown 渲染

1. 点击"输出文件"按钮
2. 查看 vulnerability_report.md：
   - ✓ Markdown 是否正确渲染
   - ✓ 样式是否正确应用
   - ✓ 代码块是否有语法高亮
3. 切换到 security_analysis.md
4. 测试源码视图切换

## 功能测试清单

### 基本功能

- [ ] 组件正确加载
- [ ] 测试用例列表显示
- [ ] "开始评估"按钮可用
- [ ] 进度条正确显示
- [ ] 状态图标正确显示

### 对比功能

- [ ] With Skill 数据正确显示
- [ ] Without Skill 数据正确显示
- [ ] 差异统计正确计算
- [ ] 颜色编码正确应用

### 断言功能

- [ ] 断言列表正确渲染
- [ ] 展开/收起功能正常
- [ ] 证据显示功能正常
- [ ] 状态变化正确标识

### Markdown 渲染

- [ ] Markdown 正确渲染
- [ ] 文件切换功能正常
- [ ] 源码/渲染视图切换正常
- [ ] 样式符合设计要求

### 交互功能

- [ ] 按钮点击响应正确
- [ ] 鼠标悬停效果正常
- [ ] 加载状态正确显示
- [ ] 错误提示正确显示

### 响应式设计

- [ ] 移动端布局正常
- [ ] 平板布局正常
- [ ] 桌面端布局正常
- [ ] 滚动功能正常

## 性能测试

### 大数据量测试

创建包含 50+ 断言的测试数据：

```typescript
const largeExpectations = Array.from({ length: 50 }, (_, i) => ({
  text: `断言 ${i + 1}`,
  type: 'detection',
  with_skill_passed: Math.random() > 0.3,
  with_skill_evidence: `With Skill 证据 ${i + 1}`,
  without_skill_passed: Math.random() > 0.5,
  without_skill_evidence: `Without Skill 证据 ${i + 1}`,
  status_change: ['improved', 'regressed', 'both_pass', 'both_fail'][
    Math.floor(Math.random() * 4)
  ] as any,
}));
```

测试点：
- [ ] 渲染时间 < 500ms
- [ ] 滚动流畅
- [ ] 内存使用正常
- [ ] 无明显卡顿

### 长文本测试

创建包含大量文本的 Markdown 输出：

```typescript
const longMarkdown = `# 长文本报告\n\n${'#'.repeat(1000)}\n\n内容...`;
```

测试点：
- [ ] 渲染正常
- [ ] 滚动功能正常
- [ ] 内存使用正常

## 错误场景测试

### 网络错误

模拟 API 失败：

```typescript
export async function GET() {
  return NextResponse.json(
    { error: 'Network error' },
    { status: 500 }
  );
}
```

测试点：
- [ ] 错误提示正确显示
- [ ] 不崩溃
- [ ] 用户可以重试

### 空数据

测试空数据场景：

```typescript
const emptyResult: SkillEvaluationResult = {
  metadata: { ... },
  runs: [],
  run_summary: { ... },
  comparisons: [],
  notes: [],
};
```

测试点：
- [ ] 显示友好提示
- [ ] 不崩溃
- [ ] 布局正常

### 格式错误

测试格式错误的数据：

```typescript
const malformedData = {
  comparisons: [
    {
      eval_id: 'not-a-number',
      // ... 其他字段缺失或类型错误
    },
  ],
};
```

测试点：
- [ ] 错误处理正确
- [ ] 不崩溃
- [ ] 显示错误提示

## 集成测试

### 与后端集成

1. 启动完整开发环境
2. 创建真实的 Skill
3. 运行真实评估
4. 验证：
   - [ ] 数据加载正确
   - [ ] 状态更新正确
   - [ ] 结果显示正确

### 与其他组件集成

测试与 Skill 创建向导其他步骤的集成：

- [ ] 从 TestCasesStep 正确接收数据
- [ ] 正确传递数据到下一步
- [ ] 返回上一步时数据保留

## 浏览器兼容性测试

在以下浏览器中测试：

- [ ] Chrome (最新版)
- [ ] Firefox (最新版)
- [ ] Safari (最新版)
- [ ] Edge (最新版)
- [ ] 移动浏览器 (iOS Safari, Chrome Android)

## 可访问性测试

使用屏幕阅读器测试：

- [ ] 所有按钮有正确的 ARIA 标签
- [ ] 图标有 alt 文本
- [ ] 键盘导航正常
- [ ] 焦点管理正确

使用 Lighthouse 检查：

- [ ] 可访问性评分 > 90
- [ ] 性能评分 > 80
- [ ] 最佳实践评分 > 90

## 调试技巧

### 使用 React DevTools

1. 安装 React DevTools 浏览器扩展
2. 检查组件状态
3. 查看传递的 props
4. 分析渲染性能

### 使用 Console 日志

在组件中添加调试日志：

```typescript
useEffect(() => {
  console.log('[EvaluationStep] evaluationResult:', evaluationResult);
  console.log('[EvaluationStep] comparisons:', evaluationResult?.comparisons);
}, [evaluationResult]);
```

### 使用断点

在浏览器开发者工具中设置断点：
1. 打开 Sources 面板
2. 找到组件文件
3. 设置断点
4. 触发相应操作

## 常见问题排查

### 问题 1：数据不显示

检查：
1. API 是否正确返回数据
2. 数据格式是否符合类型定义
3. 是否有 JavaScript 错误

### 问题 2：样式不正确

检查：
1. Tailwind CSS 是否正确配置
2. 类名是否正确应用
3. 是否有 CSS 冲突

### 问题 3：交互不响应

检查：
1. 事件处理器是否正确绑定
2. 是否有 JavaScript 错误
3. 状态更新是否正确

## 持续集成

将测试集成到 CI/CD 流程：

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm ci
      - run: npm run type-check
      - run: npm run test
```

## 下一步

完成所有测试后：
1. 记录测试结果
2. 修复发现的问题
3. 更新文档
4. 代码审查
5. 合并到主分支
