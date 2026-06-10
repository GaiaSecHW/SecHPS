import { proxyToScheduler } from '@/lib/codeswarm-proxy';

export async function POST(request: Request) {
  return proxyToScheduler(request, '/api/worker/heartbeat');
}
