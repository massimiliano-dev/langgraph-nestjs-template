import { forward, isThreadId, jsonError, readBody, rejectCrossSite } from '../../../../../lib/agent-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { id } = await params;
  if (!isThreadId(id)) return jsonError(404, 'Thread not found');
  const body = await readBody(request);
  if (body instanceof Response) return body;
  return forward(`/threads/${id}/runs/resume`, { method: 'POST', body, signal: request.signal });
}
