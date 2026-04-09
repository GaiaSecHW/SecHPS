#!/usr/bin/env python3
import zipfile
import os
import re

jar_path = 'secexample-1.0.jar'
extract_path = 'extracted'

print("Starting JAR extraction and analysis...")

# Create extraction directory
os.makedirs.makedirs(extract_path, exist_ok=True)

# Extract JAR file
try:
    with zipfile.ZipFile(jar_path, 'r') as zip_ref:
        # List all files
        print(f"\nJAR contains {len(zip_ref.namelist())} entries:")
        for name in zip_ref.namelist():
            print(f"  - {name}")

        # Extract all files
        zip_ref.extractall(extract_path)
        print(f"\nExtracted to: {extract_path}")

except Exception as e:
    print(f"Error extracting JAR: {e}")
    exit(1)

# Analyze extracted files
print("\n" + "="*60)
print("SECURITY ANALYSIS")
print("="*60)

vulnerabilities = []

# Walk through extracted files
for root, dirs, files in os.walk(extract_path):
    for file in files:
        file_path = os.path.join(root, file)

        # Read class files (binary)
        if file.endswith('.class'):
            try:
                with open(file_path, 'rb') as f:
                    content = f.read()

                    # Look for strings in class file
                    try:
                        text_content = content.decode('utf-8', errors='ignore')

                        # Check for command execution patterns
                        if 'Runtime' in text_content and 'exec' in text_content:
                            vulnerabilities.append({
                                'type': '命令注入',
                                'severity': 'high',
                                'title': '潜在的命令注入漏洞',
                                'description': '在类文件中发现Runtime.exec相关字符串，可能存在命令注入风险',
                                'location': file_path,
                                'cwe_id': 'CWE-78'
                            })

                        # Check for SQL patterns
                        if 'Statement' in text_content and 'execute' in text_content:
                            vulnerabilities.append({
                                'type': 'SQL注入',
                                'severity': 'high',
                                'title': '潜在的SQL注入漏洞',
                                'description': '在类文件中发现Statement.execute相关字符串，可能存在SQL注入风险',
                                'location': file_path,
                                'cwe_id': 'CWE-89'
                            })

                        # Check for hardcoded passwords
                        if re.search(r'password\s*[=:]\s*["\']', text_content, re.IGNORECASE):
                            vulnerabilities.append({
                                'type': '硬编码敏感信息',
                                'severity': 'medium',
                                'title': '硬编码密码',
                                'description': '在类文件中发现可能硬编码的密码',
                                'location': file_path,
                                'cwe_id': 'CWE-798'
                            })

                    except:
                        pass

            except Exception as e:
                pass

        # Read text files
        elif file.endswith('.xml') or file.endswith('.properties') or file.endswith('.txt'):
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()

                    # Check for hardcoded credentials in config files
                    if re.search(r'password\s*[=:]\s*\S+', content, re.IGNORECASE):
                        vulnerabilities.append({
                            'type': '硬编码敏感信息',
                            'severity': 'medium',
                            'title': '配置文件中的硬编码凭据',
                            'description': f'在配置文件中发现可能硬编码的密码或凭据',
                            'location': file_path,
                            'cwe_id': 'CWE-798'
                        })

            except Exception as e:
                pass

# Generate report
print("\n" + "="*60)
print("VULNERABILITY REPORT")
print("="*60)

if vulnerabilities:
    print(f"\nFound {len(vulnerabilities)} potential vulnerabilities:\n")

    for i, vuln in enumerate(vulnerabilities, 1):
        print(f"{i}. [{vuln['severity'].upper()}] {vuln['type']}")
        print(f"   Title: {vuln['title']}")
        print(f"   Description: {vuln['description']}")
        print(f"   Location: {vuln['location']}")
        print(f"   CWE: {vuln['cwe_id']}")
        print()
else:
    print("\nNo obvious vulnerabilities found in extracted files.")
    print("Note: This is a basic analysis. For comprehensive security auditing,")
    print("source code (.java files) or decompiled code is required.")

# Generate JSON report
import json

summary = {
    'total': len(vulnerabilities),
    'critical': sum(1 for v in vulnerabilities if v['severity'] == 'critical'),
    'high': sum(1 for v in vulnerabilities if v['severity'] == 'high'),
    'medium': sum(1 for v in vulnerabilities if v['severity'] == 'medium'),
    'low': sum(1 for v in vulnerabilities if v['severity'] == 'low'),
    'info': sum(1 for v in vulnerabilities if v['severity'] == 'info'),
    'skills_used': ['Python', 'zipfile', 're']
}

report = {
    'summary': summary,
    'vulnerabilities': [
        {
            'type': v['type'],
            'severity': v['severity'],
            'title': v['title'],
            'description': v['description'],
            'location': v['location'],
            'skill': 'Python',
            'cwe_id': v['cwe_id']
        } for v in vulnerabilities
    ]
}

# Save JSON report
with open('vulnerability_report.json', 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2, ensure_ascii=False)

print("\nJSON report saved to: vulnerability_report.json")
