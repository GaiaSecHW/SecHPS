# Opencode SDK 功能全集

> 本文档记录 Opencode SDK 的所有 API 功能，用于核对 AI4WEB 平台的集成进度。
>
> **更新时间**: 2025-03-30
> **SDK 版本**: 0.1.0-alpha.21
> **官方文档**: https://opencode.ai/docs/sdk/

---

## 一、SDK 资源概览

| 资源 | 类名 | 客户端调用 | HTTP 前缀 | 方法数 |
|------|------|-----------|-----------|--------|
| Session | `SessionResource` | `client.session.*` | `/session` | 12 |
| App | `AppResource` | `client.app.*` | `/app` | 5 |
| Config | `ConfigResource` | `client.config.*` | `/config` | 1 |
| File | `FileResource` | `client.file.*` | `/file` | 2 |
| Find | `Find` | `client.find.*` | `/find` | 3 |
| Event | `Event` | `client.event.*` | `/event` | 1 |
| Tui | `Tui` | `client.tui.*` | `/tui` | 2 |
| **总计** | | | | **26** |

---

## 二、Session API (`client.session.*`)

### 2.1 会话生命周期

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `create()` | `client.session.create()` | POST /session | ✅ 已集成 | 创建新会话 |
| `list()` | `client.session.list()` | GET /session | ⚠️ 部分 | 列出所有会话（平台用本地数据库） |
| `delete(id)` | `client.session.delete(id)` | DELETE /session/{id} | ⚠️ 部分 | 删除会话（平台用本地数据库） |

### 2.2 消息操作

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `chat(id, params)` | `client.session.chat(id, {...})` | POST /session/{id}/message | ✅ 已集成 | 发送消息并获取响应 |
| `messages(id)` | `client.session.messages(id)` | GET /session/{id}/message | ✅ 已集成 | 获取会话消息列表 |

### 2.3 会话控制

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `abort(id)` | `client.session.abort(id)` | POST /session/{id}/abort | ✅ 已集成 | 中止正在运行的会话 |
| `init(id, params)` | `client.session.init(id, {...})` | POST /session/{id}/init | ❌ 未集成 | 分析应用并创建 AGENTS.md |

### 2.4 会话分享

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `share(id)` | `client.session.share(id)` | POST /session/{id}/share | ✅ 已集成 | 分享会话 |
| `unshare(id)` | `client.session.unshare(id)` | DELETE /session/{id}/share | ✅ 已集成 | 取消分享会话 |

### 2.5 消息撤销

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `revert(id, params)` | `client.session.revert(id, {...})` | POST /session/{id}/revert | ✅ 已集成 | 撤销消息 |
| `unrevert(id)` | `client.session.unrevert(id)` | POST /session/{id}/unrevert | ✅ 已集成 | 恢复已撤销的消息 |

### 2.6 会话摘要

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `summarize(id, params)` | `client.session.summarize(id, {...})` | POST /session/{id}/summarize | ❌ 未集成 | 生成会话摘要 |

---

## 三、App API (`client.app.*`)

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `get()` | `client.app.get()` | GET /app | ❌ 未集成 | 获取应用信息 |
| `init()` | `client.app.init()` | POST /app/init | ❌ 未集成 | 初始化应用 |
| `log(params)` | `client.app.log({...})` | POST /log | ❌ 未集成 | 写入服务器日志 |
| `modes()` | `client.app.modes()` | GET /mode | ❌ 未集成 | 列出所有模式 |
| `providers()` | `client.app.providers()` | GET /config/providers | ✅ 已集成 | 列出所有 AI 提供商和模型 |

---

## 四、Config API (`client.config.*`)

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `get()` | `client.config.get()` | GET /config | ❌ 未集成 | 获取 Opencode 配置信息 |

---

## 五、File API (`client.file.*`)

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `read(params)` | `client.file.read({ path })` | GET /file?path=... | ✅ 已集成 | 读取文件内容 |
| `status()` | `client.file.status()` | GET /file/status | ✅ 已集成 | 获取文件变更状态 |

---

## 六、Find API (`client.find.*`)

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `files(params)` | `client.find.files({ query })` | GET /find/file?query=... | ✅ 已集成 | 按文件名搜索 |
| `symbols(params)` | `client.find.symbols({ query })` | GET /find/symbol?query=... | ✅ 已集成 | 搜索工作区符号 |
| `text(params)` | `client.find.text({ pattern })` | GET /find?pattern=... | ✅ 已集成 | 在文件中搜索文本 |

