@echo off
cd /d "%~dp0"
python analyze_mcp.py > analysis_result.txt 2>&1
echo Analysis completed
type analysis_result.txt
