import { forward, rejectCrossSite } from '../../../lib/agent-api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  return forward('/threads', { method: 'POST', body: '{}', signal: request.signal });
}
