const fs = require('fs');
const path = require('path');

const streamFile = path.join('data/sessions', 'proj-1777021450958-ow16z9t27', 'eval-1777268403518-z8x6rv8gu', 'node-wn-1777050632034-lke4zm0b2', 'stream.jsonl');

const content = fs.readFileSync(streamFile, 'utf8');
const lines = content.split('\n').filter(l => l.trim());

console.log('=== Stream.jsonl 分析 ===');
console.log('总行数:', lines.length);

// 搜索 skill 相关事件
const skillEvents = [];
lines.forEach((l, i) => {
  try {
    const obj = JSON.parse(l);
    if (obj.data && (obj.data.skill || obj.data.skillName || obj.data.currentSkill || obj.data.skillIndex !== undefined)) {
      skillEvents.push({
        lineNum: i + 1,
        skill: obj.data.skill || obj.data.skillName || obj.data.currentSkill,
        index: obj.data.skillIndex,
        total: obj.data.totalSkills,
        status: obj.data.status,
      });
    }
  } catch(e) {}
});

console.log('\n=== Skill 执行事件 ===');
console.log('找到', skillEvents.length, '个 skill 事件');

skillEvents.forEach((e, i) => {
  console.log(`${i+1}. 行${e.lineNum}: skill="${e.skill}", index=${e.index || '?'}/${e.total || '?'}, status=${e.status || '?'}`);
});

// 搜索进度消息
const progressMessages = [];
lines.forEach((l, i) => {
  try {
    const obj = JSON.parse(l);
    if (obj.data && obj.data.text) {
      const text = obj.data.text;
      if (text.includes('正在执行') || text.includes('执行完成') || text.includes('skill') || text.includes('Skill')) {
        progressMessages.push({
          lineNum: i + 1,
          text: text.substring(0, 150),
        });
      }
    }
  } catch(e) {}
});

console.log('\n=== 进度消息 ===');
console.log('找到', progressMessages.length, '个进度消息');

// 只显示关键消息
const keyMessages = progressMessages.filter(m => 
  m.text.includes('开始') || 
  m.text.includes('完成') || 
  m.text.includes('继续') ||
  m.text.includes('第') ||
  m.text.includes('正在')
);

keyMessages.slice(0, 20).forEach((m, i) => {
  console.log(`${i+1}. 行${m.lineNum}: ${m.text}`);
});

// 检查最后的状态
console.log('\n=== 最后 10 行的文本内容 ===');
lines.slice(-10).forEach((l, i) => {
  try {
    const obj = JSON.parse(l);
    if (obj.data && obj.data.text) {
      console.log(`${i+1}: ${obj.data.text.substring(0, 200)}`);
    }
  } catch(e) {}
});