// prisma/import-skills.ts
// 从 E:\NAZHUA-main\opencode\skills 导入内置 Skills

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const SOURCE_DIR = 'E:\\NAZHUA-main\\opencode\\skills';

// 定义要导入的 Skills
const skillsToImport = [
  {
    categoryDir: 'code-audit',
    name: 'code-audit',
    displayName: 'Code Audit Skill',
    description: '[Web/应用方向] Professional web and application security audit skill covering 55+ vulnerability types. Enhanced with WooYun 88,636 real-world vulnerability cases. Use for web apps, REST/GraphQL APIs, CMS, SaaS, backend services.',
    category: 'code-audit',
    techStack: ['Java', 'Python', 'Go', 'PHP', 'JavaScript', 'Node.js', 'C#', '.NET', 'Ruby', 'Rust'],
  },
  {
    categoryDir: 'security-audit',
    name: 'security-audit',
    displayName: 'Security Audit Skill',
    description: '[二进制/原生方向] Senior-level memory safety and binary vulnerability auditor. Use for C, C++, Rust (unsafe), native code, shared libraries, executables, parsers, fuzzing targets.',
    category: 'config', // 映射到 config 分类（表示底层/系统级安全）
    techStack: ['C', 'C++', 'Rust'],
  },
];

async function main() {
  console.log('开始导入 Skills...\n');

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const skillConfig of skillsToImport) {
    const skillPath = path.join(SOURCE_DIR, skillConfig.categoryDir, 'SKILL.md');

    // 检查文件是否存在
    if (!fs.existsSync(skillPath)) {
      console.error(`❌ 文件不存在: ${skillPath}`);
      errors++;
      continue;
    }

    // 读取 skill 内容
    const content = fs.readFileSync(skillPath, 'utf-8');

    // 检查是否已存在
    const existing = await prisma.skill.findFirst({
      where: {
        userId: null,
        name: skillConfig.name,
      },
    });

    if (existing) {
      console.log(`⏭️ Skill "${skillConfig.name}" 已存在，跳过`);
      skipped++;
      continue;
    }

    // 创建 Skill
    await prisma.skill.create({
      data: {
        name: skillConfig.name,
        displayName: skillConfig.displayName,
        description: skillConfig.description,
        category: skillConfig.category,
        techStack: JSON.stringify(skillConfig.techStack),
        content: content,
        isBuiltin: true,
        userId: null,
      },
    });

    console.log(`✅ 创建 Skill "${skillConfig.name}" (${skillConfig.category}) - techStack: [${skillConfig.techStack.join(', ')}]`);
    created++;
  }

  console.log(`\n导入完成！创建: ${created}, 跳过: ${skipped}, 错误: ${errors}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });