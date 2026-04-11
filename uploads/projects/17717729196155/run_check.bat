@echo off
cd /d "%~dp0"
echo Checking JAR file...
python check_jar_simple.py
echo.
echo Done.
type jar_check_result.txt
