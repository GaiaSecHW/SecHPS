@echo off
REM AI4WEB 项目启动脚本
REM 项目名称: bbb
REM 用途: 在项目目录中启动 Claude CLI

REM 获取脚本所在目录
set PROJECT_DIR=%~dp0

REM 切换到项目目录
cd /d "%PROJECT_DIR%"

REM 显示项目信息
echo ========================================
echo AI4WEB 项目启动
echo ========================================
echo 项目名称: bbb
echo 项目目录: %PROJECT_DIR%
echo 正在启动 Claude CLI...
echo ========================================
echo.

REM 启动 Claude CLI
claude
