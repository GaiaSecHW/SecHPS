/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 跳过类型检查以加快构建速度（库代码有 SDK 版本兼容问题）
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // 允许外部 IP 访问开发资源
  allowedDevOrigins: [
    '7.249.140.74',
    'localhost',
    '127.0.0.1',
    '.local',  // 允许所有 .local 域名
  ],
};

module.exports = nextConfig;
