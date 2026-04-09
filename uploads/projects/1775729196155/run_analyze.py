import subprocess
import sys

# 直接运行分析脚本
script_path = 'analyze_mcp.py'

try:
    result = subprocess.run([sys.executable, script_path], capture_output=True, text=True, timeout=60)
    print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr)
    print("Return code:", result.returncode)
except subprocess.TimeoutExpired:
    print("Script timed out")
except Exception as e:
    print(f"Error: {e}")
