---
name: audit-report-parser
description: 仅解析 Report 文件夹中的漏洞数据。优先校验并读取 JSON 文件，若 JSON 数据格式不符合预期结构则回退解析 Report 文件夹下的所有 Markdown 文件。严禁处理其他文件夹内容。当用户想要分析审计报告或提取漏洞信息时使用。
---

# 审计报告解析器

**重要限制**：此技能仅处理工作区中的 `Report` 文件夹内容，**严禁读取或处理其他任何位置的文件**。

## 严格限制

- **只允许读取**：`Report` 文件夹内的文件
- **禁止读取**：Report 文件夹之外的任何文件、其他目录、父目录、子目录等
- **所有文件路径**：必须限定在 `<工作区>/Report/` 目录下

## 执行步骤

**所有操作必须在 Report 文件夹内进行，不得访问其他位置。**

当被调用时，按以下步骤执行：

1. **定位 Report 文件夹**：
   - 仅在工作区根目录下查找名为 `Report` 的文件夹
   - **禁止搜索其他目录或子目录**

2. **检查并处理所有 JSON 文件（仅限 Report 文件夹内）**：
   - 在 `<工作区>/Report/` 目录下使用 Glob 搜索 `*.json` 文件
   - **禁止搜索 Report 文件夹之外的 JSON 文件**
   - 如果存在 JSON 文件，逐个读取所有 JSON 文件内容
   - **逐个校验 JSON 数据格式**：检查每个 JSON 是否符合预期结构（详见下方"JSON 格式校验"章节）
     - 如果格式校验通过，使用该 JSON 数据继续处理
     - 如果格式校验失败，**放弃该 JSON 文件**，继续校验下一个 JSON 文件
   - **合并所有校验通过的 JSON 数据**：将所有校验通过的 JSON 文件中的 vulnerabilities 数组合并为一个统一的 vulnerabilities 数组
   - **补全顶层缺失字段**：如果合并后的结果中缺少 `evaluationId` 或 `skillExecutionId` 字段，补上这两个字段，值设为空字符串 `""`
   - **过滤非漏洞条目**：检查每个漏洞对象的 `vulnerable` 字段，如果值为 `false`，表示该条目不是漏洞，**从结果中排除该条目**，不构造到返回的 vulnerabilities 数组中
   - **处理 rawReport 字段**：检查每个漏洞的 rawReport 字段
     - 如果 rawReport 为空字符串，需要从 location 字段解析文件路径
     - location 字段中可能包含文件路径注解，格式如 `filename:line` 或 `// filename:line -- comment`
     - 提取所有文件名，结合工作区路径构建绝对路径，多个文件用分号分隔
   - 如果所有 JSON 文件均校验失败或不存在 JSON 文件，继续下一步

3. **解析 Markdown 文件（仅限 Report 文件夹内，当所有 JSON 格式不符或无 JSON 时）**：
   - 在 `<工作区>/Report/` 目录下使用 Glob 搜索 `*.md` 文件
   - **禁止搜索 Report 文件夹之外的 Markdown 文件**
   - 读取 Report 文件夹内找到的所有 Markdown 文件内容
   - 分析 markdown 内容，提取所有漏洞信息

4. **返回结构化 JSON**：输出包含以下结构的 JSON 对象：

```json
{
  "evaluationId": "string (可选)",
  "skillExecutionId": "string (可选)",
  "vulnerabilities": [
    {
      "title": "string (必填) - 漏洞标题",
      "type": "string (必填) - 漏洞类型 (如 sql-injection, xss, command-injection)",
      "description": "string (可选) - 详细描述",
      "severity": "string (可选) - 严重程度 (默认: medium, 自动标准化)",
      "cwe": "string (可选) - CWE 编号",
      "skill": "string (可选) - 发现漏洞的 Skill 名称",
      "location": "string (可选) - 漏洞所在的关键源代码内容",
      "POC": "string (可选) - 概念验证代码",
      "vulnerable": "boolean (可选) - 是否确认存在漏洞 (默认: true，值为 false 时该条目不纳入结果)",
      "fixSuggestion": "string (可选) - 修复建议",
      "rawReport": "string (可选) - 漏洞涉及的文件绝对路径，多个文件使用分号分隔"
    }
  ]
}
```

## 字段说明

