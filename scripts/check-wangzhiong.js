const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // Check wangzhiong user
  const user = await prisma.user.findFirst({
    where: { username: 'wangzhiong' },
    include: {
      UserRole: {
        include: {
          Role: {
            include: {
              Permission: true
            }
          }
        }
      }
    }
  });
  
  if (user) {
    console.log('User:', user.email, '/', user.username);
    console.log('Roles:', user.UserRole.map(ur => ur.Role.name).join(', '));
    
    const perms = user.UserRole.flatMap(ur => ur.Role.Permission.map(p => p.name));
    console.log('Total permissions:', perms.length);
    console.log('Has evaluation:create:', perms.includes('evaluation:create') ? 'YES' : 'NO');
    
    // Show all unique permissions
    const uniquePerms = [...new Set(perms)];
    console.log('Unique permissions:', uniquePerms.join(', '));
  } else {
    console.log('User not found');
  }
  
  await prisma.$disconnect();
}

check().catch(console.error);
