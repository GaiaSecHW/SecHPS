# D4: RCE/反序列化审计报告

**Agent:** audit-spec-rce  
**状态:** PASS  
**优先级:** HIGH (plan.json blocking: false)

---

## 审计范围

根据 `plan.agent_patterns["audit-spec-rce"]`，需要覆盖4种攻击模式：
1. **unsafe_deserialization** - 不安全反序列化
2. **dynamic_exec** - 动态命令执行
3. **script_engine** - 脚本引擎
4. **dangerous_reflection** - 危险反射

### 关键审计文件
- `src/lib/mcp-client.ts` - MCP子进程spawn
- `src/services/terminal-manager.ts` - node-pty终端
- `src/services/plugin-manager.ts` - 插件管理
- `src/services/plugin-runner.ts` - 插件执行
- `src/lib/agent-executor.ts` - Agent执行
- `src/lib/tool-executor.ts` - 工具执行器
- `src/lib/scan-executor.ts` - 扫描执行
- `src/lib/gitea.ts` - Gitea同步
- `src/app/api/plugins/upload/route.ts` - 插件上传
- `src/app/api/plugins/install/route.ts` - 插件安装
- `src/lib/workflow-actions/script-executor.ts` - 脚本执行
- `src/lib/workflow-actions/transform-executor.ts` - 数据转换

---

## 发现总结

| ID | 标题 | 严重度 | 模式 | 状态 |
|----|------|--------|------|------|
| D4-001 | MCP Stdio子进程命令执行 | HIGH | dynamic_exec | 确认 |
| D4-002 | 插件上传系统命令解压注入 | HIGH | dynamic_exec | 确认 |
| D4-003 | ToolExecutor内置命令执行工具 | HIGH | dynamic_exec | 确认 |
| D4-004 | Workflow脚本执行器vm沙箱逃逸 | CRITICAL(dead) | script_engine | Dead Code |
| D4-005 | Transform脚本执行器vm沙箱逃逸 | CRITICAL(dead) | script_engine | Dead Code |
| D4-006 | WebSocket终端交互式Shell访问 | HIGH | dynamic_exec | 确认 |
| D4-007 | CodeSwarm Local-Test未授权子进程 | HIGH | dynamic_exec | 确认 |

### 严重度分布
- **CRITICAL:** 0 (2个dead code不计入)
- **HIGH:** 5
- **MEDIUM:** 0
- **LOW:** 0

---

## 关键发现详情

### D4-001: MCP Stdio子进程命令执行
**路径:** `src/lib/mcp-client.ts:99`
- MCP服务器配置中的command和args直接传给`child_process.spawn()`
- 用户通过`POST /api/mcp-servers/test` 或数据库配置提供command
- 无任何命令白名单或参数校验
- 防护: 需要`mcp:create` 或 `CONFIG_READ` 权限

### D4-002: 插件上传命令解压注入
**路径:** `src/app/api/plugins/upload/route.ts:25`
- 使用`execAsync`执行系统unzip/tar命令
- 文件名(`file.name`)未经消毒直接嵌入shell命令
- Unix环境可使用`$(cmd)`或反引号注入
- Windows环境部分受PowerShell单引号保护

### D4-003: ToolExecutor命令执行
**路径:** `src/lib/tool-executor.ts:135`
- `execute_command`内置工具可直接执行任意系统命令
- 通过AI Agent prompt注入可达 (AgentExecutor → ToolExecutor)
- 危险命令黑名单仅5个模式，可轻松绕过

### D4-004/D4-005: vm沙箱逃逸 (Dead Code)
**路径:** `script-executor.ts:139`, `transform-executor.ts:298`
- `vm.createContext()`不提供安全隔离
- 经典逃逸: `this.constructor.constructor('return process')()`
- 当前代码库无调用者，但代码存在于代码库中有被误用风险
- 修复建议: 使用 `isolated-vm` 或移除动态执行功能

### D4-006: WebSocket终端Shell访问
**路径:** `src/services/terminal-manager.ts:21`
- WebSocket连接后自动创建交互式Shell (powershell/bash)
- cwd参数来自URL查询字符串，用户可控
- JWT认证后无任何命令操作限制

### D4-007: CodeSwarm Local-Test未授权
**路径:** `src/app/api/codeswarm/local-test/route.ts`
- POST端点无任何认证检查
- 触发`spawn(opcode, ..., {cwd: workspacePath})`
- workspacePath用户可控

---

## 4种应用模式覆盖

### unsafe_deserialization ✅
JavaScript/TypeScript项目中`JSON.parse`安全，无Python pickle/Java readObject等危险反序列化。

### dynamic_exec ✅ (高风险)
5个确认的命令执行sink:
1. `mcp-client.ts:99` - spawn
2. `plugin/upload/route.ts:25` - execAsync (tar/unzip)
3. `tool-executor.ts:135` - execAsync (execute_command)
4. `terminal-manager.ts:21` - pty.spawn
5. `codeswarm/local-test/route.ts:312` - spawn

### script_engine ✅ (dead code)
2个vm.Script使用，均为dead code但存在沙箱逃逸风险。

### dangerous_reflection ✅ 
无eval/new Function()直接使用，vm.Script.runInContext本质上属于动态执行。

---

## 未完成项
1. CodeSwarm worker/result 路由认证与spawn风险确认
2. DB中Tool脚本类型executorConfig注入验证
3. nfs-upload.ts Zip Slip风险
4. 插件系统未来运行时加载的RCE风险预测
