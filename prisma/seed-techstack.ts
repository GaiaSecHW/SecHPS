// prisma/seed-techstack.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TECHSTACK_DATA = [
  // 编程语言
  { name: 'Python', category: 'language', description: 'Python 编程语言', sortOrder: 1 },
  { name: 'Java', category: 'language', description: 'Java 编程语言', sortOrder: 2 },
  { name: 'JavaScript', category: 'language', description: 'JavaScript 编程语言', sortOrder: 3 },
  { name: 'TypeScript', category: 'language', description: 'TypeScript 编程语言', sortOrder: 4 },
  { name: 'C', category: 'language', description: 'C 编程语言', sortOrder: 5 },
  { name: 'C++', category: 'language', description: 'C++ 编程语言', sortOrder: 6 },
  { name: 'C#', category: 'language', description: 'C# 编程语言', sortOrder: 7 },
  { name: 'PHP', category: 'language', description: 'PHP 编程语言', sortOrder: 8 },
  { name: 'Ruby', category: 'language', description: 'Ruby 编程语言', sortOrder: 9 },
  { name: 'Go', category: 'language', description: 'Go 编程语言', sortOrder: 10 },
  { name: 'Rust', category: 'language', description: 'Rust 编程语言', sortOrder: 11 },
  ];

async function main() {
  console.log('开始初始化技术栈数据...');

  for (const data of TECHSTACK_DATA) {
    const existing = await prisma.techStackOption.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      console.log(`技术栈 "${data.name}" 已存在，跳过`);
      continue;
    }

    await prisma.techStackOption.create({
      data: {
        ...data,
        isBuiltin: false,  // 允许删除所有技术栈
        isActive: true,
      },
    });
    console.log(`创建技术栈: ${data.name}`);
  }

  console.log('技术栈数据初始化完成！');
}

main()
  .catch((e) => {
    console.error('初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
