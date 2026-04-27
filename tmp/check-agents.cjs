const fs = require('fs');
const path = require('path');

const sessionDir = path.join('data/sessions', 'proj-1777021450958-ow16z9t27', 'eval-1777268403518-z8x6rv8gu');
const agentsDir = path.join(sessionDir, 'node-wn-1777050632034-lke4zm0b2', 'agents');

console.log('=== Agents 目录详情 ===');
console.log('路径:', agentsDir);

if (fs.existsSync(agentsDir)) {
  const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true });
  console.log('子Agent数量:', agentDirs.length);
  
  agentDirs.forEach((d, i) => {
    console.log(`\n${i+1}. ${d.name}`);
    
    if (d.isDirectory()) {
      const agentPath = path.join(agentsDir, d.name);
      const files = fs.readdirSync(agentPath);
      
      files.forEach(f => {
        const filePath = path.join(agentPath, f);
        const stat = fs.statSync(filePath);
        
        console.log(`    ${f} (${stat.size} bytes)`);
        
        // 如果是 json 文件，读取内容
        if (f.endsWith('.json') && stat.size < 5000) {
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (content.status) {
              console.log(`      status: ${content.status}`);
            }
            if (content.skillName) {
              console.log(`      skillName: ${content.skillName}`);
            }
            if (content.progress) {
              console.log(`      progress: ${JSON.stringify(content.progress)}`);
            }
          } catch(e) {}
        }
      });
    }
  });
}

// 检查 stream.jsonl 文件（可能有进度信息）
const streamFile = path.join(sessionDir, 'node-wn-1777050632034-lke4zm0b2', 'stream.jsonl');
if (fs.existsSync(streamFile)) {
  const streamContent = fs.readFileSync(streamFile, 'utf8');
  const lines = streamContent.split('\n').filter(l => l.trim());
  
  console.log('\n=== Stream.jsonl ===');
  console.log('行数:', lines.length);
  
  // 搜索进度相关的事件
  const progressEvents = lines.filter(l => l.includes('skill') || l.includes('progress') || l.includes('agent'));
  console.log('包含 skill/progress/agent 的行数:', progressEvents.length);
  
  // 显示最后几行
  console.log('\n最后 5 行:');
  lines.slice(-5).forEach(l => {
    try {
      const obj = JSON.parse(l);
      console.log('  type:', obj.type, '| data:', JSON.stringify(obj.data || {}).substring(0, 100));
    } catch(e) {
      console.log('  (parse error)');
    }
  });
}