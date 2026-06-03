# 报告下载安全改造方案

## 背景

当前报告下载流程：

```
前端 → GET /api/task-builder/tasks/{id}/report-files → 返回 MinIO presigned URL
前端 → 直接用 presigned URL 请求 MinIO → 下载文件
```

**问题**：presigned URL 暴露了 MinIO 的内网地址（`172.31.23.181:9000`）、桶名（`vuln-file`）、对象路径和签名参数。虽然 presigned URL 有 7 天有效期，但：

- 用户可以看到桶结构和对象命名规则
- 如果 MinIO 网络策略不严格（如可从前端网络直达），用户可能尝试访问其他对象
- presigned URL 有效期过长（7 天），泄漏窗口大
- **`report-files` API 无租户隔离**：只按 `taskId` 查询，任意合法 JWT 可访问任意任务报告

## 方案

**Server 代理下载 + 修复租户隔离**

### 核心改动

前端不再直接请求 MinIO，改为请求 Server API，Server 从 MinIO 读取文件后流式返回给前端。MinIO 地址和凭证完全不暴露给前端。

```
前端 → GET /api/task-builder/tasks/{id}/download-report?fileIndex=0
     → Server JWT 验证 + 租户隔离校验
     → Server 从 DB 查 Vulnerability.filePath（presigned URL 数组）
     → Server 从 URL 中提取 objectName
     → Server 用 client.getObject() 流式读取
     → Server 流式响应给前端
```

### filePath 存储格式说明

`Vulnerability.filePath` 存储的是完整 presigned URL（由 `minio-vulnerability.ts` 的 `uploadReportFolder` 上传后调用 `getPresignedUrl` 生成），格式为：

```
http://172.31.23.181:9000/vuln-file/{objectName}?X-Amz-Algorithm=...
```

提取 objectName 的方式：解析 URL 的 pathname，去掉 `/{bucketName}/` 前缀：

```ts
function extractObjectName(urlOrPath: string): string {
  try {
    const u = new URL(urlOrPath);
    // pathname: /vuln-file/prod/task-x/report/file.md
    const parts = u.pathname.split('/');
    // parts[1] is bucket name, rest is objectName
    return parts.slice(2).join('/');
  } catch {
    // 兜底：直接按路径处理（objectName 本身）
    return urlOrPath.split('?')[0];
  }
}
```

`rawReport` 字段同样存 presigned URL（来自 `uploadRawReportFiles`），但它是单条漏洞级别的原始扫描输出，不在本次下载接口范围内。如需下载可复用同一 `extractObjectName` 逻辑另建接口。

### API 设计

**`GET /api/task-builder/tasks/{id}/download-report?fileIndex=0`**

- 认证：JWT + `VULNERABILITY_READ` 权限，使用 `authenticateRequestEnhanced()` 获取租户上下文
- 租户隔离：`prisma.vulnerability.findFirst({ where: { taskId: id, ...buildTenantFilter(tenantContext) } })`
- fileIndex 校验：解析文件列表后检查 `fileIndex >= 0 && fileIndex < files.length`，越界返回 400
- 从 `filePath` JSON 数组中取第 `fileIndex` 个 URL，调用 `extractObjectName` 提取对象路径
- 调用 `minioClient.getObject(bucket, objectName)` 流式读取
- 设置 `Content-Disposition: attachment; filename="<fileName>"` 和正确 `Content-Type` 返回

**`GET /api/task-builder/tasks/{id}/report-files`（修复租户隔离）**

原有 API 保留，只返回文件名列表（去掉 URL），同时补全租户隔离查询：

```ts
// 改前（有安全缺陷）
const vuln = await prisma.vulnerability.findFirst({ where: { taskId: id } });

// 改后
const tenantContext = getTenantContext(auth);
const vuln = await prisma.vulnerability.findFirst({
  where: { taskId: id, ...buildTenantFilter(tenantContext) },
});
```

返回结构由 `{ url, name }[]` 改为只返回 `{ name }[]`，前端不再拿到 presigned URL。

### 前端改动

`task-builder/[id]/page.tsx`：

- `downloadFile` 改为请求 `/api/task-builder/tasks/${taskId}/download-report?fileIndex=${N}`，用 `fetch` + `blob()` 触发下载
- `report-files` 返回结构改为只含 `name`，前端展示文件名列表时不再使用 URL

### 文件大小与性能

安全扫描报告（AUDIT_REPORT.json / .md）通常在几十 KB 到几 MB 之间，极少数超过 10 MB。Server 代理完全可承受，使用 Node.js stream pipe 不在内存中缓冲整个文件。

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/app/api/task-builder/tasks/[id]/download-report/route.ts` | 新增，Server 代理下载（含租户隔离 + fileIndex 校验） |
| `src/app/api/task-builder/tasks/[id]/report-files/route.ts` | 修复租户隔离，返回值去掉 URL |
| `src/app/dashboard/task-builder/[id]/page.tsx` | 前端改用新 API 下载，文件名列表展示不依赖 URL |
| `src/lib/minio-vulnerability.ts` | 新增 `getObjectStream(objectName)` 方法 |

## 不改动的部分

- Worker 上传报告到 MinIO 的流程不变
- DB 中 `Vulnerability.filePath` 存储格式不变（仍存 presigned URL），Server 侧解析时提取 objectName
- `Vulnerability.rawReport` 不在本次范围内

## 验证方式

1. 创建任务并等待完成
2. 在任务详情页点击下载报告
3. 浏览器 Network 面板确认请求走 `/api/task-builder/tasks/{id}/download-report`，Response Headers 中无 MinIO 地址
4. 确认下载文件内容完整
5. 用其他租户账号尝试访问同一任务 ID 的下载接口，应返回 403/404
