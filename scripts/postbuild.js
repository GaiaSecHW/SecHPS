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
  // 从 .next 复制必要文件（排除 cache, dev 等）
  'next-files': {
    src: path.join(ROOT_DIR, '.next'),
    dest: '.next',
    mode: 'exclude-next',
    exclude: ['cache', 'dev', 'diagnostics', 'standalone', 'types', 'turbopack', 'trace', 'trace-build', 'build', 'export-marker.json', 'fallback-build-manifest.json', 'images-manifest.json', 'next-minimal-server.js.nft.json', 'next-server.js.nft.json', 'standalone.zip', 'required-server-files.js'],
  },
  // 从 .next/node_modules 复制 Prisma 客户端
  'next-node-modules': {
    src: path.join(ROOT_DIR, '.next', 'node_modules'),
    dest: '.next/node_modules',
    mode: 'all',
  },
  // data 目录：运行时不需要，可以排除
  'data': {
    mode: 'none',  // 不复制
  },  // data 目录：运行时不需要，可以排除
  'dataXXX': {
    mode: 'none',  // 不复制
  },
    'backups': {
    mode: 'none',  // 不复制
  },
  // prisma: 只复制必要文件（schema + 数据库）
  'prisma': {
    mode: 'selective',
    include: ['schema.prisma', 'dev.db', 'prod.db'],
  },
  // plugins: 全部复制
  'plugins': {
    mode: 'all',
  },// plugins: 全部复制
  'skills': {
    mode: 'all',
  },
  // uploads: 不复制（用户上传文件目录）
  'uploads': {
    mode: 'none',  // 不复制
  },
};

function shouldExclude(name, rules) {
  if (rules.exclude && rules.exclude.includes(name)) return true;
  if (rules.include && !rules.include.includes(name)) return true;
  return false;
}

function copyDir(dirName, rules, srcRoot = ROOT_DIR) {
  // mode: 'none' 表示不复制
  if (rules.mode === 'none') {
    console.log(`  ⏭️  跳过 (不需要)`);
    console.log(`✅ ${dirName}/ (0 项)`);
    return false;
  }
  
  // 使用传入的 srcRoot，如果指定了 rules.src 则使用它
  const src = rules.src || path.join(srcRoot, dirName);
  const dest = rules.dest ? path.join(STANDALONE_DIR, rules.dest) : path.join(STANDALONE_DIR, dirName);
  
  if (!fs.existsSync(src)) {
    console.log(`⚠️  源目录不存在: ${src}`);
    return false;
  }

  // 确保目标父目录存在
  const destParent = path.dirname(dest);
  if (!fs.existsSync(destParent)) {
    fs.mkdirSync(destParent, { recursive: true });
  }

  // 如果目标已存在，先删除
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  // 模式：exclude-next - 排除不需要的 .next 项
  if (rules.mode === 'exclude-next') {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    fs.mkdirSync(dest, { recursive: true });
    
    for (const entry of entries) {
      // 跳过排除的项
      if (rules.exclude && rules.exclude.includes(entry.name)) {
        console.log(`  ⏭️  跳过 ${entry.name}`);
        continue;
      }
      
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        fs.cpSync(srcPath, destPath, { recursive: true });
        console.log(`  📂 ${entry.name}/`);
      } else {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  📄 ${entry.name}`);
      }
    }
    
    console.log(`✅ ${dirName} -> ${rules.dest || dirName} (排除模式)`);
    return true;
  }

  // 对于目录，直接复制
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  } else {
    // 对于文件，直接复制
    fs.copyFileSync(src, dest);
  }
  
  console.log(`✅ ${dirName} -> ${rules.dest || dirName}`);
  return true;
}

function main() {
  console.log('🚀 开始复制运行时目录...\n');

  // 检查 standalone 目录是否存在
  if (!fs.existsSync(STANDALONE_DIR)) {
    console.error('❌ Standalone 目录不存在，请先运行 npm run build');
    process.exit(1);
  }

  // 第一步：清理不应该存在的目录（Next.js 可能错误复制了）
  console.log('🧹 清理不应该存在的目录...\n');
  const CLEANUP_DIRS = [
    'prisma_prod',
    'dataXXX',
    'backups',
    'outputs',
    'data',
    'uploads',
    'prod_dev.db',
	'vulnerabilities'
  ];
  
  for (const dirName of CLEANUP_DIRS) {
    const fullPath = path.join(STANDALONE_DIR, dirName);
    if (fs.existsSync(fullPath)) {
      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
      console.log(`🗑️  已删除: ${dirName}`);
    }
  }
  console.log('');

  let copiedCount = 0;

  for (const [dirName, rules] of Object.entries(DIR_COPY_RULES)) {
    console.log(`📦 处理 ${dirName}/...`);
    // 对于 next-files，需要使用 ROOT_DIR 作为 srcRoot
    const srcRoot = dirName === 'next-files' ? ROOT_DIR : ROOT_DIR;
    if (copyDir(dirName, rules, srcRoot)) {
      copiedCount++;
    }
  }

  console.log(`\n✨ 完成！共处理 ${copiedCount}/${Object.keys(DIR_COPY_RULES).length} 个目录`);
  console.log(`📁 输出目录: ${STANDALONE_DIR}`);
}

main();