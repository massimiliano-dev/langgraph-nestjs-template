import 'server-only';

/**
 * Server-side client for the agent API. The API key never leaves the server: the browser talks only to the
 * route handlers in app/api, which add credentials and the tenant before forwarding.
 */

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 32 * 1024;

function settings() {
  const url = process.env.AGENT_API_URL ?? 'http://localhost:3000';
  const apiKey = process.env.AGENT_API_KEY;
  // PLACEHOLDER: a real app takes the tenant from the signed-in user's session, never from the browser.
  const tenantId = process.env.AGENT_DEMO_TENANT_ID ?? 'demo';
  if (!apiKey) throw new Error('AGENT_API_KEY is not set');
  return { url: url.replace(/\/+$/, ''), apiKey, tenantId };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export const isThreadId = (id: string) => THREAD_ID.test(id);

export function jsonError(status: number, message: string): Response {
  return Response.json({ statusCode: status, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Basic CSRF defense for the cookie-less placeholder (and for when you add session cookies): only same-origin
 * browser requests with a JSON body are accepted. Non-browser clients send neither header and are not a CSRF
 * vector.
 */
export function rejectCrossSite(request: Request): Response | null {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return jsonError(403, 'Forbidden');
  const origin = request.headers.get('origin');
  if (origin && hostOf(origin) !== request.headers.get('host')) return jsonError(403, 'Forbidden');
  if (request.method === 'POST' && !request.headers.get('content-type')?.startsWith('application/json'))
    return jsonError(415, 'Expected application/json');
  return null;
}

/** Reads a small JSON body as text. The API validates its shape. */
export async function readBody(request: Request): Promise<string | Response> {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return jsonError(413, 'Payload too large');
  return text || '{}';
}

/** Forwards to the API with server-side credentials. Streams SSE bodies through without buffering. */
export async function forward(
  path: string,
  init: { method: 'GET' | 'POST'; body?: string; signal?: AbortSignal },
): Promise<Response> {
  let config: ReturnType<typeof settings>;
  try {
    config = settings();
  } catch {
    return jsonError(500, 'The chat backend is not configured');
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${config.url}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'x-tenant-id': config.tenantId,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    return jsonError(502, 'The chat backend is unreachable');
  }
  const type = upstream.headers.get('content-type') ?? '';
  if (upstream.ok && type.startsWith('text/event-stream')) {
    return new Response(upstream.body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  // The API already returns sanitized JSON errors; anything else becomes a generic message.
  const body = type.startsWith('application/json') ? await upstream.json().catch(() => null) : null;
  return body
    ? Response.json(body, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } })
    : jsonError(upstream.status, upstream.ok ? 'Unexpected response' : 'Request failed');
}
