/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
