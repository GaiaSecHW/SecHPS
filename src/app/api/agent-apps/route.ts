import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { agentAppsMemoryStorage } from '@/lib/agent-apps-storage';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const apps = agentAppsMemoryStorage.filter((app: any) => app.userId === auth.payload.userId);
    return NextResponse.json({ apps });
  } catch (error) {
    console.error('获取应用列表失败:', error);
    return NextResponse.json({ error: '获取应用列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const formData = await request.formData();
    
    const name = formData.get('name') as string;
    const engine = formData.get('engine') as string;
    const startCommand = formData.get('startCommand') as string;
    const notes = formData.get('notes') as string | null;
    const skillFileType = formData.get('skillFileType') as string | null;

    if (!name || !engine || !startCommand) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const appId = uuidv4();
    const app = {
      id: appId,
      userId: auth.payload.userId,
      name,
      engine,
      skillPath: `/agent-apps/${appId}/skill`,
      startCommand,
      notes: notes || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    agentAppsMemoryStorage.push(app);

    return NextResponse.json({ app });
  } catch (error) {
    console.error('创建应用失败:', error);
    return NextResponse.json({ error: '创建应用失败' }, { status: 500 });
  }
}