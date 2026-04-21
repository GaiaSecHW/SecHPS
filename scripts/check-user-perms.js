const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // Check all users
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true },
  });
  console.log('All users:', JSON.stringify(users, null, 2));
  
  // Check role 'user' permissions
  const userRole = await prisma.role.findFirst({
    where: { name: 'user' },
    include: { Permission: true }
  });
  console.log('\nRole "user" has', userRole?.Permission.length || 0, 'permissions');
  console.log('Permissions:', userRole?.Permission.map(p => p.name).join(', ') || 'NONE');
  
  // Check if evaluation:create is in user role
  const hasEvalCreate = userRole?.Permission.some(p => p.name === 'evaluation:create');
  console.log('\nRole "user" has evaluation:create:', hasEvalCreate ? 'YES' : 'NO');
  
  await prisma.$disconnect();
}

check().catch(console.error);
