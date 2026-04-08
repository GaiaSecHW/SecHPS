# Claude 会话前端页面设计规格

## 1. 概述

### 目标
更新 Claude 会话管理前端页面，提供更好的用户体验和更清晰的信息架构：
- 项目列表页面：展示所有 Claude Code 项目
- 会话列表页面：展示项目的所有会话
- 会话详情页面：展示会话的完整消息历史和工具调用

### 设计原则
1. **一致性**：遵循现有设计系统（Tailwind CSS + primary 色系）
2. **响应式**：支持移动端和桌面端
3. **可访问性**：清晰的视觉层次和交互反馈
4. **性能**：懒加载、虚拟滚动等优化

## 2. 设计系统分析

### 2.1 颜色系统

#### Primary 色系（来自 tailwind.config.ts）
```typescript
primary: {
  50: '#f0f9ff',   // 最浅
  100: '#e0f2fe',
  200: '#bae6fd',
  300: '#7dd3fc',
  400: '#38bdf8',
  500: '#0ea5e9',  // 主色
  600: '#0284c7',
  700: '#0369a1',
  800: '#075985',
  900: '#0c4a6e',
  950: '#082f49',  // 最深
}
```

#### 语义化颜色
- **成功**：`green-500/600` - `bg-green-50`, `text-green-700`, `border-green-200`
- **警告**：`yellow-500/600` - `bg-yellow-50`, `text-yellow-700`
- **错误**：`red-500/600` - `bg-red-50`, `text-red-700`, `border-red-200`
- **信息**：`blue-500/600` - `bg-blue-50`, `text-blue-700`

#### 状态颜色（来自 sessions/page.tsx）
```typescript
status: 'idle' | 'running' | 'completed' | 'failed'

// 状态样式映射
idle: 'bg-gray-100 text-gray-800 border-gray-200'
running: 'bg-blue-100 text-blue-800 border-blue-200'
completed: 'bg-green-100 text-green-800 border-green-200'
failed: 'bg-red-100 text-red-800 border-red-200'
```

#### 会话来源颜色
```typescript
claude: 'text-blue-600'    // Claude 官方
cursor: 'text-purple-600'   // Cursor IDE
codex: 'text-green-600'     // Codex
gemini: 'text-yellow-600'   // Gemini
```

### 2.2 间距系统

使用 Tailwind 默认间距（4px 基准）：
```typescript
space: {
  '1': '0.25rem',  // 4px
  '2': '0.5rem',   // 8px
  '3': '0.75rem',  // 12px
  '4': '1rem',     // 16px
  '6': '1.5rem',   // 24px
  '8': '2rem',     // 32px
}
```

### 2.3 布局模式

#### 页面容器
```typescript
// 主容器
<div className="space-y-6">
  {/* 头部 */}
  <div className="flex items-center justify-between">...</div>
  
  {/* 统计卡片 */}
  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">...</div>
  
  {/* 内容区域 */}
  <div className="bg-white rounded-lg border">...</div>
</div>
```

#### 卡片样式
```typescript
// 项目卡片
<div className="bg-white rounded-lg border overflow-hidden hover:shadow-lg transition-shadow">
  <div className="p-6">...</div>
  <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">...</div>
</div>
```

#### 表单输入
```typescript
// 标准输入框
<input
  className="w-full px-3 py-2 border border-gray-300 rounded-md 
             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
/>

// 搜索框（带图标）
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
  <input className="w-full pl-10 pr-4 py-2 border ..." />
</div>
```

#### 按钮样式
```typescript
// 主要按钮
<button className="px-4 py-2 bg-blue-600 text-white rounded-md 
                   hover:bg-blue-700 focus:outline-none focus:ring-2 
                   focus:ring-offset-2 focus:ring-blue-500">

// 次要按钮
<button className="px-4 py-2 border border-gray-300 rounded-md 
                   hover:bg-gray-50">

// 危险按钮
<button className="text-red-500 hover:bg-red-50 rounded">

// 图标按钮
<button className="p-2 text-gray-500 hover:bg-gray-100 rounded">
```

### 2.4 组件模式

