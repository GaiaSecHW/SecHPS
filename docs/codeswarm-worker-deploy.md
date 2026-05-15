# CodeSwarm Worker 部署指南

## 架构概述

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   平台 (Next.js) │────▶│  Dispatcher     │────▶│  Worker Node    │
│   port: 3000    │◀────│  (任务分发)      │◀────│  port: 8080     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │
                        Redis / DB
```

## 快速部署 (一键安装)

### 方式一：远程安装 (推荐)

在目标机器上执行：

```bash
curl -fsSL http://你的平台地址/api/codeswarm/worker/dist | bash
```

**带参数安装：**
```bash
ORCHESTRATOR_URL=http://192.168.1.100:3000 \
PORT=8080 \
MAX_CONCURRENT=5 \
WORKER_ADDRESS=192.168.1.101:8080 \
bash <(curl -fsSL http://192.168.1.100:3000/api/codeswarm/worker/dist)
```

### 方式二：本地安装

1. 下载部署包：
```bash
curl -fsSL http://你的平台/api/codeswarm/worker/dist -o worker.tar.gz
```

2. 解压并安装：
```bash
tar -xzf worker.tar.gz
cd worker
bash scripts/install-worker.sh
```

## 管理命令

```bash
# 安装并启动
bash install-worker.sh install

# 启动 / 停止 / 重启
bash install-worker.sh start
bash install-worker.sh stop
bash install-worker.sh restart

# 查看状态
bash install-worker.sh status

# 或使用 systemd (Linux)
systemctl status codeswarm-worker
journalctl -u codeswarm-worker -f
```

## 环境变量配置

安装后在 `$INSTALL_DIR/.env` 中配置：

```bash
# 必须配置
ORCHESTRATOR_URL=http://192.168.1.100:3000   # 平台地址

# 可选配置
NODE_ID=node-abc123                           # 节点ID (默认自动生成)
PORT=8080                                      # 监听端口 (默认 8080)
MAX_CONCURRENT=3                              # 最大并发任务数 (默认 3)
WORKER_ADDRESS=192.168.1.101:8080              # 外部可访问地址 (默认自动探测)
LOG_LEVEL=info                                 # 日志级别 (info/debug)
```

## Worker 心跳机制

- Worker 每 30 秒向平台上报一次心跳
- 平台 90 秒未收到心跳则判定节点离线
- 离线节点会自动从可用列表中移除，不会分发新任务

## 目录结构

```
/opt/codeswarm-worker/
├── dist/              # 编译后的 worker 代码
│   └── index.js       # 入口文件
├── package.json       # 生产依赖
├── .env               # 配置文件
└── logs/              # 日志目录
    ├── stdout.log
    └── stderr.log
```

## 故障排查

**节点未出现在平台列表？**
1. 检查 `ORCHESTRATOR_URL` 是否可通：`curl http://平台地址/api/broadcast`
2. 检查防火墙是否放行对应端口
3. 查看日志：`tail -f /opt/codeswarm-worker/logs/stdout.log`

**任务分发失败？**
1. 确认平台 Redis/数据库正常
2. 检查 Worker 磁盘空间是否充足
3. 查看 worker 日志中的错误信息

## 卸载

```bash
bash /opt/codeswarm-worker/scripts/install-worker.sh stop
rm -rf /opt/codeswarm-worker
```