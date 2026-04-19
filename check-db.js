const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // 检查 Skill 表的 category 值
  console.log("=== Skill 表的 category 值 ===");
  const skillCategories = await prisma.skill.findMany({
    select: { id: true, name: true, category: true },
    take: 10,
  });
  console.log("Skill 数量:", await prisma.skill.count());
  skillCategories.forEach(s => {
    console.log(`  ${s.name}: category="${s.category}"`);
  });

  // 检查 VulnerabilityCategory 的 value 值
  console.log("\n=== VulnerabilityCategory 的 value ===");
  const cats = await prisma.vulnerabilityCategory.findMany({
    select: { value: true, label: true },
    orderBy: { sortOrder: "asc" },
  });
  cats.forEach(c => {
    console.log(`  ${c.value} -> ${c.label}`);
  });

  // 检查 VulnerabilityPattern 的 category 值
  console.log("\n=== VulnerabilityPattern 的 category 值 ===");
  const patterns = await prisma.vulnerabilityPattern.findMany({
    select: { name: true, category: true },
    take: 10,
  });
  patterns.forEach(p => {
    console.log(`  ${p.name}: category="${p.category}"`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
