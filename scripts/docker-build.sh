#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Chimera Docker Image Build Script
#
# Usage:
#   bash scripts/docker-build.sh           # Build both scheduler & worker
#   bash scripts/docker-build.sh scheduler # Build scheduler only
#   bash scripts/docker-build.sh worker    # Build worker only
#
# Images:
#   chimera-scheduler:latest
#   chimera-worker:latest
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SCHEDULER_IMAGE="chimera-scheduler:latest"
WORKER_IMAGE="chimera-worker:latest"

build_scheduler() {
  echo "=== Building ${SCHEDULER_IMAGE} ==="
  docker build -f docker/Dockerfile.scheduler -t "${SCHEDULER_IMAGE}" "${PROJECT_ROOT}"
  echo "=== ${SCHEDULER_IMAGE} build complete ==="
}

build_worker() {
  echo "=== Building ${WORKER_IMAGE} ==="
  docker build -f docker/Dockerfile.worker -t "${WORKER_IMAGE}" "${PROJECT_ROOT}"
  echo "=== ${WORKER_IMAGE} build complete ==="
}

TARGET="${1:-all}"

case "$TARGET" in
  scheduler)
    build_scheduler
    ;;
  worker)
    build_worker
    ;;
  all)
    build_scheduler
    build_worker
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: bash scripts/docker-build.sh [scheduler|worker|all]"
    exit 1
    ;;
esac

echo "=== Docker build finished ==="