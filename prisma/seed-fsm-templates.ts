import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 每个 P 阶段单独一个节点
const THREAT_MODELING_NODES = JSON.stringify([
  {
    id: 'fsm-node-p1',
    label: 'P1-项目理解',
    phase: 'P1',
    fsmPhase: 1,
    fsmFixed: true,
    fsmOrder: 1,
    skillPath: 'threat-modeling/phases/P1-PROJECT-UNDERSTANDING.md',
    description: '理解项目结构、技术栈、模块划分、入口点'
  },
  {
    id: 'fsm-node-p2',
    label: 'P2-DFD分析',
    phase: 'P2',
    fsmPhase: 2,
    fsmFixed: true,
    fsmOrder: 2,
    skillPath: 'threat-modeling/phases/P2-DFD-ANALYSIS.md',
    description: '绘制数据流图(DFD)，识别数据流向和存储'
  },
  {
    id: 'fsm-node-p3',
    label: 'P3-信任边界',
    phase: 'P3',
    fsmPhase: 3,
    fsmFixed: true,
    fsmOrder: 3,
    skillPath: 'threat-modeling/phases/P3-TRUST-BOUNDARY.md',
    description: '定义信任边界，识别跨边界数据流'
  },
  {
    id: 'fsm-node-p4',
    label: 'P4-安全设计评审',
    phase: 'P4',
    fsmPhase: 4,
    fsmFixed: true,
    fsmOrder: 4,
    skillPath: 'threat-modeling/phases/P4-SECURITY-DESIGN-REVIEW.md',
    description: '安全设计评审，识别安全缺口'
  },
  {
    id: 'fsm-node-p5',
    label: 'P5-STRIDE分析',
    phase: 'P5',
    fsmPhase: 5,
    fsmFixed: true,
    fsmOrder: 5,
    skillPath: 'threat-modeling/phases/P5-STRIDE-ANALYSIS.md',
    description: 'STRIDE威胁分析，识别潜在威胁'
  },
  {
    id: 'fsm-node-penetration',
    label: '渗透测试',
    phase: null,
    fsmPhase: 6,
    fsmFixed: false,
    fsmOrder: 6,
    skillPath: null,
    description: '用户自定义渗透测试Agent（自由编排）'
  },
  {
    id: 'fsm-node-p6',
    label: 'P6-报告生成',
    phase: 'P6',
    fsmPhase: 7,
    fsmFixed: true,
    fsmOrder: 7,
    skillPath: 'threat-modeling/phases/P6-REPORT-GENERATION.md',
    description: '生成完整威胁建模报告'
  }
]);

const THREAT_MODELING_AGENT_ZONE = JSON.stringify({
  position: 6,
  allowAdd: true,
  allowDelete: true,
  allowReorder: true,
  parallel: true,
  defaultAgents: [
    { id: 'sast-agent', name: 'SAST Agent', tool: 'Semgrep', output: 'vulnerabilities/sast-report.json' },
    { id: 'secret-scanner', name: 'Secret Scanner', tool: 'truffleHog', output: 'vulnerabilities/secrets-report.json' },
    { id: 'dep-scanner', name: 'Dependency Scanner', tool: 'Snyk', output: 'vulnerabilities/dependency-report.json' }
  ]
});

async function main() {
  console.log('Seeding FSM Templates...');

  const threatModeling = await prisma.fSMTemplate.upsert({
    where: { name: 'threat-modeling' },
    update: {
      displayName: '威胁建模分析',
      description: '固定流程：P1(项目理解) → P2(DFD分析) → P3(信任边界) → P4(安全评审) → P5(STRIDE) → 渗透测试 → P6(报告)',
      nodeCount: 7,
      nodes: THREAT_MODELING_NODES,
      agentZone: THREAT_MODELING_AGENT_ZONE,
      skillPath: 'skills/threat-modeling',
      version: '3.0.0',
      isActive: true,
      isBuiltin: true,
      updatedAt: new Date(),
    },
    create: {
      id: 'threat-modeling',
      name: 'threat-modeling',
      displayName: '威胁建模分析',
      description: '固定流程：P1(项目理解) → P2(DFD分析) → P3(信任边界) → P4(安全评审) → P5(STRIDE) → 渗透测试 → P6(报告)',
      nodeCount: 7,
      nodes: THREAT_MODELING_NODES,
      agentZone: THREAT_MODELING_AGENT_ZONE,
      skillPath: 'skills/threat-modeling',
      version: '3.0.0',
      isActive: true,
      isBuiltin: true,
      updatedAt: new Date(),
    },
  });

  console.log('Created FSM Template:', threatModeling.name);

  const codeAudit = await prisma.fSMTemplate.upsert({
    where: { name: 'code-audit' },
    update: {
      displayName: '代码审计',
      description: '固定流程：P1(代码理解) → P2(漏洞扫描) → P3(报告生成)',
      nodeCount: 3,
      nodes: JSON.stringify([
        { id: 'fsm-node-p1', label: 'P1-代码理解', phase: 'P1', fsmPhase: 1, fsmFixed: true, fsmOrder: 1, skillPath: 'code-audit/phases/P1', description: '代码结构和依赖分析' },
        { id: 'fsm-node-p2', label: 'P2-漏洞扫描', phase: 'P2', fsmPhase: 2, fsmFixed: true, fsmOrder: 2, skillPath: 'code-audit/phases/P2', description: '静态代码分析和漏洞检测' },
        { id: 'fsm-node-p3', label: 'P3-报告生成', phase: 'P3', fsmPhase: 3, fsmFixed: true, fsmOrder: 3, skillPath: 'code-audit/phases/P3', description: '审计报告生成' }
      ]),
      agentZone: JSON.stringify({ position: 2, allowAdd: true, parallel: true, defaultAgents: [{ id: 'semgrep', name: 'Semgrep', tool: 'Semgrep' }] }),
      skillPath: 'data/skills/code-audit',
      version: '2.0.0',
      isActive: true,
      isBuiltin: true,
      updatedAt: new Date(),
    },
    create: {
      id: 'code-audit',
      name: 'code-audit',
      displayName: '代码审计',
      description: '固定流程：P1(代码理解) → P2(漏洞扫描) → P3(报告生成)',
      nodeCount: 3,
      nodes: JSON.stringify([
        { id: 'fsm-node-p1', label: 'P1-代码理解', phase: 'P1', fsmPhase: 1, fsmFixed: true, fsmOrder: 1, skillPath: 'code-audit/phases/P1', description: '代码结构和依赖分析' },
        { id: 'fsm-node-p2', label: 'P2-漏洞扫描', phase: 'P2', fsmPhase: 2, fsmFixed: true, fsmOrder: 2, skillPath: 'code-audit/phases/P2', description: '静态代码分析和漏洞检测' },
        { id: 'fsm-node-p3', label: 'P3-报告生成', phase: 'P3', fsmPhase: 3, fsmFixed: true, fsmOrder: 3, skillPath: 'code-audit/phases/P3', description: '审计报告生成' }
      ]),
      agentZone: JSON.stringify({ position: 2, allowAdd: true, parallel: true, defaultAgents: [{ id: 'semgrep', name: 'Semgrep', tool: 'Semgrep' }] }),
      skillPath: 'data/skills/code-audit',
      version: '2.0.0',
      isActive: true,
      isBuiltin: true,
      updatedAt: new Date(),
    },
  });

  console.log('Created FSM Template:', codeAudit.name);
  console.log('FSM Templates seeding completed!');
}

main()
  .catch((e: Error) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });