/**
 * SkillCategory + VulnerabilityTree seed 脚本
 *
 * 用法: npx tsx db/seed-skill-dimensions.ts
 */

import { PrismaClient } from '@prisma/client';

const pg = new PrismaClient();

const CATEGORIES = [
  { id: 'cat-vulnerability-mining', name: 'vulnerability-mining', displayName: '漏洞挖掘', description: '安全漏洞检测与挖掘', icon: 'Bug', sortOrder: 0, hasSubDimension: true },
  { id: 'cat-code-audit', name: 'code-audit', displayName: '代码审计', description: '代码安全审计与分析', icon: 'Search', sortOrder: 1, hasSubDimension: false },
  { id: 'cat-threat-modeling', name: 'threat-modeling', displayName: '威胁建模', description: '威胁建模与风险评估', icon: 'Shield', sortOrder: 2, hasSubDimension: false },
  { id: 'cat-coding', name: 'coding', displayName: '编程开发', description: '编程与开发辅助', icon: 'Code', sortOrder: 3, hasSubDimension: false },
  { id: 'cat-planning', name: 'planning', displayName: '规划设计', description: '架构设计与规划', icon: 'LayoutDashboard', sortOrder: 4, hasSubDimension: false },
  { id: 'cat-data-analysis', name: 'data-analysis', displayName: '数据分析', description: '数据分析与处理', icon: 'TrendUp', sortOrder: 5, hasSubDimension: false },
];

