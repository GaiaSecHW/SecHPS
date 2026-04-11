# 快速测试指南

## 问题诊断

您点击"开始评估"后看不到结果的原因：
1. ✅ **已修复**: API 端点不存在
2. ✅ **已修复**: 没有传递 `useRealData` 参数
3. ✅ **已修复**: 没有直接加载真实数据

## 修复内容

### 1. 新增 API 端点
**文件**: `src/app/api/skills/evaluation-data/route.ts`

**功能**: 直接读取 `my_cmd_inject-workspace/iteration-1/benchmark.json` 和相关输出文件

**访问**: `GET /api/skills/evaluation-data`

### 2. 修改 EvaluationStep.tsx
**改进**:
- 添加"加载已有结果"按钮
- 组件挂载时自动加载真实数据
- 修复 API 调用逻辑

## 测试步骤

### 方法 1: 使用"加载已有结果"按钮

1. 启动开发服务器:
```bash
npm run dev
```

2. 访问评估页面:
```
http://localhost:3000/dashboard/skills/create-wizard
```

3. 点击 **"加载已有结果"** 按钮（蓝色按钮）

4. 等待数据加载完成

5. 查看评估结果：
   - 对比面板
   - 断言列表
   - Markdown 输出

### 方法 2: 直接测试 API

```bash
# 测试 API 端点
curl http://localhost:3000/api/skills/evaluation-data

# 或在浏览器中访问
http://localhost:3000/api/skills/evaluation-data
```

**预期响应**:
```json
{
  "metadata": {
    "skill_name": "my_cmd_inject",
    "timestamp": "2026-04-09T16:23:26Z"
  },
  "runs": [
    {
      "eval_id": 0,
      "configuration": "with_skill",
      "result": {...},
      "outputs": {
        "vulnerability_report": "...",
        "security_analysis": "..."
      }
    }
  ]
}
```

## 调试检查清单

### ✅ 检查 API 是否工作
```bash
# 在浏览器控制台执行
fetch('/api/skills/evaluation-data')
  .then(r => r.json())
  .then(console.log)
```

### ✅ 检查文件路径
```bash
# 确认文件存在
ls D:\claude-web-platform\my_cmd_inject-workspace\iteration-1\benchmark.json
ls D:\claude-web-platform\my_cmd_inject-workspace\iteration-1\eval-1\with_skill\run-1\outputs\
```

### ✅ 检查浏览器控制台
- 打开开发者工具 (F12)
- 查看 Console 标签
- 查看 Network 标签

### ✅ 检查服务器日志
- 查看终端中的 npm 输出
- 查看是否有错误信息

## 常见问题

### 问题 1: 点击按钮无反应
**原因**: JavaScript 错误
**解决**: 检查浏览器控制台

### 问题 2: API 返回 500 错误
**原因**: 文件路径错误或权限问题
**解决**: 
```bash
# 检查文件是否存在
Test-Path "D:\claude-web-platform\my_cmd_inject-workspace\iteration-1\benchmark.json"
```

### 问题 3: 数据加载但界面不显示
**原因**: 状态更新问题
**解决**: 刷新页面重新加载

## 完整测试流程

### 步骤 1: 启动服务器
```bash
cd D:\claude-web-platform
npm run dev
```

### 步骤 2: 打开浏览器
```
http://localhost:3000
```

### 步骤 3: 导航到评估页面
1. 登录系统（如果需要）
2. 进入 Dashboard
3. 进入 Skills 创建向导
4. 跳到评估步骤

### 步骤 4: 加载数据
1. 点击 **"加载已有结果"** 按钮
2. 等待 2-3 秒
3. 查看结果面板

### 步骤 5: 验证功能
- [ ] 对比面板显示
- [ ] 断言列表可展开
- [ ] Markdown 正确渲染
- [ ] 颜色编码正确

## 数据验证

### 验证 benchmark.json
```bash
Get-Content "D:\claude-web-platform\my_cmd_inject-workspace\iteration-1\benchmark.json" -Encoding UTF8 | Select-Object -First 30
```

### 验证 grading.json
```bash
Get-Content "D:\claude-web-platform\my_cmd_inject-workspace\iteration-1\eval-1\with_skill\run-1\grading.json" -Encoding UTF8 | Select-Object -First 20
```

### 验证 Markdown 文件
```bash
Get-Content "D:\claude-web-platform\my_cmd_inject-workspace\iteration-1\eval-1\with_skill\run-1\outputs\vulnerability_report.md" -Encoding UTF8 | Select-Object -First 30
```

## 预期结果

### ✅ 成功标志
1. 点击"加载已有结果"后显示加载状态
2. 2-3 秒后显示评估结果
3. 看到 With Skill vs Without Skill 对比
4. 断言列表显示通过/失败状态
5. Markdown 内容正确渲染

### ❌ 失败标志
1. 按钮无反应
2. 控制台有错误
3. API 返回错误
4. 界面不显示数据

## 下一步

如果测试成功：
- ✅ 所有功能正常
- ✅ 可以查看评估结果
- ✅ 可以对比分析

如果测试失败：
1. 检查浏览器控制台错误
2. 检查服务器日志
3. 验证文件路径
4. 运行 API 测试

## 技术支持

如有问题，请提供：
1. 浏览器控制台截图
2. Network 标签的 API 请求详情
3. 服务器终端输出
4. 文件路径验证结果
