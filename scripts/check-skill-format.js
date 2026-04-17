const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

// Required sections from AI4WEB standard format
const REQUIRED_SECTIONS = [
  { pattern: /##\s*0\.\s*角色定位/i, name: '0. 角色定位' },
  { pattern: /##\s*3\.\s*检测步骤/i, name: '3. 检测步骤' },
  { pattern: /##\s*4\.\s*漏洞示例/i, name: '4. 漏洞示例' }
];

// All standard sections for reference
const ALL_STANDARD_SECTIONS = [
  '## 0. 角色定位',
  '## 1. 技能概述',
  '## 2. 适用范围',
  '## 3. 检测步骤',
  '## 4. 漏洞示例',
  '## 5. 修复建议'
];

async function main() {
  // Get total count first
  const total = await prisma.skill.count();
  console.log(`Total Skills in database: ${total}`);
  console.log(`Sampling 10% (approximately ${Math.ceil(total * 0.1)} skills)...\n`);
  
  // Get random sample
  const skills = await prisma.$queryRaw`
    SELECT id, name, content FROM Skill ORDER BY RANDOM() LIMIT 22
  `;
  
  const results = [];
  let passed = 0;
  let failed = 0;
  
  for (const skill of skills) {
    const content = skill.content || '';
    const checkResult = {
      id: skill.id,
      name: skill.name,
      contentLength: content.length,
      sections: {},
      missingRequired: [],
      passed: true
    };
    
    // Check for each required section
    for (const section of REQUIRED_SECTIONS) {
      const found = section.pattern.test(content);
      checkResult.sections[section.name] = found;
      if (!found) {
        checkResult.missingRequired.push(section.name);
        checkResult.passed = false;
      }
    }
    
    // Also check for all standard sections for reference
    checkResult.allSections = {};
    for (const section of ALL_STANDARD_SECTIONS) {
      const pattern = new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
      checkResult.allSections[section] = pattern.test(content);
    }
    
    if (checkResult.passed) {
      passed++;
    } else {
      failed++;
    }
    
    results.push(checkResult);
  }
  
  // Generate report
  let report = '='.repeat(80) + '\n';
  report += 'F2. 格式合规性检查报告\n';
  report += '='.repeat(80) + '\n\n';
  report += `检查时间: ${new Date().toISOString()}\n`;
  report += `总 Skill 数量: ${total}\n`;
  report += `抽样数量: ${skills.length} (约 10%)\n`;
  report += `通过: ${passed}\n`;
  report += `失败: ${failed}\n\n`;
  
  report += '='.repeat(80) + '\n';
  report += '必需章节检查标准:\n';
  report += '- ## 0. 角色定位\n';
  report += '- ## 3. 检测步骤\n';
  report += '- ## 4. 漏洞示例\n';
  report += '='.repeat(80) + '\n\n';
  
  report += '详细检查结果:\n';
  report += '-'.repeat(80) + '\n\n';
  
  for (const result of results) {
    report += `Skill: ${result.name}\n`;
    report += `ID: ${result.id}\n`;
    report += `内容长度: ${result.contentLength} 字符\n`;
    report += `状态: ${result.passed ? '✅ PASS' : '❌ FAIL'}\n`;
    
    if (!result.passed) {
      report += `缺失必需章节: ${result.missingRequired.join(', ')}\n`;
    }
    
    report += '\n章节详情:\n';
    for (const [section, found] of Object.entries(result.allSections)) {
      const icon = found ? '✓' : '✗';
      const isRequired = REQUIRED_SECTIONS.some(r => r.name === section);
      const marker = isRequired ? '[必需]' : '[标准]';
      report += `  ${icon} ${marker} ${section}\n`;
    }
    report += '\n' + '-'.repeat(80) + '\n\n';
  }
  
  // Summary
  report += '='.repeat(80) + '\n';
  report += '总结\n';
  report += '='.repeat(80) + '\n\n';
  
  if (failed === 0) {
    report += `✅ VERDICT: APPROVE\n\n`;
    report += `所有 ${skills.length} 个抽样的 Skill 均符合 AI4WEB 标准格式。\n`;
    report += `必需章节 (角色定位、检测步骤、漏洞示例) 全部存在。\n`;
  } else {
    report += `❌ VERDICT: REJECT\n\n`;
    report += `${failed}/${skills.length} 个 Skill 格式不合规。\n`;
    report += `缺失必需章节的 Skill:\n`;
    for (const result of results.filter(r => !r.passed)) {
      report += `  - ${result.name}: 缺失 ${result.missingRequired.join(', ')}\n`;
    }
  }
  
  // Save to evidence file
  const evidenceDir = path.join(__dirname, '..', '.sisyphus', 'evidence');
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }
  
  const evidenceFile = path.join(evidenceDir, 'f2-format-check.txt');
  fs.writeFileSync(evidenceFile, report, 'utf-8');
  
  console.log(report);
  console.log(`\n报告已保存至: ${evidenceFile}`);
  
  return { passed, failed, total: skills.length };
}

main()
  .then(result => {
    process.exit(result.failed > 0 ? 1 : 0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });