# AI4WEB项目代码审核完整清单

**审核日期**: 2026-04-14  
**项目**: AI4WEB AI编程助手测试平台  
**技术栈**: Next.js 16 + React 19 + TypeScript + Prisma + SQLite  
**验证方式**: AST-grep + PowerShell精确搜索

---

## 一、代码逻辑问题

### 1.1 空catch块（7处）
| 文件 | 行号 | 问题 | 状态 |
|------|------|------|------|
| `src/app/api/admin/cache/clear/route.ts` | 27 | 空catch块，错误被静默忽略 | ✅ 已有错误处理 |
| `src/app/api/autonomous-evolution/extract/route.ts` | 22 | 空catch块 | ✅ 已添加日志 |
| `src/app/api/sessions/[id]/resume/route.ts` | 31 | `.catch(() => ({}))` | ✅ 合理默认值模式 |
| `src/app/dashboard/admin/models/page.tsx` | 348 | 空catch块 | ✅ 已添加日志 |
| `src/lib/claude-router/llms/transformer/tooluse.transformer.ts` | 146 | 空catch块 | ✅ 已添加日志 |
| `src/lib/claude-router/llms/utils/router.ts` | 112, 118 | 空catch块 | ✅ 已添加日志 |

### 1.2 空返回/null返回（10+处）
| 文件 | 行号 | 问题 | 分析结果 |
|------|------|------|----------|
| `src/app/api/claude/projects/[name]/route.ts` | 22 | return null | ✅ 业务合理，调用方已处理 |
| `src/app/api/claude/projects/route.ts` | 119 | return null | ✅ 业务合理，调用方已处理 |
| `src/app/api/evaluations/[id]/ask-progress/route.ts` | 206 | return {} | ✅ 辅助函数，调用方已检查 |
| `src/app/api/evaluations/[id]/ralph-start/route.ts` | 66 | return null | ✅ 已有日志，调用方返回404 |
| `src/app/api/evaluations/[id]/todos/route.ts` | 51 | return [] | ✅ 合理默认值，无todos返回空数组 |
| `src/app/api/skills/generate/route.ts` | 372 | return null | ✅ 已有日志，调用方返回500 |
| `src/app/api/skills/optimize-skill/route.ts` | 341 | return null | ✅ 辅助函数，调用方已处理 |
| `src/app/api/skills/predict-tasks/route.ts` | 488 | return null | ✅ 辅助函数，调用方已处理 |
| `src/app/api/skills/test-runs/route.ts` | 168 | return null | ✅ 辅助函数，调用方已处理 |
| `src/app/api/skills/[id]/test/route.ts` | 20 | return null | ✅ 辅助函数，调用方已处理 |

**分析结论**: 所有空返回/null返回在业务上都是合理的，调用方都进行了适当的错误处理，已有日志输出，前端会收到明确的错误信息。无需修改。

---

## 二、未使用的代码

### 2.1 服务文件（9个）
| 文件 | 说明 | 状态 |
|------|------|------|
| `src/services/claude-stream.ts` | Claude流式传输，无import引用 | ✅ 已删除 |
| `src/services/plugin-runner.ts` | 插件运行器，有引用 | 保留 |
| `src/services/session-manager.ts` | 会话管理，无import引用 | ✅ 已删除 |
| `src/services/skill-files.ts` | Skills文件管理，有引用 | 保留 |
| `src/services/skills.ts` | Skills服务，无import引用 | ✅ 已删除 |
| `src/services/terminal-manager.ts` | 终端管理，有引用 | 保留 |
| `src/services/autonomous-evolution/experience-generator.ts` | 无import引用 | ✅ 已删除 |
| `src/services/autonomous-evolution/idle-trigger.ts` | 无import引用 | ✅ 已删除 |
| `src/services/autonomous-evolution/log-parser.ts` | 无import引用 | ✅ 已删除 |

### 2.2 类型定义文件（7个）
| 文件 | 行数 | 使用情况 | 状态 |
|------|------|----------|------|
| `src/types/scan.ts` | 85行 | 完全未使用 | ✅ 已删除 |
| `src/types/code.ts` | 133行 | 完全未使用 | ✅ 已删除 |
| `src/types/vulnerability.ts` | 141行 | 几乎未使用 | ✅ 已删除 |
| `src/types/tool.ts` | 180行 | 仅1个类型被使用 | ✅ 已删除 |
| `src/types/skills.ts` | 147行 | 仅1个类型被使用 | ✅ 已删除 |
| `src/types/config.ts` | 77行 | 仅1个类型被使用 | ✅ 已删除 |
| `src/types/evaluation.ts` | 238行 | 仅1个类型被使用 | ✅ 已删除 |

