/**
 * 初始化 Skills Governance 存量数据
 * 
 * 处理逻辑：
 * 1. 分析所有现有 Skills 的相似度
 * 2. 识别重叠组
 * 3. 创建初始的 SkillObservationStats
 * 4. 标记可能需要合并的候选
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 相似度计算函数（简化版）
function calculateKeywordSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  
  const keywords1 = extractKeywords(text1.toLowerCase());
  const keywords2 = extractKeywords(text2.toLowerCase());
  
  if (keywords1.size === 0 || keywords2.size === 0) return 0;
  
  const intersection = new Set([...keywords1].filter(x => keywords2.has(x)));
  const union = new Set([...keywords1, ...keywords2]);
  
  return intersection.size / union.size;
}

function extractKeywords(text) {
  // 移除常见停用词
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just',
    'this', 'that', 'these', 'those', 'which', 'who', 'whom', 'whose',
  ]);
  
  // 提取单词（包括中文分词）
  const words = text.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || [];
  return new Set(
    words
      .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()))
      .map(w => w.toLowerCase())
  );
}

function calculateTechStackOverlap(ts1, ts2) {
  if (!ts1 || !ts2) return 0;
  
  try {
    const arr1 = Array.isArray(ts1) ? ts1 : JSON.parse(ts1);
    const arr2 = Array.isArray(ts2) ? ts2 : JSON.parse(ts2);
    
    if (arr1.length === 0 || arr2.length === 0) return 0;
    
    const set1 = new Set(arr1.map(t => t.toLowerCase()));
    const set2 = new Set(arr2.map(t => t.toLowerCase()));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  } catch {
    return 0;
  }
}

async function analyzeSkills() {
  console.log('=== 开始分析存量 Skills ===\n');
  
  // 获取所有最新版本的 Skills
  const skills = await prisma.skill.findMany({
    where: { isLatest: true },
    select: {
      id: true,
      name: true,
      displayName: true,
      description: true,
      category: true,
      cwe: true,
      techStack: true,
      content: true,
    },
  });
  
  console.log(`共有 ${skills.length} 个 Skills 需要分析\n`);
  
  // 分析相似度对
  const overlapPairs = [];
  let processed = 0;
  
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const skill1 = skills[i];
      const skill2 = skills[j];
      
      // 计算各维度相似度
      const nameSimilarity = calculateKeywordSimilarity(skill1.name, skill2.name);
      const descSimilarity = calculateKeywordSimilarity(skill1.description, skill2.description);
      const categoryMatch = skill1.category === skill2.category ? 1 : 0;
      const cweMatch = (skill1.cwe && skill2.cwe && skill1.cwe === skill2.cwe) ? 1 : 0;
      const techStackOverlap = calculateTechStackOverlap(skill1.techStack, skill2.techStack);
      
      // 综合相似度
      const overallSimilarity = (
        nameSimilarity * 0.3 +
        descSimilarity * 0.25 +
        categoryMatch * 0.15 +
        cweMatch * 0.15 +
        techStackOverlap * 0.15
      );
      
      // 只记录相似度 >= 0.3 的对
      if (overallSimilarity >= 0.3) {
        overlapPairs.push({
          skill1Id: skill1.id,
          skill1Name: skill1.name,
          skill1DisplayName: skill1.displayName,
          skill2Id: skill2.id,
          skill2Name: skill2.name,
          skill2DisplayName: skill2.displayName,
          overallSimilarity,
          nameSimilarity,
          descSimilarity,
          categoryMatch,
          cweMatch,
          techStackOverlap,
        });
      }
    }
    
    processed++;
    if (processed % 20 === 0) {
      console.log(`已处理 ${processed}/${skills.length} 个 Skills...`);
    }
  }
  
  console.log(`\n发现 ${overlapPairs.length} 个相似对（相似度 >= 0.3）\n`);
  
  // 按相似度排序
  overlapPairs.sort((a, b) => b.overallSimilarity - a.overallSimilarity);
  
  // 输出高相似度对（>= 0.5）
  const highSimilarityPairs = overlapPairs.filter(p => p.overallSimilarity >= 0.5);
  console.log(`=== 高相似度对 (>= 0.5): ${highSimilarityPairs.length} 个 ===\n`);
  
  highSimilarityPairs.slice(0, 20).forEach((pair, index) => {
    console.log(`${index + 1}. ${pair.skill1DisplayName} <-> ${pair.skill2DisplayName}`);
    console.log(`   相似度: ${(pair.overallSimilarity * 100).toFixed(1)}%`);
    console.log(`   名称: ${(pair.nameSimilarity * 100).toFixed(1)}% | 描述: ${(pair.descSimilarity * 100).toFixed(1)}%`);
    console.log(`   类别匹配: ${pair.categoryMatch ? '是' : '否'} | CWE匹配: ${pair.cweMatch ? '是' : '否'}`);
    console.log(`   技术栈重叠: ${(pair.techStackOverlap * 100).toFixed(1)}%\n`);
  });
  
  return { skills, overlapPairs, highSimilarityPairs };
}

async function createInitialStats(skills) {
  console.log('\n=== 创建初始统计记录 ===\n');
  
  let created = 0;
  let skipped = 0;
  
  for (const skill of skills) {
    // 检查是否已存在
    const existing = await prisma.skillObservationStats.findUnique({
      where: { skillId: skill.id },
    });
    
    if (existing) {
      skipped++;
      continue;
    }
    
    // 创建初始统计记录
    await prisma.skillObservationStats.create({
      data: {
        id: `obs-stats-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        skillId: skill.id,
        totalObservations: 0,
        warningCount: 0,
        matchCount: 0,
        overlapCount: 0,
        matchRate: null,
        warningRate: null,
        firstObservedAt: null,
        lastObservedAt: null,
      },
    });
    
    created++;
  }
  
  console.log(`创建统计记录: ${created} 个`);
  console.log(`跳过（已存在）: ${skipped} 个`);
}

async function createImpactAnalysis(skills, overlapPairs) {
  console.log('\n=== 创建影响分析记录 ===\n');
  
  // 找出每个 Skill 的相似 Skills
  const skillSimilarities = new Map();
  
  for (const pair of overlapPairs) {
    // Skill1 的相似列表
    if (!skillSimilarities.has(pair.skill1Id)) {
      skillSimilarities.set(pair.skill1Id, []);
    }
    skillSimilarities.get(pair.skill1Id).push({
      skillId: pair.skill2Id,
      skillName: pair.skill2Name,
      displayName: pair.skill2DisplayName,
      similarity: pair.overallSimilarity,
    });
    
    // Skill2 的相似列表
    if (!skillSimilarities.has(pair.skill2Id)) {
      skillSimilarities.set(pair.skill2Id, []);
    }
    skillSimilarities.get(pair.skill2Id).push({
      skillId: pair.skill1Id,
      skillName: pair.skill1Name,
      displayName: pair.skill1DisplayName,
      similarity: pair.overallSimilarity,
    });
  }
  
  // 为高相似度的 Skills 创建影响分析记录
  let created = 0;
  
  for (const [skillId, similarSkills] of skillSimilarities) {
    // 只为有高相似度（>= 0.5）的创建
    const highSimilarity = similarSkills.filter(s => s.similarity >= 0.5);
    if (highSimilarity.length === 0) continue;
    
    // 检查是否已存在
    const existing = await prisma.skillNewImpactAnalysis.findFirst({
      where: { skillId, status: 'pending' },
    });
    
    if (existing) continue;
    
    // 获取 Skill 信息
    const skill = skills.find(s => s.id === skillId);
    if (!skill) continue;
    
    // 创建影响分析记录
    const recommendation = highSimilarity.length >= 3 ? 'merge' : 
                          highSimilarity.length >= 1 ? 'review' : 'keep_separate';
    
    await prisma.skillNewImpactAnalysis.create({
      data: {
        id: `impact-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        skillId: skillId,
        similarSkills: JSON.stringify(highSimilarity),
        overlapScore: Math.max(...highSimilarity.map(s => s.similarity)),
        affectedWorkflows: null,
        recommendation: recommendation,
        recommendationReason: `发现 ${highSimilarity.length} 个相似 Skills，最高相似度 ${(Math.max(...highSimilarity.map(s => s.similarity)) * 100).toFixed(1)}%`,
        status: 'pending',
        analyzedAt: new Date(),
      },
    });
    
    created++;
  }
  
  console.log(`创建影响分析记录: ${created} 个`);
}

async function main() {
  try {
    console.log('========================================');
    console.log('  Skills Governance 存量数据初始化');
    console.log('========================================\n');
    
    // 1. 分析相似度
    const { skills, overlapPairs, highSimilarityPairs } = await analyzeSkills();
    
    // 2. 创建初始统计记录
    await createInitialStats(skills);
    
    // 3. 创建影响分析记录
    await createImpactAnalysis(skills, overlapPairs);
    
    // 4. 输出汇总
    console.log('\n========================================');
    console.log('  初始化完成');
    console.log('========================================');
    console.log(`总 Skills: ${skills.length}`);
    console.log(`相似对总数: ${overlapPairs.length}`);
    console.log(`高相似度对: ${highSimilarityPairs.length}`);
    
    // 保存结果到文件
    const fs = require('fs');
    const resultPath = './scripts/governance-init-result.json';
    fs.writeFileSync(resultPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      totalSkills: skills.length,
      totalOverlapPairs: overlapPairs.length,
      highSimilarityPairs: highSimilarityPairs.length,
      topPairs: highSimilarityPairs.slice(0, 50),
    }, null, 2));
    
    console.log(`\n详细结果已保存到: ${resultPath}`);
    
  } catch (error) {
    console.error('初始化失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
