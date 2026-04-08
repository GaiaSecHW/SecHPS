# Skill 创建向导开发进度

## ✅ 已完成功能

### 1. 前端路由和页面结构
- ✅ 创建向导主页面 (`/dashboard/skills/create-wizard`)
- ✅ Skills 列表页添加"引导式创建"入口
- ✅ 7 步骤进度指示器
- ✅ 步骤导航逻辑

### 2. 临时数据存储
- ✅ 使用 sessionStorage 存储向导数据
- ✅ 页面刷新后数据恢复
- ✅ 完成后自动清理临时数据

### 3. 步骤组件实现

#### 步骤 1: 意图捕获 ✅
- Skill 基本信息（名称、描述、分类）
- 功能描述
- 触发时机
- 期望输出
- 是否需要测试用例选项

#### 步骤 2: 调研访谈 ✅
- 边缘情况收集
- 输入输出格式
- 示例文件上传
- 成功标准定义
- 依赖项列表

#### 步骤 3: Skill 生成 ✅
- AI 自动生成 Skill 定义
- 可视化编辑器
- 系统提示词编辑
- 用户提示词编辑
- 工具选择
- Markdown 预览和复制

#### 步骤 4: 测试用例管理 ✅
- 添加/删除测试用例
- 测试提示词输入
- 期望输出描述
- 测试文件关联
- 跳过选项（如果不需要测试）

### 4. API 接口
- ✅ `/api/skills/generate` - Skill 自动生成接口

---

## 🚧 待完成功能

### 步骤 5: 运行评估
**功能需求:**
- 调用 AI4WEB/Claude API 运行测试
- 并行执行（有 Skill vs 无 Skill）
- 实时进度显示
- 结果收集

**技术实现:**
```typescript
// 文件: create-wizard/EvaluationStep.tsx
- 测试运行状态展示
- 进度条和日志
- 结果对比视图
- 导出评估报告
```

**API 需求:**
```typescript
// 文件: api/skills/test-runs/route.ts
POST /api/skills/test-runs
{
  skillId: string,
  testCases: TestCase[],
  runType: 'with_skill' | 'without_skill'
}

// 返回测试运行 ID，客户端轮询状态
```

### 步骤 6: 迭代改进
**功能需求:**
- 显示评估结果对比
- 用户反馈输入
- 自动改进建议
- 版本历史记录

**技术实现:**
```typescript
// 文件: create-wizard/IterationStep.tsx
- 对比视图（有/无 Skill）
- 用户评价表单
- 改进建议生成
- 应用改进
```

### 步骤 7: 描述优化
**功能需求:**
- 生成触发评估查询集
- 自动优化描述
- 触发准确率测试
- 选择最佳描述

**技术实现:**
```typescript
// 文件: create-wizard/OptimizationStep.tsx
- 触发查询生成
- 优化循环执行
- 准确率展示
- 描述选择
```

### Python 脚本集成
**需要集成的脚本:**
1. `run_eval.py` - 运行评估
2. `aggregate_benchmark.py` - 聚合结果
3. `package_skill.py` - 打包 Skill

**集成方式:**
```typescript
// 文件: lib/skill-creator.ts
import { spawn } from 'child_process';
import path from 'path';

export async function runSkillTest(skillPath: string, testCase: TestCase) {
  const scriptPath = path.join(process.cwd(), 'skill-creator', 'scripts', 'run_eval.py');
  // 调用 Python 脚本
}

export async function aggregateBenchmark(workspacePath: string) {
  const scriptPath = path.join(process.cwd(), 'skill-creator', 'scripts', 'aggregate_benchmark.py');
  // 调用 Python 脚本
}

export async function packageSkill(skillPath: string, outputPath: string) {
  const scriptPath = path.join(process.cwd(), 'skill-creator', 'scripts', 'package_skill.py');
  // 调用 Python 脚本
}
```

---

## 📋 后续开发步骤

### 优先级 1 - 核心功能
1. **完成评估步骤**
   - 实现 EvaluationStep 组件
   - 创建测试运行 API
   - 集成 Python 脚本

2. **完成迭代步骤**
   - 实现 IterationStep 组件
   - 结果对比可视化
   - 反馈收集

3. **完成优化步骤**
   - 实现 OptimizationStep 组件
   - 描述优化逻辑
   - 触发准确率测试

### 优先级 2 - 增强功能
4. **评估结果可视化**
   - 图表展示（通过率、耗时、Token 使用）
   - 详细输出对比
   - 导出 HTML 报告

5. **Skill 导出功能**
   - 生成 `.skill` 文件
   - 包含所有资源文件
   - 版本管理

### 优先级 3 - 优化和完善
6. **错误处理和边界情况**
   - 网络错误重试
   - API 调用失败处理
   - 数据验证

7. **性能优化**
   - 并行测试执行
   - 结果缓存
   - 懒加载

8. **文档和测试**
   - 用户使用文档
   - API 文档
   - 集成测试

---

## 🔧 技术栈

### 前端
- Next.js 16 + React 19
- TypeScript
- Tailwind CSS
- Lucide Icons

### 后端
- Next.js API Routes
- Prisma ORM
- SQLite 数据库

### Python 集成
- skill-creator 脚本
- child_process 调用
- JSON 数据交换

---

## 🎯 当前状态

**进度**: 约 60% 完成

**可测试功能**:
- ✅ 步骤 1-4 完整流程
- ✅ 数据持久化
- ✅ Skill 生成

**下一步行动**:
1. 实现 EvaluationStep 组件
2. 创建测试运行 API
3. 集成 Python 脚本

---

## 📝 备注

- 前端组件已创建完成，样式和交互都已实现
- API 基础架构已搭建
- 需要后端集成 Python 脚本来完成完整功能
- 测试数据存储在 sessionStorage，不持久化到数据库
