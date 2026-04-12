/**
 * Skills 导出功能测试
 * 验证文件名格式是否包含版本号
 * 
 * 运行方式: npx ts-node scripts/test-skill-export.ts
 */

import * as fs from 'fs';
import * as path from 'path';

type TestSkill = {
  id: string;
  userId: string | null;
  name: string;
  displayName: string;
  description: string;
  category: string;
  severity: string;
  cwe: string;
  systemPrompt: string;
  userPrompt: string;
  tools: unknown[];
  parameters: unknown[];
  version: number;
  parentId: string | null;
  isLatest: boolean;
  successRate: number;
  avgDuration: number;
  execCount: number;
};

// 模拟测试 Skill 数据
const testSkill: TestSkill = {
  id: 'test-id-1',
  userId: null,
  name: 'sql-injection',
  displayName: 'SQL 注入检测',
  description: '检测 SQL 注入漏洞',
  category: 'code-audit',
  severity: 'critical',
  cwe: 'CWE-89',
  systemPrompt: '你是一个 SQL 注入检测专家...',
  userPrompt: '请检查以下代码是否存在 SQL 注入漏洞...',
  tools: [],
  parameters: [],
  version: 3,
  parentId: null,
  isLatest: true,
  successRate: 0.95,
  avgDuration: 1500,
  execCount: 100,
};

const testSkill2: TestSkill = {
  id: 'test-id-2',
  userId: null,
  name: 'xss-detection',
  displayName: 'XSS 检测',
  description: '检测跨站脚本攻击',
  category: 'web',
  severity: 'high',
  cwe: 'CWE-79',
  systemPrompt: '你是一个 XSS 检测专家...',
  userPrompt: '请检查以下代码是否存在 XSS 漏洞...',
  tools: [],
  parameters: [],
  version: 1,
  parentId: null,
  isLatest: true,
  successRate: 0.88,
  avgDuration: 2000,
  execCount: 50,
};

// 测试目录
const testDir = path.join(__dirname, '..', 'test-output');

function cleanup() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

function generateSkillMarkdown(skill: TestSkill): string {
  let markdown = '---\n';
  markdown += `name: ${skill.name}\n`;
  markdown += `description: ${skill.description}\n`;
  markdown += '---\n\n';
  markdown += skill.systemPrompt;
  
  if (skill.userPrompt && skill.userPrompt !== skill.systemPrompt) {
    markdown += '\n\n---\n\n';
    markdown += '## 用户提示词\n\n';
    markdown += skill.userPrompt;
  }
  
  return markdown;
}

function exportSkillToFile(skill: TestSkill, targetDir: string): string {
  const skillDir = path.join(targetDir, skill.name);
  const skillFile = path.join(skillDir, `SKILL-v${skill.version}.md`);
  
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }
  
  const markdown = generateSkillMarkdown(skill);
  fs.writeFileSync(skillFile, markdown, 'utf-8');
  
  return skillFile;
}

function runTests() {
  console.log('=== 开始测试 Skills 导出功能 ===\n');

  // 清理之前的测试输出
  cleanup();
  fs.mkdirSync(testDir, { recursive: true });

  let passCount = 0;
  let failCount = 0;

  // 测试 1: 单个 Skill 导出
  console.log('测试 1: 导出单个 Skill (v3)');
  try {
    const exportedFile = exportSkillToFile(testSkill, testDir);
    console.log(`  导出路径: ${exportedFile}`);

    // 验证文件名格式
    const expectedFileName = `SKILL-v${testSkill.version}.md`;
    const actualFileName = path.basename(exportedFile);
    
    if (actualFileName === expectedFileName) {
      console.log(`  ✓ 文件名正确: ${actualFileName}`);
      passCount++;
    } else {
      console.log(`  ✗ 文件名错误: 期望 "${expectedFileName}", 实际 "${actualFileName}"`);
      failCount++;
    }

    // 验证文件存在
    if (fs.existsSync(exportedFile)) {
      console.log(`  ✓ 文件存在`);
      passCount++;

      // 读取文件内容验证
      const content = fs.readFileSync(exportedFile, 'utf-8');
      if (content.includes(testSkill.systemPrompt)) {
        console.log(`  ✓ 文件内容正确`);
        passCount++;
      } else {
        console.log(`  ✗ 文件内容不正确`);
        failCount++;
      }
    } else {
      console.log(`  ✗ 文件不存在: ${exportedFile}`);
      failCount++;
    }
  } catch (error) {
    console.error(`  ✗ 导出失败:`, error);
    failCount++;
  }

  // 测试 2: 另一个 Skill (v1)
  console.log('\n测试 2: 导出另一个 Skill (v1)');
  try {
    const exportedFile = exportSkillToFile(testSkill2, testDir);
    console.log(`  导出路径: ${exportedFile}`);

    const expectedFileName = `SKILL-v${testSkill2.version}.md`;
    const actualFileName = path.basename(exportedFile);
    
    if (actualFileName === expectedFileName) {
      console.log(`  ✓ 文件名正确: ${actualFileName}`);
      passCount++;
    } else {
      console.log(`  ✗ 文件名错误: 期望 "${expectedFileName}", 实际 "${actualFileName}"`);
      failCount++;
    }

    if (fs.existsSync(exportedFile)) {
      console.log(`  ✓ 文件存在`);
      passCount++;
    } else {
      console.log(`  ✗ 文件不存在`);
      failCount++;
    }
  } catch (error) {
    console.error(`  ✗ 导出失败:`, error);
    failCount++;
  }

  // 测试 3: 验证目录结构
  console.log('\n测试 3: 验证目录结构');
  const skillDir1 = path.join(testDir, testSkill.name);
  const skillDir2 = path.join(testDir, testSkill2.name);

  if (fs.existsSync(skillDir1)) {
    const files = fs.readdirSync(skillDir1);
    console.log(`  ✓ ${testSkill.name} 目录存在，文件: ${files.join(', ')}`);
    passCount++;
  } else {
    console.log(`  ✗ ${testSkill.name} 目录不存在`);
    failCount++;
  }

  if (fs.existsSync(skillDir2)) {
    const files = fs.readdirSync(skillDir2);
    console.log(`  ✓ ${testSkill2.name} 目录存在，文件: ${files.join(', ')}`);
    passCount++;
  } else {
    console.log(`  ✗ ${testSkill2.name} 目录不存在`);
    failCount++;
  }

  // 测试 4: 验证版本号格式
  console.log('\n测试 4: 验证版本号格式');
  const versionPattern = /SKILL-v(\d+)\.md$/;
  
  const file1 = path.join(skillDir1, `SKILL-v${testSkill.version}.md`);
  if (versionPattern.test(file1)) {
    const match = file1.match(versionPattern);
    if (match && parseInt(match[1]) === testSkill.version) {
      console.log(`  ✓ 版本号格式正确: v${match[1]}`);
      passCount++;
    } else {
      console.log(`  ✗ 版本号不匹配`);
      failCount++;
    }
  } else {
    console.log(`  ✗ 文件名不匹配版本号格式`);
    failCount++;
  }

  // 输出测试结果
  console.log('\n=== 测试结果 ===');
  console.log(`通过: ${passCount}`);
  console.log(`失败: ${failCount}`);
  console.log(`总计: ${passCount + failCount}`);

  if (failCount === 0) {
    console.log('\n✓ 所有测试通过！');
  } else {
    console.log('\n✗ 部分测试失败');
  }

  // 清理测试输出
  cleanup();
  console.log('\n已清理测试输出目录');
}

// 运行测试
runTests();
