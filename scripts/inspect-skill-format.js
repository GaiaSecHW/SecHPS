const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const skill = await prisma.skill.findFirst({ 
    where: { name: 'python-security-audit' } 
  });
  
  if (skill) {
    console.log('=== First 3000 chars of python-security-audit ===\n');
    console.log(skill.content.substring(0, 3000));
    console.log('\n\n=== Looking for section patterns ===');
    
    // Check what patterns exist
    const patterns = [
      { name: '## 0. 角色定位', regex: /##\s*0\.\s*角色定位/ },
      { name: '## 0.角色定位 (no space)', regex: /##\s*0\.角色定位/ },
      { name: '# 角色定位', regex: /#\s*角色定位/ },
      { name: '角色定位 (any header)', regex: /^#+\s*角色定位/m },
      { name: '## 角色定位', regex: /##\s*角色定位/ },
      { name: '## 1. 技能概述', regex: /##\s*1\.\s*技能概述/ },
      { name: '## 技能概述', regex: /##\s*技能概述/ },
      { name: '## 3. 检测步骤', regex: /##\s*3\.\s*检测步骤/ },
      { name: '## 检测步骤', regex: /##\s*检测步骤/ },
      { name: '## 4. 漏洞示例', regex: /##\s*4\.\s*漏洞示例/ },
      { name: '## 漏洞示例', regex: /##\s*漏洞示例/ },
    ];
    
    for (const p of patterns) {
      const match = skill.content.match(p.regex);
      console.log(`${p.name}: ${match ? 'FOUND at position ' + match.index : 'NOT FOUND'}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); });