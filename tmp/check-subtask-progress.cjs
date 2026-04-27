const fs = require('fs');
const path = require('path');

// 检查节点内部的子任务进度
function checkNodeSubtaskProgress(projectId, evaluationId, workflowNodeId, opencodeSessionId) {
  // stream.jsonl 路径
  const streamFile = path.join('data/sessions', projectId, evaluationId, `node-${workflowNodeId}`, 'stream.jsonl');
  
  if (!fs.existsSync(streamFile)) {
    return { hasSubtasks: false, completed: true };
  }
  
  const content = fs.readFileSync(streamFile, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  
  // 搜索 skill 执行请求
  const skillRequests = [];
  lines.forEach((l, i) => {
    try {
      const obj = JSON.parse(l);
      if (obj.data && obj.data.text && obj.data.text.includes('请执行 Skill:')) {
        // 提取 skill 名称
        const match = obj.data.text.match(/请执行 Skill: ([\w-]+)/);
        if (match) {
          skillRequests.push({
            skillName: match[1],
            lineNum: i + 1,
          });
        }
      }
    } catch(e) {}
  });
  
  // 搜索 skill 执行完成的消息
  const skillCompleted = [];
  lines.forEach((l, i) => {
    try {
      const obj = JSON.parse(l);
      if (obj.data && obj.data.text) {
        const text = obj.data.text;
        // 检查是否有完成消息
        if (text.includes('已完成') || text.includes('执行完成') || text.includes('报告结果')) {
          skillCompleted.push({
            lineNum: i + 1,
            text: text.substring(0, 100),
          });
        }
      }
    } catch(e) {}
  });
  
  // 分析进度
  const totalSkills = skillRequests.length;
  const lastSkillRequest = skillRequests[skillRequests.length - 1];
  const lastLineNum = lines.length;
  
  // 如果最后一个 skill 请求之后还有内容，说明还在执行
  const isExecuting = lastSkillRequest && lastLineNum > lastSkillRequest.lineNum + 10;
  
  return {
    hasSubtasks: totalSkills > 0,
    totalSkills,
    skillRequests: skillRequests.map(s => s.skillName),
    lastSkillRequest: lastSkillRequest?.skillName,
    lastLineNum,
    isExecuting,
    progress: `${skillCompleted.length}/${totalSkills}`,
  };
}

// 测试
const projectId = 'proj-1777021450958-ow16z9t27';
const evaluationId = 'eval-1777268403518-z8x6rv8gu';
const workflowNodeId = 'wn-1777050632034-lke4zm0b2';

const result = checkNodeSubtaskProgress(projectId, evaluationId, workflowNodeId, '177b6926-ca6b-4817-8420-a0816f63cffc');

console.log('=== 子任务进度分析 ===');
console.log('有子任务:', result.hasSubtasks);
console.log('总 skill 数:', result.totalSkills);
console.log('Skill 列表:', result.skillRequests);
console.log('最后请求的 skill:', result.lastSkillRequest);
console.log('是否还在执行:', result.isExecuting);
console.log('进度:', result.progress);
console.log('\n结论:', result.isExecuting ? '需要恢复继续执行' : '已完成或无需恢复');