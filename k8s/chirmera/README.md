# Chirmera K8S 部署说明

该目录参考 `/home/runshine/CLionProjects/sothoth/13-secflow-service` 的扁平 YAML 风格，为当前 `SecHPS` 项目生成了独立的 Kubernetes 部署清单。

## 资源概览

- `secflow-ns`：沿用参考项目的 namespace
- `chirmera-postgresql`：PostgreSQL 16 + PVC
- `chirmera-redis`：Redis 7 + PVC
- `chirmera-sechps`：当前 Next.js 主服务
- `chirmera-worker`：CodeSwarm Worker
- `chirmera-ingress`：对外入口，域名 `chirmera.ai.icsl.huawei.com`

## 使用方式

部署前请先按实际环境修改以下文件中的占位值：

- `00-chirmera-01-01-postgresql-secret.yaml`
- `00-chirmera-03-00-sechps-configmap.yaml`
- `00-chirmera-03-01-sechps-secret.yaml`
- `00-chirmera-04-00-worker-configmap.yaml`
- `00-chirmera-04-01-worker-secret.yaml`
- `00-chirmera-05-00-ingress-for-release.yaml`（如需 TLS 或调整注解）

然后执行：

```bash
cd k8s/chirmera
chmod +x deploy.sh
./deploy.sh
```

## 镜像说明

- 主服务镜像：`ghcr.io/gaiasechw/sechps:latest`
- Worker 镜像：`ghcr.io/gaiasechw/codeswarm-worker:latest`

如你的镜像仓库地址不同，请修改对应 Deployment 里的 `image` 字段。

## Ingress

- Host：`chirmera.ai.icsl.huawei.com`
- Backend Service：`chirmera-sechps:3000`
- 当前未启用 TLS；如集群已配置证书，可在 `k8s/chirmera/00-chirmera-05-00-ingress-for-release.yaml` 中补充 `tls` 段
