/**
 * 存量 Skill 迁移脚本
 * 使用 LLM 推断存量 Skill 的语言和漏洞类型
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// 迁移状态常量
const MIGRATION_STATUS = {
  PENDING: 'pending',
  ANALYZING: 'analyzing',
  MIGRATED: 'migrated',
  PENDING_REVIEW: 'pending_review',
  FAILED: 'failed',
};

async function getActiveTechStackOptions() {
  return prisma.techStackOption.findMany({
    where: { 
      isActive: true,
      category: 'language',
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

async function getActiveVulnerabilityPatterns() {
  return prisma.vulnerabilityPattern.findMany({
    where: { isActive: true },
    select: { id: true, name: true, displayName: true, category: true, cwe: true },
    orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
  });
}

async function getSkillsForMigration() {
  return prisma.skill.findMany({
    where: {
      migrationStatus: MIGRATION_STATUS.PENDING,
      isLatest: true,
    },
    select: {
      id: true,
      name: true,
      displayName: true,
      description: true,
      category: true,
      techStack: true,
      cwe: true,
      content: true,
    },
  });
}

/**
 * 基于规则的简单推断（不调用 LLM）
 * 用于快速迁移有明显特征的 Skill
 */
function simpleInference(skill, techStackOptions, vulnPatterns) {
  const result = {
    language: null,
    languageId: null,
    vulnerabilityPatternId: null,
    confidence: 0,
    reason: '',
  };

  // 1. 推断语言
  if (skill.techStack) {
    try {
      const techStackArray = JSON.parse(skill.techStack);
      if (techStackArray.length > 0) {
        const firstLang = techStackArray[0];
        const matched = techStackOptions.find(
          t => t.name.toLowerCase() === firstLang.toLowerCase()
        );
        if (matched) {
          result.language = matched.name;
          result.languageId = matched.id;
          result.confidence = 0.7;
          result.reason = `从 techStack 数组第一个元素推断: ${firstLang}`;
        }
      }
    } catch (e) {
      // JSON 解析失败
    }
  }

  // 2. 推断漏洞类型
  // 基于名称和描述的关键词匹配
  const searchText = `${skill.name} ${skill.displayName} ${skill.description}`.toLowerCase();
  
  // 关键词映射
  const keywordMapping = [
    { keywords: ['sql', '注入', 'injection'], vulnName: 'sql-injection' },
    { keywords: ['xss', '跨站', 'cross-site scripting'], vulnName: 'xss' },
    { keywords: ['command', '命令注入', 'cmd', 'exec'], vulnName: 'command-injection' },
    { keywords: ['path', '路径遍历', 'traversal', 'directory'], vulnName: 'path-traversal' },
    { keywords: ['ssrf', 'server-side request'], vulnName: 'ssrf' },
    { keywords: ['auth', '认证', 'authentication', 'login'], vulnName: 'broken-authentication' },
    { keywords: ['session', '会话'], vulnName: 'session-fixation' },
    { keywords: ['password', '密码', 'credential'], vulnName: 'weak-password' },
    { keywords: ['secret', '密钥', 'key', 'credential', 'hardcoded'], vulnName: 'hardcoded-secrets' },
    { keywords: ['sensitive', '敏感'], vulnName: 'sensitive-data-exposure' },
    { keywords: ['info', '信息泄露', 'disclosure'], vulnName: 'information-disclosure' },
    { keywords: ['api', 'idor', 'bola'], vulnName: 'broken-object-level-authorization' },
    { keywords: ['mass', 'assignment', '批量赋值'], vulnName: 'mass-assignment' },
    { keywords: ['rate', '限流', 'throttle'], vulnName: 'missing-rate-limiting' },
    { keywords: ['config', '配置', 'misconfiguration'], vulnName: 'security-misconfiguration' },
    { keywords: ['header', '头部', 'csp', 'hsts'], vulnName: 'missing-security-headers' },
    { keywords: ['debug', '调试'], vulnName: 'debug-mode-enabled' },
    { keywords: ['crypto', '加密', 'encrypt', 'decrypt'], vulnName: 'weak-cryptography' },
    { keywords: ['random', '随机'], vulnName: 'insecure-randomness' },
    { keywords: ['certificate', '证书', 'ssl', 'tls'], vulnName: 'certificate-validation' },
    { keywords: ['csrf', 'cross-site request forgery'], vulnName: 'csrf' },
    { keywords: ['redirect', '重定向', '跳转'], vulnName: 'open-redirect' },
    { keywords: ['clickjacking', '点击劫持'], vulnName: 'clickjacking' },
  ];

  for (const mapping of keywordMapping) {
    if (mapping.keywords.some(kw => searchText.includes(kw))) {
      const matched = vulnPatterns.find(p => p.name === mapping.vulnName);
      if (matched) {
        result.vulnerabilityPatternId = matched.id;
        result.confidence = Math.min(result.confidence + 0.2, 0.85);
        result.reason += ` | 关键词匹配: ${mapping.vulnName}`;
        break;
      }
    }
  }

  // 3. 如果有 CWE，尝试匹配
  if (skill.cwe) {
    const cweNum = skill.cwe.replace('CWE-', '');
    const matchedByCwe = vulnPatterns.find(p => p.cwe && p.cwe.includes(cweNum));
    if (matchedByCwe) {
      result.vulnerabilityPatternId = matchedByCwe.id;
      result.confidence = Math.max(result.confidence, 0.8);
      result.reason += ` | CWE 匹配: ${skill.cwe}`;
    }
  }

  // 4. 如果没匹配到漏洞类型，根据 category 选择一个默认的
  if (!result.vulnerabilityPatternId) {
    const categoryPatterns = vulnPatterns.filter(p => p.category === skill.category);
    if (categoryPatterns.length > 0) {
      // 选择第一个
      result.vulnerabilityPatternId = categoryPatterns[0].id;
      result.confidence = Math.max(result.confidence - 0.1, 0.3);
      result.reason += ` | 基于 category 默认选择: ${skill.category}`;
    }
  }

  return result;
}

