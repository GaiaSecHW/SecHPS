@echo off
cd /d "%~dp0"
echo Running JAR analysis...
python analyze_jar_final.py
echo.
echo Analysis completed. Results saved to jar_analysis_final.txt
type jar_analysis_final.txt
