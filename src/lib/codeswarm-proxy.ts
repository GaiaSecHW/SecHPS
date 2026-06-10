const SCHEDULER_URL = process.env.SCHEDULER_SERVICE_URL || 'http://localhost:8080';

/**
 * Forward a Next.js Request to the Scheduler microservice
 */
export async function proxyToScheduler(
  request: Request,
  pathOverride?: string
): Promise<Response> {
  const url = new URL(request.url);
  const targetPath = pathOverride || url.pathname.replace('/api/codeswarm', '');
  const targetUrl = `${SCHEDULER_URL}${targetPath}${url.search}`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const auth = request.headers.get('authorization');
  if (auth) headers.set('Authorization', auth);

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  // Forward body for POST/PATCH/PUT
  if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
    try {
      init.body = await request.text();
    } catch {
      // No body
    }
  }

  try {
    const resp = await fetch(targetUrl, init);
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch (error: any) {
    return Response.json(
      { error: 'Scheduler service unavailable', details: error.message },
      { status: 502 }
    );
  }
}
