#!/usr/bin/env bash
set -euo pipefail

echo "=== Building CodeSwarm Service ==="

# 安装依赖
pnpm install

# 生成 Prisma Client
npx prisma generate --schema=prisma/schema.prisma

# 构建所有包
pnpm -r run build

echo "=== Build complete ==="
