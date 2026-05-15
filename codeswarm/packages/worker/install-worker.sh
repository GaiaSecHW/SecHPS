#!/bin/bash
# CodeSwarm Worker 一键安装脚本
# 用法: curl -fsSL https://你的平台地址/api/codeswarm/worker/install | bash
# 或本地: bash <(curl -fsSL http://localhost:3000/api/codeswarm/worker/install)
#
# 参数 (可通过环境变量传入):
#   ORCHESTRATOR_URL  - 平台地址 (默认: http://localhost:3000)
#   NODE_ID           - 节点ID (默认: 自动生成)
#   PORT             - 监听端口 (默认: 8080)
#   MAX_CONCURRENT   - 最大并发数 (默认: 3)
#   WORKER_ADDRESS   - 外部可访问地址 (默认: 自动探测)

set -e

SCRIPT_VERSION="0.2.0"
INSTALL_DIR="${INSTALL_DIR:-/opt/codeswarm-worker}"
LOG_FILE="/var/log/codeswarm-worker.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" 2>/dev/null || echo "$*"
}

error() {
    echo "[ERROR] $*" >&2
    exit 1
}

# 检测操作系统
detect_os() {
    case "$(uname -s)" in
        Linux*)     OS="linux"; ARCH=$(uname -m) ;;
        Darwin*)    OS="macos"; ARCH=$(uname -m) ;;
        MINGW*|MSYS*) OS="windows"; ARCH=$(uname -m) ;;
        *)          error "不支持的操作系统: $(uname -s)" ;;
    esac

    case "$ARCH" in
        x86_64)  ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *)       error "不支持的架构: $ARCH" ;;
    esac

    log "检测到操作系统: $OS / $ARCH"
}

# 检查依赖
check_deps() {
    log "检查依赖..."

    if ! command -v node &> /dev/null; then
        error "未安装 Node.js，请先安装: https://nodejs.org/"
    fi

    NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d 'v')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        error "Node.js 版本过低，需要 >= 18，当前: $(node -v)"
    fi
    log "Node.js 版本: $(node -v) ✓"

    if ! command -v git &> /dev/null; then
        log "警告: 未安装 git，部分功能可能受影响"
    else
        log "git 版本: $(git --version | cut -d' ' -f3) ✓"
    fi
}

# 探测本机外部地址
detect_address() {
    if [ -n "$WORKER_ADDRESS" ]; then
        log "使用指定的外部地址: $WORKER_ADDRESS"
        return
    fi

    # 优先通过网关探测
    local ext_ip=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
    if [ -n "$ext_ip" ]; then
        WORKER_ADDRESS="${ext_ip}:${PORT:-8080}"
        log "探测到外部地址: $WORKER_ADDRESS"
    else
        # 回退到本地 IP
        local local_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
        if [ -z "$local_ip" ]; then
            local_ip="127.0.0.1"
        fi
        WORKER_ADDRESS="${local_ip}:${PORT:-8080}"
        log "使用本地地址: $WORKER_ADDRESS"
    fi
}

# 创建工作目录
setup_dir() {
    log "创建安装目录: $INSTALL_DIR"
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown $(whoami):$(id -gn) "$INSTALL_DIR" 2>/dev/null || sudo chown -R $(whoami) "$INSTALL_DIR" 2>/dev/null || true
    cd "$INSTALL_DIR"
}

# 下载 worker 代码
download_worker() {
    log "下载 CodeSwarm Worker v${SCRIPT_VERSION}..."

    # 优先尝试 npm 包方式 (如果有发布到 npm)
    # npx @codeswarm/worker@${SCRIPT_VERSION} 2>/dev/null

    # 从平台下载 (.zip 格式)
    local download_url="${ORCHESTRATOR_URL}/api/codeswarm/worker/dist"

    log "从平台下载: $download_url"
    curl -fsSL "$download_url" -o codeswarm-worker.zip --max-time 60 || {
        log "平台下载失败，尝试备用方案..."

        # 备用: 直接从 GitHub/Gitea 下载 release
        # 这部分根据实际发布的下载地址调整
        error "无法下载 worker，请检查 ORCHESTRATOR_URL 是否正确"
    }

    unzip -o codeswarm-worker.zip || error "解压失败"
    rm -f codeswarm-worker.zip
    log "下载完成"
}

# 安装依赖
install_deps() {
    log "安装依赖..."

    if [ ! -f "package.json" ]; then
        error "package.json 未找到，下载可能失败"
    fi

    npm install --production --ignore-scripts 2>&1 | tail -5
    log "依赖安装完成"
}