---

## 七、Event API (`client.event.*`)

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `list()` | `client.event.list()` | GET /event (SSE) | ✅ 已集成 | 获取实时事件流 |

### Event 事件类型（16 种）

| 事件类型 | 说明 |
|----------|------|
| `installation.updated` | 安装更新 |
| `lsp.client.diagnostics` | LSP 诊断 |
| `message.updated` | 消息更新 |
| `message.removed` | 消息删除 |
| `message.part.updated` | 消息部分更新 |
| `message.part.removed` | 消息部分删除 |
| `storage.write` | 存储写入 |
| `permission.updated` | 权限更新 |
| `file.edited` | 文件编辑 |
| `session.updated` | 会话更新 |
| `session.deleted` | 会话删除 |
| `session.idle` | 会话空闲 |
| `session.error` | 会话错误 |
| `file.watcher.updated` | 文件监视更新 |
| `ide.installed` | IDE 安装 |

---

## 八、Tui API (`client.tui.*`)

| 方法 | SDK 调用 | HTTP | 平台状态 | 说明 |
|------|----------|------|----------|------|
| `appendPrompt(params)` | `client.tui.appendPrompt({ text })` | POST /tui/append-prompt | ❌ 未集成 | 追加提示到 TUI |
| `openHelp()` | `client.tui.openHelp()` | POST /tui/open-help | ❌ 未集成 | 打开帮助对话框 |

> ⚠️ **注意**: TUI API 主要用于终端 UI 集成，Web 平台可能不需要。

---

## 九、Server API 扩展（SDK 未暴露）

### 9.1 项目管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/project` | GET | 列出所有项目 |
| `/project/current` | GET | 获取当前项目 |

### 9.2 全局

| 端点 | 方法 | 说明 |
|------|------|------|
| `/global/health` | GET | 获取服务器健康状态 |

### 9.3 路径和版本控制

| 端点 | 方法 | 说明 |
|------|------|------|
| `/path` | GET | 获取当前路径 |
| `/vcs` | GET | 获取版本控制信息 |

### 9.4 提供商（扩展）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/provider` | GET | 列出所有提供商详情 |
| `/provider/auth` | GET | 获取提供商认证方法 |
| `/provider/{id}/oauth/authorize` | POST | OAuth 授权 |
| `/provider/{id}/oauth/callback` | POST | OAuth 回调 |

### 9.5 会话（扩展）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/session/status` | GET | 获取所有会话状态 |
| `/session/:id/children` | GET | 获取子会话 |
| `/session/:id/todo` | GET | 获取会话待办事项 |
| `/session/:id/fork` | POST | 分叉会话 |
| `/session/:id/diff` | GET | 获取会话差异 |
| `/session/:id/message/:messageID` | GET | 获取单个消息详情 |
| `/session/:id/prompt_async` | POST | 异步发送消息 |
| `/session/:id/command` | POST | 执行斜杠命令 |
| `/session/:id/shell` | POST | 运行 shell 命令 |

### 9.6 文件（扩展）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/file` | GET | 列出文件和目录 |

### 9.7 工具（实验性）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/experimental/tool/ids` | GET | 列出所有工具 ID |
| `/experimental/tool` | GET | 列出模型的工具和 JSON Schema |

### 9.8 LSP、格式化程序、MCP

| 端点 | 方法 | 说明 |
|------|------|------|
| `/lsp` | GET | 获取 LSP 服务器状态 |
| `/formatter` | GET | 获取格式化程序状态 |
| `/mcp` | GET | 获取 MCP 服务器状态 |
| `/mcp` | POST | 动态添加 MCP 服务器 |

### 9.9 代理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/agent` | GET | 列出所有可用的代理 |

### 9.10 命令

| 端点 | 方法 | 说明 |
|------|------|------|
| `/command` | GET | 列出所有可用命令 |

---

## 十、集成进度统计

### SDK 方法集成统计

| 资源 | 总方法数 | 已集成 | 未集成 | 集成率 |
|------|----------|--------|--------|--------|
| Session | 12 | 9 | 3 | 75% |
| App | 5 | 1 | 4 | 20% |
| Config | 1 | 0 | 1 | 0% |
| File | 2 | 2 | 0 | 100% |
| Find | 3 | 3 | 0 | 100% |
| Event | 1 | 1 | 0 | 100% |
| Tui | 2 | 0 | 2 | 0% |
| **SDK 总计** | **26** | **16** | **10** | **62%** |

