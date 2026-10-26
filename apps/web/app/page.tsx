import { Chat } from './chat';

export default function Page() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 20 }}>Agent chat</h1>
      <p style={{ color: '#555', fontSize: 14 }}>
        Try: &quot;What is the refund policy?&quot; or &quot;Send an email to ops@example.com saying hi&quot;.
        Side-effect tools wait for your approval.
      </p>
      <Chat />
    </main>
  );
}
