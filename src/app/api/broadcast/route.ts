// src/app/api/broadcast/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BROADCAST_KEY = 'broadcast_content';

interface BroadcastConfig {
  content: string;
  enabled: boolean;
  color: string;
}

const DEFAULT_CONFIG: BroadcastConfig = {
  content: '欢迎使用 AI4WEB 测试平台',
  enabled: true,
  color: 'blue',
};

// GET /api/broadcast - 获取广播内容（无需权限）
export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: BROADCAST_KEY },
    });

    if (!config) {
      return NextResponse.json({ config: DEFAULT_CONFIG });
    }

    const broadcastConfig: BroadcastConfig = JSON.parse(config.value);
    return NextResponse.json({ config: broadcastConfig });
  } catch (error) {
    console.error('获取广播内容失败:', error);
    // 返回默认配置，避免影响用户体验
    return NextResponse.json({ config: DEFAULT_CONFIG });
  }
}