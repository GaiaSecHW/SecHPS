#!/bin/bash
# AI4WEB 平台运行脚本 (Linux/Mac)
# 用法: ./run.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "AI4WEB 平台启动脚本"
echo "=========================================="

# 检查 .env 文件
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo -e "${YELLOW}[提示] 未找到 .env 文件，从 .env.example 创建...${NC}"
        cp .env.example .env
        echo -e "${YELLOW}[重要] 请编辑 .env 文件配置数据库和 API 密钥!${NC}"
    fi
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[错误] 未安装 Node.js${NC}"
    exit 1
fi

# 检查依赖
if [ ! -d "node_modules" ] || [ ! -d "node_modules/@prisma/client" ]; then
    echo -e "${YELLOW}[提示] 安装依赖...${NC}"
    npm install
fi

# 检查 Prisma 客户端
if [ ! -d "node_modules/.prisma/client" ]; then
    echo -e "${YELLOW}[提示] 生成 Prisma 客户端...${NC}"
    npx prisma generate
fi

# 检查数据库
if [ ! -f "prisma/dev.db" ] && [ ! -f "prisma/prod.db" ]; then
    echo -e "${YELLOW}[提示] 初始化数据库...${NC}"
    npx prisma db push
fi

# 检查构建
if [ ! -d ".next" ]; then
    echo -e "${YELLOW}[提示] 构建项目...${NC}"
    npm run build
fi

# 启动服务
echo ""
echo -e "${GREEN}[OK] 启动服务...${NC}"
echo ""
echo "访问地址: http://localhost:3000"
echo "按 Ctrl+C 停止服务"
echo "=========================================="
echo ""

npm start
