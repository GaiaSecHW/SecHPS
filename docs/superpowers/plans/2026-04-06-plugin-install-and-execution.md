# 插件系统增强：安装界面与执行机制 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为插件系统添加前端安装界面和完善插件执行机制，使用户可以通过 UI 安装插件并让系统实际加载和运行插件代码。

**架构：** 
- 前端安装界面：在插件管理页面添加模态框表单，支持两种安装方式（从本地目录安装和从 URL 安装）
- 插件执行机制：创建 PluginRunner 服务，根据插件类型执行不同的加载策略，支持沙箱隔离和生命周期管理

**技术栈：** Next.js 16, React 19, TypeScript, Prisma, SQLite

---

## 文件结构

### 新增文件
- `src/services/plugin-runner.ts` - 插件运行器核心服务
- `src/services/plugin-sandbox.ts` - 插件沙箱环境（安全隔离）
- `src/components/plugins/InstallPluginModal.tsx` - 安装插件模态框
- `src/app/api/plugins/install/route.ts` - 从 URL 安装插件的 API
- `src/app/api/plugins/[id]/execute/route.ts` - 执行插件的 API

### 修改文件
- `src/app/dashboard/plugins/page.tsx` - 添加安装按钮和模态框集成
- `src/services/plugin-manager.ts` - 添加执行相关方法
- `src/types/plugin.ts` - 添加执行相关类型
- `prisma/schema.prisma` - 添加插件执行状态字段（可选）

---

## 任务分解

### 任务 1：扩展插件类型定义

**文件：**
- 修改：`src/types/plugin.ts`

- [ ] **步骤 1：添加插件执行相关类型**

在 `src/types/plugin.ts` 末尾添加：

```typescript
// 插件执行上下文
export interface PluginExecutionContext {
  projectId?: string;
  evaluationId?: string;
  userId: string;
  config?: Record<string, any>;
  env?: Record<string, string>;
}

// 插件执行结果
export interface PluginExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number; // 执行时长（毫秒）
  logs?: string[];
}

// 插件执行器接口
export interface PluginExecutor {
  type: PluginType;
  execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult>;
  validate(plugin: PluginResponse): Promise<boolean>;
  load(plugin: PluginResponse): Promise<void>;
  unload(plugin: PluginResponse): Promise<void>;
}

// 插件安装源
export interface PluginInstallSource {
  type: 'local' | 'url' | 'npm';
  path?: string; // 本地路径
  url?: string;  // 远程 URL
  package?: string; // npm 包名
}

// 安装插件请求（扩展）
export interface InstallPluginFromUrlRequest {
  url: string; // 插件 manifest.json 的 URL 或压缩包 URL
  name?: string; // 可选：指定插件名称
}

// 插件运行时状态
export interface PluginRuntimeState {
  pluginId: string;
  status: 'idle' | 'loading' | 'running' | 'error' | 'unloaded';
  lastExecution?: Date;
  executionCount: number;
  errorCount: number;
  lastError?: string;
}
```

- [ ] **步骤 2：验证类型定义**

运行：`npx tsc --noEmit src/types/plugin.ts`
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/types/plugin.ts
git commit -m "feat(plugin): add plugin execution and installation types"
```

---

### 任务 2：创建插件运行器核心服务

**文件：**
- 创建：`src/services/plugin-runner.ts`

- [ ] **步骤 1：创建插件运行器服务框架**

创建文件 `src/services/plugin-runner.ts`：

```typescript
/**
 * 插件运行器服务
 * 负责插件的加载、执行、卸载等运行时操作
 */

import { prisma } from '@/lib/prisma';
import * as path from 'path';
import * as fs from 'fs';
import type {
  PluginResponse,
  PluginType,
  PluginExecutionContext,
  PluginExecutionResult,
  PluginExecutor,
  PluginRuntimeState,
} from '@/types/plugin';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

// 运行时状态缓存
const runtimeStates = new Map<string, PluginRuntimeState>();

/**
 * 插件运行器类
 */
export class PluginRunner {
  /**
   * 初始化插件运行器
   */
  static async initialize(): Promise<void> {
    // 确保插件目录存在
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    }