#### 列表项（来自 claude/page.tsx）
```typescript
<div className="bg-white rounded-lg border overflow-hidden">
  <div className="flex items-center justify-between px-4 py-3 
                  cursor-pointer hover:bg-gray-50">
    <div className="flex items-center space-x-3 flex-1 min-w-0">
      <FolderOpen size={20} className="text-blue-500" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-gray-900 truncate">项目名称</div>
        <div className="text-xs text-gray-500 truncate">项目路径</div>
      </div>
    </div>
    <div className="flex items-center space-x-4">
      <span className="text-sm text-gray-500">会话数</span>
      <button className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
        <Play size={16} />
      </button>
    </div>
  </div>
</div>
```

#### 模态框
```typescript
{showModal && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <h3 className="text-lg font-semibold">标题</h3>
        <button className="text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>
      <div className="p-6">内容</div>
      <div className="px-6 py-4 border-t flex justify-end space-x-3">
        <button className="px-4 py-2 border rounded-md hover:bg-gray-50">取消</button>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-md">确认</button>
      </div>
    </div>
  </div>
)}
```

## 3. 页面设计

### 3.1 项目列表页面（更新 `src/app/dashboard/claude/page.tsx`）

#### 布局结构
```
┌─────────────────────────────────────────────────────────┐
│  Claude 会话                              [+ 新建项目]  │
├─────────────────────────────────────────────────────────┤
│  统计卡片 (项目数、Claude/Cursor/Codex/Gemini 会话数)  │
├─────────────────────────────────────────────────────────┤
│  🔍 搜索项目...                                         │
├─────────────────────────────────────────────────────────┤
│  📁 project-1 (/path/to/project-1)        5 会话      │
│  📁 project-2 (/path/to/project-2)        3 会话      │
└─────────────────────────────────────────────────────────┘
```

#### 功能需求
1. **项目卡片**
   - 显示项目名称和路径
   - 显示会话总数
   - 支持展开/折叠查看最近会话
   - 操作按钮：打开对话、删除

2. **多源会话**
   - 单独卡片展示 Cursor/Codex/Gemini 会话
   - 按来源分组显示会话数

3. **新建项目模态框**
   - 输入项目路径
   - 扫描 Claude Code 会话

### 3.2 会话列表页面（更新 `src/app/dashboard/claude/[project]/page.tsx`）

#### 布局结构（分屏布局）
```
┌─────────────────────────────────────────────────────────┐
│  ← 返回   project-1                    [删除项目]      │
├────────────────┬──────────────────────────────────────┤
│                │                                       │
│  会话列表      │  主内容区                             │
│  ────────────  │                                       │
│  [+ 新建会话] │  根据选择显示：                       │
│                │  - 空状态提示                         │
│  📝 会话1 ←   │  - 聊天面板                           │
│  📝 会话2     │  - 终端面板                           │
│  📝 会话3     │  - 文件面板                           │
│                │                                       │
│  来源筛选：    │                                       │
│  [全部▼]       │                                       │
│                │                                       │
└────────────────┴──────────────────────────────────────┘
```

#### 功能需求
1. **侧边栏（可折叠）**
   - 新建会话按钮
   - 会话列表（摘要、消息数、最后活动）
   - 来源筛选（全部/Claude/Cursor/Codex/Gemini）
   - 删除会话按钮（hover 显示）

2. **主内容区**
   - 标签页切换：聊天/终端/文件
   - 聊天面板：ChatContainer + 输入框
   - 终端面板：TerminalComponent
   - 文件面板：ClaudeFileBrowser + ClaudeFileEditor

3. **顶部工具栏**
   - 侧边栏切换按钮
   - 当前会话标题
   - 刷新按钮
   - 设置按钮

### 3.3 会话详情页面（新建 `src/app/dashboard/claude/[project]/[session]/page.tsx`）

#### 布局结构（参考现有的聊天界面）
```
┌─────────────────────────────────────────────────────────┐
│  ← 返回   会话1                          [续订会话]    │
├────────────────┬──────────────────────────────────────┤
│                │  消息列表                             │
│  [会话列表]    │  ─────────────────────                │
│  ────────────  │  📝 用户: 你好 Claude                │
│  📝 会话1 ←   │                                       │
│  📝 会话2     │  ✨ Claude: 你好！有什么可以帮你的？  │
│  📝 会话3     │                                       │
│                │  🔧 工具调用                         │
│  来源: 全部   │  ┌─────────────────────────────────┐│
│                │  │ ✏️ Edit                          ││
│                │  │ path: src/index.ts               ││
│                │  │ oldString: ...                   ││
│                │  │ newString: ...                   ││
│                │  └─────────────────────────────────┘│
│                │                                       │
└────────────────┴──────────────────────────────────────┘
```

