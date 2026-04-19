const { PrismaClient } = require('../node_modules/.prisma/client');
const p = new PrismaClient();

async function main() {
  const all = await p.techStackOption.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  const active = all.filter(o => o.isActive);
  const inactive = all.filter(o => !o.isActive);

  console.log('=== TechStackOption 统计 ===');
  console.log('总数:', all.length);
  console.log('激活 (isActive=true):', active.length);
  console.log('禁用 (isActive=false):', inactive.length);

  const byCategory = {};
  all.forEach(o => {
    if (!byCategory[o.category]) byCategory[o.category] = { active: [], inactive: [] };
    o.isActive ? byCategory[o.category].active.push(o.name) : byCategory[o.category].inactive.push(o.name);
  });

  console.log('\n=== 按分类统计 ===');
  for (const [cat, data] of Object.entries(byCategory)) {
    console.log(`\n[${cat}] 激活:${data.active.length} 禁用:${data.inactive.length}`);
    console.log('  激活:', data.active.join(', '));
    if (data.inactive.length > 0) console.log('  禁用:', data.inactive.join(', '));
  }
}

main().catch(console.error).finally(() => p.$disconnect());