| 字段 | 类型 | 必填 | 说明 |
|-------|------|----------|-------------|
| evaluationId | string | 否 | 关联评估会话 ID |
| skillExecutionId | string | 否 | 关联 Skill 执行记录 ID |
| vulnerabilities | array | 是 | 漏洞数组（1~100 条） |
| vulnerabilities[].title | string | 是 | 漏洞标题 |
| vulnerabilities[].type | string | 是 | 漏洞类型（如 sql-injection） |
| vulnerabilities[].description | string | 否 | 漏洞描述（默认空字符串） |
| vulnerabilities[].severity | string | 否 | 严重程度（默认 medium，自动标准化） |
| vulnerabilities[].cwe | string | 否 | CWE 编号 |
| vulnerabilities[].skill | string | 否 | 发现漏洞的 Skill 名称 |
| vulnerabilities[].location | string | 否 | 漏洞所在的关键源代码内容 |
| vulnerabilities[].POC | string | 否 | POC 验证代码 |
| vulnerabilities[].vulnerable | boolean | 否 | 是否确认存在漏洞（默认 true，值为 false 时排除该条目不纳入结果） |
| vulnerabilities[].fixSuggestion | string | 否 | 修复建议 |
| vulnerabilities[].rawReport | string | 否 | 漏洞涉及的文件绝对路径，多个文件使用分号分隔（如 `E:/project/file1.py;E:/project/file2.js`） |

## JSON 格式校验

读取 JSON 文件后，必须先校验数据是否符合预期结构，校验通过才使用 JSON 数据，校验失败则回退到 Markdown 解析。

### 校验规则

以下条件**全部满足**才算校验通过：

1. **顶层结构**：JSON 必须是对象（不能是数组、字符串、数字等），且包含 `vulnerabilities` 数组字段
2. **vulnerabilities 数组**：必须是数组类型，且至少包含 1 条漏洞对象
3. **漏洞对象必填字段**：每条漏洞对象必须包含 `title`（字符串且非空）和 `type`（字符串且非空）字段
4. **字段类型一致性**：
   - `vulnerabilities[].severity` 如果存在，必须是字符串
   - `vulnerabilities[].vulnerable` 如果存在，必须是布尔值
   - `vulnerabilities[].rawReport` 如果存在，必须是字符串
5. **不包含未知顶层字段**：顶层仅允许 `evaluationId`、`skillExecutionId`、`vulnerabilities` 三个字段（可缺少前两个）

### 校验失败的场景

以下情况视为格式不符，应放弃 JSON 并回退到 Markdown：

- JSON 顶层不是对象（如是数组、字符串、数字、null）
- JSON 缺少 `vulnerabilities` 字段，或 `vulnerabilities` 不是数组
- `vulnerabilities` 数组为空（0 条漏洞）
- 漏洞对象缺少 `title` 或 `type` 字段，或它们的值为空字符串、非字符串类型
- `severity` 字段存在但值为数字、数组等非字符串类型
- `vulnerable` 字段存在但值为字符串、数字等非布尔类型
- JSON 结构完全不符合漏洞报告格式（如是一般的配置文件、日志数据等）

### 校验流程

1. 尝试将文件内容解析为 JSON 对象
2. 如果解析失败（不是合法 JSON），判定为格式不符
3. 如果解析成功，依次检查上述 5 条校验规则
4. 任何一条不满足，判定为格式不符
5. 格式不符时，**不使用该 JSON 数据**，转至步骤 3 解析 Markdown 文件

## 字段缺失处理

**重要**：输出 JSON 必须包含所有字段，不可省略任何字段。如果原文档中未提供对应信息，必须按以下规则处理：

### 顶层字段

1. **evaluationId**：如果 JSON 中缺少此字段，补上空字符串 `""`；如果存在则保留原值
2. **skillExecutionId**：如果 JSON 中缺少此字段，补上空字符串 `""`；如果存在则保留原值
3. **vulnerabilities**：必须存在，至少包含一个漏洞对象

### vulnerabilities 数组中的字段

1. **字符串类型可选字段**（description、cwe、skill、location、POC、fixSuggestion）：如果缺失，使用空字符串 `""`
2. **rawReport 字段**：漏洞涉及的文件绝对路径，多个文件使用分号 `;` 分隔。格式示例：`E:/work/project/ssh_check.py` 或 `E:/work/project/opencode.json;E:/work/project/.opencode/agents/nazhua-audit.md`
3. **布尔类型可选字段**（vulnerable）：如果缺失，使用默认值 `true`；**如果值为 `false`，表示不是漏洞，该条目从结果中排除，不纳入 vulnerabilities 数组**
4. **severity 字段**：如果缺失，使用默认值 `"medium"`
5. **必填字段**（title、type）：必须从文档中提取，无法提取时应返回合理推测值或报错

### 示例输出（包含所有字段）

```json
{
  "evaluationId": "",
  "skillExecutionId": "",
  "vulnerabilities": [
    {
      "title": "硬编码 SSH 凭据",
      "type": "hardcoded-credentials",
      "description": "硬编码了 SSH 连接密码",
      "severity": "critical",
      "cwe": "CWE-798",
      "skill": "",
      "location": "// ssh_check.py:6 -- 硬编码密码\npassword='Huawei12#$'",
      "POC": "grep -o \"password='[^']*\" ssh_check.py",
      "vulnerable": true,
      "fixSuggestion": "使用环境变量或密钥管理服务",
      "rawReport": "E:/work/project/ssh_check.py"
    },
    {
      "title": "权限配置不一致",
      "type": "incorrect-authorization",
      "description": "权限配置冲突",
      "severity": "high",
      "cwe": "CWE-863",
      "skill": "",
      "location": "// opencode.json:40 -- 受限权限\n\"bash\": { \"*\": \"ask\" }\n// .opencode/agents/nazhua-audit.md:21 -- 冲突\nbash: allow",
      "POC": "",
      "vulnerable": true,
      "fixSuggestion": "确保配置一致性",
      "rawReport": "E:/work/project/opencode.json;E:/work/project/.opencode/agents/nazhua-audit.md"
    }
  ]
}
```

## 从 location 字段解析文件路径

当 JSON 文件中的 rawReport 字段为空时，需要从 location 字段解析出涉及的文件路径。

### 解析规则

location 字段中可能包含以下格式的文件路径注解：

1. **注释格式**：`// filename:line -- comment` 或 `# filename:line`
2. **直接格式**：`filename:line` 或 `filename:line-number`
3. **多文件格式**：多个文件路径可能用逗号、换行或注释分隔

### 示例 location 内容及解析结果

| location 内容示例 | 解析出的文件路径 |
|-------------------|-------------------|
| `// ssh_check.py:6 -- 硬编码密码` | `ssh_check.py` |
| `ssh.connect(...)`（无文件注解） | 空字符串 |
| `// opencode.json:40\n...\n// .opencode/agents/nazhua-audit.md:21` | `opencode.json;.opencode/agents/nazhua-audit.md` |
| `opencode.json:41` | `opencode.json` |

### 处理流程

1. 使用正则表达式匹配 location 字符串中的文件路径模式
2. 提取文件名部分（去除行号）
3. 将工作区绝对路径与文件名拼接，得到完整路径
4. 多个文件使用分号 `;` 分隔
5. 如果 location 中无法解析出文件路径，rawReport 保持空字符串

### 正则模式参考

- `//\s*([a-zA-Z0-9_./-]+):\d+` - 匹配注释中的文件路径
- `([a-zA-Z0-9_./-]+\.py|[a-zA-Z0-9_./-]+\.js|[a-zA-Z0-9_./-]+\.json|[a-zA-Z0-9_./-]+\.md):\d+` - 匹配常见文件类型

## 严重程度标准化

将严重程度值标准化为：`critical`、`high`、`medium`、`low`、`info`

常见严重程度映射：
- 严重、critical、Critical → `critical`
- 高危、high、High → `high`
- 中危、medium、Medium、moderate → `medium`
- 低危、low、Low → `low`
- 信息、info、Informational → `info`

## JSON 字符串安全规则

**输出 JSON 时，所有字符串值必须严格遵守 JSON 转义规范，确保最终输出是可直接解析的有效 JSON。location、POC 等字段允许包含原始源代码片段，但必须正确转义。**

### 必须转义的特殊字符

| 原字符 | JSON 转义写法 | 说明 |
|--------|---------------|------|
| 双引号 `"` | `\"` | **最常见导致 JSON 格式错乱的字符** |
| 反斜杠 `\` | `\\` | 路径和正则中常见，必须双重转义 |
| 换行符 | `\n` | **禁止在 JSON 字符串中直接换行**，必须用 `\n` 转义表示 |
| 制表符 | `\t` | 必须用 `\t` 转义表示 |
| 回车符 | `\r` | 必须用 `\r` 转义表示 |

### 嵌入代码片段的转义规则

location、POC、description 等字段允许包含原始源代码片段，这是业务要求。但代码中的特殊字符必须严格转义，否则会破坏 JSON 结构。

**关键原则**：代码原文必须保留，但其中破坏 JSON 结构的字符必须转义。

#### 转义处理流程

1. 将代码片段原样保留
2. 遍历代码片段，按以下规则逐字符转义：
   - 遇到 `\` → 替换为 `\\`（但已经是合法 JSON 转义序列如 `\n` `\t` `\r` `\uXXXX` 的除外）
   - 遇到 `"` → 替换为 `\"`
   - 遇到物理换行 → 替换为 `\n`
   - 遇到物理制表符 → 替换为 `\t`
3. 将转义后的代码片段放入 JSON 字符串值中

#### 转义示例

**原始代码**：`password='Huawei12#$'`