#### 功能需求
1. **消息渲染**
   - 用户消息：右对齐，蓝色背景
   - 助手消息：左对齐，白色背景
   - 系统消息：居中，灰色背景

2. **工具调用卡片**
   - 工具图标 + 工具名称
   - 可折叠的参数面板
   - 工具结果（可折叠）

3. **思考过程**
   - 可折叠的思考块
   - 特殊样式（斜体、灰色）

4. **续订按钮**
   - 复制 resume 命令到剪贴板
   - 显示 toast 提示

### 3.4 工具调用图标映射

```typescript
const TOOL_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  // 文件操作
  'Edit': { icon: <Edit2 size={16} />, color: 'text-blue-600' },
  'Write': { icon: <FileText size={16} />, color: 'text-green-600' },
  'Read': { icon: <FileText size={16} />, color: 'text-gray-600' },
  
  // 命令执行
  'Bash': { icon: <Terminal size={16} />, color: 'text-purple-600' },
  
  // 搜索
  'Glob': { icon: <Search size={16} />, color: 'text-yellow-600' },
  'Grep': { icon: <Search size={16} />, color: 'text-orange-600' },
  
  // 任务管理
  'TodoWrite': { icon: <CheckSquare size={16} />, color: 'text-indigo-600' },
  
  // 网络
  'WebFetch': { icon: <Globe size={16} />, color: 'text-cyan-600' },
  
  // 默认
  'default': { icon: <Settings size={16} />, color: 'text-gray-600' },
};
```

## 4. API 集成

### 4.1 现有 API 端点

#### 项目管理
- `GET /api/claude` - 获取所有项目及其会话
- `POST /api/claude/projects` - 添加新项目
- `DELETE /api/claude/projects/[name]` - 删除项目

#### 会话管理
- `POST /api/claude/[project]/session` - 创建新会话
- `GET /api/claude/[project]/[sessionId]/messages` - 获取会话消息
- `DELETE /api/claude/[project]/[sessionId]` - 删除会话

#### 流式聊天
- `POST /api/claude/[project]/stream` - 流式发送消息

#### 文件操作
- `GET /api/claude/[project]/files/browse` - 浏览文件
- `POST /api/claude/[project]/files/read` - 读取文件
- `POST /api/claude/[project]/files/write` - 写入文件

### 4.2 数据模型

#### ClaudeProject
```typescript
interface ClaudeProject {
  name: string;
  path: string;
  displayName?: string;
  sessions: ClaudeSession[];
  cursorSessions?: ClaudeSession[];
  codexSessions?: ClaudeSession[];
  geminiSessions?: ClaudeSession[];
}
```

#### ClaudeSession
```typescript
interface ClaudeSession {
  id: string;
  summary: string;
  lastActivity: string;
  messageCount?: number;
  model?: string;
}
```

#### Message
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | any[];
  timestamp?: string;
  thinking?: string;
  _raw?: any;
}
```

## 5. 组件设计

### 5.1 复用现有组件

#### ChatContainer
- 位置：`src/components/chat/ChatContainer.tsx`
- 用途：显示消息列表
- Props：`messages`, `isStreaming`, `onApprovePermission`, `onRejectPermission`

#### ChatMessage
- 位置：`src/components/chat/ChatMessage.tsx`
- 用途：渲染单条消息
- 功能：支持用户/助手/工具消息

#### TerminalComponent
- 位置：`src/components/terminal/TerminalComponent.tsx`
- 用途：终端面板

#### ClaudeFileBrowser / ClaudeFileEditor
- 位置：`src/components/files/`
- 用途：文件浏览和编辑

### 5.2 新建组件

#### SessionList
- 位置：`src/components/claude/SessionList.tsx`
- Props：
  ```typescript
  interface SessionListProps {
    sessions: Session[];
    currentSessionId?: string;
    onSelect: (session: Session) => void;
    onDelete: (sessionId: string) => void;
    source?: 'claude' | 'cursor' | 'codex' | 'gemini' | 'all';
  }
  ```

#### ToolCallCard
- 位置：`src/components/claude/ToolCallCard.tsx`
- Props：
  ```typescript
  interface ToolCallCardProps {
    toolName: string;
    parameters: Record<string, any>;
    result?: any;
    timestamp?: string;
    expanded?: boolean;
  }
  ```

#### ThinkingBlock
- 位置：`src/components/claude/ThinkingBlock.tsx`
- Props：
  ```typescript
  interface ThinkingBlockProps {
    content: string;
    expanded?: boolean;
  }
  ```

#### ResumeButton
- 位置：`src/components/claude/ResumeButton.tsx`
- 功能：复制 resume 命令

## 6. 交互设计

### 6.1 加载状态
```typescript
// 页面加载
<div className="flex items-center justify-center h-64">
  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
