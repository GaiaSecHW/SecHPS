import sys
import json
from pathlib import Path

# 添加skill-creator路径
sys.path.insert(0, r'C:\Users\icsl\.agents\skills\skill-creator\eval-viewer')

# 导入必要的模块
from generate_review import find_runs, build_run, generate_html

workspace = Path(r'D:\claude-web-platform\my_cmd_inject-workspace\iteration-1')
skill_name = 'my_cmd_inject'

# 查找所有runs
runs = find_runs(workspace)
print(f'找到 {len(runs)} 个测试运行')

for run in runs:
    print(f'  - {run["id"]}: prompt长度={len(run["prompt"])} chars, outputs={len(run["outputs"])} files')

# 读取benchmark
benchmark_path = workspace / 'benchmark.json'
benchmark = None
if benchmark_path.exists():
    with open(benchmark_path, encoding='utf-8') as f:
        benchmark = json.load(f)
    print(f'Benchmark loaded: {len(benchmark["runs"])} runs')

# 生成HTML
html = generate_html(runs, skill_name, None, benchmark)

# 保存
output_path = workspace / 'evaluation_report.html'
output_path.write_text(html, encoding='utf-8')
print(f'HTML报告已生成: {output_path}')
print(f'文件大小: {output_path.stat().st_size} bytes')
