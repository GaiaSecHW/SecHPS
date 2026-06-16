#!/usr/bin/env bash
# ============================================================================
# SecHPS Docker Image Save Script
#
# 获取当前最新生成的带sechps-server的docker镜像（如v20260616105630）
# docker save 该镜像，文件名为 {镜像名}.tar
#OUTPUT_DIR="/home/icsl/images"
# Usage:
#   ./deploy/save_images.sh              # 保存 server + worker
#   ./deploy/save_images.sh server       # 保存 server only
#   ./deploy/save_images.sh worker       # 保存 worker only
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/images"

SERVER_IMAGE="sechps-server"
WORKER_IMAGE="sechps-worker"

# ---------------------------------------------------------------------------
# 获取镜像的最新版本 tag（排除 latest）
# ---------------------------------------------------------------------------
get_latest_tag() {
    local image="$1"
    local tag
    tag=$(docker images --format '{{.Tag}}' "$image" | grep -E '^v[0-9]{14}$' | sort -r | head -1)
    if [ -z "$tag" ]; then
        echo "[save] ❌ No versioned tag found for $image (expected vYYYYMMDDHHmmss format)"
        return 1
    fi
    echo "$tag"
}

# ---------------------------------------------------------------------------
# 保存镜像为 tar 文件
# ---------------------------------------------------------------------------
save_image() {
    local image="$1"
    local tag
    tag=$(get_latest_tag "$image") || return 1

    local full_image="$image:$tag"
    local output_file="$OUTPUT_DIR/${image}-${tag}.tar"

    mkdir -p "$OUTPUT_DIR"

    echo "[save] Saving $full_image → $output_file"
    docker save "$full_image" -o "$output_file"

    local size
    size=$(du -h "$output_file" | cut -f1)
    echo "[save] ✅ Saved $full_image ($size) → $output_file"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
TARGET="${1:-all}"

echo "[save] SecHPS Docker Image Save"
echo "[save] Target: $TARGET"
echo "[save] Output: $OUTPUT_DIR/"
echo ""

case "$TARGET" in
    server)
        save_image "$SERVER_IMAGE"
        ;;
    worker)
        save_image "$WORKER_IMAGE"
        ;;
    all)
        mkdir -p "$OUTPUT_DIR"
        save_image "$SERVER_IMAGE" &
        SERVER_PID=$!
        save_image "$WORKER_IMAGE" &
        WORKER_PID=$!
        wait "$SERVER_PID" "$WORKER_PID"
        ;;
    *)
        echo "Usage: $0 [server|worker|all]"
        echo "  all     - Save both server and worker (default, concurrent)"
        echo "  server  - Save server image only"
        echo "  worker  - Save worker image only"
        exit 1
        ;;
esac

echo ""
echo "[save] ===== Save Summary ====="

for image in "$SERVER_IMAGE" "$WORKER_IMAGE"; do
    if [ "$TARGET" = "all" ] || [ "$TARGET" = "$image" ] || \
       { [ "$TARGET" = "server" ] && [ "$image" = "$SERVER_IMAGE" ]; } || \
       { [ "$TARGET" = "worker" ] && [ "$image" = "$WORKER_IMAGE" ]; }; then
        tag=$(get_latest_tag "$image") || continue
        f="$OUTPUT_DIR/${image}-${tag}.tar"
        if [ -f "$f" ]; then
            s=$(du -h "$f" | cut -f1)
            echo "[save]   $image:$tag → ${image}-${tag}.tar ($s)"
        fi
    fi
done

echo "[save] Done!"