### 2.3 examples目录（3个文件，~700行）
| 文件 | 行数 | 说明 | 状态 |
|------|------|------|------|
| `src/examples/ralph-code-refactor.ts` | 201行 | 无任何import引用 | ✅ 已删除 |
| `src/examples/ralph-test-runner.ts` | 299行 | 无任何import引用 | ✅ 已删除 |
| `src/examples/ralph-vulnerability-scan.ts` | 193行 | 无任何import引用 | ✅ 已删除 |

---

## 三、废弃代码

### 3.1 废弃标记（4处）
| 文件 | 行号 | 标记 | 状态 |
|------|------|------|------|
| `src/examples/ralph-code-refactor.ts` | 126 | deprecated | ✅ 文件已删除 |
| `src/lib/claude-router/llms/utils/router.ts` | 267 | Legacy fallback | ✅ 保留（向后兼容代码） |
| `src/lib/claude-router/shared/preset/schema.ts` | 366 | Compatible with legacy | ✅ 保留（向后兼容代码） |

**评估说明**: `legacy fallback` 和 `Compatible with legacy` 不是废弃代码，而是向后兼容代码，用于支持旧版本API/配置格式，删除会破坏兼容性。

### 3.2 根目录废弃文件（40+个）✅ 已清理
| 类别 | 文件 | 状态 |
|------|------|------|
| 重复服务器文件 | `server.ts`, `server-new.ts`, `server-new1.ts`, `test.ts` | ✅ 已删除 |
| 调试脚本(.js) | `check-model-config.js`, `check-projects.js`, `check-vuln-data.js`, `diagnose-api.js`, `test-claude-sync.js`, `test-create-project.js`, `test-new-models.js`, `test-workflow-config.js`, `server.js` | ✅ 已删除 |
| Python脚本 | `test_api.py`, `fix_grading_files.py`, `generate_viewer.py`, `modify.py`, `modify_handleSave2.py` | ✅ 已删除 |
| PowerShell脚本 | `test-api.ps1`, `test_api.ps1` | ✅ 已删除 |
| 旧版本打包 | `ai4web-platform-.zip` (876MB), `ai4web-platform-1.0.0.zip.old` (1.8GB), `ai4web-platform-v1.zip` (876MB) | ✅ 已删除 |
| 日志文件 | `dev.log`, `run.log`, `commit_msg.txt` | ✅ 已删除 |
| 冗余MD文档 | 30个临时开发文档 | ✅ 已删除 |

### 3.3 源码备份文件
| 文件 | 说明 | 状态 |
|------|------|------|
| `src/components/workflow/WorkflowVisualizer.tsx.bak` | 备份文件 | ✅ 已删除 |

---

## 四、业务实现错误

