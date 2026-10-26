import { forward, isThreadId, jsonError, rejectCrossSite } from '../../../../../lib/agent-api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { id } = await params;
  if (!isThreadId(id)) return jsonError(404, 'Thread not found');
  return forward(`/threads/${id}/history`, { method: 'GET', signal: request.signal });
}
