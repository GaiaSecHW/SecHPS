import subprocess
import sys
import os

# Change to the script directory
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

# Run the analysis script
script_path = 'analyze_jar_final.py'

try:
    result = subprocess.run(
        [sys.executable, script_path],
        capture_output=True,
        text=True,
        timeout=120
    )

    # Save output to file
    with open('wrapper_output.txt', 'w', encoding='utf-8') as f:
        f.write("STDOUT:\n")
        f.write(result.stdout)
        f.write("\n\nSTDERR:\n")
        f.write(result.stderr)
        f.write(f"\n\nReturn code: {result.returncode}")

    print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr)
    print(f"Return code: {result.returncode}")

except subprocess.TimeoutExpired:
    print("Script timed out")
    with open('wrapper_output.txt', 'w', encoding='utf-8') as f:
        f.write("Script timed out")
except Exception as e:
    print(f"Error: {e}")
    with open('wrapper_output.txt', 'w', encoding='utf-8') as f:
        f.write(f"Error: {e}")
