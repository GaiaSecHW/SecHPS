#!/bin/bash
# AI4WEB 平台打包脚本（生产部署）
# 用法: ./scripts/pack.sh

set -e

echo "=========================================="
echo "AI4WEB 平台打包脚本"
echo "=========================================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未安装 Node.js"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✓ Node.js 版本: $NODE_VERSION"

# 获取版本号
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME="ai4web-platform-${VERSION}.zip"
TEMP_DIR="dist-package"

echo "✓ 打包版本: $VERSION"

# 清理旧文件
echo ""
echo "[1/5] 清理旧文件..."
rm -rf "$TEMP_DIR"
rm -f "$PACKAGE_NAME"

# 构建项目
echo ""
echo "[2/5] 构建项目..."
npm run build

# 创建打包目录
echo ""
echo "[3/5] 创建打包目录..."
mkdir -p "$TEMP_DIR"

# 复制必需文件（仅生产运行所需）
echo ""
echo "[4/5] 复制文件..."

# 构建产物
cp -r .next "$TEMP_DIR/"

# 数据库相关
cp -r prisma "$TEMP_DIR/"
# 保留已存在的数据库文件
if [ -f "prisma/prod.db" ]; then
    cp prisma/prod.db "$TEMP_DIR/prisma/"
fi
if [ -f "prisma/dev.db" ]; then
    cp prisma/dev.db "$TEMP_DIR/prisma/"
fi

# 配置文件
cp package.json "$TEMP_DIR/"
cp package-lock.json "$TEMP_DIR/"
cp next.config.js "$TEMP_DIR/"

# 运行脚本
cp run.sh "$TEMP_DIR/" 2>/dev/null || true
cp run.bat "$TEMP_DIR/" 2>/dev/null || true

# 部署文档
cp README-DEPLOY.md "$TEMP_DIR/" 2>/dev/null || true
cp .env.example "$TEMP_DIR/"

# 安装生产依赖
echo ""
echo "[5/5] 安装生产依赖..."
cd "$TEMP_DIR"
npm install --production --ignore-scripts --omit=dev
npx prisma generate
cd ..

# 创建 ZIP 文件
echo "创建 ZIP 文件..."
cd "$TEMP_DIR"
zip -r "../$PACKAGE_NAME" .
cd ..

# 清理
rm -rf "$TEMP_DIR"

# 输出结果
echo ""
echo "=========================================="
echo "✅ 打包完成!"
echo "=========================================="
echo "文件: $PACKAGE_NAME"
echo "大小: $(du -h "$PACKAGE_NAME" | cut -f1)"
echo ""
echo "包含文件:"
echo "  - .next/          (构建产物)"
echo "  - node_modules/   (生产依赖)"
echo "  - prisma/         (数据库)"
echo "  - package.json    (运行脚本)"
echo "  - run.sh/run.bat  (启动脚本)"
echo "  - .env.example    (环境变量模板)"
echo ""
echo "下一步:"
echo "1. 将 $PACKAGE_NAME 复制到目标机器"
echo "2. 解压: unzip $PACKAGE_NAME"
echo "3. 配置: cp .env.example .env && 编辑 .env"
echo "4. 运行: ./run.sh (Linux/Mac) 或 run.bat (Windows)"
