import { proxyToScheduler } from '@/lib/codeswarm-proxy';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  return proxyToScheduler(request, `/api/task/${taskId}/stream`);
}
