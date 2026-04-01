# 多文件上传功能说明

## ✅ 功能已完成

项目新建功能现已支持同时上传多个文件。

---

## 📁 支持的文件格式

### 1. 压缩包格式
- `.zip` - ZIP 压缩文件
- `.jar` - Java 归档文件
- `.war` - Web 应用归档
- `.ear` - 企业应用归档
- `.tar` - TAR 归档文件
- `.gz` - GZIP 压缩文件
- `.rar` - RAR 压缩文件
- `.7z` - 7-Zip 压缩文件

### 2. 文档格式
- `.pdf` - PDF 文档
- `.doc` - Word 文档（旧版）
- `.docx` - Word 文档（新版）
- `.xls` - Excel 电子表格（旧版）
- `.xlsx` - Excel 电子表格（新版）
- `.ppt` - PowerPoint 演示文稿（旧版）
- `.pptx` - PowerPoint 演示文稿（新版）
- `.txt` - 纯文本文件
- `.md` - Markdown 文档

### 3. 数据格式
- `.csv` - 逗号分隔值文件
- `.json` - JSON 数据文件
- `.xml` - XML 文档
- `.yaml` / `.yml` - YAML 配置文件

---

## 🎯 功能特性

### 1. 多文件选择
- ✅ 支持同时选择多个文件
- ✅ 支持重复选择文件（可多次添加文件）
- ✅ 文件选择器中已预过滤支持的文件类型

### 2. 文件验证
- ✅ 文件格式验证（仅接受支持的格式）
- ✅ 文件大小验证（单个文件最大 5GB）
- ✅ 友好的错误提示

### 3. 文件管理
- ✅ 显示已选文件列表
- ✅ 显示文件名和文件大小
- ✅ 显示总文件数和总大小
- ✅ 支持单个文件删除
- ✅ 支持一键清空所有文件

### 4. 上传状态
- ✅ 待上传状态（pending）
- ✅ 上传中状态（uploading，带动画）
- ✅ 上传成功状态（success，绿色勾号）
- ✅ 上传失败状态（error，红色错误提示）

### 5. 用户体验优化
- ✅ 文件大小格式化显示（B、KB、MB、GB、TB）
- ✅ 上传成功后延迟关闭对话框（1秒）
- ✅ 创建按钮显示文件数量
- ✅ 无文件时禁用创建按钮
- ✅ 上传中禁用所有操作

---

## 💡 使用流程

### 新建项目

1. 点击"新建项目"按钮
2. 填写项目名称（必填）
3. 填写项目描述（可选）
4. 点击"点击上传文件"或拖拽文件到上传区域
5. 可以多次添加文件
6. 查看已选文件列表
7. 可以删除不需要的文件
8. 点击"创建项目"按钮

### 文件上传

```
支持的格式：
- 压缩包：ZIP、JAR、WAR、EAR、TAR、GZ、RAR、7Z
- 文档：PDF、DOC、DOCX、XLS、XLSX、PPT、PPTX、TXT、MD
- 数据：CSV、JSON、XML、YAML

文件限制：
- 单个文件最大 5GB
- 无文件数量限制
```

---

## 🔧 技术实现

### 前端（React + TypeScript）

**状态管理：**
```typescript
interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
  file?: File; // 保存实际的 File 对象
}

const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
```

**文件选择：**
```typescript
<input
  type="file"
  multiple  // 支持多选
  accept=".zip,.jar,.war,.ear,..." // 文件类型过滤
  onChange={handleFileSelect}
/>
```

**文件上传：**
```typescript
const formData = new FormData();
formData.append('name', projectName);
formData.append('description', projectDescription);

// 添加多个文件
for (const uploadedFile of uploadedFiles) {
  if (uploadedFile.file) {
    formData.append('files', uploadedFile.file);
  }
}
```

### 后端（Next.js API Route）

**文件接收：**
```typescript
const formData = await request.formData();
const files = formData.getAll('files') as File[];
```

**文件验证：**
```typescript
const ALLOWED_FILE_TYPES = [
  '.zip', '.jar', '.war', '.ear', '.tar', '.gz', '.rar', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt',
  '.md', '.csv', '.json', '.xml', '.yaml', '.yml'
];
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
```

---

## 📊 数据库存储

### SessionFile 表
每个上传的文件都会在数据库中创建一条记录：

```prisma
model SessionFile {
  id          String   @id @default(cuid())
  sessionId   String
  fileName    String
  filePath    String
  fileSize    Float
  fileType    String
  uploadedAt  DateTime @default(now())
  
  session     Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  
  @@index([sessionId])
}
```

---

## 🎨 UI 截图说明

### 文件上传区域
```
┌─────────────────────────────────────┐
│         📤 点击上传文件              │
│          或拖拽文件到此处            │
│                                     │
│  支持多种格式：压缩包、文档、数据...  │
│       单个文件最大 5GB              │
└─────────────────────────────────────┘
```

### 已选文件列表
```
已选择 3 个文件（共 25.6 MB）          [清空所有]

┌─────────────────────────────────────┐
│ 📄 project.zip        20.5 MB    ✕  │
│    待上传                            │
├─────────────────────────────────────┤
│ 📄 README.md           2.3 MB    ✕  │
│    待上传                            │
├─────────────────────────────────────┤
│ 📄 config.json         2.8 MB    ✕  │
│    待上传                            │
└─────────────────────────────────────┘
```

### 创建按钮
```
[取消]  [创建项目（3 个文件）]
```

---

## ⚠️ 注意事项

1. **数据库更新**：运行 `npm run db:push` 同步数据库结构
2. **存储空间**：确保服务器有足够的磁盘空间
3. **上传目录**：在系统配置中设置项目上传目录
4. **权限检查**：用户需要 `SESSION_CREATE` 权限才能创建项目
5. **并发上传**：大文件上传可能需要较长时间，建议提示用户等待

---

## 🚀 后续优化建议

1. **上传进度条**：显示每个文件的上传进度
2. **断点续传**：支持大文件的断点续传
3. **文件预览**：支持常见文档格式的在线预览
4. **拖拽上传**：增强拖拽上传的用户体验
5. **批量删除**：支持多选删除文件
6. **文件排序**：支持按名称、大小、时间排序
7. **上传限制**：管理员可配置最大文件数和总大小限制
