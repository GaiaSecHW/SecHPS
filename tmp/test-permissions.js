const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    // 1. 获取所有用户
    const users = await prisma.user.findMany({
      select: { id: true, name: true, username: true },
      take: 5,
    });
    
    console.log('=== 用户列表 ===');
    for (const user of users) {
      console.log(`用户: ${user.name || user.username}, ID: ${user.id}`);
      
      // 2. 获取用户创建的项目
      const projects = await prisma.project.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, userId: true },
        take: 3,
      });
      
      console.log(`  项目数量: ${projects.length}`);
      for (const proj of projects) {
        console.log(`    - ${proj.name} (userId: ${proj.userId})`);
        
        // 3. 获取项目的评估会话
        const evaluations = await prisma.evaluationSession.findMany({
          where: { projectId: proj.id },
          select: { id: true, projectId: true, status: true },
          take: 3,
        });
        
        console.log(`      评估会话数量: ${evaluations.length}`);
        for (const eval of evaluations) {
          console.log(`        - ${eval.id} (status: ${eval.status})`);
          
          // 4. 测试 execute route 的查询条件
          const result = await prisma.evaluationSession.findFirst({
            where: { id: eval.id, Project: { userId: user.id } },
            include: { Project: { select: { userId: true, name: true } } },
          });
          
          if (result) {
            console.log(`          OK: 查询成功 (Project: ${result.Project.name}, userId: ${result.Project.userId})`);
          } else {
            console.log(`          FAIL: 查询失败 - 权限问题`);
            
            // 检查原因
            const evalOnly = await prisma.evaluationSession.findUnique({
              where: { id: eval.id },
              include: { Project: { select: { userId: true, name: true } } },
            });
            
            if (evalOnly) {
              console.log(`          原因: Project.userId (${evalOnly.Project.userId}) != 用户 ID (${user.id})`);
            }
          }
        }
      }
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();