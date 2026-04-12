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
  
  // 打包后自动排除不需要的目录
  async headers() {
    return [];
  },
};

module.exports = nextConfig;