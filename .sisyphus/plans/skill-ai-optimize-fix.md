# Skill AI 优化 Bug 修复

## 问题描述

1. **技术栈信息丢失（Bug）**：前端没有将 techStack 传递给大模型
   - 需要修复：前端传递 techStack → 后端提示词添加技术栈约束

2. **500行限制不合理**：去掉这个限制

## 执行 TODO

- [ ] 1. 修改前端 `src/app/dashboard/skills/[id]/page.tsx`：传递 techStack 和 cwe
- [ ] 2. 修改后端 `src/app/api/skills/optimize-skill/route.ts`：提示词添加技术栈约束
- [ ] 3. 修改 `src/lib/skill-builder.ts`：去掉 500 行限制