---
name: java-command-injection-scanner
description: 扫描 Java Web 项目中的命令注入漏洞。使用 ai4Java MCP 获取从 Web 入口到 Runtime.exec/ProcessBuilder 的完整调用链源代码，大模型审计漏洞可利用性并生成 POC。
license: MIT
compatibility: opencode
metadata:
  category: security
  language: java
  cwe: 	
  owasp: A03:2021-Injection
  requires-mcp: ai4Java
---

# Java 命令注入漏洞扫描

## 核心流程

1. **ai4Java** 获取调用链源代码（危险函数 → Web 入口）
2. 大模型审计：污点传播、安全过滤、漏洞确认
3. 编写 POC，生成报告

## MCP 依赖

**ai4Java 是唯一调用链分析工具。**

配置 `opencode.json`:
```json
{
  "mcp": {
    "ai4Java": {
      "type": "remote",
      "enabled": true,
      "url": "http://localhost:9999/sse",
      "timeout": 600000
    }
  }
}
```

## 危险函数签名

传递给 ai4Java 分析：

```
java.lang.Runtime.exec()
java.lang.ProcessBuilder.start()
```

## ai4Java 调用

```typescript
skill_mcp({
  mcp_name: "ai4Java",
  tool_name: "ai4Java",
  arguments: {
    signature: "java.lang.Runtime.exec()",
    traceToWebEntry: true  // 追踪到 Web 入口
  }
})
```

| 参数 | 说明 |
|------|------|
| `signature` | `包名.类名.方法名(参数类型)` |
| `traceToWebEntry` | `true` 返回完整调用链；`false` 仅目标方法 |

**返回**：调用链上所有方法的源代码（Web 入口 → 中间调用 → 危险函数）

## 审计流程

### 1. 识别 Web 入口

从返回代码中识别：`@Controller`、`@RequestMapping`、`@RequestParam`、`@RequestBody`、`HttpServlet`、`doGet/doPost` 等

### 2. 构建污点传播路径

```
Web 入口: [类名.方法名]
  ↓ 参数: [参数名] (来源: @RequestParam/@RequestBody)
  ↓ 第 N 行: [数据流转换]
  ↓ ...
Sink: [危险函数] (文件:行号)
```

### 3. 安全过滤检查

- ❌ 白名单验证: `if (ALLOWED_COMMANDS.contains(cmd))`
- ❌ 正则过滤: `Pattern.matches("^[a-z]+$", input)`
- ❌ 参数化执行: `ProcessBuilder("ping", host)`
- ❌ 输入转义

### 4. 漏洞判定

| 条件 | 严重程度 |
|------|----------|
| Web 入口 → Runtime.exec(用户输入) | 🔴 严重 |
| Web 入口 → ProcessBuilder(用户输入) | 🟠 高危 |
| 有白名单验证 | 🟡 中危 |
| 无 Web 入口 | 🟢 忽略 |

### 5. POC 编写

```http
POST /admin/exec HTTP/1.1
Host: target.com
Content-Type: application/json

{"command": "; cat /etc/passwd #"}
```

**攻击推导**：请求构造 → 参数接收 → 数据传递 → 危险函数调用 → Shell 解析 → 攻击效果

**Payload 类型**：`; cmd`、`| cmd`、`&& cmd`、`$(cmd)`、`` `cmd` ``、`%0acmd`

## 输出模板

```markdown
## 漏洞分析报告

### Web 入口
- 入口类: com.example.controller.AdminController
- HTTP 路径: POST /admin/exec
- 参数来源: @RequestBody

### 污点传播路径
[从入口到 Sink 的数据流]

### 安全过滤
- [ ] 白名单/正则/参数化/转义

### 漏洞确认
- 严重程度: 🔴 严重
- CWE: CWE-78

### POC
[完整攻击请求 + 推导过程]
```

## 工具使用

| 工具 | 用途 |
|------|------|
| `skill_mcp` | 调用 ai4Java |
| `read` | 补充读取源码 |
| `write` | 生成报告 |

## 注意事项

- ai4Java 执行时间长（10分钟+），设置足够 timeout
- 返回代码缺失关键类时，再次调用补充
- 确认漏洞后必须编写完整 POC

## ai4Java 失败处理

**如果 ai4Java 超时或失败：**

1. 停止当前子任务执行
2. 报告错误：`ai4Java 超时或连接失败`
3. 不要尝试使用 `grep`/`ast_grep_search` 等其他工具继续分析
4. 明确说明：ai4Java 是唯一支持的调用链分析工具
