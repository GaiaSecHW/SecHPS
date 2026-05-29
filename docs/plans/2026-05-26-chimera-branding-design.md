# Chimera Platform Branding Design

**Date**: 2026-05-26
**Status**: Approved

## Overview

将平台从 "SecHPS" 更名为 "Chimera"（奇美拉），设计全新 LOGO，统一品牌常量。

Chimera — 希腊神话中的火焰吐息混合生物（狮首、羊身、蛇尾），象征"融合"与"不可能的组合"，契合多 Agent 融合平台理念。

## LOGO Design

### Style: 火焰徽章风

圆盾形徽章内，完整三首奇美拉居中构图。

### Composition

- **顶部**：狮首侧面轮廓，朝右，鬃毛用短弧线表现 3-4 层。口部张开，吐出火焰弧线向右上方延伸
- **中部**：羊首较小，从狮首颈部下方右侧探出，弯角用两根曲线表现
- **底部**：蛇尾从盾牌底部盘旋而出，沿左侧弧线向上延伸至狮首鬃毛附近，蛇首朝左，与狮首形成对角张力
- **动线**：右上（狮首 + 火焰）→ 中右（羊首）→ 左下（蛇尾盘旋向上），S 形动态流线
- **边框**：双层圆环 — 外环深蓝实线（粗），内环橙金细线，2px 间隔
- **火焰**：3 条渐变弧线从狮口吐出，最外层微微突破圆环边界（约 5px 溢出）

### Color Palette

| 元素 | 颜色 | 说明 |
|------|------|------|
| 盾牌外环 | `#1E3A5F` | 深海军蓝，安全/专业 |
| 盾牌内环 | `#D4A030` | 橙金边线 |
| 狮首轮廓 | `#D4A030` → `#E8C04A` | 橙金渐变，鬃毛亮金高光 |
| 狮口火焰 | `#E8C04A` → `#FF6B2B` → `#FFE066` | 亮金→焰橙→亮黄三层渐变 |
| 羊首 + 弯角 | `#C8B070` | 柔金 |
| 蛇尾 | `#1E3A5F` → `#2A5A8F` | 深蓝到中蓝渐变 |
| 蛇首小眼 | `#FF6B2B` | 焰橙点 |
| 背景 | `#0D1B2A` | 极深蓝，凸显轮廓 |

### Size Variants

| 变体 | 尺寸 | 用途 | 适配 |
|------|------|------|------|
| Full | 200×200px | 登录页、关于页 | 完整三首 + 双环 + 火焰溢出 |
| Medium | 48×48px | 侧边栏展开态 | 双环 + 三首简化为 2-3 主线 + 1 条火焰弧线 |
| Small | 32×32px | favicon、折叠态 | 外环 + 独首剪影 + 1 条火焰 + 底部蛇尾曲线暗示 |

## Implementation Plan

### New Files

| 文件 | 说明 |
|------|------|
| `public/chimera-logo-full.svg` | 200px 完整 LOGO |
| `public/chimera-logo-medium.svg` | 48px 中等 LOGO |
| `public/chimera-logo-small.svg` | 32px 简化 LOGO |
| `src/app/manifest.ts` | Web App Manifest |
| `src/lib/branding.ts` | 统一品牌常量 |
| `src/components/ChimeraLogo.tsx` | React LOGO 组件 |

### Code Changes

#### UI (replace Brain icon → ChimeraLogo)

- `src/app/layout.tsx` — title → 'Chimera', description 更新, favicon 链接
- `src/app/login/page.tsx` — Brain → ChimeraLogo full, "SecHPS" → "Chimera"
- `src/app/dashboard/layout.tsx` — Brain → ChimeraLogo medium/small, 添加 "Chimera" 文字
- `src/app/dashboard/page.tsx` — Brain → ChimeraLogo medium

#### Text (SecHPS → Chimera)

- `src/components/BroadcastMarquee.tsx` — 欢迎语
- `src/app/api/broadcast/route.ts` — 同上
- `src/app/api/admin/broadcast/route.ts` — 同上
- `src/app/dashboard/admin/broadcast/page.tsx` — 同上
- `src/app/api/config/export/route.ts` — _source, filename
- `src/app/api/config/import/route.ts` — _source 校验
- `src/app/dashboard/config/page.tsx` — filename 示例

#### Config/Internal

- `src/lib/branding.ts` — 统一常量（所有硬编码引用改用此文件）
- `src/lib/system-token-tracker.ts` — email
- `src/lib/mcp-client.ts` — clientInfo.name
- `src/lib/gitea-org-repo.ts` — git user.name
- `src/lib/claude-project-sync.ts` — 接口字段名、注释
- `src/types/config.ts` — 注释

#### Data/Seed

- `prisma/seed.ts` — adminEmail, 配置描述
- `prisma/reset-admin-password.ts` — adminEmail

#### Package/Scripts

- `package.json` — name, description
- `package-lock.json` — name
- `.env` / `.env.example` — 注释
- `run.sh` / `run.bat` — 注释
- `Dockerfile.server` — LABEL, 注释
- `.dockerignore` — 注释
- `plugins/example-plugin/manifest.json` — author, URLs

#### Skills

- `.claude/skills/threat-modeling/config.yaml` — author
- `skills/threat-modeling/config.yaml` — author

#### Docs (不改代码逻辑，仅更新品牌名)

- `README.md` — 标题
- `CLAUDE.md` — 项目描述
- `AGENTS.md` — 描述
- `docs/` 下各文档 — 品牌名引用

## Branding Constants

```ts
// src/lib/branding.ts
export const PLATFORM_NAME = 'Chimera'
export const PLATFORM_NAME_CN = '奇美拉'
export const LOGO_FULL = '/chimera-logo-full.svg'
export const LOGO_MEDIUM = '/chimera-logo-medium.svg'
export const LOGO_SMALL = '/chimera-logo-small.svg'
export const PLATFORM_EMAIL_DOMAIN = 'chimera.internal'
export const MCP_CLIENT_NAME = 'Chimera-mcp-client'
export const GIT_BOT_NAME = 'Chimera-Bot'
export const CONFIG_EXPORT_SOURCE = 'Chimera 平台'
export const CONFIG_EXPORT_PREFIX = 'Chimera-config'
```