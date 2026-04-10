# Skill 评估组件

## 概述

增强版的 `EvaluationStep.tsx` 组件，提供完整的评估结果展示功能，包括对比面板、断言列表和 Markdown 渲染。

## 文件结构

```
src/app/dashboard/skills/create-wizard/
├── EvaluationStep.tsx              # 主组件（已增强）
└── components/
    ├── EvaluationComparisonCard.tsx    # 对比卡片组件
    └── MarkdownOutputView.tsx          # Markdown 输出查看器
```

## 主要功能

### 1. 对比面板（Comparison Card）

展示 With Skill vs Without Skill 的详细对比：

- **通过率对比**：显示两组测试的通过率和通过数量
- **性能对比**：耗时和 Token 使用量对比
- **差异统计**：自动计算改进/回退情况
- **视觉标识**：使用颜色和图标标识改进/回退状态

### 2. 断言列表（Assertion List）

详细的断言对比视图：

- **展开/收起**：点击可展开查看详细断言
- **状态标识**：每个断言显示通过/失败状态
- **证据展示**：可查看每个断言的证据文本
- **对比指示**：显示改进、回退、都通过、都失败四种状态

### 3. Markdown 输出渲染

支持渲染评估输出文件：

- **多文件支持**：支持多个输出文件（vulnerability_report.md、security_analysis.md 等）
- **Tab 切换**：使用 Tab 切换不同文件
- **双视图模式**：支持渲染视图和源码视图切换
- **自定义样式**：使用 Tailwind prose 类自定义 Markdown 样式

## 数据类型

基于 `@/types/evaluation.ts` 中定义的类型：

```typescript
// 核心类型
- SkillEvaluationResult      // 完整评估结果
- SkillEvaluationComparison  // 单个测试用例的对比
- ExpectationComparison      // 断言对比
- SkillEvaluationRun         // 单次运行数据
- OutputFiles                // 输出文件集合
```

## 使用方式

### 基本使用

```tsx
import EvaluationStep from './EvaluationStep';

function MyComponent() {
  return (
    <EvaluationStep
      skillData={skillData}
      testCases={testCases}
      evaluationData={evaluationData}
      onChange={handleChange}
      onNext={handleNext}
      onPrevious={handlePrevious}
    />
  );
}
```

### 数据加载

组件会自动尝试从以下 API 加载评估结果：

```
GET /api/skills/{skillId}/evaluation-result
```

期望返回 `SkillEvaluationResult` 类型的数据。

## 样式约定

### 颜色方案（与 Dashboard 一致）

- **成功**：`bg-green-100 text-green-800 border-green-200`
- **失败**：`bg-red-100 text-red-800 border-red-200`
- **运行中**：`bg-blue-100 text-blue-800 border-blue-200`
- **等待**：`bg-gray-100 text-gray-800 border-gray-200`
- **警告**：`bg-yellow-100 text-yellow-800 border-yellow-200`

### 图标

使用 Lucide React 图标库：

- `CheckCircle` - 成功
- `XCircle` - 失败
- `Clock` - 等待
- `RefreshCw` - 运行中/刷新
- `TrendingUp` - 改进
- `TrendingDown` - 回退
- `Minus` - 无变化
- `ChevronUp/ChevronDown` - 展开/收起

## 交互设计

### 1. 展开/收起

- 点击"展开"按钮查看详细的断言列表
- 每个断言可进一步展开查看证据

### 2. 输出文件查看

- 点击"输出文件"按钮查看 Markdown 输出
- 使用 Tab 切换不同文件
- 支持渲染视图和源码视图切换

### 3. 响应式设计

- 支持移动端和桌面端
- 使用 Tailwind 响应式类（sm, md, lg, xl）

## 性能优化

1. **懒加载**：评估结果在需要时才加载
2. **条件渲染**：只在有数据时才渲染相应组件
3. **虚拟滚动**：输出文件使用 max-height 和 overflow-y-auto 限制高度

## 错误处理

- 加载失败时显示错误提示
- 网络错误时提供重试建议
- 空数据时显示友好的提示信息

## 后续改进

### 可选功能

1. **导出报告**：支持导出评估结果为 PDF/HTML
2. **历史对比**：对比多次评估结果
3. **图表可视化**：使用图表展示性能趋势
4. **筛选和搜索**：筛选特定状态的断言

### API 集成

需要实现以下 API 端点：

```
GET  /api/skills/{skillId}/evaluation-result  # 获取评估结果
POST /api/skills/test-runs                    # 运行测试
```

## 测试建议

1. **单元测试**：测试各个子组件的渲染
2. **集成测试**：测试完整的数据流
3. **E2E 测试**：测试用户交互流程

## 注意事项

1. **类型安全**：所有数据都使用 TypeScript 严格类型
2. **代码风格**：遵循 AGENTS.md 中的代码规范
3. **国际化**：所有文本使用中文
4. **可访问性**：添加适当的 ARIA 标签

## 依赖项

- `react-markdown@9.1.0` - Markdown 渲染
- `lucide-react@0.460.0` - 图标库
- React 19 和 Next.js 16 - 框架支持
