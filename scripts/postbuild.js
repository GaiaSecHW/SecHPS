/**
 * postbuild.js
 * 
 * 构建后脚本：复制运行时需要的目录到 standalone 输出目录
 * 
 * 运行时必需的目录：
 * - data/skills - 技能数据存储
 * - prisma/ - Prisma schema 和数据库
 * - plugins/ - 插件存储
 * - uploads/ - 用户上传文件
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const STANDALONE_DIR = path.join(ROOT_DIR, '.next/standalone');

// 需要复制到 standalone 输出目录的目录
const DIR_COPY_RULES = {
  // data 目录：运行时不需要，可以排除
  'data': {
    mode: 'none',  // 不复制
  },
  // prisma: 只复制必要文件
  'prisma': {
    mode: 'selective',
    include: ['schema.prisma', 'dev.db'],
  },
  // plugins: 全部复制
  'plugins': {
    mode: 'all',
  },
  // uploads: 排除测试数据
  'uploads': {
    mode: 'exclude',
    exclude: ['performs', 'projects'],
  },
};

function shouldExclude(name, rules) {
  if (rules.exclude && rules.exclude.includes(name)) return true;
  if (rules.include && !rules.include.includes(name)) return true;
  return false;
}

function copyDir(dirName, rules) {
  // mode: 'none' 表示不复制
  if (rules.mode === 'none') {
    console.log(`  ⏭️  跳过 (不需要)`);
    console.log(`✅ ${dirName}/ (0 项)`);
    return false;
  }
  
  const src = path.join(ROOT_DIR, dirName);
  const dest = path.join(STANDALONE_DIR, dirName);
  
  if (!fs.existsSync(src)) {
    console.log(`⚠️  源目录不存在: ${dirName}/`);
    return false;
  }

  // 确保目标父目录存在
  if (!fs.existsSync(STANDALONE_DIR)) {
    fs.mkdirSync(STANDALONE_DIR, { recursive: true });
  }

  // 如果目标已存在，先删除
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  let copiedCount = 0;

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    // 根据规则过滤
    if (shouldExclude(entry.name, rules)) {
      console.log(`  ⏭️  跳过 ${entry.name}`);
      continue;
    }

    if (entry.isDirectory()) {
      fs.cpSync(srcPath, destPath, { recursive: true });
      console.log(`  📂 ${entry.name}/`);
      copiedCount++;
    } else if (entry.isFile()) {
      // 对于 selective 模式，检查文件是否在 include 列表中
      if (rules.mode === 'selective' && rules.include && !rules.include.includes(entry.name)) {
        console.log(`  ⏭️  跳过 ${entry.name}`);
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
      console.log(`  📄 ${entry.name}`);
      copiedCount++;
    }
  }

  console.log(`✅ ${dirName}/ (${copiedCount} 项)`);
  return copiedCount > 0;
}

function main() {
  console.log('🚀 开始复制运行时目录...\n');

  // 检查 standalone 目录是否存在
  if (!fs.existsSync(STANDALONE_DIR)) {
    console.error('❌ Standalone 目录不存在，请先运行 npm run build');
    process.exit(1);
  }

  let copiedCount = 0;

  for (const [dirName, rules] of Object.entries(DIR_COPY_RULES)) {
    console.log(`📦 处理 ${dirName}/...`);
    if (copyDir(dirName, rules)) {
      copiedCount++;
    }
  }

  console.log(`\n✨ 完成！共处理 ${copiedCount}/${Object.keys(DIR_COPY_RULES).length} 个目录`);
  console.log(`📁 输出目录: ${STANDALONE_DIR}`);
}

main();