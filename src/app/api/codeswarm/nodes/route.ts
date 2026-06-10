import { proxyToScheduler } from '@/lib/codeswarm-proxy';

export async function GET(request: Request) {
  return proxyToScheduler(request, '/api/node/list');
}
