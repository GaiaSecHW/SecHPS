@echo off
cd /d "%~dp0"
echo Starting JAR analysis...
python analyze.py > analysis_output.txt 2>&1
echo Analysis completed.
echo.
echo Results:
type analysis_output.txt
