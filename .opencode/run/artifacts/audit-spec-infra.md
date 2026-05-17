# Infra Security Audit Narrative - audit-spec-infra

## 范围
- CodeSwarm Worker Docker 部署 (codeswarm/Dockerfile, docker-compose.yml)
- Redis Stream 架构 (codeswarm-dispatcher.ts)
- NFS 文件存储 (nfs-upload.ts)
- 跨服务信任边界 (worker-auth, daemon, callbacks)
- 环境变量配置 (.env, .env.example)
- CodeSwarm 回调 API (worker/result, worker/heartbeat, worker/event)

## 方法
1. read deployment_boundary → 分析容器化部署的信任边界
2. read cross_service_trust → 分析 Worker-Orchestrator 之间的认证/授权
3. check_runtime_exposure → 检查实际运行时的暴露面和凭据安全

## 关键发现摘要

### CRITICAL
- **INFRA-001**: Worker 回调 API (result/heartbeat/event/nodes) 缺少认证
- **INFRA-002**: .env 文件硬编码生产凭据到代码仓库
- **INFRA-003**: JWT_SECRET 回退至硬编码默认值，Worker Token 与 User Token 共享密钥

### HIGH
- **INFRA-004**: GET /api/codeswarm/nodes 暴露 Worker JWT Token
- **INFRA-006**: Worker→Orchestrator 回调缺乏认证，callbackUrl 可被攻击者控制
- **INFRA-007**: /api/v1/vulnerabilities 端点完全无认证

### MEDIUM
- **INFRA-005**: Worker 绑定 0.0.0.0（可通过网络访问）
- **INFRA-008**: NFS 文件上传缺少路径遍历防护

## 核心结论
CodeSwarm 分布式系统的信任边界存在系统性缺陷：Worker 回调端点和 v1 漏洞接口完全无认证，由设计文档承认"依赖网络隔离保护"。同时 .env 文件硬编码了生产环境的所有凭据。JWT_SECRET 使用不安全默认值且 worker token 与 user token 共享密钥。这些问题组合在一起允许攻击者伪造任务结果、注入漏洞数据、窃取 Worker 回调数据。
