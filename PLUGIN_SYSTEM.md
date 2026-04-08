# 插件系统实现总结

## 已完成的文件

### 1. 数据库模型
- **文件**: `prisma/schema.prisma`
- **新增**: `Plugin` 模型，包含插件的基本信息、配置、状态等字段

### 2. 类型定义
- **文件**: `src/types/plugin.ts`
- **内容**:
  - `PluginType`: 插件类型定义 (ui-tab, backend-service, integration, tool)
  - `PluginStatus`: 插件状态定义 (active, inactive, error)
  - `Plugin`: 插件信息接口
  - `PluginManifest`: 插件清单接口
  - `PluginConfigSchema`: 插件配置 Schema
  - `PluginResponse`: 插件 API 响应接口
  - `InstallPluginRequest`: 安装插件请求接口
  - `TogglePluginRequest`: 切换插件状态请求接口

### 3. 权限常量
- **文件**: `src/types/permissions.ts`
- **新增权限**:
  - `PLUGIN_CREATE`: 创建/安装插件
  - `PLUGIN_READ`: 查看插件
  - `PLUGIN_UPDATE`: 更新插件配置
  - `PLUGIN_DELETE`: 删除/卸载插件
  - `PLUGIN_TOGGLE`: 启用/禁用插件

### 4. 插件管理器
- **文件**: `src/services/plugin-manager.ts`
- **功能**:
  - `discoverPlugins()`: 扫描 plugins 目录发现插件
  - `syncPlugins()`: 同步插件到数据库
  - `getPlugins()`: 获取所有插件列表
  - `getPlugin(id)`: 获取单个插件
  - `getPluginByName(name)`: 根据名称获取插件
  - `installPlugin(manifest, pluginPath)`: 安装新插件
  - `uninstallPlugin(id)`: 卸载插件
  - `togglePlugin(id, enabled)`: 启用/禁用插件
  - `updatePluginConfig(id, config)`: 更新插件配置
  - `getEnabledPlugins()`: 获取已启用的插件
  - `getPluginsByType(type)`: 按类型获取插件
  - `getPluginStats()`: 获取插件统计信息

### 5. API 路由

#### 插件列表 API
- **文件**: `src/app/api/plugins/route.ts`
- **端点**:
  - `GET /api/plugins`: 获取所有插件列表
  - `POST /api/plugins`: 安装新插件

#### 单个插件 API
- **文件**: `src/app/api/plugins/[id]/route.ts`
- **端点**:
  - `GET /api/plugins/[id]`: 获取单个插件详情
  - `PATCH /api/plugins/[id]`: 更新插件配置
  - `DELETE /api/plugins/[id]`: 卸载插件

#### 插件切换 API
- **文件**: `src/app/api/plugins/[id]/toggle/route.ts`
- **端点**:
  - `POST /api/plugins/[id]/toggle`: 启用/禁用插件

### 6. 前端管理页面
- **文件**: `src/app/dashboard/plugins/page.tsx`
- **功能**:
  - 插件统计展示（总数、已启用、未启用、错误）
  - 插件卡片布局展示
  - 显示插件名称、描述、版本、作者、类型、状态
  - 启用/禁用切换按钮
  - 卸载插件按钮（非内置插件）
  - 访问插件主页链接
  - 权限检查（PLUGIN_READ, PLUGIN_TOGGLE, PLUGIN_DELETE）
  - 使用 Tailwind CSS 样式
  - 使用 lucide-react 图标

### 7. 示例插件
- **文件**: `plugins/example-plugin/manifest.json`
- **内容**: 示例插件清单文件，用于演示插件系统

## 注意事项

### Prisma 客户端生成问题
如果遇到 `EPERM: operation not permitted` 错误，请尝试以下方法：

1. **关闭所有 Node.js 进程**:
   ```bash
   taskkill /F /IM node.exe
   ```

2. **删除并重新生成 Prisma 客户端**:
   ```bash
   rd /s /q node_modules\.prisma\client
   npx prisma generate
   ```

3. **如果仍然失败，重启计算机后再试**

### 数据库已同步
数据库 schema 已经成功推送，Plugin 表已创建。即使 Prisma 客户端生成失败，数据库结构也已正确更新。

## 使用说明

### 访问插件管理页面
访问 `/dashboard/plugins` 路径即可查看和管理插件。

### 权限配置
需要为角色添加以下权限才能使用插件管理功能：
- `plugin:read` - 查看插件列表
- `plugin:create` - 安装新插件
- `plugin:update` - 更新插件配置
- `plugin:delete` - 卸载插件
- `plugin:toggle` - 启用/禁用插件

### 插件清单格式
每个插件需要在 `plugins/` 目录下创建一个子目录，并在其中放置 `manifest.json` 文件：

```json
{
  "name": "plugin-name",
  "displayName": "插件显示名称",
  "description": "插件描述",
  "version": "1.0.0",
  "author": "作者名称",
  "type": "tool",
  "main": "index.js",
  "icon": "extension",
  "homepage": "https://example.com/plugin",
  "repository": "https://github.com/example/plugin",
  "configSchema": {
    "type": "object",
    "properties": {
      "option1": {
        "type": "string",
        "title": "选项1",
        "description": "选项1的描述"
      }
    },
    "required": ["option1"]
  }
}
```

## 技术栈
- **后端**: Next.js API Routes + Prisma ORM + SQLite
- **前端**: React 19 + TypeScript + Tailwind CSS
- **图标**: lucide-react
- **认证**: JWT Bearer Token
- **数据库**: Prisma + SQLite
