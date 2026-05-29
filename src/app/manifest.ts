import type { MetadataRoute } from 'next';
import { PLATFORM_NAME, LOGO_SMALL } from '@/lib/branding';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PLATFORM_NAME,
    short_name: PLATFORM_NAME,
    description: 'AI 驱动的代码安全审计平台',
    start_url: '/',
    display: 'standalone',
    icons: [
      { src: LOGO_SMALL, sizes: '32x32', type: 'image/svg+xml' },
    ],
  };
}