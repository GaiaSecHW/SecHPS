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
      // 测试相关目录
      'test-results/**',
      'test-outputs/**',
      // 根目录测试和脚本文件
      '*.test.ts',
      '*.test.js',
      'test*.ts',
      'test*.js',
      'test*.ps1',
      'test*.py',
      // 测试报告
      '*TEST*.md',
      '*test*.md',
      // zip 打包文件
      '*.zip',
      '*.tar.gz',
      '*.7z',
    ],
  },
};

module.exports = nextConfig;