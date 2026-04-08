// scripts 测 Skills 导出功能

import * as fs from 'fs';
import * as path from 'path';

// 模拟一个 Skill 数据
const mockSkill = {
  id: 'test-skill-1',
  userId: null,
  name: 'sql-injection',
  displayName: 'SQL 注入检测',
  description: '检测代码中的 SQL 注入漏洞，包括字符串拼接、不安全的参数传递等',
  category: 'code-audit',
  severity: 'high',
  cwe: 'CWE-89',
  systemPrompt: `你是一个专业的安全代码审计专家，专注于检测 SQL 注入漏洞。

你的任务是分析代码中的 SQL 注入风险，包括但不限于：
1. 字符串拼接构建 SQL 语句
2. 用户输入直接拼接到 SQL 中
3. 使用不安全的数据库操作方法
4. 动态表名、列名构造

请仔细分析每一段代码，找出潜在的 SQL 注入点，并提供修复建议。`,
  userPrompt: '请分析项目中的 SQL 注入漏洞。',
  tools: [
    { name: 'Read', description: '读取文件' },
    { name: 'Grep', description: '搜索代码' },
  ],
  parameters: [],
  version: 1,
  isLatest: true,
  successRate: 0.85,
  avgDuration: 5000,
  execCount: 100,
  
  // Claude 官方标准字段
  disableModelInvocation: false,
  userInvocable: true,
  context: 'inline',
  agent: undefined,
  argumentHint: '[filepath]',
  model: undefined,
  effort: 'high',
  paths: undefined,
  shell: undefined,
  hooks: undefined,
};

/**
 * 生成 SKILL.md 内容
 */
function generateSkillMarkdown(skill: any): string {
  let markdown = '---\n';
  
  // 必需字段
  markdown += `name: ${skill.name}\n`;
  markdown += `description: ${skill.description}\n`;
  
  // 可选字段
  if (skill.disableModelInvocation) {
    markdown += `disable-model-invocation: true\n`;
  }
  
  if (skill.userInvocable === false) {
    markdown += `user-invocable: false\n`;
  }
  
  if (skill.tools && skill.tools.length > 0) {
    const toolNames = skill.tools.map((t: any) => t.name).join(' ');
    markdown += `allowed-tools: ${toolNames}\n`;
  }
  
  if (skill.context) {
    markdown += `context: ${skill.context}\n`;
  }
  
  if (skill.agent) {
    markdown += `agent: ${skill.agent}\n`;
  }
  
  if (skill.argumentHint) {
    markdown += `argument-hint: ${skill.argumentHint}\n`;
  }
  
  if (skill.model) {
    markdown += `model: ${skill.model}\n`;
  }
  
  if (skill.effort) {
    markdown += `effort: ${skill.effort}\n`;
  }
  
  if (skill.paths && skill.paths.length > 0) {
    markdown += `paths: ${skill.paths.join(', ')}\n`;
  }
  
  if (skill.shell) {
    markdown += `shell: ${skill.shell}\n`;
  }
  
  if (skill.hooks) {
    const hooksJson = typeof skill.hooks === 'string' 
      ? skill.hooks 
      : JSON.stringify(skill.hooks, null, 2);
    markdown += `hooks: ${hooksJson}\n`;
  }
  
  // 结束 frontmatter
  markdown += '---\n\n';
  
  // 添加内容
  markdown += skill.systemPrompt;
  
  return markdown;
}

// 测试导出
console.log('=== 测试 Skills 导出功能 ===\n');

const testDir = path.join(process.cwd(), 'test-skills-output');

// 创建测试目录
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// 生成 SKILL.md
const skillDir = path.join(testDir, mockSkill.name);
const skillFile = path.join(skillDir, 'SKILL.md');

if (!fs.existsSync(skillDir)) {
  fs.mkdirSync(skillDir, { recursive: true });
}

const markdown = generateSkillMarkdown(mockSkill);
fs.writeFileSync(skillFile, markdown, 'utf-8');

console.log(`✅ 成功生成 SKILL.md: ${skillFile}`);
console.log('\n=== 生成的 SKILL.md 内容 ===\n');
console.log(markdown);
console.log('\n=== 测试完成 ===');
