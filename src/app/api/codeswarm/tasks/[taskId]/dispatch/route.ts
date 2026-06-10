import { proxyToScheduler } from '@/lib/codeswarm-proxy';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  return proxyToScheduler(request, `/api/task/${taskId}/dispatch`);
}
