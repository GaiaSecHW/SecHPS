// Test FSM/DAG evaluation execution
const fs = require('fs');
const http = require('http');

// Read test data
const testData = JSON.parse(fs.readFileSync('tmp-test-data.json', 'utf-8'));
const token = fs.readFileSync('tmp-test-token.txt', 'utf-8');

const projectId = testData.project?.id;
const modelId = testData.modelConfig?.id;

// Determine which workflow to test based on command arg
const workflowType = process.argv[2] || 'fsm'; // 'fsm' or 'dag'
const workflowId = workflowType === 'fsm' 
  ? testData.fsmWorkflow?.id 
  : testData.dagWorkflow?.id;

if (!projectId || !workflowId || !modelId) {
  console.error('Missing required data:', { projectId, workflowId, modelId });
  process.exit(1);
}

console.log(`\n=== Starting ${workflowType.toUpperCase()} Evaluation ===`);
console.log('Project:', projectId);
console.log('Workflow:', workflowId);
console.log('Model:', modelId);

// Send POST request
const requestBody = JSON.stringify({
  workflowId: workflowId,
  modelId: modelId
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/api/projects/${projectId}/start`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(requestBody)
  }
};

console.log('\nSending request...');

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));

  // Check if SSE stream
  const contentType = res.headers['content-type'];
  if (contentType && contentType.includes('text/event-stream')) {
    console.log('\n=== SSE Stream ===');
    let buffer = '';
    
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      // Process SSE events
      const lines = buffer.split('\n\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.substring(6));
            console.log('Event:', event.type, event);
            
            // Write evaluation ID for later checking
            if (event.type === 'started' || event.evaluationId) {
              fs.writeFileSync('tmp-evaluation-id.txt', event.evaluationId);
              console.log('\nEvaluation ID saved to tmp-evaluation-id.txt');
            }
            
            // Stop on completion
            if (event.type === 'done') {
              console.log('\n=== Workflow Completed ===');
              res.destroy();
              process.exit(0);
            }
          } catch (e) {
            console.log('Raw data:', line);
          }
        }
      }
      buffer = lines[lines.length - 1];
    });
    
    res.on('end', () => {
      console.log('\nStream ended');
      process.exit(0);
    });
  } else {
    // Regular JSON response
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log('\nResponse:', data);
      try {
        const json = JSON.parse(data);
        if (json.evaluationId) {
          fs.writeFileSync('tmp-evaluation-id.txt', json.evaluationId);
          console.log('Evaluation ID saved to tmp-evaluation-id.txt');
        }
      } catch (e) {}
      process.exit(res.statusCode === 200 || res.statusCode === 202 ? 0 : 1);
    });
  }
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
  process.exit(1);
});

req.write(requestBody);
req.end();

// Timeout handler
setTimeout(() => {
  console.log('\nTimeout reached (30 seconds)');
  process.exit(0);
}, 30000);