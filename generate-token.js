const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function generateToken() {
  const user = await prisma.user.findFirst({
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
  
  if (!user) {
    console.log('No user found');
    return;
  }
  
  const permissions = user.UserRole.flatMap(ur => 
    ur.Role.Permission.map(p => `${p.module}:${p.action}`)
  );
  
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      permissions
    },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '24h' }
  );
  
  console.log('Token:', token);
  console.log('User ID:', user.id);
  
  await prisma.$disconnect();
}

generateToken();
