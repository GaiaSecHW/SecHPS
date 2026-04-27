// Test FSM workflow execution
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

async function getTestData() {
  // Get admin user
  const user = await prisma.user.findFirst({
    where: { email: 'admin@ai4web.com' },
    select: {
      id: true,
      email: true,
      username: true,
      UserRole: {
        include: {
          Role: {
            include: { Permission: true }
          }
        }
      }
    }
  });

  if (!user) {
    console.error('No admin user found');
    return null;
  }

  const permissions = user.UserRole.flatMap(ur => 
    ur.Role.Permission.map(p => `${p.module}:${p.action}`)
  );

  // Get FSM workflow
  const fsmWorkflow = await prisma.workflow.findFirst({
    where: { workflowType: 'fsm', isActive: true },
    select: { id: true, name: true, fsmTemplateId: true }
  });

  // Get DAG workflow
  const dagWorkflow = await prisma.workflow.findFirst({
    where: { workflowType: 'dag', isActive: true },
    select: { id: true, name: true }
  });

  // Get project
  const project = await prisma.project.findFirst({
    where: { projectPath: { not: null } },
    select: { id: true, name: true, projectPath: true, userId: true }
  });

  // Get model config
  const modelConfig = await prisma.modelConfig.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, providerType: true, models: true }
  });

  // Get FSM Template
  const fsmTemplate = await prisma.fSMTemplate.findFirst({
    select: { id: true, name: true, displayName: true }
  });

  return {
    user: { id: user.id, email: user.email, permissions },
    fsmWorkflow,
    dagWorkflow,
    project,
    modelConfig,
    fsmTemplate
  };
}

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, permissions: user.permissions },
    process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    { expiresIn: '1h' }
  );
}

async function main() {
  const data = await getTestData();
  
  if (!data) {
    console.error('Failed to get test data');
    process.exit(1);
  }

  console.log('\n=== Test Data ===');
  console.log('User:', data.user.email, `(${data.user.id})`);
  console.log('FSM Workflow:', data.fsmWorkflow?.name, `(${data.fsmWorkflow?.id})`);
  console.log('FSM Template:', data.fsmTemplate?.displayName, `(${data.fsmTemplate?.id})`);
  console.log('DAG Workflow:', data.dagWorkflow?.name, `(${data.dagWorkflow?.id})`);
  console.log('Project:', data.project?.name, `(${data.project?.id})`);
  console.log('Model:', data.modelConfig?.name, `(${data.modelConfig?.id})`);
  
  if (data.user) {
    const token = generateToken(data.user);
    console.log('\n=== JWT Token ===');
    console.log(token.substring(0, 50) + '...');
    
    // Write token to file for easy access
    const fs = require('fs');
    fs.writeFileSync('tmp-test-token.txt', token);
    console.log('Token saved to tmp-test-token.txt');
  }

  // Write test data to JSON for other scripts
  const fs = require('fs');
  fs.writeFileSync('tmp-test-data.json', JSON.stringify(data, null, 2));
  console.log('Test data saved to tmp-test-data.json');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());