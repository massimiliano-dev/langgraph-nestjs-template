import { Chat } from './chat';

// The tenant label is not secret; the API key never leaves the server.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <Chat tenant={process.env.AGENT_DEMO_TENANT_ID ?? null} />;
}
