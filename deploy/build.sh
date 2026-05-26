#!/usr/bin/env bash
# ============================================================================
# SecHPS Docker Image Build Script
#
# Usage:
#   ./deploy/build.sh              # Build both server and worker
#   ./deploy/build.sh server       # Build server only
#   ./deploy/build.sh worker       # Build worker only
#
# Version tag format: vYYYYMMDDHHmmss (e.g. v20260525103204)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION_TAG="v$(date +%Y%m%d%H%M%S)"
SERVER_IMAGE="sechps-server"
WORKER_IMAGE="sechps-worker"

# ---------------------------------------------------------------------------
# .dockerignore management
# Server and Worker need different .dockerignore files:
#   - Server: excludes codeswarm/ (has its own Dockerfile)
#   - Worker: includes codeswarm/ (needs worker source + codedmap)
# ---------------------------------------------------------------------------
SERVER_DOCKERIGNORE="$PROJECT_DIR/.dockerignore"
WORKER_DOCKERIGNORE="$SCRIPT_DIR/worker.dockerignore"

backup_dockerignore() {
    if [ -f "$SERVER_DOCKERIGNORE" ]; then
        cp "$SERVER_DOCKERIGNORE" "$SERVER_DOCKERIGNORE.server.bak"
        echo "[build] Backed up .dockerignore to .dockerignore.server.bak"
    fi
}

restore_dockerignore() {
    if [ -f "$SERVER_DOCKERIGNORE.server.bak" ]; then
        cp "$SERVER_DOCKERIGNORE.server.bak" "$SERVER_DOCKERIGNORE"
        rm "$SERVER_DOCKERIGNORE.server.bak"
        echo "[build] Restored original .dockerignore"
    fi
}

# ---------------------------------------------------------------------------
# Build Server Image
# ---------------------------------------------------------------------------
build_server() {
    echo "[build] ===== Building Server Image ====="
    echo "[build] Tag: $SERVER_IMAGE:$VERSION_TAG"
    echo "[build] Tag: $SERVER_IMAGE:latest"
    echo ""

    cd "$PROJECT_DIR"

    # Server uses the existing .dockerignore (excludes codeswarm/)
    docker build \
        -f Dockerfile.server \
        -t "$SERVER_IMAGE:$VERSION_TAG" \
        -t "$SERVER_IMAGE:latest" \
        .

    echo ""
    echo "[build] ✅ Server image built successfully"
    echo "[build]    $SERVER_IMAGE:$VERSION_TAG"
    echo "[build]    $SERVER_IMAGE:latest"
}

# ---------------------------------------------------------------------------
# Build Worker Image
# ---------------------------------------------------------------------------
build_worker() {
    echo "[build] ===== Building Worker Image ====="
    echo "[build] Tag: $WORKER_IMAGE:$VERSION_TAG"
    echo "[build] Tag: $WORKER_IMAGE:latest"
    echo ""

    cd "$PROJECT_DIR"

    # Worker needs custom .dockerignore that includes codeswarm/
    backup_dockerignore

    if [ ! -f "$WORKER_DOCKERIGNORE" ]; then
        echo "[build] ❌ Worker dockerignore not found: $WORKER_DOCKERIGNORE"
        restore_dockerignore
        exit 1
    fi

    cp "$WORKER_DOCKERIGNORE" "$SERVER_DOCKERIGNORE"
    echo "[build] Swapped .dockerignore for worker build (includes codeswarm/)"

    # Ensure .dockerignore is restored even if docker build fails
    trap restore_dockerignore EXIT

    docker build \
        -f Dockerfile.worker \
        -t "$WORKER_IMAGE:$VERSION_TAG" \
        -t "$WORKER_IMAGE:latest" \
        .

    # Clear trap after successful build, restore explicitly
    trap - EXIT
    restore_dockerignore

    echo ""
    echo "[build] ✅ Worker image built successfully"
    echo "[build]    $WORKER_IMAGE:$VERSION_TAG"
    echo "[build]    $WORKER_IMAGE:latest"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
TARGET="${1:-all}"

echo "[build] SecHPS Docker Image Build"
echo "[build] Version: $VERSION_TAG"
echo "[build] Target: $TARGET"
echo "[build] Project: $PROJECT_DIR"
echo ""

case "$TARGET" in
    server)
        build_server
        ;;
    worker)
        build_worker
        ;;
    all)
        build_server
        echo ""
        build_worker
        ;;
    *)
        echo "Usage: $0 [server|worker|all]"
        echo "  all     - Build both server and worker (default)"
        echo "  server  - Build server image only"
        echo "  worker  - Build worker image only"
        exit 1
        ;;
esac

echo ""
echo "[build] ===== Build Summary ====="
echo "[build] Version tag: $VERSION_TAG"

if [ "$TARGET" = "server" ] || [ "$TARGET" = "all" ]; then
    echo "[build] Server: $SERVER_IMAGE:$VERSION_TAG / $SERVER_IMAGE:latest"
fi
if [ "$TARGET" = "worker" ] || [ "$TARGET" = "all" ]; then
    echo "[build] Worker: $WORKER_IMAGE:$VERSION_TAG / $WORKER_IMAGE:latest"
fi

echo "[build] Done!"