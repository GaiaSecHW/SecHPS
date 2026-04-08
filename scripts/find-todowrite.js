const { getSessionMessages } = require('@anthropic-ai/claude-agent-sdk');

async function findTodoWrite() {
  const sessionId = 'ae16d68e-6171-4095-a955-4cabd0bd925b';
  const projectPath = 'd:\\temp\\projects\\1775402410953';
  
  console.log('Getting messages from session:', sessionId);
  const msgs = await getSessionMessages(sessionId, { dir: projectPath });
  
  console.log('Total messages:', msgs.length);
  console.log('\nSearching for TodoWrite...\n');
  
  let found = false;
  
  msgs.forEach((m, i) => {
    if (m.message?.content && Array.isArray(m.message.content)) {
      m.message.content.forEach((c, j) => {
        if (c.type === 'tool_use') {
          console.log(`Message ${i}, Part ${j}:`, c.name);
          
          if (c.name === 'TodoWrite' || c.name.includes('todo') || c.name.includes('Todo')) {
            found = true;
            console.log('  ✓ FOUND TodoWrite!');
            console.log('  Input:', JSON.stringify(c.input, null, 2));
          }
        }
      });
    }
  });
  
  if (!found) {
    console.log('\n❌ No TodoWrite found in messages');
    console.log('\nShowing all tool names:');
    const toolNames = new Set();
    msgs.forEach(m => {
      if (m.message?.content && Array.isArray(m.message.content)) {
        m.message.content.forEach(c => {
          if (c.type === 'tool_use') {
            toolNames.add(c.name);
          }
        });
      }
    });
    console.log('Tools found:', Array.from(toolNames).join(', '));
  }
}

findTodoWrite().catch(console.error);
