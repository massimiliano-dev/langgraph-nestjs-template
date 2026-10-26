'use client';

import { type FormEvent, useState } from 'react';
import { readEvents } from '../lib/sse';

interface Line {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

interface PendingApproval {
  toolCallId: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = body?.message;
  return Array.isArray(message) ? message.join(', ') : (message ?? `Request failed (${response.status})`);
}

export function Chat() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [argsText, setArgsText] = useState('');

  const append = (line: Line) => setLines((current) => [...current, line]);
  const appendToken = (text: string) =>
    setLines((current) => {
      const last = current.at(-1);
      if (last?.role === 'assistant') return [...current.slice(0, -1), { ...last, text: last.text + text }];
      return [...current, { role: 'assistant', text }];
    });

  async function ensureThread(): Promise<string> {
    if (threadId) return threadId;
    const response = await fetch('/api/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    const { id } = (await response.json()) as { id: string };
    setThreadId(id);
    return id;
  }

  async function consume(response: Response) {
    if (!response.ok) throw new Error(await errorMessage(response));
    for await (const { event, data } of readEvents(response)) {
      if (event === 'token') appendToken(String(data.text ?? ''));
      else if (event === 'tool_result')
        append({ role: 'system', text: `Tool ${String(data.tool)}: ${String(data.status)}` });
      else if (event === 'approval_required') {
        const request = data.request as PendingApproval;
        setPending(request);
        setArgsText(JSON.stringify(request.args, null, 2));
      } else if (event === 'error')
        append({ role: 'system', text: String(data.message ?? 'The run failed.') });
    }
  }

  async function run(action: () => Promise<Response>) {
    setBusy(true);
    try {
      await consume(await action());
    } catch (error) {
      append({ role: 'system', text: error instanceof Error ? error.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy || pending) return;
    setInput('');
    append({ role: 'user', text: message });
    await run(async () => {
      const id = await ensureThread();
      return fetch(`/api/threads/${id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    });
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!pending || !threadId) return;
    let editedArgs: Record<string, unknown> | undefined;
    if (decision === 'approve' && argsText !== JSON.stringify(pending.args, null, 2)) {
      try {
        editedArgs = JSON.parse(argsText) as Record<string, unknown>;
      } catch {
        append({ role: 'system', text: 'The edited arguments are not valid JSON.' });
        return;
      }
    }
    const body = { decision, toolCallId: pending.toolCallId, ...(editedArgs ? { editedArgs } : {}) };
    append({ role: 'system', text: `You chose to ${decision} ${pending.tool}.` });
    setPending(null);
    await run(() =>
      fetch(`/api/threads/${threadId}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  return (
    <section>
      <div
        style={{ minHeight: 240, border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#fff' }}
      >
        {lines.map((line, index) => (
          <p
            key={index}
            style={{ whiteSpace: 'pre-wrap', color: line.role === 'system' ? '#666' : undefined }}
          >
            <strong>{line.role === 'user' ? 'You' : line.role === 'assistant' ? 'Agent' : 'Info'}:</strong>{' '}
            {line.text}
          </p>
        ))}
        {busy && <p style={{ color: '#666' }}>…</p>}
      </div>

      {pending && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: '2px solid #b45309',
            borderRadius: 8,
            background: '#fffbeb',
          }}
        >
          <p>
            <strong>Approval required:</strong> the agent wants to call <code>{pending.tool}</code>.
          </p>
          <p style={{ fontSize: 13, color: '#555' }}>{pending.description}</p>
          <label style={{ fontSize: 13 }}>
            Arguments (you can edit them before approving):
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={6}
              style={{ width: '100%', fontFamily: 'monospace', boxSizing: 'border-box' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => void decide('approve')} disabled={busy}>
              Approve
            </button>
            <button type="button" onClick={() => void decide('reject')} disabled={busy}>
              Reject
            </button>
          </div>
        </div>
      )}

      <form onSubmit={(e) => void send(e)} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={4000}
          placeholder={pending ? 'Approve or reject the pending action first' : 'Type a message'}
          disabled={busy || Boolean(pending)}
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={busy || Boolean(pending) || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
