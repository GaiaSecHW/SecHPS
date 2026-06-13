# CodeSwarm Kubernetes 操作命令

本文记录当前项目 `k8s/` 目录下 CodeSwarm 服务的常用 Kubernetes 操作命令。

## 基本信息

```bash
# Namespace
secflow-ns

# 核心组件
scheduler
worker
codeswarm-postgres
codeswarm-redis
```

## 部署/更新

```bash
# 一次性应用全部 manifest
kubectl apply -f k8s/

# 按依赖顺序应用，推荐首次部署使用
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/postgresql.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/scheduler-service.yaml
kubectl apply -f k8s/scheduler-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/worker-hpa.yaml
kubectl apply -f k8s/scheduler-ingress.yaml
kubectl apply -f k8s/servicemonitor.yaml
```

## 查看状态

```bash
# 查看核心资源
kubectl get all -n secflow-ns

# 查看 Pod
kubectl get pods -n secflow-ns -o wide

# 查看 Deployment
kubectl get deploy -n secflow-ns -o wide

# 查看 Service
kubectl get svc -n secflow-ns -o wide

# 查看 PVC
kubectl get pvc -n secflow-ns -o wide

# 查看 HPA
kubectl get hpa -n secflow-ns

# 查看 Ingress
kubectl get ingress -n secflow-ns
```

## 查看日志

```bash
# Scheduler 日志
kubectl logs -n secflow-ns deploy/codeswarm-scheduler --tail=200 -f

# Worker 日志
kubectl logs -n secflow-ns deploy/codeswarm-worker --tail=200 -f

# PostgreSQL 日志
kubectl logs -n secflow-ns deploy/codeswarm-postgres --tail=200 -f

# Redis 日志
kubectl logs -n secflow-ns deploy/codeswarm-redis --tail=200 -f
```

## 健康检查

```bash
# Scheduler Pod 内部 health
kubectl exec -n secflow-ns deploy/codeswarm-scheduler -- sh -c \
  'wget -qO- http://127.0.0.1:8080/health || curl -sf http://127.0.0.1:8080/health'

# 通过 Service 访问 Scheduler
kubectl exec -n secflow-ns deploy/codeswarm-scheduler -- sh -c \
  'wget -qO- http://scheduler:8080/health || curl -sf http://scheduler:8080/health'

# Worker health
kubectl exec -n secflow-ns deploy/codeswarm-worker -- sh -c \
  'wget -qO- http://127.0.0.1:8080/health || curl -sf http://127.0.0.1:8080/health'

# PostgreSQL readiness
kubectl exec -n secflow-ns deploy/codeswarm-postgres -- sh -c \
  'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# Redis ping
kubectl exec -n secflow-ns deploy/codeswarm-redis -- redis-cli ping
```

## 数据库检查

```bash
# 连接 PostgreSQL
kubectl exec -it -n secflow-ns deploy/codeswarm-postgres -- sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# 查看当前数据库和用户
kubectl exec -n secflow-ns deploy/codeswarm-postgres -- sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select current_database() as db, current_user as \"user\", now() as now;"'

# 查看应用表
kubectl exec -n secflow-ns deploy/codeswarm-postgres -- sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select table_name from information_schema.tables where table_schema = '\''public'\'' order by table_name;"'

# 从 Scheduler Pod 用 Prisma 验证 DB 访问
kubectl exec -n secflow-ns deploy/codeswarm-scheduler -- sh -c \
  'node -e '\''const {PrismaClient}=require("@prisma/client"); const p=new PrismaClient(); p.codeswarmTask.count().then(c=>console.log(JSON.stringify({codeswarmTaskCount:c}))).finally(()=>p["$disconnect"]())'\'''
```

## 重启/扩缩容

```bash
# 重启 Scheduler
kubectl rollout restart deployment/codeswarm-scheduler -n secflow-ns

# 重启 Worker
kubectl rollout restart deployment/codeswarm-worker -n secflow-ns

# 重启 PostgreSQL
kubectl rollout restart deployment/codeswarm-postgres -n secflow-ns

# 重启 Redis
kubectl rollout restart deployment/codeswarm-redis -n secflow-ns

# 查看 rollout 状态
kubectl rollout status deployment/codeswarm-scheduler -n secflow-ns
kubectl rollout status deployment/codeswarm-worker -n secflow-ns

# 手动扩容 Worker
kubectl scale deployment/codeswarm-worker -n secflow-ns --replicas=2
```

## 排障命令

```bash
# 查看 Pod 事件和详细信息
kubectl describe pod -n secflow-ns <pod-name>

# 查看 Deployment 详情
kubectl describe deploy -n secflow-ns scheduler
kubectl describe deploy -n secflow-ns worker

# 查看近期事件
kubectl get events -n secflow-ns --sort-by=.lastTimestamp

# 查看 Service Endpoints
kubectl get endpoints -n secflow-ns scheduler codeswarm-postgres codeswarm-redis -o wide

# 进入 Scheduler 容器
kubectl exec -it -n secflow-ns deploy/codeswarm-scheduler -- sh

# 进入 Worker 容器（Deployment 方式）
kubectl exec -it -n secflow-ns deploy/codeswarm-worker -c worker -- sh

# 查看 Worker Pod 名称
kubectl get pods -n secflow-ns -l app=worker

# 进入指定 Worker Pod
kubectl exec -it -n secflow-ns <worker-pod-name> -c worker -- sh

# 如果镜像内有 bash，也可以使用 bash
kubectl exec -it -n secflow-ns <worker-pod-name> -c worker -- bash

# 进入 PostgreSQL 容器
kubectl exec -it -n secflow-ns deploy/codeswarm-postgres -- sh
```

## 镜像更新

```bash
# 更新 Scheduler 镜像
kubectl set image deployment/codeswarm-scheduler \
  scheduler=ghcr.io/gaiasechw/codeswarm-scheduler:dev_secflow_codeswarm \
  -n secflow-ns

# 更新 Worker 镜像
kubectl set image deployment/codeswarm-worker \
  worker=ghcr.io/gaiasechw/codeswarm-worker:dev_secflow_codeswarm \
  -n secflow-ns

# 等待更新完成
kubectl rollout status deployment/codeswarm-scheduler -n secflow-ns
kubectl rollout status deployment/codeswarm-worker -n secflow-ns
```

## 删除/清理

```bash
# 删除全部 k8s 资源
kubectl delete -f k8s/

# 只删除应用，不删数据库/Redis/PVC
kubectl delete -f k8s/worker-deployment.yaml
kubectl delete -f k8s/scheduler-deployment.yaml
kubectl delete -f k8s/scheduler-service.yaml
kubectl delete -f k8s/scheduler-ingress.yaml

# 危险：删除数据库和 Redis 工作负载，PVC 可能仍保留
kubectl delete -f k8s/postgresql.yaml
kubectl delete -f k8s/redis.yaml

# 危险：删除 PVC 会导致数据丢失，确认后再执行
kubectl delete pvc -n secflow-ns postgres-data redis-data
```

## 最常用命令

```bash
kubectl apply -f k8s/
kubectl get pods -n secflow-ns -o wide
kubectl logs -n secflow-ns deploy/codeswarm-scheduler --tail=200 -f
kubectl logs -n secflow-ns deploy/codeswarm-worker --tail=200 -f
kubectl rollout restart deployment/codeswarm-scheduler -n secflow-ns
kubectl rollout restart deployment/codeswarm-worker -n secflow-ns
```
