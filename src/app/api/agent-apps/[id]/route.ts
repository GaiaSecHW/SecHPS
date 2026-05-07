import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { agentAppsMemoryStorage } from '@/lib/agent-apps-storage';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const params = await context.params;
    const appId = params.id;
    const formData = await request.formData();
    
    const name = formData.get('name') as string;
    const engine = formData.get('engine') as string;
    const startCommand = formData.get('startCommand') as string;
    const notes = formData.get('notes') as string | null;
    const skillFileType = formData.get('skillFileType') as string | null;

    if (!name || !engine || !startCommand) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const appIndex = agentAppsMemoryStorage.findIndex(
      (app: any) => app.id === appId && app.userId === auth.payload.userId
    );

    if (appIndex === -1) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 });
    }

    const updatedApp = {
      ...agentAppsMemoryStorage[appIndex],
      name,
      engine,
      startCommand,
      notes: notes || null,
      updatedAt: new Date(),
    };

    if (skillFileType) {
      updatedApp.skillPath = `/agent-apps/${appId}/skill`;
    }

    agentAppsMemoryStorage[appIndex] = updatedApp;

    return NextResponse.json({ app: updatedApp });
  } catch (error) {
    console.error('更新应用失败:', error);
    return NextResponse.json({ error: '更新应用失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    const params = await context.params;
    const appId = params.id;
    
    const appIndex = agentAppsMemoryStorage.findIndex(
      (app: any) => app.id === appId && app.userId === auth.payload.userId
    );

    if (appIndex === -1) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 });
    }

    agentAppsMemoryStorage.splice(appIndex, 1);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除应用失败:', error);
    return NextResponse.json({ error: '删除应用失败' }, { status: 500 });
  }
}