const VULNERABILITY_TREE = [
  // 语言节点
  { id: 'vt-java', name: 'java', displayName: 'Java', type: 'language', sortOrder: 0 },
  { id: 'vt-python', name: 'python', displayName: 'Python', type: 'language', sortOrder: 1 },
  { id: 'vt-cpp', name: 'cpp', displayName: 'C/C++', type: 'language', sortOrder: 2 },
  { id: 'vt-go', name: 'go', displayName: 'Go', type: 'language', sortOrder: 3 },
  { id: 'vt-javascript', name: 'javascript', displayName: 'JavaScript', type: 'language', sortOrder: 4 },
  { id: 'vt-php', name: 'php', displayName: 'PHP', type: 'language', sortOrder: 5 },
  { id: 'vt-rust', name: 'rust', displayName: 'Rust', type: 'language', sortOrder: 6 },
  { id: 'vt-general', name: 'general', displayName: '通用', type: 'language', sortOrder: 99 },

  // Java 模式
  { id: 'vt-java-deserialization', name: 'deserialization', displayName: '反序列化', type: 'pattern', parentId: 'vt-java', sortOrder: 0 },
  { id: 'vt-java-sqli-mybatis', name: 'sqli-mybatis', displayName: 'SQL注入(MyBatis)', type: 'pattern', parentId: 'vt-java', sortOrder: 1 },
  { id: 'vt-java-ssrf', name: 'ssrf', displayName: 'SSRF', type: 'pattern', parentId: 'vt-java', sortOrder: 2 },
  { id: 'vt-java-xss', name: 'xss', displayName: 'XSS', type: 'pattern', parentId: 'vt-java', sortOrder: 3 },
  { id: 'vt-java-rce', name: 'rce', displayName: 'RCE/命令注入', type: 'pattern', parentId: 'vt-java', sortOrder: 4 },
  { id: 'vt-java-path-traversal', name: 'path-traversal', displayName: '路径遍历', type: 'pattern', parentId: 'vt-java', sortOrder: 5 },

  // Python 模式
  { id: 'vt-python-ssti', name: 'ssti', displayName: '模板注入(SSTI)', type: 'pattern', parentId: 'vt-python', sortOrder: 0 },
  { id: 'vt-python-sqli', name: 'sqli', displayName: 'SQL注入', type: 'pattern', parentId: 'vt-python', sortOrder: 1 },
  { id: 'vt-python-code-exec', name: 'code-exec', displayName: '代码执行', type: 'pattern', parentId: 'vt-python', sortOrder: 2 },
  { id: 'vt-python-path-traversal', name: 'path-traversal', displayName: '路径遍历', type: 'pattern', parentId: 'vt-python', sortOrder: 3 },

  // C/C++ 模式
  { id: 'vt-cpp-buffer-overflow', name: 'buffer-overflow', displayName: '缓冲区溢出', type: 'pattern', parentId: 'vt-cpp', sortOrder: 0 },
  { id: 'vt-cpp-format-string', name: 'format-string', displayName: '格式化字符串', type: 'pattern', parentId: 'vt-cpp', sortOrder: 1 },
  { id: 'vt-cpp-memory-leak', name: 'memory-leak', displayName: '内存泄漏', type: 'pattern', parentId: 'vt-cpp', sortOrder: 2 },

  // Go 模式
  { id: 'vt-go-sqli', name: 'sqli', displayName: 'SQL注入', type: 'pattern', parentId: 'vt-go', sortOrder: 0 },
  { id: 'vt-go-ssrf', name: 'ssrf', displayName: 'SSRF', type: 'pattern', parentId: 'vt-go', sortOrder: 1 },

  // JavaScript 模式
  { id: 'vt-js-xss', name: 'xss', displayName: 'XSS', type: 'pattern', parentId: 'vt-javascript', sortOrder: 0 },
  { id: 'vt-js-prototype-pollution', name: 'prototype-pollution', displayName: '原型链污染', type: 'pattern', parentId: 'vt-javascript', sortOrder: 1 },
  { id: 'vt-js-sqli', name: 'sqli', displayName: 'SQL注入(NoSQL)', type: 'pattern', parentId: 'vt-javascript', sortOrder: 2 },

  // PHP 模式
  { id: 'vt-php-sqli', name: 'sqli', displayName: 'SQL注入', type: 'pattern', parentId: 'vt-php', sortOrder: 0 },
  { id: 'vt-php-file-inclusion', name: 'file-inclusion', displayName: '文件包含', type: 'pattern', parentId: 'vt-php', sortOrder: 1 },
  { id: 'vt-php-rce', name: 'rce', displayName: 'RCE/命令注入', type: 'pattern', parentId: 'vt-php', sortOrder: 2 },

  // 通用模式
  { id: 'vt-general-weak-password', name: 'weak-password', displayName: '弱口令', type: 'pattern', parentId: 'vt-general', sortOrder: 0 },
  { id: 'vt-general-auth-bypass', name: 'auth-bypass', displayName: '越权访问', type: 'pattern', parentId: 'vt-general', sortOrder: 1 },
  { id: 'vt-general-info-leak', name: 'info-leak', displayName: '信息泄露', type: 'pattern', parentId: 'vt-general', sortOrder: 2 },
  { id: 'vt-general-csrf', name: 'csrf', displayName: 'CSRF', type: 'pattern', parentId: 'vt-general', sortOrder: 3 },
  { id: 'vt-general-insecure-deserialization', name: 'insecure-deserialization', displayName: '不安全反序列化', type: 'pattern', parentId: 'vt-general', sortOrder: 4 },
];

async function seed() {
  console.log('🌱 Seeding SkillCategory + VulnerabilityTree...\n');

  for (const cat of CATEGORIES) {
    await pg.skillCategory.upsert({
      where: { id: cat.id },
      update: {},
      create: { ...cat, isActive: true, createdAt: new Date(), updatedAt: new Date() },
    });
  }
  console.log(`✅ ${CATEGORIES.length} SkillCategory created`);

  for (const vt of VULNERABILITY_TREE) {
    await pg.vulnerabilityTree.upsert({
      where: { id: vt.id },
      update: {},
      create: { ...vt, isActive: true, createdAt: new Date(), updatedAt: new Date(), description: null },
    });
  }
  console.log(`✅ ${VULNERABILITY_TREE.length} VulnerabilityTree created`);

  await pg.$disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
