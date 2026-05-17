# D10 客户端安全审计报告

## 范围

- **技术栈**: Next.js 16 + React 19 + TypeScript + TailwindCSS
- **审计维度**: DOM XSS、CSRF、PostMessage、CORS、WebSocket
- **攻击模式**: dom_xss, csrf_boundary, postmessage_boundary, cors_misuse, websocket_boundary
- **覆盖**: 84 个 Dashboard 页面 (`.tsx`)，核心客户端组件，WebSocket 服务端，中间件

---

## 审计结果

| 攻击模式 | 状态 | 说明 |
|---------|------|------|
| DOM XSS | ✅ PASS | `dangerouslySetInnerHTML` 仅用于语法高亮，均通过 DOMPurify 清洗 |
| CSRF | ✅ PASS | API 使用 Bearer Token 认证；Cookies 设 HttpOnly + SameSite=Strict |
| PostMessage | ✅ PASS | 未发现 `postMessage()` 调用；没有跨源消息监听器 |
| CORS | ✅ PASS | 单源部署，无需 CORS；未发现 `Access-Control-Allow-Origin: *` |
| WebSocket | ⚠️ 注释 | Token 校验 OK，但 Token 通过 URL 查询参数传递（见 D10-002） |

---

## 发现摘要

### D10-001 [MEDIUM] CodeSwarm SSE 流端点缺乏认证

- **文件**: `src/app/api/codeswarm/tasks/[taskId]/stream/route.ts`
- **CWE**: CWE-306 (Missing Authentication for Critical Function)
- **描述**: SSE 端点 `/api/codeswarm/tasks/[taskId]/stream` 无任何认证。知道 taskId 者即可获取任务实时事件流，包括执行结果、错误信息等。
- **影响**: 任务执行数据泄露。taskId 为 UUID 但可能通过 URL、日志等渠道泄露。
- **建议**: 添加 Bearer Token 认证；限制 stream 仅对任务创建者可见。

### D10-002 [MEDIUM] WebSocket URL 中包含 JWT Token

- **文件**: `src/lib/websocket-server.ts` + `src/components/terminal/TerminalComponent.tsx`
- **CWE**: CWE-200 (Exposure of Sensitive Information)
- **描述**: WebSocket 连接将 JWT token 放在 URL 查询参数中 (`?token=xxx`)。Token 可能泄露到：
  - 服务端访问日志
  - Referer 请求头
  - 浏览器历史记录
- **建议**: 使用 WebSocket 握手阶段的自定义 Header 传递 Token。

### D10-003 [LOW] JWT Token 存储在 localStorage

- **文件**: 所有 Dashboard 页面 (`src/hooks/useAuth.ts` 为统一入口)
- **CWE**: CWE-312 (Cleartext Storage of Sensitive Information)
- **描述**: JWT Token 通过 `localStorage.setItem('token', data.token)` 存储，所有 API 调用从 localStorage 读取。SPA 通用模式但若有 XSS 则 Token 可被窃取。
- **建议**: 考虑 HttpOnly Cookie + 适当 CSRF 保护替代。

### D10-004 [LOW] 安全头缺失

- **文件**: `src/middleware.ts`
- **CWE**: CWE-693
- **描述**: 中间件仅检查 `auth-token` cookie 存在性并重定向。未设置 CSP、X-Frame-Options、X-Content-Type-Options 等安全头。
- **建议**: 添加 CSP 头、X-Frame-Options: DENY、X-Content-Type-Options: nosniff。

---

## 已确认通过项

### DOM XSS 防护
- 仅有 2 处使用 `dangerouslySetInnerHTML`（`FileEditor.tsx`、`ClaudeFileEditor.tsx`），均通过 `DOMPurify.sanitize()` 清洗 HTML
- 聊天消息使用 `ReactMarkdown` 渲染，默认不渲染原始 HTML
- 未发现 `document.write()`、`innerHTML`、`outerHTML` 等 DOM XSS sink
- 未发现 `eval()`、`new Function()` 等动态执行

### CSRF 防护
- Cookie 配置: `HttpOnly; SameSite=Strict; Path=/`
- API 认证: `Authorization: Bearer <token>` header，不使用 Cookie
- 仪表盘中间件仅用 Cookie 检查登录状态（重定向），不做 API 鉴权

### CORS
- 项目中无 CORS 中间件/配置
- Next.js 16 standalone 部署为同源架构，CORS 非必需
- 未发现 `Access-Control-Allow-Origin: *` 配置

### WebSocket 安全
- 服务端使用 `verifyToken()` 验证 JWT Token ✓
- 无效 Token 返回 `1008` 关闭码 ✓
- 终端管理器正确处理消息，`terminal.write()` 使用 xterm.js API ✓

---

## 未完成项

1. **task-builder SSE 端点**: 客户端尝试连接 `/api/task-builder/tasks/${id}/logs/stream`，但该端点未见实现。需等待实现后审计。
2. **外部 OAuth/SSO 集成**: 当前审计未覆盖 Gitea OAuth 回调流程。若将来增加 OAuth 流程，需审计回调 URL 的 token 注入风险。

---

## 总评

- 严重度: 无 Critical/High 发现
- 中等: 2 (D10-001, D10-002)
- 低: 2 (D10-003, D10-004)
- 客户端整体防护状态: **良好**。React 19 的默认转义机制 + DOMPurify 使用 + SameSite Cookie 提供了有效的基线防护。
