import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🔑 重置管理员密码...');

  const adminEmail = 'admin@ai4web.com';
  const newPassword = 'admin123'; // 可以修改为新密码

  // 查找管理员账户
  const admin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!admin) {
    console.error('❌ 管理员账户不存在');
    console.log('提示: 请先运行 npm run db:seed 创建管理员账户');
    process.exit(1);
  }

  // 生成新密码哈希
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // 更新密码
  await prisma.user.update({
    where: { email: adminEmail },
    data: { passwordHash },
  });

  console.log('✅ 管理员密码已重置');
  console.log(`   邮箱: ${adminEmail}`);
  console.log(`   新密码: ${newPassword}`);
}

main()
  .catch((e) => {
    console.error('❌ 重置失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