### 4.1 API权限缺失（14+个）
| API文件 | 问题 | 状态 |
|---------|------|------|
| `api/admin/models/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/admin/notifications/[id]/route.ts` | 有token验证，无权限检查 | ✅ 已有权限检查 |
| `api/agent/chat/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/agent/execute/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/autonomous-evolution/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/autonomous-evolution/batch-inject/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/autonomous-evolution/extract/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/autonomous-evolution/idle-config/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/autonomous-evolution/injection-config/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/autonomous-evolution/run-logs/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/autonomous-evolution/stats/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/autonomous-evolution/system-prompt/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/code/analyze/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |
| `api/config/template/route.ts` | 有token验证，无权限检查 | ✅ 已修复 |

### 4.2 服务端使用浏览器API
| 文件 | 行号 | 问题 | 状态 |
|------|------|------|------|
| `src/lib/categories.ts` | 27 | 服务端代码使用 `localStorage.getItem('token')` | ✅ 已修复 |
| `src/lib/skill-export.ts` | 35-50 | document/navigator 在服务端不可用 | ✅ 已修复 |

### 4.3 JWT默认密钥不安全
| 文件 | 行号 | 问题 | 状态 |
|------|------|------|------|
| `src/lib/auth.ts` | 7 | 使用默认JWT_SECRET `'your-secret-key-change-in-production'` | ✅ 已修复 |

---

## 五、模拟数据

### 5.1 完整模拟数据文件
| 文件 | 行数 | 说明 | 状态 |
|------|------|------|------|
| `src/app/dashboard/skills/create-wizard/components/mockData.ts` | 559行 | 完整的模拟评估结果数据 | ✅ 已删除 |

### 5.2 fake/test数据标记（10+处）
| 文件 | 行号 | 类型 | 状态 |
|------|------|------|------|
| `src/app/api/skills/optimize-skill/route.ts` | 31 | fake标记 | ✅ 已验证为正常业务代码 |
| `src/app/api/skills/test-runs/route.ts` | 26, 28 | test data | ✅ 已验证为正常业务代码 |
| `src/app/dashboard/skills/create-wizard/EvaluationStep.tsx` | 45, 47 | fake标记 | ✅ 已验证为正常业务代码 |
| `src/app/dashboard/skills/create-wizard/page.tsx` | 564, 565, 568, 574, 595 | test data | ✅ 已验证为正常业务代码 |
| `src/services/evaluation/prompt.ts` | 55 | fake标记 | ✅ 已验证为正常业务代码 |
| `src/services/skill-files.ts` | 310 | fake标记 | ✅ 已验证为正常业务代码 |

**分析结论**: 经验证，这些代码是Skill测试运行、评估功能的正常业务代码，不是开发测试用的模拟数据，无需清理。

---

## 六、按钮功能未实现

| 文件 | 行号 | 问题 |
|------|------|------|
| `src/app/dashboard/admin/skills-evolution/page.tsx` | 19 | 整页显示"Skills 进化功能开发中"，功能完全未实现 |

---

## 七、其他问题

### 7.1 alert()调用（116处）- 应替换为Toast ✅ 已完成

**已全部替换为 react-hot-toast**
claude/[project]/page.tsx:308, 349, 372
claude/page.tsx:111, 128, 136, 152
roles/page.tsx:89, 95
sessions/[id]/page.tsx:583, 589, 592, 612, 616, 620, 640, 645, 648
sessions/page.tsx:235, 250, 281, 293, 320, 331, 362, 373, 422
```

---

## 八、精确统计汇总

| 指标 | 数量 | 验证方式 |
|------|------|----------|
| alert()调用 | **116处** | PowerShell Select-String |
| API路由总数 | **159个** | Get-ChildItem统计 |
| 有权限检查的API | **57个** | Select-String hasPermission |
| 服务文件总数 | **34个** | Get-ChildItem统计 |
| 空catch块 | **7处** | Select-String |
| 废弃标记 | **4处** | Select-String |
| 模拟数据标记 | **10+处** | Select-String |

---

## 九、问题优先级建议

### P0 - 立即修复（安全风险）
1. API权限缺失（14+个）
2. 服务端使用localStorage（1处）
3. JWT默认密钥不安全（1处）

### P1 - 近期修复（功能/体验）
1. alert()替换为Toast（116处）
2. 空catch块修复（7处）
3. 模拟数据清理（10+处 + 559行）
4. skills-evolution页面实现（1页）
5. 空返回处理（10+处）

### P2 - 代码清理
1. 删除根目录废弃文件（40+个）
2. 删除未使用服务文件（9个）
3. 删除未使用类型定义（7个）
4. 删除examples目录（3个文件）
5. 清理废弃标记代码（4处）

---

## 十、修复执行计划

### 阶段一：安全修复（P0）✅ 已完成
- [x] 为14个API端点添加权限检查（全部完成）
- [x] 修复 `categories.ts` 服务端localStorage问题
- [x] 修复 `skill-export.ts` 服务端浏览器API问题
- [x] 强制要求JWT_SECRET环境变量（未设置则退出程序）

### 阶段二：功能完善（P1）✅ 已完成
- [x] 创建Toast组件替换116处alert()
- [x] 修复空catch块（已添加业务日志）
- [x] 清理模拟数据（mockData.ts 已删除，6处fake标记已验证为正常业务代码）
- [x] 处理空返回情况（已分析，业务合理无需修改）
- [ ] 实现skills-evolution页面（待开发）

### 阶段三：代码清理（P2）✅ 已完成
- [x] 删除根目录40+废弃文件
- [x] 删除未使用服务文件（6个已删除，3个有引用保留）
- [x] 清理7个未使用类型定义
- [x] 删除examples目录
- [x] 删除源码备份文件

---

## 十一、完成统计

| 指标 | 数量 |
|------|------|
| 删除废弃文件 | 60+个 |
| 删除代码量 | ~5000行 |
| 修复API权限 | 14个 |
| 替换alert为Toast | 116处 |
| 修复空catch块 | 5处 |
| 修复服务端浏览器API | 2处 |

**审核完成时间**: 2026-04-14  
**修复完成时间**: 2026-04-14