---

## 十一、未集成功能清单

### 🔴 高优先级

| 资源 | 方法 | 说明 |
|------|------|------|
| Session | `init()` | 创建 AGENTS.md |
| Session | `summarize()` | 会话摘要 |
| App | `get()` | 获取应用信息 |
| App | `init()` | 初始化应用 |
| App | `modes()` | 获取模式列表 |
| Config | `get()` | 获取 Opencode 配置 |
| Project | `list()` | 列出项目（Server API） |
| Project | `current()` | 获取当前项目（Server API） |

### 🟡 中优先级

| 资源 | 方法 | 说明 |
|------|------|------|
| App | `log()` | 写入日志 |
| Session | `children()` | 获取子会话（Server API） |
| Session | `fork()` | 分叉会话（Server API） |
| Session | `todo()` | 获取待办事项（Server API） |
| Session | `diff()` | 获取会话差异（Server API） |
| Session | `command()` | 执行命令（Server API） |
| Session | `shell()` | 运行 Shell（Server API） |
| Provider | `list()` | 列出提供商详情（Server API） |

### 🟢 低优先级

| 资源 | 方法 | 说明 |
|------|------|------|
| Global | `health()` | 健康检查（Server API） |
| Path | `get()` | 获取路径（Server API） |
| VCS | `get()` | 版本控制信息（Server API） |
| LSP | `get()` | LSP 状态（Server API） |
| MCP | `get/post` | MCP 管理（Server API） |
| Agent | `list()` | 列出代理（Server API） |
| Command | `list()` | 列出命令（Server API） |
| Tool | `ids/list` | 工具列表（Server API） |

---

## 十二、Server API 独有功能（SDK 未暴露）

以下功能存在于 Server API，但 SDK 没有对应的客户端方法。需要直接调用 HTTP API。

### 🔴 高优先级（核心功能）

| 端点 | 方法 | 说明 | 平台状态 |
|------|------|------|----------|
| `/project` | GET | 列出所有项目 | ❌ 未集成 |
| `/project/current` | GET | 获取当前项目 | ❌ 未集成 |
| `/session/:id/children` | GET | 获取子会话 | ❌ 未集成 |
| `/session/:id/todo` | GET | 获取会话待办事项 | ❌ 未集成 |
| `/session/:id/fork` | POST | 分叉会话 | ❌ 未集成 |
| `/session/:id/diff` | GET | 获取会话差异（代码变更） | ❌ 未集成 |
| `/session/:id/message/:messageID` | GET | 获取单个消息详情 | ❌ 未集成 |
| `/session/:id/prompt_async` | POST | 异步发送消息（不等待响应） | ❌ 未集成 |
| `/session/:id/command` | POST | 执行斜杠命令 | ❌ 未集成 |
| `/session/:id/shell` | POST | 运行 shell 命令 | ❌ 未集成 |

### 🟡 中优先级（增强功能）

| 端点 | 方法 | 说明 | 平台状态 |
|------|------|------|----------|
| `/global/health` | GET | 获取服务器健康状态和版本 | ❌ 未集成 |
| `/path` | GET | 获取当前工作路径 | ❌ 未集成 |
| `/vcs` | GET | 获取版本控制信息（Git 状态） | ❌ 未集成 |
| `/provider` | GET | 列出所有提供商详情 | ❌ 未集成 |
| `/provider/auth` | GET | 获取提供商认证方法 | ❌ 未集成 |
| `/provider/{id}/oauth/authorize` | POST | OAuth 授权 | ❌ 未集成 |
| `/provider/{id}/oauth/callback` | POST | OAuth 回调 | ❌ 未集成 |
| `/file` | GET | 列出文件和目录（目录浏览） | ❌ 未集成 |
| `/config` | PATCH | 更新配置（SDK 只有 GET） | ❌ 未集成 |

### 🟢 低优先级（辅助功能）

