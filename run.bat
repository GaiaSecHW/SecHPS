@echo off
chcp 65001 >nul
REM SecHPS 平台运行脚本 (Windows)
REM 用法: 双击运行或 .\run.bat

setlocal

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM 创建日志目录
if not exist "logs" mkdir logs

REM 日志文件名（带日期）
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "DATETIME=%%I"
set "LOG_FILE=logs\app-%DATETIME:~0,8%.log"

REM 颜色输出 (使用 PowerShell)
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "NC=[0m"

echo ==========================================
echo SecHPS 平台启动脚本
echo ==========================================
echo 日志文件: %LOG_FILE%
echo ==========================================

REM 检查 .env 文件
if not exist ".env" (
    if exist ".env.example" (
        echo [提示] 未找到 .env 文件，从 .env.example 创建...
        copy .env.example .env >nul
        echo [重要] 请编辑 .env 文件配置数据库和 API 密钥!
    )
)

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未安装 Node.js
    exit /b 1
)

REM 检查依赖
if not exist "node_modules" (
    echo [提示] 安装依赖...
    call npm install
) else (
    if not exist "node_modules\@prisma\client" (
        echo [提示] 安装依赖...
        call npm install
    )
)

REM 检查 Prisma 客户端
if not exist "node_modules\.prisma\client" (
    echo [提示] 生成 Prisma 客户端...
    call npx prisma generate
)

REM 检查数据库
if not exist "prisma\dev.db" (
    if not exist "prisma\prod.db" (
        echo [提示] 初始化数据库...
        call npx prisma db push
    )
)

REM 检查构建
if not exist ".next" (
    echo [提示] 构建项目...
    call npm run build
)

REM 启动服务
echo.
echo [OK] 启动服务...
echo.
echo 访问地址: http://localhost:3000
echo 日志文件: %LOG_FILE%
echo 按 Ctrl+C 停止服务
echo ==========================================
echo.

REM 写入启动日志
echo [%date% %time%] SecHPS 平台启动 >> "%LOG_FILE%"

REM 使用 PowerShell 实现 tee 功能（同时输出到终端和文件）
powershell -Command "& { npm start 2>&1 | ForEach-Object { $_ | Out-File -Append -FilePath '%LOG_FILE%'; $_ } }"
