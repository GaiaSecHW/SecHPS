#!/usr/bin/env bash
# ============================================================================
# SecHPS Docker 容器运行脚本
#
# Usage:
#   ./deploy/run.sh              # 运行 server + worker
#   ./deploy/run.sh server       # 运行 server only
#   ./deploy/run.sh worker       # 运行 worker only
#   ./deploy/run.sh stop         # 停止所有容器
#   ./deploy/run.sh stop server  # 停止 server
#   ./deploy/run.sh stop worker  # 停止 worker
#
# 环境变量文件:
#   Server: 项目根目录 .env（含 DATABASE_URL、JWT_SECRET、REDIS_URL 等）
#   Worker: deploy/.env.worker（含 ORCHESTRATOR_URL、MINIO_* 等）
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SERVER_CONTAINER="sechps-server"
WORKER_CONTAINER="sechps-worker"
SERVER_PORT=3000
WORKER_PORT=8090

# 共享数据卷：宿主机路径 → 容器内路径
SHARED_VOLUME="/home/icsl/luyuxin/ai4_worker:/mnt/luyuxin/ai4_worker"

# 自动检测 latest 镜像 tag
SERVER_IMAGE="sechps-server:latest"
WORKER_IMAGE="sechps-worker:latest"

# 环境变量文件
SERVER_ENV_FILE="$SCRIPT_DIR/.env.server"
WORKER_ENV_FILE="$SCRIPT_DIR/.env.worker"

# ---------------------------------------------------------------------------
# 停止容器
# ---------------------------------------------------------------------------
stop_container() {
    local name="$1"
    if docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
        echo "[run] Stopping $name..."
        docker stop "$name" 2>/dev/null || true
        docker rm "$name" 2>/dev/null || true
        echo "[run] ✅ $name stopped and removed"
    else
        echo "[run] $name is not running"
    fi
}

stop_all() {
    stop_container "$SERVER_CONTAINER"
    stop_container "$WORKER_CONTAINER"
}

# ---------------------------------------------------------------------------
# 运行 Server
# ---------------------------------------------------------------------------
run_server() {
    if docker ps -a --format '{{.Names}}' | grep -q "^${SERVER_CONTAINER}$"; then
        echo "[run] $SERVER_CONTAINER exists, stopping and removing..."
        stop_container "$SERVER_CONTAINER"
    fi

    if [ ! -f "$SERVER_ENV_FILE" ]; then
        echo "[run] ❌ Server env file not found: $SERVER_ENV_FILE"
        echo "[run]    Copy .env.example to .env and configure it first"
        exit 1
    fi

    echo "[run] ===== Starting Server ====="
    echo "[run] Image: $SERVER_IMAGE"
    echo "[run] Port: $SERVER_PORT"
    echo "[run] Env: $SERVER_ENV_FILE"

    docker run -d \
        --name "$SERVER_CONTAINER" \
        --user root \
        --env-file "$SERVER_ENV_FILE" \
        -p "${SERVER_PORT}:${SERVER_PORT}" \
        -v "$SHARED_VOLUME" \
        --restart unless-stopped \
        "$SERVER_IMAGE"

    echo "[run] ✅ Server started: $SERVER_CONTAINER"
    echo "[run]    Health check: curl -s http://localhost:${SERVER_PORT}/api/global/health"
}

# ---------------------------------------------------------------------------
# 运行 Worker
# ---------------------------------------------------------------------------
run_worker() {
    if docker ps -a --format '{{.Names}}' | grep -q "^${WORKER_CONTAINER}$"; then
        echo "[run] $WORKER_CONTAINER exists, stopping and removing..."
        stop_container "$WORKER_CONTAINER"
    fi

    if [ ! -f "$WORKER_ENV_FILE" ]; then
        echo "[run] ❌ Worker env file not found: $WORKER_ENV_FILE"
        exit 1
    fi

    echo "[run] ===== Starting Worker ====="
    echo "[run] Image: $WORKER_IMAGE"
    echo "[run] Port: $WORKER_PORT"
    echo "[run] Env: $WORKER_ENV_FILE"

    docker run -d \
        --name "$WORKER_CONTAINER" \
        --env-file "$WORKER_ENV_FILE" \
        -p "${WORKER_PORT}:${WORKER_PORT}" \
        -v "$SHARED_VOLUME" \
        --restart unless-stopped \
        "$WORKER_IMAGE"

    echo "[run] ✅ Worker started: $WORKER_CONTAINER"
    echo "[run]    Health check: curl -s http://localhost:${WORKER_PORT}/health"
}

# ---------------------------------------------------------------------------
# 查看状态
# ---------------------------------------------------------------------------
show_status() {
    echo "[run] ===== Container Status ====="
    for name in "$SERVER_CONTAINER" "$WORKER_CONTAINER"; do
        if docker ps --format '{{.Names}}' | grep -q "^${name}$"; then
            local status=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "unknown")
            local image=$(docker inspect --format='{{.Config.Image}}' "$name" 2>/dev/null || echo "unknown")
            echo "[run]   $name: $status (image: $image)"
        elif docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
            echo "[run]   $name: stopped (exited)"
        else
            echo "[run]   $name: not created"
        fi
    done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
ACTION="${1:-run}"
TARGET="${2:-all}"

case "$ACTION" in
    run)
        case "$TARGET" in
            server)
                run_server
                ;;
            worker)
                run_worker
                ;;
            all)
                run_server
                echo ""
                run_worker
                ;;
            *)
                echo "Usage: $0 run [server|worker|all]"
                exit 1
                ;;
        esac
        echo ""
        show_status
        ;;
    stop)
        case "$TARGET" in
            server)
                stop_container "$SERVER_CONTAINER"
                ;;
            worker)
                stop_container "$WORKER_CONTAINER"
                ;;
            all)
                stop_all
                ;;
            *)
                echo "Usage: $0 stop [server|worker|all]"
                exit 1
                ;;
        esac
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 [run|stop|status] [server|worker|all]"
        echo ""
        echo "  run [all]     - 运行 server + worker (默认)"
        echo "  run server    - 运行 server only"
        echo "  run worker    - 运行 worker only"
        echo "  stop [all]    - 停止所有容器"
        echo "  stop server   - 停止 server"
        echo "  stop worker   - 停止 worker"
        echo "  status        - 查看容器状态"
        exit 1
        ;;
esac