| 端点 | 方法 | 说明 | 平台状态 |
|------|------|------|----------|
| `/instance/dispose` | POST | 释放当前实例 | ❌ 未集成 |
| `/lsp` | GET | 获取 LSP 服务器状态 | ❌ 未集成 |
| `/formatter` | GET | 获取格式化程序状态 | ❌ 未集成 |
| `/mcp` | GET | 获取 MCP 服务器状态 | ❌ 未集成 |
| `/mcp` | POST | 动态添加 MCP 服务器 | ❌ 未集成 |
| `/agent` | GET | 列出所有可用的代理 | ❌ 未集成 |
| `/command` | GET | 列出所有可用命令 | ❌ 未集成 |
| `/experimental/tool/ids` | GET | 列出所有工具 ID | ❌ 未集成 |
| `/experimental/tool` | GET | 列出模型的工具和 JSON Schema | ❌ 未集成 |
| `/doc` | GET | 获取 OpenAPI 规范 | ❌ 未集成 |

### 🖥️ TUI 相关（Web 平台不需要）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/tui/open-sessions` | POST | 打开会话选择器 |
| `/tui/open-themes` | POST | 打开主题选择器 |
| `/tui/open-models` | POST | 打开模型选择器 |
| `/tui/submit-prompt` | POST | 提交当前提示 |
| `/tui/clear-prompt` | POST | 清除提示 |
| `/tui/execute-command` | POST | 执行命令 |
| `/tui/show-toast` | POST | 显示通知 |
| `/tui/control/next` | GET | 等待下一个控制请求 |
| `/tui/control/response` | POST | 响应控制请求 |

---

## 十三、Server API 独有功能统计

| 类别 | 数量 | 说明 |
|------|------|------|
| 🔴 高优先级 | 10 | 核心功能，建议实现 |
| 🟡 中优先级 | 9 | 增强功能，可选实现 |
| 🟢 低优先级 | 10 | 辅助功能，按需实现 |
| 🖥️ TUI 相关 | 9 | Web 平台不需要 |
| **总计** | **38** | Server API 独有端点 |

---

## 十四、实现建议

### 第一阶段（核心功能）

建议优先实现的端点：

```
/api/project                    # GET - 列出项目
/api/project/current            # GET - 当前项目
/api/sessions/[id]/todo         # GET - 待办事项
/api/sessions/[id]/diff         # GET - 代码差异
/api/sessions/[id]/command      # POST - 执行命令
```

### 第二阶段（增强功能）

```
/api/health                     # GET - 健康检查
/api/path                       # GET - 当前路径
/api/vcs                        # GET - Git 状态
/api/providers                  # GET - 提供商详情
/api/sessions/[id]/fork         # POST - 分叉会话
/api/sessions/[id]/children     # GET - 子会话
```

### 第三阶段（扩展功能）

```
/api/tools                      # GET - 工具列表
/api/agents                     # GET - 代理列表
/api/commands                   # GET - 命令列表
/api/mcp                        # GET/POST - MCP 管理
/api/lsp                        # GET - LSP 状态
```

---

## 十五、总集成进度统计

### SDK 方法集成

| 资源 | 总方法数 | 已集成 | 未集成 | 集成率 |
|------|----------|--------|--------|--------|
| Session | 12 | 9 | 3 | 75% |
| App | 5 | 1 | 4 | 20% |
| Config | 1 | 0 | 1 | 0% |
| File | 2 | 2 | 0 | 100% |
| Find | 3 | 3 | 0 | 100% |
| Event | 1 | 1 | 0 | 100% |
| Tui | 2 | 0 | 2 | 0% |
| **SDK 小计** | **26** | **16** | **10** | **62%** |

### Server API 独有端点集成

| 类别 | 总端点数 | 已集成 | 未集成 |
|------|----------|--------|--------|
| 🔴 高优先级 | 10 | 0 | 10 |
| 🟡 中优先级 | 9 | 0 | 9 |
| 🟢 低优先级 | 10 | 0 | 10 |
| 🖥️ TUI 相关 | 9 | 0 | 9（不需要） |
| **Server API 小计** | **38** | **0** | **29**（需实现） |

### 总体集成进度

| 来源 | 总数 | 已集成 | 未集成 | 集成率 |
|------|------|--------|--------|--------|
| SDK 方法 | 26 | 16 | 10 | 62% |
| Server API 独有 | 29 | 0 | 29 | 0% |
| **总计** | **55** | **16** | **39** | **29%** |

---

## 更新日志

- **2025-03-30**: 初始创建，记录 SDK 功能全集
- **2025-03-30**: 补充 Server API 独有功能（38 个端点）
- 集成进度: 16/55 总功能 (29%)

---

## 参考链接

- **SDK 文档**: https://opencode.ai/docs/sdk/
- **Server API 文档**: https://opencode.ai/docs/server/
- **GitHub**: https://github.com/anomalyco/opencode
