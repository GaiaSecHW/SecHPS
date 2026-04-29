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
  // ⭐ 复制完整的 next 模块（确保所有依赖文件存在）
  'next-module': {
    src: path.join(ROOT_DIR, 'node_modules', 'next'),
    dest: 'node_modules/next',
    mode: 'all',
  },
  // ⭐ 复制 @anthropic-ai SDK（claude-agent-sdk 和 sdk）
  'anthropic-sdk': {
    src: path.join(ROOT_DIR, 'node_modules', '@anthropic-ai'),
    dest: 'node_modules/@anthropic-ai',
    mode: 'all',
  },
  // ⭐ 复制 claude-agent-sdk Linux binary (生产环境需要)
  'claude-agent-sdk-linux-x64': {
    src: path.join(ROOT_DIR, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64'),
    dest: 'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64',
    mode: 'all',
  },
  // ⭐ 复制 @google/genai SDK
  'google-genai': {
    src: path.join(ROOT_DIR, 'node_modules', '@google'),
    dest: 'node_modules/@google',
    mode: 'all',
  },
  // ⭐ 复制 openai SDK
  'openai-sdk': {
    src: path.join(ROOT_DIR, 'node_modules', 'openai'),
    dest: 'node_modules/openai',
    mode: 'all',
  },
  // ⭐ 复制 bcryptjs
  'bcryptjs': {
    src: path.join(ROOT_DIR, 'node_modules', 'bcryptjs'),
    dest: 'node_modules/bcryptjs',
    mode: 'all',
  },
  // ⭐ 复制 jsonwebtoken
  'jsonwebtoken': {
    src: path.join(ROOT_DIR, 'node_modules', 'jsonwebtoken'),
    dest: 'node_modules/jsonwebtoken',
    mode: 'all',
  },
  // ⭐ 复制 ws (WebSocket)
  'ws': {
    src: path.join(ROOT_DIR, 'node_modules', 'ws'),
    dest: 'node_modules/ws',
    mode: 'all',
  },
  // ⭐ 复制 @huggingface/tokenizers
  'huggingface-tokenizers': {
    src: path.join(ROOT_DIR, 'node_modules', '@huggingface'),
    dest: 'node_modules/@huggingface',
    mode: 'all',
  },
  // ⭐ 复制 tiktoken
  'tiktoken': {
    src: path.join(ROOT_DIR, 'node_modules', 'tiktoken'),
    dest: 'node_modules/tiktoken',
    mode: 'all',
  },
  // ⭐ 复制 @xyflow/react
  'xyflow': {
    src: path.join(ROOT_DIR, 'node_modules', '@xyflow'),
    dest: 'node_modules/@xyflow',
    mode: 'all',
  },
  // ⭐ 复制 fastify 相关
  'fastify': {
    src: path.join(ROOT_DIR, 'node_modules', 'fastify'),
    dest: 'node_modules/fastify',
    mode: 'all',
  },
  'fastify-plugin': {
    src: path.join(ROOT_DIR, 'node_modules', 'fastify-plugin'),
    dest: 'node_modules/fastify-plugin',
    mode: 'all',
  },
  '@fastify': {
    src: path.join(ROOT_DIR, 'node_modules', '@fastify'),
    dest: 'node_modules/@fastify',
    mode: 'all',
  },
  // ⭐ 复制压缩工具
  'adm-zip': {
    src: path.join(ROOT_DIR, 'node_modules', 'adm-zip'),
    dest: 'node_modules/adm-zip',
    mode: 'all',
  },
  'archiver': {
    src: path.join(ROOT_DIR, 'node_modules', 'archiver'),
    dest: 'node_modules/archiver',
    mode: 'all',
  },
  // ⭐ 复制其他关键依赖
  'yaml': {
    src: path.join(ROOT_DIR, 'node_modules', 'yaml'),
    dest: 'node_modules/yaml',
    mode: 'all',
  },
  'json5': {
    src: path.join(ROOT_DIR, 'node_modules', 'json5'),
    dest: 'node_modules/json5',
    mode: 'all',
  },
  'jsonrepair': {
    src: path.join(ROOT_DIR, 'node_modules', 'jsonrepair'),
    dest: 'node_modules/jsonrepair',
    mode: 'all',
  },
  'dompurify': {
    src: path.join(ROOT_DIR, 'node_modules', 'dompurify'),
    dest: 'node_modules/dompurify',
    mode: 'all',
  },
  'lru-cache': {
    src: path.join(ROOT_DIR, 'node_modules', 'lru-cache'),
    dest: 'node_modules/lru-cache',
    mode: 'all',
  },
  'uuid': {
    src: path.join(ROOT_DIR, 'node_modules', 'uuid'),
    dest: 'node_modules/uuid',
    mode: 'all',
  },
  'undici': {
    src: path.join(ROOT_DIR, 'node_modules', 'undici'),
    dest: 'node_modules/undici',
    mode: 'all',
  },
  'stream-chain': {
    src: path.join(ROOT_DIR, 'node_modules', 'stream-chain'),
    dest: 'node_modules/stream-chain',
    mode: 'all',
  },
  'stream-json': {
    src: path.join(ROOT_DIR, 'node_modules', 'stream-json'),
    dest: 'node_modules/stream-json',
    mode: 'all',
  },
  'dotenv': {
    src: path.join(ROOT_DIR, 'node_modules', 'dotenv'),
    dest: 'node_modules/dotenv',
    mode: 'all',
  },
  'async-lock': {
    src: path.join(ROOT_DIR, 'node_modules', 'async-lock'),
    dest: 'node_modules/async-lock',
    mode: 'all',
  },
  'eventsource': {
    src: path.join(ROOT_DIR, 'node_modules', 'eventsource'),
    dest: 'node_modules/eventsource',
    mode: 'all',
  },
  'google-auth-library': {
    src: path.join(ROOT_DIR, 'node_modules', 'google-auth-library'),
    dest: 'node_modules/google-auth-library',
    mode: 'all',
  },
  'node-pty': {
    src: path.join(ROOT_DIR, 'node_modules', 'node-pty'),
    dest: 'node_modules/node-pty',
    mode: 'all',
  },
  // 从 .next 复制必要文件（排除 cache, dev 等）
  'next-files': {
    src: path.join(ROOT_DIR, '.next'),
    dest: '.next',
    mode: 'exclude-next',
    exclude: ['cache', 'dev', 'diagnostics', 'standalone', 'types', 'turbopack', 'trace', 'trace-build', 'build', 'export-marker.json', 'fallback-build-manifest.json', 'images-manifest.json', 'next-minimal-server.js.nft.json', 'next-server.js.nft.json', 'standalone.zip', 'required-server-files.js'],
  },
  // 从 node_modules 复制完整的 @prisma/client（包含 generator-build）
  'prisma-client': {
    src: path.join(ROOT_DIR, 'node_modules', '@prisma'),
    dest: 'node_modules/@prisma',
    mode: 'all',
  },
  // 复制 .prisma 客户端缓存
  'prisma-cache': {
    src: path.join(ROOT_DIR, 'node_modules', '.prisma'),
    dest: 'node_modules/.prisma',
    mode: 'all',
  },
  // ⭐ 复制 Prisma CLI（用于生产环境执行 db push）
  'prisma-cli': {
    src: path.join(ROOT_DIR, 'node_modules', 'prisma'),
    dest: 'node_modules/prisma',
    mode: 'all',
  },
  // ⭐ 复制 .bin 目录（CLI 入口脚本）
  'node-bin': {
    src: path.join(ROOT_DIR, 'node_modules', '.bin'),
    dest: 'node_modules/.bin',
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

  // 模式：selective - 只复制指定的文件
  if (rules.mode === 'selective') {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    fs.mkdirSync(dest, { recursive: true });
    
    for (const entry of entries) {
      // 只复制 include 列表中的文件
      if (rules.include && rules.include.includes(entry.name)) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
          fs.cpSync(srcPath, destPath, { recursive: true });
          console.log(`  📂 ${entry.name}/`);
        } else {
          fs.copyFileSync(srcPath, destPath);
          console.log(`  📄 ${entry.name}`);
        }
      } else {
        console.log(`  ⏭️  跳过 ${entry.name} (不在 include 列表)`);
      }
    }
    
    console.log(`✅ ${dirName} -> ${rules.dest || dirName} (选择性复制)`);
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

  // ========================================
  // 第二步：清理 Windows 专用文件（只保留 Linux）
  // ========================================
  console.log('\n🧹 清理 Windows/macOS 专用文件（只保留 Linux）...\n');
  
  // 使用 OpenNext.js 的最佳实践：正则匹配平台特定包
  // 参考: https://github.com/opennextjs/opennextjs-aws/pull/1117
  const NON_LINUX_PLATFORMS = ['darwin', 'win32', 'freebsd', 'android'];
  const platformPattern = NON_LINUX_PLATFORMS.join('|');
  
  // 检测是否是非 Linux 平台包的目录名
  function isNonLinuxPlatformDir(dirName) {
    // 匹配多种格式：
    // 1. {pkg}-{platform}-{arch}: sharp-win32-x64, esbuild-darwin-arm64
    // 2. {arch}-{platform}: arm64-win32, x64-darwin
    // 3. {platform}: windows, darwin
    const patterns = [
      new RegExp(`-(${platformPattern})-`, 'i'),     // -win32-, -darwin-
      new RegExp(`^(${platformPattern})$`, 'i'),     // windows, darwin
      new RegExp(`-(${platformPattern})$`, 'i'),     // -win32, -darwin
      new RegExp(`^\\w+-(${platformPattern})$`, 'i'), // arm64-win32, x64-darwin
    ];
    return patterns.some(regex => regex.test(dirName));
  }
  
  // 检测是否是 Windows 专用文件
  function isWindowsOnlyFile(fileName) {
    // Windows 专用：.dll.node, .exe, 包含 windows 的文件名
    // 但要排除 schema-engine-*（这是 Linux db push 需要的）
    if (fileName.startsWith('schema-engine-') && !fileName.includes('windows')) {
      return false;  // Linux schema-engine 保留
    }
    return fileName.endsWith('.dll.node') || 
           fileName.endsWith('.exe') ||
           fileName.includes('windows');
  }
  
  // 检测是否是 macOS 专用文件
  function isDarwinOnlyFile(fileName) {
    return fileName.includes('darwin') || fileName.endsWith('.dylib.node');
  }
  
  // 检测是否是备份/临时文件（应删除）
  function isBackupOrTempFile(fileName) {
    return fileName.endsWith('.bak') ||
           fileName.endsWith('.backup') ||
           fileName.endsWith('.tmp') ||
           fileName.includes('.tmp') ||
           fileName.endsWith('.old');
  }
  
  // 检测是否是备份目录
  function isBackupDir(dirName) {
    return dirName === '.backups' ||
           dirName === 'backups' ||
           dirName.endsWith('-backup') ||
           dirName.endsWith('-bak');
  }
  
  let cleanedFiles = 0;
  let cleanedDirs = 0;
  
  // 清理整个 standalone 目录（不只是 node_modules）
  function walkAndClean(dir) {
    if (!fs.existsSync(dir)) return;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = fullPath.replace(STANDALONE_DIR, '');
      
      if (entry.isDirectory()) {
        // 检查目录名是否是非 Linux 平台包
        if (isNonLinuxPlatformDir(entry.name)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`  🗑️  目录: ${relativePath}`);
          cleanedDirs++;
        }
        // 删除备份目录（如 .backups, backups）
        else if (isBackupDir(entry.name)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`  🗑️  备份目录: ${relativePath}`);
          cleanedDirs++;
        }
        else {
          // 递归处理
          walkAndClean(fullPath);
        }
      } else {
        // 删除 Windows/macOS 专用文件
        if (isWindowsOnlyFile(entry.name) || isDarwinOnlyFile(entry.name)) {
          try {
            fs.unlinkSync(fullPath);
            console.log(`  🗑️  平台文件: ${relativePath}`);
            cleanedFiles++;
          } catch (err) {
            console.log(`  ⚠️  删除失败: ${relativePath} - ${err.message}`);
          }
        }
        // 删除备份/临时文件（所有平台都应删除）
        else if (isBackupOrTempFile(entry.name)) {
          try {
            fs.unlinkSync(fullPath);
            console.log(`  🗑️  备份文件: ${relativePath}`);
            cleanedFiles++;
          } catch (err) {
            console.log(`  ⚠️  删除失败: ${relativePath} - ${err.message}`);
          }
        }
      }
    }
  }
  
  // 从 standalone 根目录开始清理
  walkAndClean(STANDALONE_DIR);
  
  // 统计清理结果
  const totalCleaned = cleanedFiles + cleanedDirs;
  console.log(`\n✅ 已清理 ${totalCleaned} 个非 Linux 文件/目录`);
  console.log(`   - 文件: ${cleanedFiles}`);
  console.log(`   - 目录: ${cleanedDirs}`);
  
  // 计算节省的空间
  console.log(`📦 保留的 Linux 平台文件:`);
  console.log(`   - libquery_engine-debian-openssl-3.0.x.so.node`);
  console.log(`   - libquery_engine-linux-musl-openssl-3.0.x.so.node`);
  console.log(`   - *-linux vendor 目录`);
  
  console.log(`\n✨ 完成！共处理 ${copiedCount}/${Object.keys(DIR_COPY_RULES).length} 个目录`);
  console.log(`📁 输出目录: ${STANDALONE_DIR}`);
}

main();