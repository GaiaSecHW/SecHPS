/**
 * TechStackOption 种子数据
 * 23 个技术栈：9 语言 + 14 框架
 */
import { prisma } from '../src/lib/prisma';

const techStacks = [
  // === 语言类 (9个) ===
  { id: 'ts_java', name: 'java', category: 'language', description: 'Java 语言', isBuiltin: true },
  { id: 'ts_python', name: 'python', category: 'language', description: 'Python 语言', isBuiltin: true },
  { id: 'ts_php', name: 'php', category: 'language', description: 'PHP 语言', isBuiltin: true },
  { id: 'ts_javascript', name: 'javascript', category: 'language', description: 'JavaScript/Node.js', isBuiltin: true },
  { id: 'ts_go', name: 'go', category: 'language', description: 'Go 语言', isBuiltin: true },
  { id: 'ts_dotnet', name: 'dotnet', category: 'language', description: '.NET/C#', isBuiltin: true },
  { id: 'ts_ruby', name: 'ruby', category: 'language', description: 'Ruby 语言', isBuiltin: true },
  { id: 'ts_rust', name: 'rust', category: 'language', description: 'Rust 语言', isBuiltin: true },
  { id: 'ts_cpp', name: 'cpp', category: 'language', description: 'C/C++', isBuiltin: true },
  
  // === 框架类 (14个) ===
  { id: 'ts_spring', name: 'spring', category: 'framework', description: 'Spring Framework', isBuiltin: true },
  { id: 'ts_django', name: 'django', category: 'framework', description: 'Django', isBuiltin: true },
  { id: 'ts_flask', name: 'flask', category: 'framework', description: 'Flask', isBuiltin: true },
  { id: 'ts_express', name: 'express', category: 'framework', description: 'Express.js', isBuiltin: true },
  { id: 'ts_fastapi', name: 'fastapi', category: 'framework', description: 'FastAPI', isBuiltin: true },
  { id: 'ts_gin', name: 'gin', category: 'framework', description: 'Gin (Go)', isBuiltin: true },
  { id: 'ts_laravel', name: 'laravel', category: 'framework', description: 'Laravel', isBuiltin: true },
  { id: 'ts_rails', name: 'rails', category: 'framework', description: 'Ruby on Rails', isBuiltin: true },
  { id: 'ts_koa', name: 'koa', category: 'framework', description: 'Koa', isBuiltin: true },
  { id: 'ts_nestjs', name: 'nestjs', category: 'framework', description: 'NestJS', isBuiltin: true },
  { id: 'ts_mybatis', name: 'mybatis', category: 'framework', description: 'MyBatis', isBuiltin: true },
  { id: 'ts_java_web', name: 'java-web', category: 'framework', description: 'Java Web 通用', isBuiltin: true },
  { id: 'ts_dotnet_web', name: 'dotnet-web', category: 'framework', description: '.NET Web', isBuiltin: true },
  { id: 'ts_rust_web', name: 'rust-web', category: 'framework', description: 'Rust Web', isBuiltin: true },
];

async function seedTechStack() {
  console.log('开始导入 TechStackOption...');
  const now = new Date();
  
  try {
    for (const ts of techStacks) {
      await prisma.techStackOption.upsert({
        where: { id: ts.id },
        update: { ...ts, updatedAt: now },
        create: { ...ts, updatedAt: now, createdAt: now },
      });
    }
    
    const count = await prisma.techStackOption.count();
    console.log(`✓ 导入完成，共 ${count} 条记录`);
  } catch (error) {
    console.error('导入失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedTechStack();
