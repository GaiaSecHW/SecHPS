/**
 * 用户数据迁移脚本
 * 将源数据库的用户表迁移到目标数据库，并分配 user 角色
 * 
 * 使用方法:
 *   npx ts-node scripts/migrate-users.ts <源数据库路径> <目标数据库路径>
 * 
 * 示例:
 *   npx ts-node scripts/migrate-users.ts ./prisma/source.db ./prisma/dev.db
 */

import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('用法: npx ts-node scripts/migrate-users.ts <源数据库路径> <目标数据库路径>');
  console.error('示例: npx ts-node scripts/migrate-users.ts ./prisma/source.db ./prisma/dev.db');
  process.exit(1);
}

const sourceDbPath = path.resolve(args[0]);
const targetDbPath = path.resolve(args[1]);

if (!fs.existsSync(sourceDbPath)) {
  console.error(`错误: 源数据库不存在: ${sourceDbPath}`);
  process.exit(1);
}

if (!fs.existsSync(targetDbPath)) {
  console.error(`错误: 目标数据库不存在: ${targetDbPath}`);
  process.exit(1);
}

console.log('=== 用户迁移 ===');
console.log(`源: ${sourceDbPath}`);
console.log(`目标: ${targetDbPath}\n`);

const sourcePrisma = new PrismaClient({
  datasources: { db: { url: `file:${sourceDbPath}` } }
});

const targetPrisma = new PrismaClient({
  datasources: { db: { url: `file:${targetDbPath}` } }
});

async function migrate() {
  try {
    // 获取 user 角色
    const userRole = await targetPrisma.role.findUnique({ where: { name: 'user' } });
    if (!userRole) {
      console.error('错误: 目标数据库缺少 user 角色，请先运行 npm run db:seed');
      process.exit(1);
    }

    // 读取源用户
    const users = await sourcePrisma.user.findMany();
    console.log(`源数据库用户数: ${users.length}\n`);

    if (users.length === 0) {
      console.log('无用户数据，结束');
      return;
    }

    let created = 0, skipped = 0, errors = 0;

    for (const user of users) {
      try {
        // 检查是否存在
        const existing = await targetPrisma.user.findFirst({
          where: { OR: [{ email: user.email }, { username: user.username }] }
        });

        if (existing) {
          console.log(`跳过: ${user.email}`);
          skipped++;
          continue;
        }

        // 创建用户 + 分配 user 角色
        await targetPrisma.user.create({
          data: {
            id: user.id,
            email: user.email,
            username: user.username,
            passwordHash: user.passwordHash,
            name: user.name,
            avatar: user.avatar,
            isActive: user.isActive,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            UserRole: {
              create: {
                roleId: userRole.id,
              }
            }
          }
        });

        console.log(`成功: ${user.email}`);
        created++;

      } catch (err) {
        console.error(`错误: ${user.email} - ${err instanceof Error ? err.message : err}`);
        errors++;
      }
    }

    console.log(`\n=== 完成 ===`);
    console.log(`成功: ${created} | 跳过: ${skipped} | 错误: ${errors}`);

  } catch (err) {
    console.error('迁移失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await sourcePrisma.$disconnect();
    await targetPrisma.$disconnect();
  }
}

migrate();