// Check evaluation results
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  // Read evaluation ID from file if exists
  let evaluationId;
  try {
    evaluationId = fs.readFileSync('tmp-evaluation-id.txt', 'utf-8').trim();
  } catch {
    // Get latest evaluation
    const latest = await prisma.evaluationSession.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    });
    evaluationId = latest?.id;
  }

  if (!evaluationId) {
    console.error('No evaluation ID found');
    process.exit(1);
  }

  console.log(`\n=== Checking Evaluation: ${evaluationId} ===`);

  // Get evaluation session
  const session = await prisma.evaluationSession.findUnique({
    where: { id: evaluationId },
    select: {
      id: true,
      status: true,
      workflowType: true,
      startedAt: true,
      completedAt: true,
      totalInputTokens: true,
      totalOutputTokens: true,
      totalTokens: true,
      endReason: true,
      endMessage: true,
      errorMessage: true,
      createdAt: true
    }
  });

  console.log('\n--- Session ---');
  console.log(JSON.stringify(session, null, 2));

  // Get node executions
  const nodeExecutions = await prisma.nodeExecution.findMany({
    where: { evaluationSessionId: evaluationId },
    select: {
      id: true,
      workflowNodeId: true,
      nodeLabel: true,
      nodeType: true,
      status: true,
      order: true,
      modelName: true,
      startedAt: true,
      completedAt: true
    },
    orderBy: { order: 'asc' }
  });

  console.log('\n--- Node Executions ---');
  console.log(`Count: ${nodeExecutions.length}`);
  for (const exec of nodeExecutions) {
    console.log(`  ${exec.order}: ${exec.nodeLabel} (${exec.status}) - model: ${exec.modelName || 'N/A'}`);
  }

  // Get session messages
  const messages = await prisma.sessionMessage.findMany({
    where: { evaluationSessionId: evaluationId },
    select: {
      id: true,
      workflowNodeId: true,
      role: true,
      content: true,
      createdAt: true
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log('\n--- Session Messages ---');
  console.log(`Count: ${messages.length}`);
  for (const msg of messages.slice(0, 5)) {
    const contentPreview = msg.content.substring(0, 100);
    console.log(`  ${msg.role}: ${contentPreview}...`);
  }

  // Summary
  console.log('\n=== Summary ===');
  const allNodesCompleted = nodeExecutions.every(n => n.status === 'completed');
  const hasTokens = session.totalInputTokens > 0 || session.totalOutputTokens > 0;
  const hasMessages = messages.length > 0;
  
  console.log(`Status: ${session.status}`);
  console.log(`All nodes completed: ${allNodesCompleted ? '✓' : '✗'}`);
  console.log(`Has tokens: ${hasTokens ? '✓' : '✗'} (${session.totalInputTokens}/${session.totalOutputTokens})`);
  console.log(`Has messages: ${hasMessages ? '✓' : '✗'} (${messages.length})`);
  
  if (session.status === 'completed' && allNodesCompleted) {
    console.log('\n✓ TEST PASSED');
  } else {
    console.log('\n✗ TEST FAILED or INCOMPLETE');
    if (session.errorMessage) {
      console.log('Error:', session.errorMessage);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());