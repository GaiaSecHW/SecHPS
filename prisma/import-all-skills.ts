// prisma/import-all-skills.ts
// 递归导入 E:\NAZHUA-main\opencode\skills 下所有 .md 文件作为独立 Skills
// 优化版：智能从内容提取技术栈

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// 类型声明
declare const process: any;

const prisma = new PrismaClient();

const SOURCE_DIR = 'E:\\NAZHUA-main\\opencode\\skills';

const FILE_CONFIG: Record<string, { category: string; techStack: string[] }> = {
  'code-audit/SKILL.md': { category: 'code-audit', techStack: ['Java', 'Python', 'Go', 'PHP', 'JavaScript', 'Node.js', 'C#', 'Ruby', 'Rust'] },
  'security-audit/SKILL.md': { category: 'config', techStack: ['C', 'C++', 'Rust'] },
};

interface SkillFile {
  relativePath: string;
  fileName: string;
  absolutePath: string;
}

function scanDirectory(dir: string): SkillFile[] {
  const files: SkillFile[] = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(SOURCE_DIR, fullPath);
    
    if (entry.isDirectory()) {
      files.push(...scanDirectory(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push({
        relativePath,
        fileName: entry.name,
        absolutePath: fullPath,
      });
    }
  }
  
  return files;
}

function extractTechStackFromContent(content: string): string[] {
  const contentLower = content.toLowerCase();
  const result: string[] = [];
  
  if (contentLower.includes('java')) result.push('Java');
  if (contentLower.includes('python') || contentLower.includes('py')) result.push('Python');
  if (contentLower.includes('go') || contentLower.includes('golang')) result.push('Go');
  if (contentLower.includes('php')) result.push('PHP');
  if (contentLower.includes('javascript') || contentLower.includes('js') || contentLower.includes('node')) {
    result.push('JavaScript');
    result.push('Node.js');
  }
  if (contentLower.includes('c#') || contentLower.includes('csharp') || contentLower.includes('.net') || contentLower.includes('asp')) {
    result.push('C#');
    result.push('.NET');
  }
  if (contentLower.includes('ruby')) result.push('Ruby');
  if (contentLower.includes('rust')) result.push('Rust');
  if (contentLower.includes('c/c++') || contentLower.includes('cpp') || contentLower.includes('c language') || contentLower.includes('c++ language')) {
    result.push('C');
    result.push('C++');
  }
  
  if (contentLower.includes('spring')) result.push('Java');
  if (contentLower.includes('django') || contentLower.includes('flask') || contentLower.includes('fastapi')) result.push('Python');
  if (contentLower.includes('express') || contentLower.includes('koa') || contentLower.includes('nest') || contentLower.includes('fastify')) {
    result.push('JavaScript');
    result.push('Node.js');
  }
  if (contentLower.includes('laravel')) result.push('PHP');
  if (contentLower.includes('rails')) result.push('Ruby');
  if (contentLower.includes('gin')) result.push('Go');
  
  const unique = Array.from(new Set(result));
  return unique.length > 0 ? unique : ['Java', 'Python', 'Go', 'PHP', 'JavaScript'];
}

function extractDisplayNameFromContent(content: string, fileName: string): string {
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed.substring(2).trim();
    }
    if (trimmed.startsWith('## ')) {
      return trimmed.substring(3).trim();
    }
  }
  
  const descMatch = content.match(/description:\s*(.+?)(?=\n|$)/);
  if (descMatch) {
    const desc = descMatch[1].trim().replace(/\|/g, '').replace(/"/g, '');
    if (desc.length > 10 && desc.length < 100) {
      return desc;
    }
  }
  
  return fileName.replace(/\.md$/, '').replace(/_/g, ' ');
}

function getConfig(relativePath: string, content: string): { category: string; techStack: string[] } {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  
  if (FILE_CONFIG[normalizedPath]) {
    return FILE_CONFIG[normalizedPath];
  }
  
  return { category: 'code-audit', techStack: extractTechStackFromContent(content) };
}

function normalizeName(relativePath: string): string {
  let name = relativePath.replace(/\\/g, '-').replace(/\//g, '-').replace(/\.md$/, '');
  name = name.replace(/^-+/, '');
  
  if (name === 'code-audit-SKILL') return 'code-audit';
  if (name === 'security-audit-SKILL') return 'security-audit';
  
  return name;
}

async function main() {
  console.log('开始导入 Skills...\n');

  const deleteResult = await prisma.skill.deleteMany({
    where: { isBuiltin: true },
  });
  console.log(`清除 ${deleteResult.count} 个现有内置 Skills\n`);

  const skillFiles = scanDirectory(SOURCE_DIR);
  console.log(`找到 ${skillFiles.length} 个 .md 文件\n`);

  let created = 0;
  let errors = 0;
  const stats: Record<string, number> = {};

  for (const skillFile of skillFiles) {
    try {
      const content = fs.readFileSync(skillFile.absolutePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const description = lines.slice(0, 3).join(' ').substring(0, 200) || extractDisplayNameFromContent(content, skillFile.fileName);
      
      const name = normalizeName(skillFile.relativePath);
      const { category, techStack } = getConfig(skillFile.relativePath, content);
      
      stats[category] = (stats[category] || 0) + 1;
      
      await prisma.skill.create({
        data: {
          name,
          displayName: extractDisplayNameFromContent(content, skillFile.fileName),
          description: description.substring(0, 500),
          category,
          techStack: JSON.stringify(techStack),
          content,
          isBuiltin: true,
          userId: null,
        },
      });
      
      console.log(`✅ [${category}] ${name}${techStack.length ? ` (${techStack.join(', ')})` : ''}`);
      created++;
    } catch (err: any) {
      console.error(`❌ ${skillFile.relativePath}: ${err.message}`);
      errors++;
    }
  }

  console.log('\n========== 分类统计 ==========');
  for (const [cat, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\n总计: ${created}, 错误: ${errors}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
