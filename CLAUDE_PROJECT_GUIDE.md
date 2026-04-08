# Claude 项目使用指南

## 🎯 问题说明

在 Claude Code CLI 中看不到 AI4WEB 创建的项目，这是因为：

**Claude Code CLI 通过当前工作目录 (`cwd`) 识别项目**，而不是通过配置文件或项目列表。

## ✅ 解决方案

### 方法 1：使用启动脚本（推荐）

创建项目时，系统会自动生成启动脚本：

**Windows**: `启动Claude.bat`
**Linux/Mac**: `start-claude.sh`

**使用步骤**：
1. 创建项目后，系统会显示脚本路径
2. 双击脚本文件，自动在项目目录启动 Claude CLI
3. Claude 会自动识别项目文件

### 方法 2：手动切换目录

```bash
# 切换到项目目录
cd D:\claude-web-platform\uploads\projects\{timestamp}

# 启动 Claude CLI
claude
```

### 方法 3：在 AI4WEB 平台中使用

AI4WEB 平台的评估功能已经可以正常使用：
- ✅ `projectPath` 已正确设置
- ✅ Claude Agent SDK 会使用 `cwd` 参数
- ✅ 文件可以正常访问
- ✅ 无需额外配置

## 📁 项目目录结构

```
uploads/
└── projects/
    └── {timestamp}/
        ├── 启动Claude.bat          # Windows 启动脚本
        ├── start-claude.sh         # Linux/Mac 启动脚本
        ├── your-project-files/      # 项目文件
        └── ...
```

## 🔧 配置文件位置

### AI4WEB 配置
- 数据库：`Project` 表
- 项目路径：`projectPath` 字段
- 文件存储：`uploads/projects/{timestamp}/`

### Claude CLI 配置
- 会话文件：`~/.claude/sessions/*.json`
- 项目目录：当前工作目录 (`cwd`)
- 识别方式：基于 `cwd` 自动识别

## 💡 使用建议

### 新建项目后

1. **记录项目路径**：创建项目时会显示路径
2. **使用启动脚本**：双击 `启动Claude.bat` 即可
3. **或手动切换**：`cd` 到项目目录后运行 `claude`

### 在 AI4WEB 中评估

1. 选择项目
2. 选择工作流（可选）
3. 点击"启动评估"
4. Claude Agent 会自动使用项目路径

## 🎁 自动化功能

系统已自动完成：
- ✅ 创建项目目录
- ✅ 生成启动脚本
- ✅ 同步 Claude 项目配置
- ✅ 设置正确的 `cwd` 参数

## ❓ 常见问题

**Q: 为什么 Claude CLI 看不到项目？**
A: Claude CLI 基于当前工作目录识别项目，需要在项目目录中运行 `claude` 命令。

**Q: 启动脚本在哪？**
A: 在项目目录中（`uploads/projects/{timestamp}/启动Claude.bat`）

**Q: AI4WEB 评估需要手动配置吗？**
A: 不需要，系统会自动使用正确的项目路径。

**Q: 如何删除项目？**
A: 在 AI4WEB 平台删除项目时，会同步删除项目目录和启动脚本。