**转义后 JSON**：`"password='Huawei12#$'"`（此例无需转义，因不含 `"` 或 `\`）

---

**原始代码**：`conn.execute("SELECT * FROM users WHERE id = " + user_id)`

**错误写法**（裸引号破坏 JSON）：`"conn.execute("SELECT * FROM users WHERE id = " + user_id)"`

**正确写法**（转义引号）：`"conn.execute(\"SELECT * FROM users WHERE id = \" + user_id)"`

---

**原始 location 含多行代码**：

```
// opencode.json:40 -- 受限权限
"bash": { "*": "ask" }
// .opencode/agents/nazhua-audit.md:21 -- 冲突
bash: allow
```

**正确写法**（转义引号和换行）：`"// opencode.json:40 -- 受限权限\n\"bash\": { \"*\": \"ask\" }\n// .opencode/agents/nazhua-audit.md:21 -- 冲突\nbash: allow"`

---

**原始 POC 含双引号**：`grep -o "password='[^']*" ssh_check.py`

**正确写法**：`"grep -o \"password='[^']*\" ssh_check.py"`

### Base64 编码兜底方案

当代码片段转义过于复杂（如包含大量引号、多层嵌套转义、超长多行代码），手动转义极易出错时，使用 Base64 编码作为兜底：

1. **优先使用转义方案**：对于简单代码片段，按上述规则手动转义
2. **Base64 兜底触发条件**：
   - 代码片段包含 3 个及以上需要转义的双引号
   - 代码片段超过 200 个字符且含多层嵌套转义
   - 手动转义后自检发现 JSON 格式仍错乱
3. **Base64 编码流程**：
   - 将原始代码片段（未转义）进行 Base64 编码
   - 在字段值前添加 `base64:` 前缀标识
   - 示例：原始代码 `conn.execute("SELECT * FROM users")` → Base64 编码 → `"base64:Y29ubi5leGVjdXRlKCJTRUxFQ1QgKiBGUk9NIHVzZXJzIik="`

### 转义检查清单

输出 JSON 前必须逐项检查：

1. 所有字符串值中的 `"` 是否已替换为 `\"`（除非使用了 Base64 编码）
2. 所有字符串值中的 `\`（非转义前缀）是否已替换为 `\\`（除非使用了 Base64 编码）
3. 字符串值中**不存在**物理换行（必须用 `\n` 表示）
4. 含代码片段的字段是否已正确转义，代码原文是否保留
5. 使用了 Base64 编码的字段是否以 `base64:` 前缀标识

### 自检步骤

**输出前必须执行以下自检**：

1. 将输出的完整 JSON 字符串尝试解析为 JSON 对象
2. 如果解析失败，定位格式错误并修复：
   - 检查是否有未转义的 `"` 或 `\`
   - 检查是否有物理换行残留在字符串值中
   - 对仍无法修复的字段，改用 Base64 编码兜底方案
3. 解析成功后，检查代码片段字段的内容是否完整保留了原始代码（不含 Base64 前缀的字段需还原转义验证原文完整性）
4. 重复自检直到 JSON 可正确解析且代码原文完整
5. **确认最终输出是合法 JSON 且代码片段完整后才返回**

## 输出格式

仅返回 JSON 对象，不添加额外的 markdown 格式或说明。输出应为可直接解析的有效 JSON。**输出前必须完成上述"自检步骤"，确保 JSON 格式无误。**

## 使用示例

当用户请求解析审计报告或提到 Report 文件夹时：
1. **仅在** `<工作区>/Report/` 文件夹内操作
2. 检查 `<工作区>/Report/` 目录是否存在 JSON 文件
3. 若存在 JSON 文件：
   - 逐个读取 `<工作区>/Report/*.json` 文件
   - 逐个校验 JSON 数据格式是否符合预期结构（详见"JSON 格式校验"章节）
   - 合并所有校验通过的 JSON 数据的 vulnerabilities 数组
   - 过滤 `vulnerable` 为 `false` 的条目（排除非漏洞），检查剩余漏洞的 rawReport 字段是否为空，若为空从 location 字段解析文件路径，构建绝对路径填充 rawReport
   - 若所有 JSON 格式校验失败：放弃所有 JSON，回退到 Markdown 解析
4. 若所有 JSON 文件均校验失败或无 JSON 文件，使用 Glob 在 `<工作区>/Report/` 下搜索 `*.md` 文件并读取所有找到的 Markdown 文件
5. 提取报告中发现的所有漏洞
6. 按上述格式返回结构化的 JSON 数据，确保所有字段都存在

**违反限制的情况**：
- 如果用户要求处理其他文件夹，拒绝并提示"此技能仅处理 Report 文件夹"
- 如果在其他位置发现类似文件，忽略它们，只处理 Report 文件夹内的内容