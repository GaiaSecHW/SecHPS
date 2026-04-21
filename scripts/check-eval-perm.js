const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // Check if evaluation:create permission exists
  const perm = await prisma.permission.findFirst({
    where: { name: 'evaluation:create' }
  });
  console.log('Permission evaluation:create:', perm ? 'EXISTS' : 'NOT FOUND');
  
  // Check admin user and roles
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@ai4web.com' },
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
  
  if (adminUser) {
    console.log('Admin user found:', adminUser.email);
    console.log('Roles:', adminUser.UserRole.map(ur => ur.Role.name).join(', '));
    const perms = adminUser.UserRole.flatMap(ur => ur.Role.Permission.map(p => p.name));
    console.log('Has evaluation:create:', perms.includes('evaluation:create') ? 'YES' : 'NO');
    console.log('Total permissions:', perms.length);
    
    // Show first 20 permissions
    console.log('First 20 permissions:', [...new Set(perms)].slice(0, 20).join(', '));
  } else {
    console.log('Admin user NOT FOUND');
  }
  
  // List all permissions
  const allPerms = await prisma.permission.findMany({
    select: { name: true }
  });
  console.log('\nTotal permissions in DB:', allPerms.length);
  console.log('All permission names:', allPerms.map(p => p.name).join(', '));
  
  await prisma.$disconnect();
}

check().catch(console.error);
