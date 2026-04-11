# 下一步操作指南

## 🎯 当前状态

### ✅ 已完成
- **A 部分（平台集成）**: 100% 完成
- **B 部分（编码修复）**: 100% 完成
- **C3（评估查看器）**: UI 已实现

### ⏳ 待执行
- **C1**: 重新运行完整技能评估向导
- **C2**: 验证真实数据生成
- **C4**: 验证平台内对比视图

---

## 🚀 立即可执行的验证步骤

### 1. 启动开发服务器

```bash
cd D:\claude-web-platform
npm run dev
```

访问: http://localhost:3000

### 2. 测试 UI 组件

访问 Skill 创建向导:
```
http://localhost:3000/dashboard/skills/create-wizard
```

**检查项**:
- [ ] 进入评估步骤页面
- [ ] 查看对比面板显示
- [ ] 测试展开/收起功能
- [ ] 查看 Markdown 渲染

### 3. 测试 API 端点

#### GET 请求 - 获取评估列表
```bash
curl http://localhost:3000/api/skills/test-runs
```

**预期响应**:
```json
{
  "metadata": { ... },
  "runs": [ ... ],
  "run_summary": { ... }
}
```

#### POST 请求 - 获取单个评估数据
```bash
curl -X POST http://localhost:3000/api/skills/test-runs \
  -H "Content-Type: application/json" \
  -d '{
    "testCase": { "name": "detect-command-injection-file" },
    "runType": "with_skill",
    "useRealData": true,
    "evalId": 1
  }'
```

**预期响应**:
```json
{
  "output": "...",
  "duration": 125000,
  "tokens": 85000,
  "expectations": [ ... ],
  "result": { ... },
  "outputs": {
    "vulnerability_report": "...",
    "security_analysis": "..."
  }
}
```

---

## 📊 真实评估流程（可选执行）

### 步骤 1: 准备测试环境

确保以下文件存在:
```
D:\claude-web-platform\my_cmd_inject-workspace\iteration-1\
├── benchmark.json
├── eval-1\
│   ├── with_skill\
│   │   ├── run-1\
│   │   │   ├── grading.json
│   │   │   └── outputs\
│   │   │       ├── vulnerability_report.md
│   │   │       └── security_analysis.md
│   └── without_skill\
│       └── run-1\
│           └── grading.json
└── eval-2\
    └── ...
```

### 步骤 2: 重新生成 Benchmark 数据

```bash
cd D:\claude-web-platform\my_cmd_inject-workspace\iteration-1
python ../../../skills.clone/skills/skill-creator/scripts/aggregate_benchmark.py .
```

**预期输出**:
- `benchmark.json` 更新
- `benchmark.md` 生成

### 步骤 3: 生成评估查看器（可选）

```bash
cd D:\claude-web-platform\my_cmd_inject-workspace\iteration-1
python ../../../skills.clone/skills/skill-creator/eval-viewer/generate_review.py .
```

**预期输出**:
- 浏览器自动打开评估查看器
- 或生成静态 HTML 文件

### 步骤 4: 在平台内查看结果

访问 Skill 详情页面，查看:
- With Skill vs Without Skill 对比
- 断言列表
- Markdown 输出

---

## 🧪 测试清单

### UI 测试
- [ ] 对比面板正确显示
- [ ] 断言列表可展开收起
- [ ] Markdown 正确渲染
- [ ] 颜色编码正确（绿/红/蓝/灰）
- [ ] 响应式布局正常

### API 测试
- [ ] GET /api/skills/test-runs 返回数据
- [ ] POST /api/skills/test-runs 返回完整数据
- [ ] 文件读取正确（UTF-8）
- [ ] 错误处理正确

### 数据测试
- [ ] grading.json 正确解析
- [ ] benchmark.json 正确解析
- [ ] Markdown 文件正确读取
- [ ] 数据类型正确

---

## 🐛 常见问题排查

### 问题 1: API 返回 404
**原因**: 文件路径错误
**解决**: 检查 `my_cmd_inject-workspace/iteration-1/` 是否存在

### 问题 2: Markdown 不渲染
**原因**: react-markdown 未安装
**解决**: `npm install react-markdown`

### 问题 3: 中文乱码
**原因**: 编码问题
**解决**: 已修复，确保使用 UTF-8

### 问题 4: 类型错误
**原因**: TypeScript 类型不匹配
**解决**: 检查 `src/types/evaluation.ts`

---

## 📁 关键文件位置

### 前端组件
- 主组件: `src/app/dashboard/skills/create-wizard/EvaluationStep.tsx`
- 对比卡片: `src/app/dashboard/skills/create-wizard/components/EvaluationComparisonCard.tsx`
- Markdown 视图: `src/app/dashboard/skills/create-wizard/components/MarkdownOutputView.tsx`

### 后端 API
- API 路由: `src/app/api/skills/test-runs/route.ts`
- 类型定义: `src/types/evaluation.ts`

### 评估脚本
- Benchmark 聚合: `skills.clone/skills/skill-creator/scripts/aggregate_benchmark.py`
- 评估查看器: `skills.clone/skills/skill-creator/eval-viewer/generate_review.py`
- Grader Agent: `skills.clone/skills/skill-creator/agents/grader.md`

### 真实数据
- Benchmark: `my_cmd_inject-workspace/iteration-1/benchmark.json`
- Grading: `my_cmd_inject-workspace/iteration-1/eval-1/with_skill/run-1/grading.json`
- 输出: `my_cmd_inject-workspace/iteration-1/eval-1/with_skill/run-1/outputs/`

---

## 🎉 成功标志

当以下条件满足时，说明集成成功：

1. ✅ `npm run dev` 无错误启动
2. ✅ 访问评估页面能看到对比面板
3. ✅ API 返回真实的评估数据
4. ✅ Markdown 正确渲染
5. ✅ 数据来自真实文件（非模拟）

---

## 📞 需要帮助？

如果遇到问题，请检查：

1. **控制台日志**: 浏览器开发者工具 Console
2. **服务器日志**: 终端中的 npm 输出
3. **网络请求**: 浏览器开发者工具 Network 标签
4. **类型错误**: 运行 `npx tsc --noEmit`

---

## 🔄 下一次迭代

完成当前验证后，可以考虑：

1. **性能优化**
   - 添加数据缓存
   - 懒加载组件
   - 虚拟滚动

2. **功能增强**
   - 图表可视化
   - 导出报告
   - 历史对比

3. **测试覆盖**
   - 单元测试
   - 集成测试
   - E2E 测试

---

## ✨ 总结

**基础设施已完全就绪**，可以立即开始验证和测试！

所有代码已完成，构建成功，类型安全，编码问题已修复。

**下一步**: 启动开发服务器并访问 http://localhost:3000/dashboard/skills/create-wizard