/**
 * 执行迁移
 */
async function runMigration(options = {}) {
  const { dryRun = true, limit = 0, confidenceThreshold = 0.8 } = options;

  console.log('========================================');
  console.log('存量 Skill 迁移脚本');
  console.log('========================================\n');
  console.log(`模式: ${dryRun ? '预览 (dry-run)' : '执行'}`);
  console.log(`置信度阈值: ${confidenceThreshold}`);
  console.log('');

  // 获取参考数据
  const techStackOptions = await getActiveTechStackOptions();
  const vulnPatterns = await getActiveVulnerabilityPatterns();
  
  console.log(`可选语言: ${techStackOptions.length} 个`);
  console.log(`可选漏洞类型: ${vulnPatterns.length} 个`);
  console.log('');

  // 获取待迁移的 Skill
  let skills = await getSkillsForMigration();
  if (limit > 0) {
    skills = skills.slice(0, limit);
  }
  console.log(`待迁移 Skill: ${skills.length} 个\n`);

  // 推断并分类
  const results = {
    autoMigrated: [],      // 高置信度自动迁移
    pendingReview: [],     // 中置信度待审核
    failed: [],            // 低置信度失败
  };

  for (const skill of skills) {
    const inference = simpleInference(skill, techStackOptions, vulnPatterns);
    
    const item = {
      skillId: skill.id,
      skillName: skill.name,
      originalTechStack: skill.techStack,
      originalCategory: skill.category,
      originalCwe: skill.cwe,
      inferredLanguage: inference.language,
      inferredLanguageId: inference.languageId,
      inferredVulnPatternId: inference.vulnerabilityPatternId,
      confidence: inference.confidence,
      reason: inference.reason,
    };

    if (inference.confidence >= confidenceThreshold) {
      results.autoMigrated.push(item);
    } else if (inference.confidence >= 0.5) {
      results.pendingReview.push(item);
    } else {
      results.failed.push(item);
    }
  }

  // 打印报告
  console.log('========================================');
  console.log('迁移报告');
  console.log('========================================\n');

  console.log(`自动迁移 (置信度 >= ${confidenceThreshold}): ${results.autoMigrated.length} 个`);
  console.log(`待人工审核 (置信度 0.5-0.8): ${results.pendingReview.length} 个`);
  console.log(`迁移失败 (置信度 < 0.5): ${results.failed.length} 个\n`);

  // 打印详细信息
  if (results.failed.length > 0) {
    console.log('\n--- 迁移失败详情 ---');
    results.failed.slice(0, 10).forEach((item, i) => {
      console.log(`${i + 1}. ${item.skillName}`);
      console.log(`   原始: techStack=${item.originalTechStack}, category=${item.originalCategory}`);
      console.log(`   置信度: ${item.confidence.toFixed(2)}`);
      console.log(`   原因: ${item.reason || '无法推断'}`);
    });
    if (results.failed.length > 10) {
      console.log(`... 还有 ${results.failed.length - 10} 条`);
    }
  }

  if (results.pendingReview.length > 0) {
    console.log('\n--- 待人工审核详情 ---');
    results.pendingReview.slice(0, 10).forEach((item, i) => {
      console.log(`${i + 1}. ${item.skillName}`);
      console.log(`   原始: techStack=${item.originalTechStack}, category=${item.originalCategory}`);
      console.log(`   推断: language=${item.inferredLanguage}, vulnPatternId=${item.inferredVulnPatternId}`);
      console.log(`   置信度: ${item.confidence.toFixed(2)}`);
    });
    if (results.pendingReview.length > 10) {
      console.log(`... 还有 ${results.pendingReview.length - 10} 条`);
    }
  }

  // 如果非 dry-run，执行更新
  if (!dryRun) {
    console.log('\n========================================');
    console.log('执行迁移...');
    console.log('========================================\n');

    let updated = 0;
    let markedReview = 0;
    let markedFailed = 0;

    // 更新自动迁移的
    for (const item of results.autoMigrated) {
      await prisma.skill.update({
        where: { id: item.skillId },
        data: {
          techStackId: item.inferredLanguageId,
          vulnerabilityPatternId: item.inferredVulnPatternId,
          migrationStatus: MIGRATION_STATUS.MIGRATED,
          migrationConfidence: item.confidence,
          migrationNotes: item.reason,
          updatedAt: new Date(),
        },
      });
      updated++;
    }

    // 更新待审核的
    for (const item of results.pendingReview) {
      await prisma.skill.update({
        where: { id: item.skillId },
        data: {
          techStackId: item.inferredLanguageId,
          vulnerabilityPatternId: item.inferredVulnPatternId,
          migrationStatus: MIGRATION_STATUS.PENDING_REVIEW,
          migrationConfidence: item.confidence,
          migrationNotes: item.reason,
          updatedAt: new Date(),
        },
      });
      markedReview++;
    }

    // 更新失败的
    for (const item of results.failed) {
      await prisma.skill.update({
        where: { id: item.skillId },
        data: {
          migrationStatus: MIGRATION_STATUS.FAILED,
          migrationConfidence: item.confidence,
          migrationNotes: item.reason || '无法推断语言或漏洞类型',
          updatedAt: new Date(),
        },
      });
      markedFailed++;
    }

    console.log(`已迁移: ${updated} 条`);
    console.log(`待审核: ${markedReview} 条`);
    console.log(`失败: ${markedFailed} 条`);
  }

  // 保存报告到文件
  const reportPath = path.join(process.cwd(), 'data', `migration-report-${Date.now()}.json`);
  const dataDir = path.dirname(reportPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    dryRun,
    confidenceThreshold,
    summary: {
      total: skills.length,
      autoMigrated: results.autoMigrated.length,
      pendingReview: results.pendingReview.length,
      failed: results.failed.length,
    },
    details: results,
  }, null, 2), 'utf-8');
  
  console.log(`\n报告已保存: ${reportPath}`);

  await prisma.$disconnect();
  
  return results;
}

// 解析命令行参数
const args = process.argv.slice(2);
const options = {
  dryRun: !args.includes('--execute'),
  limit: parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0'),
  confidenceThreshold: parseFloat(args.find(a => a.startsWith('--confidence='))?.split('=')[1] || '0.8'),
};

// 运行迁移
runMigration(options).catch(e => {
  console.error('迁移失败:', e);
  process.exit(1);
});
