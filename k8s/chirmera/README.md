# Chirmera K8S 部署说明

该目录参考 `/home/runshine/CLionProjects/sothoth/13-secflow-service` 的扁平 YAML 风格，为当前 `SecHPS` 项目生成了独立的 Kubernetes 部署清单。

## 资源概览

- `secflow-ns`：沿用参考项目的 namespace
- `chirmera-postgresql`：PostgreSQL 16 + PVC
- `chirmera-redis`：Redis 7 + PVC
- `chirmera-sechps-db-init`：数据库自动初始化 Job（`db push` + 可选基础 seed）
- `chirmera-sechps-db-migrate`：数据库迁移预留 Job（默认挂起）
- `chirmera-sechps`：当前 Next.js 主服务
- `chirmera-worker`：CodeSwarm Worker
- `chirmera-ingress`：对外入口，域名 `chirmera.ai.icsl.huawei.com`

## 使用方式

部署前请先按实际环境修改以下文件中的占位值：

- `00-chirmera-01-01-postgresql-secret.yaml`
- `00-chirmera-03-00-sechps-configmap.yaml`
- `00-chirmera-03-01-sechps-secret.yaml`
- `00-chirmera-03-05a-sechps-db-init-job.yaml`（如需调整初始化策略）
- `00-chirmera-03-05b-sechps-db-migrate-job.yaml`（如需启用迁移）
- `00-chirmera-04-00-worker-configmap.yaml`
- `00-chirmera-04-01-worker-secret.yaml`
- `00-chirmera-05-00-ingress-for-release.yaml`（如需 TLS 或调整注解）

然后执行：

```bash
cd k8s/chirmera
chmod +x deploy.sh
./deploy.sh
```

`deploy.sh` 现在会按以下顺序自动执行并等待关键资源就绪：

- PostgreSQL / Redis
- `chirmera-sechps-db-init`
- `chirmera-sechps`
- `chirmera-worker`
- Ingress

可选环境变量：

- `WAIT_TIMEOUT=600s ./deploy.sh`：调整 rollout / job 等待超时
- `SKIP_DB_INIT_WAIT=true ./deploy.sh`：只下发初始化 Job，不等待其完成

## 数据库初始化与迁移

- `chirmera-sechps-db-init` 会在部署时自动执行：
  - 等待 PostgreSQL 就绪
  - 执行 `npx prisma db push --skip-generate`
  - 当 `DB_SEED_ENABLED=true` 时执行 `npx tsx prisma/seed.ts`
- `chirmera-sechps` 主服务通过 `initContainer` 等待 `CodeswarmWorker` 表存在后再启动，避免应用先启动后因缺表报 `500`
- `chirmera-sechps-db-migrate` 默认 `suspend: true`，用于后续显式迁移，避免误执行高风险数据变更

### 初始化开关

- `k8s/chirmera/00-chirmera-03-00-sechps-configmap.yaml:11`
  - `DB_SEED_ENABLED: "true"`：是否执行基础 seed
  - `DB_MIGRATION_COMMAND: ""`：预留迁移命令

### 启用迁移

- 在 `00-chirmera-03-00-sechps-configmap.yaml` 中设置：
  - `DB_MIGRATION_COMMAND: "npx tsx scripts/migrate-workflow-to-agent-team.ts"`
- 然后执行：

```bash
kubectl -n secflow-ns patch job chirmera-sechps-db-migrate -p '{"spec":{"suspend":false}}'
kubectl -n secflow-ns logs -f job/chirmera-sechps-db-migrate
```

### 重跑初始化

```bash
kubectl -n secflow-ns delete job chirmera-sechps-db-init --ignore-not-found
kubectl apply -f k8s/chirmera/00-chirmera-03-05a-sechps-db-init-job.yaml
kubectl -n secflow-ns logs -f job/chirmera-sechps-db-init
```

## 镜像说明

- 主服务镜像：`ghcr.io/gaiasechw/sechps:latest`
- Worker 镜像：`ghcr.io/gaiasechw/codeswarm-worker:latest`

如你的镜像仓库地址不同，请修改对应 Deployment 里的 `image` 字段。

## Ingress

- Host：`chirmera.ai.icsl.huawei.com`
- Backend Service：`chirmera-sechps:3000`
- 当前未启用 TLS；如集群已配置证书，可在 `k8s/chirmera/00-chirmera-05-00-ingress-for-release.yaml` 中补充 `tls` 段
