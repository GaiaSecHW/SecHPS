import { proxyToScheduler } from '@/lib/codeswarm-proxy';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  return proxyToScheduler(request, `/api/task/${taskId}/logs`);
}
