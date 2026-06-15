# CodeSwarm Scheduler / Worker 重拉镜像操作

基于当前集群实际运行资源，`scheduler` 和 `worker` 的 Deployment 位于 `secflow-ns` namespace。

> 注意：当前 `k8s/scheduler-deployment.yaml` / `k8s/worker-deployment.yaml` 中写的是 `imagePullPolicy: Always`，因此执行 `rollout restart` 会让新 Pod 重新拉取同 tag 镜像。

## 本次实际部署命令（2026-06-13）

```bash
kubectl config current-context
kubectl get deploy -n secflow-ns scheduler worker -o wide

kubectl rollout restart deployment/scheduler deployment/worker -n secflow-ns && \
  kubectl rollout status deployment/scheduler -n secflow-ns --timeout=300s && \
  kubectl rollout status deployment/worker -n secflow-ns --timeout=300s && \
  kubectl get pods -n secflow-ns -l 'app in (scheduler,worker)' -o wide

kubectl get deploy -n secflow-ns scheduler worker \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.readyReplicas}{"/"}{.status.replicas}{" ready\t"}{range .spec.template.spec.containers[*]}{.image}{" "}{end}{"\n"}{end}'
```

## 1. 查看当前 Kubernetes Context

```bash
kubectl config current-context
```

确认当前 context 指向目标集群，例如：

```text
kubernetes-admin@kubernetes
```

## 2. 查看当前镜像配置

```bash
kubectl get deploy -n secflow-ns scheduler worker \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.template.spec.containers[*]}{.name}{"="}{.image}{" pull="}{.imagePullPolicy}{" "}{end}{"\n"}{end}'
```

期望看到类似：

```text
scheduler   scheduler=ghcr.io/gaiasechw/codeswarm-scheduler:dev_secflow_codeswarm pull=Always
worker      worker=ghcr.io/gaiasechw/codeswarm-worker:dev_secflow_codeswarm pull=Always
```

## 3. 重启 Scheduler / Worker 以重新拉取镜像

```bash
kubectl rollout restart deployment/scheduler deployment/worker -n secflow-ns
```

## 4. 等待 Scheduler Rollout 完成

```bash
kubectl rollout status deployment/scheduler -n secflow-ns --timeout=300s
```

成功时输出类似：

```text
deployment "scheduler" successfully rolled out
```

## 5. 等待 Worker Rollout 完成

```bash
kubectl rollout status deployment/worker -n secflow-ns --timeout=300s
```

成功时输出类似：

```text
deployment "worker" successfully rolled out
```

## 6. 查看新 Pod 状态

```bash
kubectl get pods -n secflow-ns -l 'app in (scheduler,worker)' -o wide
```

期望状态：

```text
NAME                         READY   STATUS    RESTARTS   AGE   IP            NODE
scheduler-xxxxxxxxxx-xxxxx   1/1     Running   0          ...   ...           ...
worker-xxxxxxxxxx-xxxxx      1/1     Running   0          ...   ...           ...
```

## 一条命令完成重拉与等待

```bash
kubectl rollout restart deployment/scheduler deployment/worker -n secflow-ns && \
kubectl rollout status deployment/scheduler -n secflow-ns --timeout=300s && \
kubectl rollout status deployment/worker -n secflow-ns --timeout=300s && \
kubectl get pods -n secflow-ns -l 'app in (scheduler,worker)' -o wide
```

## 常见问题

### 1. 为什么不是 `codeswarm-scheduler` / `codeswarm-worker`？

当前仓库 manifest 中 `metadata.name` 是：

- `codeswarm-scheduler`
- `codeswarm-worker`

但当前集群实际运行的 Deployment 是：

- `scheduler`
- `worker`

因此线上重拉镜像时使用实际集群资源名：

```bash
kubectl rollout restart deployment/scheduler deployment/worker -n secflow-ns
```

### 2. 如果 Worker 被 HPA 管理怎么办？

当前 Worker 有 HPA，例如：

```bash
kubectl get hpa -n secflow-ns
```

只需要重启 Deployment 即可，HPA 会继续管理副本数：

```bash
kubectl rollout restart deployment/worker -n secflow-ns
```

### 3. 如果 rollout 卡住如何排查？

```bash
kubectl get pods -n secflow-ns -l 'app in (scheduler,worker)' -o wide
kubectl describe deploy -n secflow-ns scheduler
kubectl describe deploy -n secflow-ns worker
kubectl get events -n secflow-ns --sort-by=.lastTimestamp
```

查看日志：

```bash
kubectl logs -n secflow-ns deploy/scheduler --tail=200
kubectl logs -n secflow-ns deploy/worker --tail=200
```
