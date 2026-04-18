// scripts/migrate-categories.ts
// 从 SystemConfig.skill_categories 迁移到 VulnerabilityCategory 表
// 并修复未关联的分类

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 未关联分类到已有分类的映射
const CATEGORY_MAPPING: Record<string, string> = {
  'auth': 'authentication',      // 认证相关
  'info': 'sensitive',           // 信息泄露
  'deserialization': 'injection', // 反序列化属于注入
  'logic': 'business-logic',     // 逻辑问题
  'api': 'injection',            // API 安全
  'supply-chain': 'components',  // 供应链安全
  'ai': 'other',                 // AI 安全
  'infra': 'configuration',      // 基础设施安全
  'mobile': 'other',             // 移动安全
  'frontend': 'input-validation', // 前端安全
};

async function main() {
  console.log('从 SystemConfig.skill_categories 迁移到 VulnerabilityCategory 表...');

  // 1. 清空 VulnerabilityCategory 表
  console.log('清空现有 VulnerabilityCategory 数据...');
  await prisma.vulnerabilityCategory.deleteMany({});
  
  // 2. 从 SystemConfig 获取原有分类数据
  const config = await prisma.systemConfig.findUnique({
    where: { key: 'skill_categories' },
  });

  if (!config) {
    console.log('SystemConfig.skill_categories 不存在！');
    return;
  }

  // 处理双重转义
  let value = config.value;
  if (value.includes('\\"')) {
    value = value.replace(/\\"/g, '"');
  }

  let categories: Array<{ value: string; label: string }> = [];
  try {
    categories = JSON.parse(value);
  } catch (e) {
    console.log('解析失败:', e);
    return;
  }

  console.log(`发现 ${categories.length} 个分类`);

  // 3. 插入原有分类数据
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    
    const created = await prisma.vulnerabilityCategory.create({
      data: {
        id: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        value: cat.value,
        label: cat.label,
        sortOrder: i,
        isActive: true,
        updatedAt: new Date(),
      },
    });

    console.log(`  ${created.id}: ${cat.value} -> ${cat.label}`);

    // 4. 更新 VulnerabilityPattern 的 categoryId
    const updateResult = await prisma.vulnerabilityPattern.updateMany({
      where: { category: cat.value },
      data: { categoryId: created.id },
    });

    if (updateResult.count > 0) {
      console.log(`    已关联 ${updateResult.count} 条漏洞模式`);
    }
  }

  // 5. 修复未关联的分类
  console.log('\n修复未关联的分类...');
  
  for (const [oldCategory, newCategory] of Object.entries(CATEGORY_MAPPING)) {
    // 查找新分类的 id
    const newCat = await prisma.vulnerabilityCategory.findUnique({
      where: { value: newCategory },
    });

    if (!newCat) {
      console.log(`  ⚠️ 分类 ${newCategory} 不存在，跳过 ${oldCategory}`);
      continue;
    }

    // 更新旧分类的漏洞模式
    const updateResult = await prisma.vulnerabilityPattern.updateMany({
      where: { category: oldCategory },
      data: { 
        categoryId: newCat.id,
        category: newCategory,  // 同时更新 category 字段
      },
    });

    if (updateResult.count > 0) {
      console.log(`  ${oldCategory} -> ${newCategory}: 修复 ${updateResult.count} 条`);
    }
  }

  // 6. 验证结果
  const finalCategories = await prisma.vulnerabilityCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  const totalPatterns = await prisma.vulnerabilityPattern.count();
  const linkedPatterns = await prisma.vulnerabilityPattern.count({
    where: { categoryId: { not: null } },
  });

  console.log('\n迁移完成！');
  console.log(`  - 分类数量: ${finalCategories.length}`);
  console.log(`  - 漏洞模式总数: ${totalPatterns}`);
  console.log(`  - 已关联分类: ${linkedPatterns}`);

  if (linkedPatterns < totalPatterns) {
    console.log(`\n⚠️ 还有 ${totalPatterns - linkedPatterns} 条未关联`);
    
    const unlinked = await prisma.vulnerabilityPattern.findMany({
      where: { categoryId: null },
      select: { name: true, category: true },
    });
    console.log('  未关联的:', [...new Set(unlinked.map(p => p.category))]);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