</div>

// 列表加载
<div className="flex items-center space-x-2">
  <Loader2 size={14} className="animate-spin" />
  <span className="text-sm text-gray-600">加载中...</span>
</div>
```

### 6.2 空状态
```typescript
<div className="text-center py-12 bg-white rounded-lg border">
  <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
  <h3 className="mt-4 text-lg font-medium">暂无会话</h3>
  <p className="mt-2 text-sm text-gray-600">创建新会话开始对话</p>
</div>
```

### 6.3 错误处理
```typescript
{error && (
  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
    {error}
  </div>
)}
```

### 6.4 Toast 提示
使用简单的 alert 或考虑引入 toast 库：
```typescript
// 简单提示
alert('操作成功');

// 或使用 toast
toast.success('已复制到剪贴板');
```

## 7. 响应式设计

### 7.1 断点
```typescript
// Tailwind 默认断点
sm: '640px'   // 小屏幕
md: '768px'   // 平板
lg: '1024px'  // 桌面
xl: '1280px'  // 大屏幕
```

### 7.2 响应式布局
```typescript
// 网格布局
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

// 侧边栏折叠
<div className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all overflow-hidden`}>

// 移动端隐藏
<div className="hidden md:block">
```

## 8. 性能优化

### 8.1 懒加载
- 会话列表滚动加载（虚拟滚动）
- 消息分页加载
- 文件浏览器懒加载

### 8.2 缓存
- 会话列表本地缓存
- 消息历史缓存
- 项目列表缓存

### 8.3 优化渲染
- 使用 `React.memo` 优化组件
- 避免不必要的状态更新
- 使用 `useMemo` 和 `useCallback`

## 9. 可访问性

### 9.1 键盘导航
- Tab 键切换焦点
- Enter 键确认操作
- Escape 键关闭模态框

### 9.2 ARIA 标签
```typescript
<button aria-label="删除会话" title="删除">
  <Trash2 size={16} />
</button>
```

### 9.3 焦点管理
- 模态框打开时自动聚焦
- 删除后焦点移到下一项
- 键盘导航支持

## 10. 测试要点

### 10.1 功能测试
- [ ] 项目列表正确显示
- [ ] 新建项目功能正常
- [ ] 删除项目功能正常
- [ ] 搜索项目功能正常
- [ ] 会话列表正确显示
- [ ] 来源筛选功能正常
- [ ] 创建/删除会话功能正常
- [ ] 消息渲染正确
- [ ] 工具调用卡片显示正确
- [ ] 续订功能正常

### 10.2 UI 测试
- [ ] 响应式布局正常
- [ ] 加载状态显示正确
- [ ] 错误提示显示正确
- [ ] 空状态显示正确
- [ ] 动画流畅

### 10.3 性能测试
- [ ] 大量会话时列表流畅
- [ ] 滚动加载正常
- [ ] 内存占用合理

## 11. 实现计划

### Phase 1: 项目列表页面更新
1. 更新统计卡片样式
2. 优化项目卡片布局
3. 添加多源会话展示
4. 改进搜索功能

### Phase 2: 会话列表页面重构
1. 重构为分屏布局
2. 添加来源筛选
3. 优化会话卡片样式
4. 改进侧边栏交互

### Phase 3: 会话详情页面新建
1. 创建路由和基础组件
2. 实现消息渲染
3. 添加工具调用卡片
4. 实现思考过程显示
5. 添加续订功能

### Phase 4: 优化和完善
1. 性能优化
2. 响应式适配
3. 可访问性改进
4. 测试和修复

## 12. 注意事项

### 12.1 与现有代码的兼容性
- 保持现有的 API 调用方式
- 复用现有的组件和工具函数
- 遵循现有的错误处理模式

### 12.2 设计系统遵守
- 使用 Tailwind CSS 类
- 使用 primary 色系
- 遵循间距和字体规范
- 保持组件风格一致

### 12.3 代码质量
- TypeScript 类型定义完整
- 错误处理完善
- 代码注释清晰
- 组件职责单一
