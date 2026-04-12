/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  allowedDevOrigins: ['172.31.31.229'],
  
  // standalone 输出配置
  output: 'standalone',
  
  // 打包时排除这些目录和文件
  outputFileTracingExcludes: {
    '**/*': [
      // 目录
      'docs/**',
      'scripts/**', 
      'skills.clone/**',
      'test-skills-output/**',
      'tmp/**',
      'src/examples/**',
      '.claude/**',
      'data/**',
      'project/**',
      'test-results/**',
      'test-outputs/**',
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
};

module.exports = nextConfig;