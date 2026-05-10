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

// 检查是否保留 Windows 文件（本地开发测试用）
const KEEP_WINDOWS = process.env.KEEP_WINDOWS_FILES === 'true' || process.platform === 'win32';

const DIR_COPY_RULES = {
  'anthropic-sdk': {
    src: path.join(ROOT_DIR, 'node_modules', '@anthropic-ai'),
    dest: 'node_modules/@anthropic-ai',
    mode: 'all',
  },
  'next-files': {
    src: path.join(ROOT_DIR, '.next'),
    dest: '.next',
    mode: 'exclude-next',
    exclude: ['cache', 'dev', 'diagnostics', 'standalone', 'types', 'turbopack', 'trace', 'trace-build', 'build', 'export-marker.json', 'fallback-build-manifest.json', 'images-manifest.json', 'next-minimal-server.js.nft.json', 'next-server.js.nft.json', 'standalone.zip', 'required-server-files.js'],
  },
  'next-node-modules': {
    src: path.join(ROOT_DIR, '.next', 'node_modules'),
    dest: '.next/node_modules',
    mode: 'all',
  },
  'data': {
    mode: 'none',
  },
  'dataXXX': {
    mode: 'none',
  },
  'backups': {
    mode: 'none',
  },
  'prisma': {
    mode: 'selective',
    include: ['schema.prisma', 'dev.db', 'prod.db'],
  },
  'plugins': {
    mode: 'all',
  },
  'skills': {
    mode: 'all',
  },
  'uploads': {
    mode: 'none',
  },
};

function shouldExclude(name, rules) {
  if (rules.exclude && rules.exclude.includes(name)) return true;
  if (rules.include && !rules.include.includes(name)) return true;
  return false;
}

function copyDir(dirName, rules, srcRoot = ROOT_DIR) {
  if (rules.mode === 'none') {
    console.log(`  ⏭️  跳过 (不需要)`);
    console.log(`✅ ${dirName}/ (0 项)`);
    return false;
  }
  
  const src = rules.src || path.join(srcRoot, dirName);
  const dest = rules.dest ? path.join(STANDALONE_DIR, rules.dest) : path.join(STANDALONE_DIR, dirName);
  
  if (!fs.existsSync(src)) {
    console.log(`⚠️  源目录不存在: ${src}`);
    return false;
  }

  const destParent = path.dirname(dest);
  if (!fs.existsSync(destParent)) {
    fs.mkdirSync(destParent, { recursive: true });
  }

  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  if (rules.mode === 'exclude-next') {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    fs.mkdirSync(dest, { recursive: true });
    
    for (const entry of entries) {
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

  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  } else {
    fs.copyFileSync(src, dest);
  }
  
  console.log(`✅ ${dirName} -> ${rules.dest || dirName}`);
  return true;
}

function main() {
  console.log('🚀 开始复制运行时目录...\n');

  if (!fs.existsSync(STANDALONE_DIR)) {
    console.error('❌ Standalone 目录不存在，请先运行 npm run build');
    process.exit(1);
  }

  console.log('🧹 清理不应该存在的目录...\n');
  const CLEANUP_DIRS = [
    'prisma_prod',
    'dataXXX',
    'backups',
    'outputs',
    'data',
    'dev.db',
    'prod_dev.db',
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
    const srcRoot = dirName === 'next-files' ? ROOT_DIR : ROOT_DIR;
    if (copyDir(dirName, rules, srcRoot)) {
      copiedCount++;
    }
  }

  console.log(`\n✨ 完成！共处理 ${copiedCount}/${Object.keys(DIR_COPY_RULES).length} 个目录`);

  // 清理 Windows/macOS 专用文件（只保留 Linux）
  // 如果 KEEP_WINDOWS_FILES=true 或当前是 Windows 平台，则保留 Windows 文件
  if (KEEP_WINDOWS) {
    console.log('\n⚠️  保留 Windows 文件用于本地测试');
    console.log(`📁 输出目录: ${STANDALONE_DIR}`);
    return;
  }
  
  console.log('\n🧹 清理 Windows/macOS 专用文件（只保留 Linux）...\n');
  
  const NON_LINUX_PLATFORMS = ['darwin', 'freebsd', 'android'];
  const platformPattern = NON_LINUX_PLATFORMS.join('|');
  
  function isNonLinuxPlatformDir(dirName) {
    const patterns = [
      new RegExp(`-(${platformPattern})-`, 'i'),
      new RegExp(`^(${platformPattern})$`, 'i'),
      new RegExp(`-(${platformPattern})$`, 'i'),
    ];
    return patterns.some(regex => regex.test(dirName));
  }
  
  function isWindowsOnlyFile(fileName) {
    if (fileName.startsWith('schema-engine-') && !fileName.includes('windows')) {
      return false;
    }
    return fileName.endsWith('.dll.node') || fileName.endsWith('.exe') || fileName.includes('windows');
  }
  
  function isDarwinOnlyFile(fileName) {
    return fileName.includes('darwin') || fileName.endsWith('.dylib.node');
  }
  
  let cleanedFiles = 0;
  let cleanedDirs = 0;
  
  function walkAndClean(dir) {
    if (!fs.existsSync(dir)) return;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (isNonLinuxPlatformDir(entry.name)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`  🗑️  目录: ${entry.name}`);
          cleanedDirs++;
        } else {
          walkAndClean(fullPath);
        }
      } else {
        if (isWindowsOnlyFile(entry.name) || isDarwinOnlyFile(entry.name)) {
          fs.unlinkSync(fullPath);
          console.log(`  🗑️  文件: ${entry.name}`);
          cleanedFiles++;
        }
      }
    }
  }
  
  walkAndClean(STANDALONE_DIR);
  
  console.log(`\n✅ 已清理 ${cleanedFiles + cleanedDirs} 个非 Linux 文件/目录`);
  console.log(`📁 输出目录: ${STANDALONE_DIR}`);
}

main();