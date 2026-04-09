@echo off
cd /d "%~dp0"
echo Checking jar file with jar command...
jar -tf secexample-1.0.jar > jar_contents.txt 2>&1
echo.
echo First 50 lines of jar contents:
type jar_contents.txt | more /e +0
