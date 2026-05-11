/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // instrumentation 已稳定化，无需 experimental 配置
  // instrumentation.ts 文件会自动被 Next.js 检测
  
  // API 路由最大执行时间（秒）
  allowedDevOrigins: ['172.31.31.229', '127.0.0.1', 'localhost'],
  
  // standalone 输出配置
  output: 'standalone',
  
  // 打包时排除这些目录和文件
  outputFileTracingExcludes: {
    '**/*': [
      // 配置文件本身
      'next.config.js',
      // 目录
      'docs/**',
      'scripts/**', 
      'skills.clone/**',
      'test-skills-output/**',
      'tmp/**',
      'src/examples/**',
      '.claude/**',
      'data/**',
      'dataXXX/**',
      'backups/**',
      'outputs/**',
      'project/**',
      'test-results/**',
      'test-outputs/**',
      '.omc/**',
      'prisma_prod/**',
      'dev.db',
      'prod_dev.db',
      // 根目录多余数据库文件
      '*.db',
      // 源代码不需要打包（已编译到 .next/server）
      'src/**',
      // 根目录测试相关
      '*.test.ts',
      '*.test.js',
      'test*.ts',
      'test*.js',
      'test*.ps1',
      'test*.py',
      '*TEST*.md',
      '*test*.md',
      // 压缩包
      '*.zip',
      '*.tar.gz',
      '*.7z',
      // 根目录无关文件
      '*.md',
      'check-*.js',
      'diagnose-*.js',
      'fix_*.py',
      'modify*.py',
      'generate_*.py',
      'run.bat',
      'run.sh',
      'run.log',
      'dev.log',
      'commit_msg.txt',
      // 根目录多余服务器文件
      'server.ts',
      'server-new.ts',
      'server-new1.ts',
    ],
  },
  
  // 强制包含必要的 Next.js 内部文件
  outputFileTracingIncludes: {
    '**/*': [
      'node_modules/next/dist/lib/metadata/**',
    ],
  },
  
  // 生产优化
  productionBrowserSourceMaps: false, // 禁用 sourcemap 减小体积
  
  // 压缩配置
  compress: true,
  
  // 优化图片处理
  images: {
    unoptimized: true, // 如果不需要图片优化可以启用
  },

  // ssh2 使用原生模块，不兼容 ESM 打包
  serverExternalPackages: ['ssh2'],
};

module.exports = nextConfig;