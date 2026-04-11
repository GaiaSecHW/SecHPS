#!/usr/bin/env python3
"""Fix encoding issues in grading.json files."""

import json
from pathlib import Path

# 定义正确的数据
grading_data = {
    "eval-1": {
        "with_skill": {
            "expectations": [
                {
                    "text": "检测到 os.system 中的命令注入漏洞",
                    "passed": True,
                    "evidence": "漏洞 #1 明确指出了第10-11行存在os.system命令注入，并提供了详细的攻击示例和修复建议"
                },
                {
                    "text": "检测到 subprocess.call 中的命令注入漏洞",
                    "passed": True,
                    "evidence": "漏洞 #2 明确指出了第17-18行存在subprocess.call命令注入，说明了shell=True的危险性"
                },
                {
                    "text": "检测到 eval 执行用户输入的安全问题",
                    "passed": True,
                    "evidence": "漏洞 #3 明确指出了第24-25行存在eval代码注入漏洞，风险等级为极高，并说明了攻击者可执行任意Python代码"
                },
                {
                    "text": "提供了具体的修复建议",
                    "passed": True,
                    "evidence": "每个漏洞都提供了详细的修复代码示例，包括使用subprocess.run替代os.system，使用shell=False参数等"
                },
                {
                    "text": "正确识别了 safe_list_files 函数是安全的实现",
                    "passed": True,
                    "evidence": "报告中明确标注第31-32行为安全实现示例，使用subprocess.run并设置shell=False"
                }
            ],
            "timing": {
                "executor_duration_seconds": 125.0,
                "total_duration_seconds": 125.0
            }
        },
        "without_skill": {
            "expectations": [
                {
                    "text": "检测到 os.system 命令注入",
                    "passed": True,
                    "evidence": "Found vulnerability in lines 9-12"
                },
                {
                    "text": "检测到 subprocess.call 命令注入",
                    "passed": True,
                    "evidence": "Found vulnerability in lines 15-19"
                },
                {
                    "text": "检测到 eval 代码注入",
                    "passed": True,
                    "evidence": "Found vulnerability in lines 22-26"
                },
                {
                    "text": "提供了修复建议",
                    "passed": True,
                    "evidence": "Fix examples provided"
                },
                {
                    "text": "识别了安全实现",
                    "passed": True,
                    "evidence": "Mentioned safe implementation"
                }
            ],
            "timing": {
                "executor_duration_seconds": 115.0,
                "total_duration_seconds": 115.0
            }
        }
    },
    "eval-2": {
        "with_skill": {
            "expectations": [
                {
                    "text": "Correctly identified command injection",
                    "passed": True,
                    "evidence": "Identified high-risk vulnerability"
                },
                {
                    "text": "Explained exploitation methods",
                    "passed": True,
                    "evidence": "Provided 4 detailed attack scenarios"
                },
                {
                    "text": "Provided fix suggestions",
                    "passed": True,
                    "evidence": "Provided subprocess and shlex.quote solutions"
                }
            ],
            "timing": {
                "executor_duration_seconds": 69.0,
                "total_duration_seconds": 69.0
            }
        },
        "without_skill": {
            "expectations": [
                {
                    "text": "Correctly identified command injection",
                    "passed": True,
                    "evidence": "Identified CWE-78 vulnerability"
                },
                {
                    "text": "Explained exploitation methods",
                    "passed": True,
                    "evidence": "Provided 5 attack scenarios"
                },
                {
                    "text": "Provided fix suggestions",
                    "passed": True,
                    "evidence": "Provided subprocess solution with code"
                }
            ],
            "timing": {
                "executor_duration_seconds": 64.0,
                "total_duration_seconds": 64.0
            }
        }
    }
}

# 基础路径
base_path = Path("D:/claude-web-platform/my_cmd_inject-workspace/iteration-1")

# 修复每个文件
for eval_name, configs in grading_data.items():
    for config_name, data in configs.items():
        grading_path = base_path / eval_name / config_name / "run-1" / "grading.json"
        
        # 添加 summary
        data["summary"] = {
            "passed": sum(1 for e in data["expectations"] if e["passed"]),
            "failed": sum(1 for e in data["expectations"] if not e["passed"]),
            "total": len(data["expectations"]),
            "pass_rate": sum(1 for e in data["expectations"] if e["passed"]) / len(data["expectations"])
        }
        
        # 写入文件
        with open(grading_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        
        print(f"Fixed: {grading_path}")

print("\nAll grading.json files have been fixed!")
