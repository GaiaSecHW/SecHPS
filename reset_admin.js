const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function resetPassword() {
  // Reset admin password
  const hash = await bcrypt.hash('admin123', 10);
  
  await prisma.user.updateMany({
    where: { username: 'admin' },
    data: { passwordHash: hash, isActive: true }
  });
  
  await prisma.user.updateMany({
    where: { username: 'icsl_user' },
    data: { passwordHash: hash, isActive: true }
  });
  
  await prisma.user.updateMany({
    where: { username: 'team_a_user' },
    data: { passwordHash: hash, isActive: true }
  });
  
  console.log('Passwords reset to admin123');
  
  // Query users
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, tenantId: true }
  });
  console.log('Users:', JSON.stringify(users, null, 2));
}

resetPassword().catch(console.error).finally(() => prisma.$disconnect());