# 生成配置
generate_config() {
    log "生成配置文件..."

    cat > .env << EOF
# CodeSwarm Worker 配置
# 由 install-worker.sh 自动生成 $(date '+%Y-%m-%d %H:%M:%S')

# 必须配置
ORCHESTRATOR_URL=${ORCHESTRATOR_URL:-http://localhost:3000}

# 节点配置
NODE_ID=${NODE_ID:-node-$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c 10)}
PORT=${PORT:-8080}
MAX_CONCURRENT=${MAX_CONCURRENT:-3}
WORKER_ADDRESS=${WORKER_ADDRESS:-}

# 日志
LOG_LEVEL=info
EOF

    log "配置文件已生成: $INSTALL_DIR/.env"
}

# 验证安装
verify_install() {
    log "验证安装..."

    if [ ! -f "dist/index.js" ]; then
        error "未找到 dist/index.js，构建可能失败或包结构错误"
    fi

    node --version
    log "安装验证通过 ✓"
}

# 启动 worker
start_worker() {
    log "启动 CodeSwarm Worker..."

    # 使用 systemd 启动 (如果可用)
    if command -v systemctl &> /dev/null && [ -d "/etc/systemd/system" ]; then
        log "注册 systemd 服务..."

        sudo tee /etc/systemd/system/codeswarm-worker.service > /dev/null << EOF
[Unit]
Description=CodeSwarm Worker
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) dist/index.js
EnvironmentFile=${INSTALL_DIR}/.env
Restart=on-failure
RestartSec=5s
StandardOutput=append:${INSTALL_DIR}/logs/stdout.log
StandardError=append:${INSTALL_DIR}/logs/stderr.log

[Install]
WantedBy=multi-user.target
EOF

        sudo systemctl daemon-reload
        sudo systemctl enable codeswarm-worker
        sudo systemctl start codeswarm-worker

        log "Worker 已通过 systemd 启动 (systemctl status codeswarm-worker)"
    else
        # 直接后台启动
        mkdir -p logs
        nohup node dist/index.js > logs/stdout.log 2>&1 &
        sleep 2

        if pgrep -f "dist/index.js" > /dev/null; then
            log "Worker 已启动 (PID: $(pgrep -f 'dist/index.js' | head -1))"
        else
            error "Worker 启动失败，查看日志: logs/stdout.log"
        fi
    fi
}

# 停止 worker
stop_worker() {
    log "停止 CodeSwarm Worker..."

    if command -v systemctl &> /dev/null && systemctl list-unit-files codeswarm-worker.service &> /dev/null; then
        sudo systemctl stop codeswarm-worker
        sudo systemctl disable codeswarm-worker
        sudo rm -f /etc/systemd/system/codeswarm-worker.service
        sudo systemctl daemon-reload
        log "systemd 服务已移除"
    else
        local pid=$(pgrep -f "dist/index.js" 2>/dev/null | head -1)
        if [ -n "$pid" ]; then
            kill "$pid" 2>/dev/null && log "进程已终止 (PID: $pid)" || log "进程终止失败"
        else
            log "未发现运行中的 worker"
        fi
    fi

    log "停止完成"
}

# 重启 worker
restart_worker() {
    stop_worker
    sleep 1
    start_worker
}

# 主流程
main() {
    local cmd="${1:-install}"

    log "=========================================="
    log "CodeSwarm Worker 管理脚本 v${SCRIPT_VERSION}"
    log "=========================================="

    case "$cmd" in
        install)  install_worker ;;
        start)    start_worker ;;
        stop)     stop_worker ;;
        restart)  restart_worker ;;
        status)
            if command -v systemctl &> /dev/null && systemctl is-active codeswarm-worker &> /dev/null; then
                log "Worker 状态: 运行中 (systemd)"
            elif pgrep -f "dist/index.js" > /dev/null; then
                log "Worker 状态: 运行中 (PID: $(pgrep -f 'dist/index.js' | head -1))"
            else
                log "Worker 状态: 未运行"
            fi
            ;;
        *)
            echo "用法: $0 {install|start|stop|restart|status}"
            echo ""
            echo "命令:"
            echo "  install  - 安装并启动 worker (默认)"
            echo "  start    - 仅启动 worker"
            echo "  stop     - 停止 worker"
            echo "  restart  - 重启 worker"
            echo "  status   - 查看 worker 运行状态"
            exit 1
            ;;
    esac
}

main "$@"