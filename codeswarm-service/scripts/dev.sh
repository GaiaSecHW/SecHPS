#!/usr/bin/env bash
set -euo pipefail

echo "=== CodeSwarm Dev Environment ==="

# 检查 .env
if [ ! -f .env ]; then
  echo "Copying .env.example to .env..."
  cp .env.example .env
  echo "Please edit .env with your configuration."
fi

# 安装依赖
pnpm install

# 生成 Prisma Client
npx prisma generate --schema=prisma/schema.prisma

# 推送 schema 到数据库（开发环境）
echo "Pushing schema to database..."
npx prisma db push --schema=prisma/schema.prisma

echo ""
echo "=== Starting services ==="
echo "Scheduler: pnpm dev:scheduler"
echo "Worker:    pnpm dev:worker"
echo ""
echo "Or use Docker Compose:"
echo "  cd docker && docker compose up --build"
