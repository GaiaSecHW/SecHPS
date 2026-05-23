# SecHPS 平台部署指南

## 快速部署

### 方式一：Docker 部署（推荐）

使用 GitHub Actions 自动构建的镜像部署，无需本地构建。

#### 1. 准备环境

- **Docker**: 已安装 Docker
- **PostgreSQL**: 可用的 PostgreSQL 数据库（必须提前准备好）
- **Redis**: 可选，CodeSwarm 调度需要

#### 2. 配置环境变量

复制 `.env.example` 并填入实际值：

```bash
cp .env.example .env
# 编辑 .env，填入实际的 DATABASE_URL、JWT_SECRET 等
```

**`.env` 文件注意**：
- 值不要用引号包裹（Docker `--env-file` 不解析引号），如 `DATABASE_URL=postgresql://...` 而不是 `DATABASE_URL="postgresql://..."`
- `NODE_ENV` 改为 `production`
- `JWT_SECRET` 改为强随机密钥（生成方法: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`）
- `#` 注释行会被 Docker 跳过，可以保留

必填变量：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串（**必填**） |
| `JWT_SECRET` | JWT 签名密钥（**必填**，不要用默认值） |
| `NODE_ENV` | 设为 `production` |

可选变量（完整列表见 `.env.example`）：

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_BASE_URL` | Worker 回调地址（CodeSwarm 功能需要） |
| `REDIS_URL` | Redis 连接（CodeSwarm 调度队列） |
| `GITEA_*` | Gitea 文件同步配置 |
| `SKILLS_GITEA_*` | Skill Git 同步配置 |
| `MINIO_*` | MinIO 对象存储配置 |

#### 3. 初始化数据库

镜像内没有 Prisma CLI，需要在外部先初始化数据库（在有源码的机器上）：

```bash
npm run db:push              # 推送 schema
npm run db:seed              # 种子数据（用户 + 角色 + 权限）
npm run db:seed-techstack    # 技术栈种子数据
npm run db:seed-agents       # Agent 定义种子数据
npm run db:seed-fsm          # FSM 模板种子数据
```

或者单独搞一个一次性的初始化容器。

#### 4. 拉取镜像并运行

```bash
# 拉取镜像
docker pull ghcr.io/gaiasechw/sechps:sha-0a90dab

# 使用 .env 文件运行（推荐）
docker run -d \
  --name sechps \
  -p 3000:3000 \
  --restart unless-stopped \
  --env-file .env \
  -v sechps-data:/app/data \
  -v sechps-uploads:/app/uploads \
  -v sechps-skills:/app/skill_management \
  -v sechps-agent-harness:/app/AgentHarness \
  ghcr.io/gaiasechw/sechps:sha-0a90dab
```

如果不使用 `.env` 文件，也可以用 `-e` 参数逐个传递：

```bash
docker run -d \
  --name sechps \
  -p 3000:3000 \
  --restart unless-stopped \
  -e DATABASE_URL="postgresql://postgres:密码@数据库IP:5432/sechps" \
  -e JWT_SECRET="your-strong-random-secret" \
  -e NODE_ENV="production" \
  -e NEXT_PUBLIC_BASE_URL="http://服务器IP:3000" \
  -e REDIS_URL="redis://RedisIP:6379/3" \
  -v sechps-data:/app/data \
  -v sechps-uploads:/app/uploads \
  -v sechps-skills:/app/skill_management \
  -v sechps-agent-harness:/app/AgentHarness \
  ghcr.io/gaiasechw/sechps:sha-0a90dab
```

#### 5. 健康检查

```bash
curl -f http://localhost:3000/api/global/health
```

镜像内置了 Docker HEALTHCHECK（30s 间隔），也可以用 `docker ps` 查看健康状态。

#### 6. 常用运维

```bash
# 查看日志
docker logs -f sechps

# 停止
docker stop sechps

# 重启（修改 .env 后需要重建容器）
docker rm -f sechps
docker run -d --name sechps -p 3000:3000 --restart unless-stopped --env-file .env \
  -v sechps-data:/app/data -v sechps-uploads:/app/uploads \
  -v sechps-skills:/app/skill_management -v sechps-agent-harness:/app/AgentHarness \
  ghcr.io/gaiasechw/sechps:sha-0a90dab

# 更新镜像版本
docker pull ghcr.io/gaiasechw/sechps:sha-新的tag
docker rm -f sechps
docker run -d ...（同上，换成新的 tag）
```

#### 持久化 Volume 说明

| Volume | 容器路径 | 说明 |
|--------|----------|------|
| `sechps-data` | `/app/data` | 运行时数据（skills 等） |
| `sechps-uploads` | `/app/uploads` | 上传文件 |
| `sechps-skills` | `/app/skill_management` | Skill 管理文件 |
| `sechps-agent-harness` | `/app/AgentHarness` | AgentHarness 文件 |

**必须挂载这些 volume**，否则容器重建后数据会丢失。

---

### 方式二：源码部署

#### Windows
1. 双击 `run.bat`
2. 首次运行会自动安装依赖、初始化数据库、构建项目
3. 浏览器访问 http://localhost:3000

#### Linux / Mac
```bash
chmod +x run.sh
./run.sh
```
首次运行会自动完成所有初始化工作。

---

## 源码详细部署步骤

### 1. 环境要求

- **Node.js**: >= 18.0.0
- **操作系统**: Windows / Linux / macOS
- **磁盘空间**: 约 500MB

### 2. 配置环境变量

编辑 `.env` 文件：

```env
# 数据库配置（PostgreSQL）
DATABASE_URL="postgresql://postgres:密码@数据库IP:5432/sechps"

# JWT 密钥（生产环境请使用强随机密钥）
# 生成方法: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET="your-secret-key-change-in-production"

# 环境模式
NODE_ENV="production"

# 服务端口（默认 3000）
PORT="3000"
```

### 3. 初始化数据库

```bash
npm run db:push              # 推送 schema
npm run db:seed              # 种子数据（用户 + 角色 + 权限）
npm run db:seed-techstack    # 技术栈种子数据
npm run db:seed-agents       # Agent 定义种子数据
npm run db:seed-fsm          # FSM 模板种子数据
```

### 4. 启动服务

```bash
# 生产构建 + 启动
npm run build && npm start

# 或使用 screen 后台运行
screen -dmS sechps bash -c 'npm start > app.log 2>&1; exec bash'
```

服务启动后访问: **http://localhost:3000**

---

## 目录结构

```
SecHPS-platform/
├── .next/           # Next.js 构建产物
├── prisma/
│   └── schema.prisma # 数据库 Schema（60+ 模型）
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
# Docker 部署
docker logs -f sechps

# 源码部署 - 输出到文件
npm start > app.log 2>&1

# 源码部署 - Linux/Mac 后台运行
nohup ./run.sh > app.log 2>&1 &
```

### Q: 如何备份数据库？
```bash
# PostgreSQL
pg_dump -h 数据库IP -U postgres sechps > sechps_backup.sql
```

### Q: 数据库损坏怎么办？
```bash
# PostgreSQL - 重新推送 schema
npm run db:push
npm run db:seed
```

### Q: Docker 部署后修改 .env 如何生效？
需要重建容器（Docker 不支持热更新 env-file）：
```bash
docker rm -f sechps
docker run -d --name sechps -p 3000:3000 --restart unless-stopped --env-file .env \
  -v sechps-data:/app/data -v sechps-uploads:/app/uploads \
  -v sechps-skills:/app/skill_management -v sechps-agent-harness:/app/AgentHarness \
  ghcr.io/gaiasechw/sechps:sha-0a90dab
```

---

## 生产环境注意事项

1. **JWT_SECRET**: 使用强随机密钥，不要使用默认值
2. **防火墙**: 确保 3000 端口可访问
3. **HTTPS**: 生产环境建议使用 Nginx/Caddy 反向代理
4. **数据库备份**: 定期备份 PostgreSQL 数据
5. **日志管理**: 配置日志轮转，避免磁盘空间问题
6. **Docker Volume**: 持久化数据必须挂载 volume，避免容器重建后数据丢失

---

## 卸载

```bash
# Docker 部署
docker rm -f sechps
docker volume rm sechps-data sechps-uploads sechps-skills sechps-agent-harness

# 源码部署
rm -rf SecHPS-platform/
```

---

## 联系支持

如有问题，请查看项目 GitHub Issues。
