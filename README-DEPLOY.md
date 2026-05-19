# SecHPS 平台部署指南

## 快速部署

### Windows
1. 双击 `run.bat`
2. 首次运行会自动安装依赖、初始化数据库、构建项目
3. 浏览器访问 http://localhost:3000

### Linux / Mac
```bash
chmod +x run.sh
./run.sh
```
首次运行会自动完成所有初始化工作。

---

## 详细部署步骤

### 1. 环境要求

- **Node.js**: >= 18.0.0
- **操作系统**: Windows / Linux / macOS
- **磁盘空间**: 约 500MB

### 2. 配置环境变量

编辑 `env` 文件（首次运行会自动创建）：

```env
# 数据库配置（SQLite，文件路径相对于项目根目录）
DATABASE_URL="file:./prisma/prod.db"

# JWT 密钥（生产环境请使用强随机密钥）
# 生成方法: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET="your-secret-key-change-in-production"

# 环境模式
NODE_ENV="production"

# 服务端口（默认 3000）
PORT="3000"
```

### 3. 初始化数据库

如果数据库未自动初始化，手动运行：

```bash
# Windows
npx prisma db push

# Linux/Mac
npx prisma db push
```

### 4. 启动服务

```bash
# Windows
run.bat

# Linux/Mac
./run.sh
```

服务启动后访问: **http://localhost:3000**

---

## 目录结构

```
SecHPS-platform/
├── .next/           # Next.js 构建产物
├── prisma/
│   └── prod.db      # SQLite 数据库文件
├── node_modules/    # 依赖
├── src/             # 源代码
├── run.sh           # Linux/Mac 启动脚本
├── run.bat          # Windows 启动脚本
└── .env             # 环境变量配置
```

---

## 常见问题

### Q: 端口 3000 被占用？
修改 `.env` 文件：
```env
PORT=3001
```
或直接运行：
```bash
PORT=3001 npm start
```

### Q: 如何查看日志？
```bash
# 输出到文件
npm start > app.log 2>&1

# Linux/Mac 后台运行
nohup ./run.sh > app.log 2>&1 &
```

### Q: 如何备份数据库？
```bash
# 复制数据库文件
cp prisma/prod.db prisma/prod.db.backup
```

### Q: 数据库损坏怎么办？
```bash
# 删除旧数据库，重新初始化
rm prisma/prod.db
npx prisma db push
```

---

## 生产环境注意事项

1. **JWT_SECRET**: 使用强随机密钥，不要使用默认值
2. **防火墙**: 确保 3000 端口可访问
3. **HTTPS**: 生产环境建议使用 Nginx/Caddy 反向代理
4. **数据库备份**: 定期备份 `prisma/prod.db` 文件
5. **日志管理**: 配置日志轮转，避免磁盘空间问题

---

## 卸载

```bash
# 删除项目目录即可
rm -rf SecHPS-platform/
```

---

## 联系支持

如有问题，请查看项目 GitHub Issues。
