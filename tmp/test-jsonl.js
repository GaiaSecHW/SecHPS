const { createEvaluationMessageStore } = require('./src/services/evaluation-message-store.ts');

async function test() {
  try {
    const projectId = 'proj-1776595278830-rzkr0u9da';
    const sessionId = 'eval-1776918813706-o0cymfcxu';
    
    const store = createEvaluationMessageStore(projectId, sessionId);
    const exists = await store.exists();
    console.log('Exists:', exists);
    
    if (exists) {
      const messages = await store.getMessages({ limit: 10 });
      console.log('Messages:', messages.total);
    } else {
      console.log('No JSONL files, should fallback to Prisma');
    }
  } catch (e) {
    console.error('Error:', e.message);
    console.error('Stack:', e.stack);
  }
}

test();