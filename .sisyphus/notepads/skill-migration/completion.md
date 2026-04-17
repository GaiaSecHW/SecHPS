# Skill 迁移完成记录

## 迁移时间
2026-04-17

## 最终统计

| 项目 | 数量 |
|------|------|
| Skill | 214 |
| TechStackOption | 24 |
| VulnerabilityPattern | 86 |
| 漏洞分类 | 17 |

## 批次详情

| 批次 | 成功 | 失败 |
|------|------|------|
| languages | 19 | 0 |
| frameworks | 14 | 0 |
| checklists | 9 | 0 |
| adapters | 5 | 0 |
| core | 22 | 0 |
| wooyun | 33 | 0 |
| security | 112 | 0 |

## 数据来源
`E:\NAZHUA-main\opencode\skills\code-audit\references\`

## 注意事项
1. 多语言文件已按语言拆分
2. 内容已标准化为 AI4WEB 格式（添加 YAML frontmatter）
3. 技术栈和漏洞模式按需自动创建
4. 备份文件：`prisma/backup_pre_migration.db`

## 脚本位置
- `scripts/clear-skills.ts` - 清空数据
- `scripts/seed-techstack.ts` - 技术栈种子
- `scripts/seed-vulnpattern.ts` - 漏洞模式种子
- `scripts/parse-languages.ts` - 解析 languages
- `scripts/parse-all.ts` - 批量解析
- `scripts/import-all.ts` - 导入数据库
- `scripts/verify.ts` - 最终验证
