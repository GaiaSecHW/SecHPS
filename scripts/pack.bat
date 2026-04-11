@echo off
chcp 65001 >nul
REM AI4WEB Packing Script (Production)

echo ==========================================
echo AI4WEB Packing Script
echo ==========================================

rmdir /s /q  .next
rmdir /s /q  node_modules

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found
    exit /b 1
)

for /f "delims=" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%

for /f "delims=" %%i in ('node -p "require('./package.json').version"') do set VERSION=%%i
set PACKAGE_NAME=ai4web-platform-%VERSION%.zip
set TEMP_DIR=dist-package

echo [OK] Version: %VERSION%

echo.
echo [1/5] Cleaning...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
if exist "%PACKAGE_NAME%" del /q "%PACKAGE_NAME%"

echo.
echo [2/5] Building...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed
    exit /b 1
)

echo.
echo [3/5] Creating package directory...
mkdir "%TEMP_DIR%" 2>nul

echo.
echo [4/5] Copying files...

REM Build output
xcopy /E /I /Q .next "%TEMP_DIR%\.next" >nul

REM Database
xcopy /E /I /Q prisma "%TEMP_DIR%\prisma" >nul

REM Config files
copy /Y package.json "%TEMP_DIR%\" >nul
copy /Y package-lock.json "%TEMP_DIR%\" >nul
copy /Y next.config.ts "%TEMP_DIR%\" >nul

REM Scripts
copy /Y run.bat "%TEMP_DIR%\" >nul
copy /Y run.sh "%TEMP_DIR%\" >nul

REM Docs
copy /Y README-DEPLOY.md "%TEMP_DIR%\" >nul
copy /Y .env.example "%TEMP_DIR%\" >nul

echo.
echo [5/5] Installing production dependencies...
cd "%TEMP_DIR%"
call npm install --production --ignore-scripts
call npx prisma generate
cd ..

echo.
echo Creating ZIP...
powershell -command "Compress-Archive -Path '%TEMP_DIR%\*' -DestinationPath '%PACKAGE_NAME%' -Force"

rmdir /s /q "%TEMP_DIR%"

echo.
echo ==========================================
echo Packing Complete!
echo ==========================================
echo File: %PACKAGE_NAME%
echo.
echo Contents:
echo   - .next/          (build output)
echo   - node_modules/   (production deps)
echo   - prisma/         (database)
echo   - package.json    (scripts)
echo   - run.bat         (startup script)
echo   - .env.example    (env template)
echo.
echo Next steps:
echo 1. Copy %PACKAGE_NAME% to target machine
echo 2. Unzip the file
echo 3. Copy .env.example to .env and edit
echo 4. Run run.bat
