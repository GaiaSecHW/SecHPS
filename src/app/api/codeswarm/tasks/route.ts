import { proxyToScheduler } from '@/lib/codeswarm-proxy';

export async function GET(request: Request) {
  return proxyToScheduler(request, '/api/task/list');
}

export async function POST(request: Request) {
  return proxyToScheduler(request, '/api/task/submit');
}

export async function DELETE(request: Request) {
  return proxyToScheduler(request, '/api/task/list');
}
