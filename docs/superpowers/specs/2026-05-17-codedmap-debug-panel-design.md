# Codedmap 调试面板设计

## 概述

在"智能体 Worker 管理"页面新增 "Codedmap 调试" Tab，提供 codedmap 知识图谱构建触发和 MinIO 缓存管理功能。

## 功能

### 1. 构建触发

通过现有 CodeSwarm 任务机制触发 codedmap 构建：

- 表单字段：`targetProduct`（必填）、`workspacePath`（必填）、Worker 选择（可选）、model/apiKey（可选）
- 调用 `POST /api/codeswarm/tasks` 创建任务（带 `targetProduct`）
- Worker 收到任务后走 `CodedmapManager.ensureDbFile()` 流程（本地检查 → MinIO 下载 → build_map.py 生成）
- 前端通过 SSE (`/api/codeswarm/tasks/[taskId]/stream`) 实时展示构建日志
- 过滤展示 codedmap 相关事件（phase=codedmap）

### 2. MinIO 缓存管理

- `GET /api/codeswarm/codedmap/cache` — 列出 MinIO `dbs/` 下所有 targetProduct 目录及文件信息
- `DELETE /api/codeswarm/codedmap/cache?targetProduct=xxx` — 删除指定缓存
- 前端表格展示：targetProduct、文件数量、总大小
- 操作：删除缓存

## 新增文件

| 文件 | 作用 |
|------|------|
| `src/components/codeswarm/CodedmapDebugPanel.tsx` | 前端调试面板（构建表单 + 缓存管理 + 实时日志） |
| `src/app/api/codeswarm/codedmap/cache/route.ts` | MinIO 缓存管理 API（GET/DELETE） |
| 修改 `src/app/dashboard/codeswarm/page.tsx` | 新增 Tab 入口 |

## 技术要点

- 复用现有 Worker 任务分发机制，不引入新的执行路径
- MinIO 操作复用 `codeswarm/packages/worker/src/minio-client.ts` 中的函数（需要在平台侧创建等价 API 或直接引用）
- SSE 日志复用 `TaskDebugPanel` 的事件解析逻辑
- UI 风格与现有 CodeSwarm 页面一致（dark theme、lucide-react 图标）
