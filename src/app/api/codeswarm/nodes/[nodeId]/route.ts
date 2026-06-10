import { proxyToScheduler } from '@/lib/codeswarm-proxy';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const { nodeId } = await params;
  return proxyToScheduler(request, `/api/node/${nodeId}`);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const { nodeId } = await params;
  return proxyToScheduler(request, `/api/node/${nodeId}`);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const { nodeId } = await params;
  return proxyToScheduler(request, `/api/node/${nodeId}`);
}