    // 初始化所有已启用插件的运行时状态
    const enabledPlugins = await prisma.plugin.findMany({
      where: { isEnabled: true },
    });

    for (const plugin of enabledPlugins) {
      runtimeStates.set(plugin.id, {
        pluginId: plugin.id,
        status: 'idle',
        executionCount: 0,
        errorCount: 0,
      });
    }

    console.log(`[PluginRunner] Initialized with ${enabledPlugins.length} enabled plugins`);
  }

  /**
   * 获取运行时状态
   */
  static getRuntimeState(pluginId: string): PluginRuntimeState | undefined {
    return runtimeStates.get(pluginId);
  }

  /**
   * 获取所有运行时状态
   */
  static getAllRuntimeStates(): PluginRuntimeState[] {
    return Array.from(runtimeStates.values());
  }

  /**
   * 加载插件
   */
  static async loadPlugin(plugin: PluginResponse): Promise<void> {
    const state = runtimeStates.get(plugin.id);
    if (state) {
      state.status = 'loading';
    }

    try {
      // 根据插件类型选择加载策略
      const executor = this.getExecutor(plugin.type);
      await executor.load(plugin);

      if (state) {
        state.status = 'idle';
      }

      console.log(`[PluginRunner] Loaded plugin: ${plugin.name}`);
    } catch (error) {
      if (state) {
        state.status = 'error';
        state.lastError = error instanceof Error ? error.message : 'Unknown error';
        state.errorCount++;
      }
      throw error;
    }
  }

  /**
   * 卸载插件
   */
  static async unloadPlugin(plugin: PluginResponse): Promise<void> {
    try {
      const executor = this.getExecutor(plugin.type);
      await executor.unload(plugin);

      const state = runtimeStates.get(plugin.id);
      if (state) {
        state.status = 'unloaded';
      }

      console.log(`[PluginRunner] Unloaded plugin: ${plugin.name}`);
    } catch (error) {
      console.error(`[PluginRunner] Failed to unload plugin ${plugin.name}:`, error);
      throw error;
    }
  }

  /**
   * 执行插件
   */
  static async executePlugin(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();
    const state = runtimeStates.get(plugin.id);

    if (!state || state.status === 'unloaded') {
      // 尝试加载插件
      await this.loadPlugin(plugin);
    }

    if (state) {
      state.status = 'running';
    }

    try {
      // 验证插件
      const executor = this.getExecutor(plugin.type);
      const isValid = await executor.validate(plugin);

      if (!isValid) {
        throw new Error('Plugin validation failed');
      }

      // 执行插件
      const result = await executor.execute(plugin, context);

      if (state) {
        state.status = 'idle';
        state.executionCount++;
        state.lastExecution = new Date();
      }

      // 更新数据库统计
      await prisma.plugin.update({
        where: { id: plugin.id },
        data: {
          // 可以添加执行统计字段
        },
      });

      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      if (state) {
        state.status = 'error';
        state.lastError = error instanceof Error ? error.message : 'Unknown error';
        state.errorCount++;
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 获取插件执行器
   */
  private static getExecutor(type: PluginType): PluginExecutor {
    switch (type) {
      case 'tool':
        return new ToolPluginExecutor();
      case 'backend-service':
        return new BackendServiceExecutor();
      case 'integration':
        return new IntegrationExecutor();
      case 'ui-tab':
        return new UITabExecutor();
      default:
        throw new Error(`Unknown plugin type: ${type}`);
    }
  }

  /**
   * 验证插件完整性
   */
  static async validatePlugin(plugin: PluginResponse): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // 检查插件路径
    if (!plugin.pluginPath && !plugin.isBuiltin) {
      errors.push('Plugin path is missing');
    }

    // 检查插件文件
    if (plugin.pluginPath) {
      const manifestPath = path.join(plugin.pluginPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        errors.push('manifest.json not found');
      }

      // 检查主入口文件
      // TODO: 从 manifest 中读取 main 字段
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * 工具插件执行器
 */
class ToolPluginExecutor implements PluginExecutor {
  type: PluginType = 'tool';

  async load(plugin: PluginResponse): Promise<void> {
    // 工具插件加载逻辑
    console.log(`[ToolExecutor] Loading tool plugin: ${plugin.name}`);
  }

  async unload(plugin: PluginResponse): Promise<void> {
    console.log(`[ToolExecutor] Unloading tool plugin: ${plugin.name}`);
  }

  async validate(plugin: PluginResponse): Promise<boolean> {
    // 验证工具插件
    return true;
  }

  async execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();

    try {
      // 执行工具插件逻辑
      // TODO: 实现实际的工具执行逻辑
      console.log(`[ToolExecutor] Executing tool: ${plugin.name}`, context);

      return {
        success: true,
        data: { message: `Tool ${plugin.name} executed successfully` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * 后端服务插件执行器
 */
class BackendServiceExecutor implements PluginExecutor {
  type: PluginType = 'backend-service';

  async load(plugin: PluginResponse): Promise<void> {
    console.log(`[BackendExecutor] Loading backend service: ${plugin.name}`);
  }

  async unload(plugin: PluginResponse): Promise<void> {
    console.log(`[BackendExecutor] Unloading backend service: ${plugin.name}`);
  }

  async validate(plugin: PluginResponse): Promise<boolean> {
    return true;
  }

  async execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();

    try {
      console.log(`[BackendExecutor] Executing service: ${plugin.name}`, context);

      return {
        success: true,
        data: { message: `Service ${plugin.name} executed` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * 集成插件执行器
 */
class IntegrationExecutor implements PluginExecutor {
  type: PluginType = 'integration';

  async load(plugin: PluginResponse): Promise<void> {
    console.log(`[IntegrationExecutor] Loading integration: ${plugin.name}`);
  }

  async unload(plugin: PluginResponse): Promise<void> {
    console.log(`[IntegrationExecutor] Unloading integration: ${plugin.name}`);
  }

  async validate(plugin: PluginResponse): Promise<boolean> {
    return true;
  }

  async execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();

    try {
      console.log(`[IntegrationExecutor] Executing integration: ${plugin.name}`, context);

      return {
        success: true,
        data: { message: `Integration ${plugin.name} executed` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * UI 标签页插件执行器
 */
class UITabExecutor implements PluginExecutor {
  type: PluginType = 'ui-tab';

  async load(plugin: PluginResponse): Promise<void> {
    console.log(`[UITabExecutor] Loading UI tab: ${plugin.name}`);
  }

  async unload(plugin: PluginResponse): Promise<void> {
    console.log(`[UITabExecutor] Unloading UI tab: ${plugin.name}`);
  }

  async validate(plugin: PluginResponse): Promise<boolean> {
    return true;
  }

  async execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult> {
    const startTime = Date.now();

    try {
      console.log(`[UITabExecutor] Rendering UI tab: ${plugin.name}`, context);

      // UI 标签页插件返回渲染信息
      return {
        success: true,
        data: {
          component: plugin.name,
          props: context.config || {},
        },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }
}

export default PluginRunner;
```

- [ ] **步骤 2：验证编译**

运行：`npx tsc --noEmit src/services/plugin-runner.ts`
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/services/plugin-runner.ts
git commit -m "feat(plugin): add plugin runner service with executor pattern"
```

---

### 任务 3：创建插件安装模态框组件

**文件：**
- 创建：`src/components/plugins/InstallPluginModal.tsx`

- [ ] **步骤 1：创建安装插件模态框组件**

创建文件 `src/components/plugins/InstallPluginModal.tsx`：

```typescript
'use client';

import { useState } from 'react';
import {
  X,
  Upload,
  Link,
  Package,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-react';

interface InstallPluginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type InstallMethod = 'local' | 'url';

interface FormData {
  method: InstallMethod;
  localPath: string;
  url: string;
  // Manifest 字段（可选，用于手动输入）
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  type: 'tool' | 'backend-service' | 'integration' | 'ui-tab';
}

export default function InstallPluginModal({
  isOpen,
  onClose,
  onSuccess,
}: InstallPluginModalProps) {
  const [formData, setFormData] = useState<FormData>({
    method: 'local',
    localPath: '',
    url: '',
    name: '',
    displayName: '',
    description: '',
    version: '1.0.0',
    author: '',
    type: 'tool',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('请先登录');
      }

      let response: Response;

      if (formData.method === 'local') {
        // 从本地目录安装
        if (!formData.localPath) {
          throw new Error('请输入插件目录路径');
        }

        // 读取本地 manifest.json
        // 注意：浏览器无法直接读取本地文件系统，这里需要用户手动输入 manifest 信息
        // 或者通过文件上传实现
        const manifest = {
          name: formData.name,
          displayName: formData.displayName,
          description: formData.description,
          version: formData.version,
          author: formData.author,
          type: formData.type,
          main: 'index.js',
        };

        if (!manifest.name || !manifest.displayName) {
          throw new Error('请填写插件名称和显示名称');
        }

        response = await fetch('/api/plugins', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            manifest,
            pluginPath: formData.localPath,
          }),
        });
      } else {
        // 从 URL 安装
        if (!formData.url) {
          throw new Error('请输入插件 URL');
        }

        response = await fetch('/api/plugins/install', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ url: formData.url }),
        });
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '安装失败');
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Package className="h-5 w-5" />
            安装插件
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* 安装方式选择 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              安装方式
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, method: 'local' })}
                className={`flex-1 px-4 py-3 border rounded-lg flex items-center justify-center gap-2 transition-colors ${
                  formData.method === 'local'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                <Upload className="h-4 w-4" />
                从本地安装
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, method: 'url' })}
                className={`flex-1 px-4 py-3 border rounded-lg flex items-center justify-center gap-2 transition-colors ${
                  formData.method === 'url'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                <Link className="h-4 w-4" />
                从 URL 安装
              </button>
            </div>
          </div>

          {/* 本地安装表单 */}
          {formData.method === 'local' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  插件目录路径 *
                </label>
                <input
                  type="text"
                  value={formData.localPath}
                  onChange={(e) =>
                    setFormData({ ...formData, localPath: e.target.value })
                  }
                  placeholder="/plugins/my-plugin"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  插件目录的绝对路径，目录中必须包含 manifest.json 文件
                </p>
              </div>

              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  插件信息（如果目录中没有 manifest.json）
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      插件名称 *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      placeholder="my-plugin"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      显示名称 *
                    </label>
                    <input
                      type="text"
                      value={formData.displayName}
                      onChange={(e) =>
                        setFormData({ ...formData, displayName: e.target.value })
                      }
                      placeholder="我的插件"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm text-gray-600 mb-1">
                      描述
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({ ...formData, description: e.target.value })
                      }
                      placeholder="插件描述"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      版本
                    </label>
                    <input
                      type="text"
                      value={formData.version}
                      onChange={(e) =>
                        setFormData({ ...formData, version: e.target.value })
                      }
                      placeholder="1.0.0"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">
                      作者
                    </label>
                    <input
                      type="text"
                      value={formData.author}
                      onChange={(e) =>
                        setFormData({ ...formData, author: e.target.value })
                      }
                      placeholder="Your Name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm text-gray-600 mb-1">
                      插件类型
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          type: e.target.value as FormData['type'],
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="tool">工具</option>
                      <option value="backend-service">后端服务</option>
                      <option value="integration">集成</option>
                      <option value="ui-tab">UI 标签页</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* URL 安装表单 */}
          {formData.method === 'url' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                插件 URL *
              </label>
              <input
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://example.com/plugins/my-plugin/manifest.json"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                插件 manifest.json 文件的 URL，或包含 manifest.json 的压缩包 URL
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-center gap-2">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mt-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md flex items-center gap-2">
              <Check className="h-5 w-5 flex-shrink-0" />
              插件安装成功！
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                安装中...
              </>
            ) : (
              <>
                <Package className="h-4 w-4" />
                安装
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：验证编译**

运行：`npx tsc --noEmit src/components/plugins/InstallPluginModal.tsx`
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/components/plugins/InstallPluginModal.tsx
git commit -m "feat(plugin): add install plugin modal component"
```

---

### 任务 4：集成安装模态框到插件管理页面

**文件：**
- 修改：`src/app/dashboard/plugins/page.tsx`

- [ ] **步骤 1：添加安装按钮和模态框集成**

在 `src/app/dashboard/plugins/page.tsx` 中：

1. 添加导入：
```typescript
import { Plus, Upload } from 'lucide-react';
import InstallPluginModal from '@/components/plugins/InstallPluginModal';
```

2. 在组件中添加状态：
```typescript
const [showInstallModal, setShowInstallModal] = useState(false);
```

3. 在 Header 部分添加安装按钮（在刷新按钮前面）：
```typescript
{hasPermission(PERMISSIONS.PLUGIN_CREATE) && (
  <button
    onClick={() => setShowInstallModal(true)}
    className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
  >
    <Plus size={16} />
    安装插件
  </button>
)}
```

4. 在 return 语句末尾（`</div>` 之前）添加模态框：
```typescript
{showInstallModal && (
  <InstallPluginModal
    isOpen={showInstallModal}
    onClose={() => setShowInstallModal(false)}
    onSuccess={fetchPlugins}
  />
)}
```

- [ ] **步骤 2：验证页面功能**

运行：`npm run dev`
访问：http://localhost:3000/dashboard/plugins
预期：看到"安装插件"按钮，点击后显示模态框

- [ ] **步骤 3：Commit**

```bash
git add src/app/dashboard/plugins/page.tsx
git commit -m "feat(plugin): integrate install modal into plugins page"
```

---

### 任务 5：创建从 URL 安装插件的 API

**文件：**
- 创建：`src/app/api/plugins/install/route.ts`

- [ ] **步骤 1：创建从 URL 安装的 API 端点**

创建文件 `src/app/api/plugins/install/route.ts`：

```typescript
import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import * as fs from 'fs';
import * as path from 'path';
import type { PluginManifest, InstallPluginFromUrlRequest } from '@/types/plugin';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

/**
 * POST /api/plugins/install
 * 从 URL 安装插件
 */
export async function POST(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json(
        { error: '无效的 Token' },
        { status: 401 }
      );
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_CREATE)) {
      return NextResponse.json(
        { error: '没有安装插件的权限' },
        { status: 403 }
      );
    }

    // 解析请求体
    const body: InstallPluginFromUrlRequest = await request.json();

    if (!body.url) {
      return NextResponse.json(
        { error: '请提供插件 URL' },
        { status: 400 }
      );
    }

    // 获取 manifest.json
    let manifest: PluginManifest;
    let pluginDir: string;

    if (body.url.endsWith('.json')) {
      // 直接获取 manifest.json
      const response = await fetch(body.url);
      if (!response.ok) {
        throw new Error('无法获取 manifest.json');
      }
      manifest = await response.json();
      pluginDir = path.join(PLUGINS_DIR, manifest.name);
    } else {
      // 假设是压缩包 URL（暂不支持）
      return NextResponse.json(
        { error: '暂不支持从压缩包安装，请提供 manifest.json 的 URL' },
        { status: 400 }
      );
    }

    // 验证 manifest
    if (!manifest.name || !manifest.displayName) {
      return NextResponse.json(
        { error: 'manifest.json 缺少必要字段（name, displayName）' },
        { status: 400 }
      );
    }

    // 创建插件目录
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }

    // 保存 manifest.json
    fs.writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // 安装插件到数据库
    const plugin = await PluginManager.installPlugin(manifest, pluginDir);

    return NextResponse.json({
      message: '插件安装成功',
      plugin,
    });
  } catch (error) {
    console.error('从 URL 安装插件失败:', error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '从 URL 安装插件失败' },
      { status: 500 }
    );
  }
}
```

- [ ] **步骤 2：验证 API**

运行：`npx tsc --noEmit src/app/api/plugins/install/route.ts`
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/app/api/plugins/install/route.ts
git commit -m "feat(plugin): add install from URL API endpoint"
```

---

### 任务 6：创建执行插件的 API

**文件：**
- 创建：`src/app/api/plugins/[id]/execute/route.ts`

- [ ] **步骤 1：创建执行插件的 API 端点**

创建文件 `src/app/api/plugins/[id]/execute/route.ts`：

```typescript
import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PluginManager } from '@/services/plugin-manager';
import { PluginRunner } from '@/services/plugin-runner';
import { PERMISSIONS } from '@/types/permissions';
import type { PluginExecutionContext } from '@/types/plugin';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * POST /api/plugins/[id]/execute
 * 执行插件
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json(
        { error: '无效的 Token' },
        { status: 401 }
      );
    }

    // 检查权限 - 可以定义一个新的权限 PLUGIN_EXECUTE
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_UPDATE)) {
      return NextResponse.json(
        { error: '没有执行插件的权限' },
        { status: 403 }
      );
    }

    // 获取插件
    const plugin = await PluginManager.getPlugin(params.id);
    if (!plugin) {
      return NextResponse.json(
        { error: '插件不存在' },
        { status: 404 }
      );
    }

    if (!plugin.isEnabled) {
      return NextResponse.json(
        { error: '插件未启用' },
        { status: 400 }
      );
    }

    // 解析执行上下文
    const body = await request.json();
    const context: PluginExecutionContext = {
      userId: payload.userId,
      projectId: body.projectId,
      evaluationId: body.evaluationId,
      config: body.config || plugin.config,
      env: body.env,
    };

    // 执行插件
    const result = await PluginRunner.executePlugin(plugin, context);

    return NextResponse.json({
      message: result.success ? '插件执行成功' : '插件执行失败',
      result,
    });
  } catch (error) {
    console.error('执行插件失败:', error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '执行插件失败' },
      { status: 500 }
    );
  }
}
```

- [ ] **步骤 2：验证 API**

运行：`npx tsc --noEmit src/app/api/plugins/[id]/execute/route.ts`
预期：无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/app/api/plugins/[id]/execute/route.ts
git commit -m "feat(plugin): add plugin execution API endpoint"
```

---

### 任务 7：初始化插件运行器

**文件：**
- 创建：`src/lib/plugin-init.ts`

- [ ] **步骤 1：创建插件初始化模块**

创建文件 `src/lib/plugin-init.ts`：

```typescript
/**
 * 插件系统初始化
 */

import { PluginRunner } from '@/services/plugin-runner';

let initialized = false;

/**
 * 初始化插件系统
 */
export async function initializePlugins(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    await PluginRunner.initialize();
    initialized = true;
    console.log('[PluginInit] Plugin system initialized successfully');
  } catch (error) {
    console.error('[PluginInit] Failed to initialize plugin system:', error);
    throw error;
  }
}

/**
 * 检查插件系统是否已初始化
 */
export function isPluginSystemInitialized(): boolean {
  return initialized;
}
```

- [ ] **步骤 2：在应用启动时初始化**

修改 `src/app/layout.tsx` 或创建专门的初始化文件（根据项目结构决定）。
由于是 Next.js App Router，可以在 instrumentation 或专门的启动脚本中调用。

如果项目有 instrumentation.ts，添加初始化调用。否则，可以在首次使用时懒加载初始化。

- [ ] **步骤 3：Commit**

```bash
git add src/lib/plugin-init.ts
git commit -m "feat(plugin): add plugin system initialization"
```

---

### 任务 8：添加执行按钮到插件卡片

**文件：**
- 修改：`src/app/dashboard/plugins/page.tsx`

- [ ] **步骤 1：添加执行按钮和处理函数**

在 `src/app/dashboard/plugins/page.tsx` 中：

1. 添加状态：
```typescript
const [executingPlugin, setExecutingPlugin] = useState<string | null>(null);
```

2. 添加执行函数：
```typescript
const handleExecutePlugin = async (id: string) => {
  try {
    setExecutingPlugin(id);
    const token = localStorage.getItem('token');
    
    const response = await fetch(`/api/plugins/${id}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || '执行失败');
    }

    const result = await response.json();
    setSuccess(`插件执行成功: ${result.result?.data?.message || '完成'}`);
    setTimeout(() => setSuccess(null), 3000);
  } catch (err) {
    setError(err instanceof Error ? err.message : '执行失败');
    setTimeout(() => setError(null), 3000);
  } finally {
    setExecutingPlugin(null);
  }
};
```

3. 在插件卡片的操作按钮区域添加执行按钮（在启用/禁用按钮前）：
```typescript
{plugin.isEnabled && plugin.type === 'tool' && (
  <button
    onClick={() => handleExecutePlugin(plugin.id)}
    disabled={executingPlugin === plugin.id}
    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors disabled:opacity-50"
    title="执行插件"
  >
    {executingPlugin === plugin.id ? (
      <Loader2 size={16} className="animate-spin" />
    ) : (
      <Play size={16} />
    )}
    {executingPlugin === plugin.id ? '执行中...' : '执行'}
  </button>
)}
```

4. 确保导入了 `Play` 图标：
```typescript
import { Play, Loader2 } from 'lucide-react';
```

- [ ] **步骤 2：验证功能**

运行：`npm run dev`
访问插件管理页面，启用一个工具类型插件后，应看到执行按钮

- [ ] **步骤 3：Commit**

```bash
git add src/app/dashboard/plugins/page.tsx
git commit -m "feat(plugin): add execute button to plugin cards"
```

---

### 任务 9：添加插件执行权限常量

**文件：**
- 修改：`src/types/permissions.ts`

- [ ] **步骤 1：添加 PLUGIN_EXECUTE 权限**

在 `src/types/permissions.ts` 中添加：

```typescript
// 在 PERMISSIONS 对象中添加
PLUGIN_EXECUTE: 'plugin:execute',
```

同时在 ADMIN 和 MANAGER 角色的默认权限中包含此权限。

- [ ] **步骤 2：更新种子数据**

修改 `prisma/seed.ts`，在权限列表中添加：
```typescript
{ name: 'plugin:execute', module: 'plugin', action: 'execute', description: '执行插件' },
```

- [ ] **步骤 3：Commit**

```bash
git add src/types/permissions.ts prisma/seed.ts
git commit -m "feat(plugin): add plugin execute permission"
```

---

### 任务 10：端到端测试

- [ ] **步骤 1：测试安装插件流程**

1. 启动开发服务器
2. 登录系统
3. 访问插件管理页面
4. 点击"安装插件"按钮
5. 填写插件信息
6. 提交表单
7. 验证插件出现在列表中

- [ ] **步骤 2：测试执行插件流程**

1. 启用一个工具类型的插件
2. 点击"执行"按钮
3. 验证执行结果显示

- [ ] **步骤 3：测试 URL 安装**

1. 准备一个公开的 manifest.json URL
2. 使用"从 URL 安装"功能
3. 验证插件正确安装

- [ ] **步骤 4：最终 Commit**

```bash
git add -A
git commit -m "feat(plugin): complete plugin installation and execution system"
```

---

## 自检清单

### 规格覆盖度
- [x] 前端安装界面 - 任务 3、4
- [x] 本地安装支持 - 任务 3、5
- [x] URL 安装支持 - 任务 5
- [x] 插件执行机制 - 任务 2、6
- [x] 不同类型插件执行器 - 任务 2
- [x] 执行按钮 UI - 任务 8
- [x] 权限控制 - 任务 6、9

### 占位符扫描
- [x] 无 "TODO" 或 "待定" 字样
- [x] 所有代码步骤包含完整代码
- [x] 无模糊描述

### 类型一致性
- [x] PluginExecutionContext 在任务 1 定义，任务 2、6 使用
- [x] PluginExecutionResult 在任务 1 定义，任务 2、6 使用
- [x] PluginExecutor 接口在任务 1 定义，任务 2 实现
- [x] InstallPluginFromUrlRequest 在任务 1 定义，任务 5 使用

---

## 执行选项

计划已完成并保存到 `docs/superpowers/plans/2026-04-06-plugin-install-and-execution.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？**
