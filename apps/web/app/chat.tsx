'use client';

import {
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { flushSync } from 'react-dom';
import { messagesFor } from '../lib/i18n';
import { readEvents } from '../lib/sse';
import { AlertIcon, BoardIcon, CheckIcon, CloseIcon, MarkIcon, PlusIcon, SendIcon } from './icons';

const t = messagesFor('en');
const MAX_MESSAGE = 4000;
const LONG_VALUE = 48;

type Role = 'user' | 'agent' | 'notice' | 'ref';

interface Row {
  id: number;
  role: Role;
  text: string;
  at: Date;
  tone?: 'error' | 'info';
  icon?: 'check' | 'close';
  stripId?: string;
}

type StripKind = 'lookup' | 'action';
type StripStatus = 'done' | 'failed' | 'awaiting' | 'cleared' | 'rejected';

interface Strip {
  id: string;
  n: number;
  tool: string;
  kind: StripKind;
  status: StripStatus;
  at: Date;
  description?: string;
  args?: Record<string, unknown>;
  outcome?: 'success' | 'error';
}

interface ApprovalRequest {
  toolCallId: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
}

const timeFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false });
const callsign = (n: number) => `S-${String(n).padStart(2, '0')}`;
const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const message = body?.message;
  return Array.isArray(message) ? message.join(', ') : (message ?? t.requestFailed(response.status));
}

const NARROW = '(max-width: 899px)';

/** True below the board breakpoint; the pending strip then docks above the composer instead of the board. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/** Runs a DOM update inside a view transition when the browser supports it and motion is allowed. */
function withTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduced) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

export function Chat({ tenant }: Readonly<{ tenant: string | null }>) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [strips, setStrips] = useState<Strip[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [urgent, setUrgent] = useState('');
  const rowId = useRef(0);
  const stripsRef = useRef<Strip[]>([]);
  stripsRef.current = strips;
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<HTMLHeadingElement>(null);
  const boardHeadingRef = useRef<HTMLHeadingElement>(null);

  const pending = strips.find((s) => s.status === 'awaiting') ?? null;
  const narrow = useNarrow();

  const addRow = useCallback((row: Omit<Row, 'id' | 'at'>) => {
    rowId.current += 1;
    const next = { ...row, id: rowId.current, at: new Date() };
    setRows((current) => [...current, next]);
  }, []);

  const appendToken = useCallback((text: string) => {
    setRows((current) => {
      const last = current.at(-1);
      if (last?.role === 'agent') return [...current.slice(0, -1), { ...last, text: last.text + text }];
      rowId.current += 1;
      return [...current, { id: rowId.current, role: 'agent', text, at: new Date() }];
    });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [rows.length, pending?.id]);

  useEffect(() => {
    if (pending) pendingRef.current?.focus();
  }, [pending?.id, narrow]);

  useEffect(() => {
    if (!boardOpen) return;
    boardHeadingRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setBoardOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardOpen]);

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

  function upsertToolResult(toolCallId: string, tool: string, ok: boolean) {
    setStrips((current) => {
      if (current.some((s) => s.id === toolCallId)) {
        return current.map((s) => (s.id === toolCallId ? { ...s, outcome: ok ? 'success' : 'error' } : s));
      }
      const strip: Strip = {
        id: toolCallId,
        n: current.length + 1,
        tool,
        kind: 'lookup',
        status: ok ? 'done' : 'failed',
        at: new Date(),
      };
      return [...current, strip];
    });
  }

  async function consume(response: Response) {
    if (!response.ok) throw new Error(await errorMessage(response));
    setAnnouncement(t.replying);
    for await (const { event, data } of readEvents(response)) {
      if (event === 'token') {
        appendToken(typeof data.text === 'string' ? data.text : '');
      } else if (event === 'tool_result') {
        const tool = typeof data.tool === 'string' ? data.tool : 'tool';
        const id = typeof data.toolCallId === 'string' ? data.toolCallId : `${tool}-${Date.now()}`;
        const ok = data.status === 'success';
        upsertToolResult(id, tool, ok);
        addRow({
          role: 'ref',
          text: ok ? t.toolDone(tool) : t.toolFailed(t.toolAction(tool)),
          stripId: id,
          tone: ok ? 'info' : 'error',
        });
      } else if (event === 'approval_required') {
        const request = data.request as ApprovalRequest;
        const strip: Strip = {
          id: request.toolCallId,
          n: 0,
          tool: request.tool,
          kind: 'action',
          status: 'awaiting',
          at: new Date(),
          description: request.description,
          args: request.args,
        };
        withTransition(() =>
          setStrips((current) => {
            const others = current.filter((s) => s.id !== strip.id);
            return [...others, { ...strip, n: others.length + 1 }];
          }),
        );
        setUrgent(t.approvalAnnouncement(t.toolAction(request.tool)));
      } else if (event === 'error') {
        addRow({ role: 'notice', tone: 'error', text: t.runFailed });
      }
    }
    setAnnouncement(t.replyDone);
  }

  async function run(action: () => Promise<Response>) {
    setBusy(true);
    try {
      await consume(await action());
    } catch (error) {
      addRow({
        role: 'notice',
        tone: 'error',
        text: error instanceof Error ? error.message : t.somethingWrong,
      });
    } finally {
      setBusy(false);
    }
  }

  async function send(message: string) {
    const text = message.trim();
    if (!text || busy || pending) return;
    setInput('');
    addRow({ role: 'user', text });
    await run(async () => {
      const id = await ensureThread();
      return fetch(`/api/threads/${id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
    });
    composerRef.current?.focus();
  }

  async function decide(strip: Strip, decision: 'approve' | 'reject', editedArgs?: Record<string, unknown>) {
    if (!threadId) return;
    const body = { decision, toolCallId: strip.id, ...(editedArgs ? { editedArgs } : {}) };
    withTransition(() =>
      setStrips((current) =>
        current.map((s) =>
          s.id === strip.id
            ? { ...s, status: decision === 'approve' ? 'cleared' : 'rejected', args: editedArgs ?? s.args }
            : s,
        ),
      ),
    );
    setUrgent('');
    addRow({
      role: 'notice',
      tone: 'info',
      icon: decision === 'approve' ? 'check' : 'close',
      text: t.decisionNotice(decision, t.toolAction(strip.tool)),
    });
    await run(() =>
      fetch(`/api/threads/${threadId}/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    composerRef.current?.focus();
  }

  function newThread() {
    if (busy) return;
    setThreadId(null);
    setRows([]);
    setStrips([]);
    setUrgent('');
    setAnnouncement('');
    composerRef.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  }

  const blocked = Boolean(pending);
  const left = MAX_MESSAGE - input.length;
  const log = strips.filter((s) => s.status !== 'awaiting').reverse();
  const waiting = busy && rows.at(-1)?.role !== 'agent';

  let bay;
  if (pending && !narrow) {
    bay = <PendingStrip strip={pending} busy={busy} headingRef={pendingRef} onDecide={decide} />;
  } else if (pending) {
    bay = <p className="slot">{t.awaitingDocked}</p>;
  } else {
    bay = <p className="slot">{t.awaitingEmpty}</p>;
  }

  return (
    <div className="desk">
      <header className="topbar">
        <div className="brand">
          <MarkIcon className="brand-mark" />
          <h1 className="brand-name">{t.appName}</h1>
        </div>
        <dl className="context context-top">
          <div>
            <dt>{t.thread}</dt>
            <dd className="numerals">{threadId ? threadId.slice(0, 8) : t.noThread}</dd>
          </div>
          {tenant && (
            <div>
              <dt>{t.tenant}</dt>
              <dd>{tenant}</dd>
            </div>
          )}
        </dl>
        <div className="topbar-actions">
          <button type="button" className="btn btn-quiet board-toggle" onClick={() => setBoardOpen(true)}>
            <BoardIcon />
            <span>{t.strips}</span>
            {strips.length > 0 && <span className="count-pill numerals">{strips.length}</span>}
          </button>
          <button
            type="button"
            className="btn btn-quiet new-thread"
            onClick={newThread}
            disabled={busy}
            title={t.newThreadHint}
          >
            <PlusIcon />
            <span>{t.newThread}</span>
          </button>
        </div>
      </header>

      <main className="conversation" aria-label={t.appName}>
        <div className="transcript">
          {rows.length === 0 ? (
            <EmptyState onPick={(text) => void send(text)} disabled={busy || blocked} />
          ) : (
            <ol className="rows">
              {rows.map((row) => (
                <MessageRow key={row.id} row={row} strips={strips} />
              ))}
              {waiting && (
                <li className="row row-agent">
                  <RowHead label={t.agent} />
                  <p className="working">
                    <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
                      <circle className="mark-ring" cx="14" cy="14" r="8" />
                    </svg>
                    <span>{t.replying}</span>
                  </p>
                </li>
              )}
            </ol>
          )}
          <div ref={endRef} />
        </div>

        {pending && narrow && (
          <section className="dock" aria-label={t.awaitingTitle}>
            <PendingStrip strip={pending} busy={busy} headingRef={pendingRef} onDecide={decide} docked />
          </section>
        )}

        <form className="composer" onSubmit={onSubmit}>
          <label htmlFor="composer" className="visually-hidden">
            {t.composerLabel}
          </label>
          <textarea
            id="composer"
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onComposerKey}
            maxLength={MAX_MESSAGE}
            rows={1}
            placeholder={blocked ? t.composerBlocked : t.composerPlaceholder}
            disabled={blocked}
            aria-describedby={left < 500 ? 'composer-count' : undefined}
          />
          <div className="composer-side">
            {left < 500 && (
              <span id="composer-count" className="count numerals">
                {t.charactersLeft(left)}
              </span>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy || blocked || !input.trim()}>
              <span>{busy ? t.sending : t.send}</span>
              <SendIcon />
            </button>
          </div>
        </form>
      </main>

      <aside className="board" data-open={boardOpen || undefined} aria-labelledby="board-title">
        <div className="board-head">
          <h2 id="board-title" ref={boardHeadingRef} tabIndex={-1}>
            {t.board}
          </h2>
          <button
            type="button"
            className="btn btn-icon board-close"
            onClick={() => setBoardOpen(false)}
            aria-label={t.closeBoard}
          >
            <CloseIcon />
          </button>
        </div>

        <dl className="context context-board">
          <div>
            <dt>{t.thread}</dt>
            <dd className="numerals">{threadId ? threadId.slice(0, 8) : t.noThread}</dd>
          </div>
          {tenant && (
            <div>
              <dt>{t.tenant}</dt>
              <dd>{tenant}</dd>
            </div>
          )}
        </dl>

        <section className="bay" aria-labelledby="bay-title">
          <h3 id="bay-title">{t.awaitingTitle}</h3>
          {bay}
        </section>

        <section className="log" aria-labelledby="log-title">
          <h3 id="log-title">{t.logTitle}</h3>
          {log.length === 0 ? (
            <p className="board-note">{t.logEmpty}</p>
          ) : (
            <ol className="strips">
              {log.map((strip) => (
                <li key={strip.id}>
                  <StripCard strip={strip} />
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
      {boardOpen && (
        <button
          type="button"
          className="scrim"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setBoardOpen(false)}
        />
      )}

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      <p className="visually-hidden" role="alert" aria-live="assertive">
        {urgent}
      </p>
    </div>
  );
}

function EmptyState({ onPick, disabled }: Readonly<{ onPick: (text: string) => void; disabled: boolean }>) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <h2 id="empty-title">{t.emptyTitle}</h2>
      <p>{t.emptyBody}</p>
      <h3 className="visually-hidden">{t.suggestionsLabel}</h3>
      <ul className="suggestions">
        {t.suggestions.map(({ text, kind }) => (
          <li key={text}>
            <button
              type="button"
              className={`suggestion kind-${kind}`}
              onClick={() => onPick(text)}
              disabled={disabled}
            >
              <span className="suggestion-text">{text}</span>
              <span className="suggestion-kind">
                <span className={`ref-chip kind-${kind}`} aria-hidden="true" />
                {t.suggestionKind[kind]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RowHead({ label, at }: Readonly<{ label: string; at?: Date }>) {
  return (
    <p className="row-head">
      <span className="row-who">{label}</span>
      {at && (
        <time className="numerals" dateTime={at.toISOString()}>
          {timeFormat.format(at)}
        </time>
      )}
    </p>
  );
}

function MessageRow({ row, strips }: Readonly<{ row: Row; strips: Strip[] }>) {
  if (row.role === 'ref') {
    const strip = strips.find((s) => s.id === row.stripId);
    return (
      <li className={`row row-ref ${row.tone === 'error' ? 'is-error' : ''}`}>
        <span className={`ref-chip kind-${strip?.kind ?? 'lookup'}`} aria-hidden="true" />
        <span>{row.text}</span>
        {strip && <span className="numerals ref-callsign">{t.stripRef(callsign(strip.n))}</span>}
      </li>
    );
  }
  if (row.role === 'notice') {
    return (
      <li className={`row row-notice ${row.tone === 'error' ? 'is-error' : ''}`}>
        {row.tone === 'error' ? <AlertIcon /> : row.icon === 'close' ? <CloseIcon /> : <CheckIcon />}
        <span>{row.text}</span>
      </li>
    );
  }
  return (
    <li className={`row row-${row.role}`}>
      <RowHead label={row.role === 'user' ? t.you : t.agent} at={row.at} />
      <p className="row-text">{row.text}</p>
    </li>
  );
}

function StatusMark({ status }: Readonly<{ status: StripStatus }>) {
  return (
    <span className={`mark mark-${status}`}>
      <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
        {(status === 'cleared' || status === 'done') && <path className="mark-tick" d="M6 15l5 5 11-12" />}
        {status === 'rejected' && <path className="mark-strike" d="M5 23 23 5" />}
        {status === 'failed' && <path className="mark-alert" d="M14 5 24 22H4zM14 11v5M14 19v.01" />}
        {status === 'awaiting' && <circle className="mark-ring" cx="14" cy="14" r="8" />}
      </svg>
      <span className="mark-label">{t.status[status]}</span>
    </span>
  );
}

function Holder({ strip }: Readonly<{ strip: Strip }>) {
  return (
    <div className="strip-holder numerals">
      <span className="strip-callsign">{callsign(strip.n)}</span>
      <time dateTime={strip.at.toISOString()}>{timeFormat.format(strip.at)}</time>
      <span className="strip-class">{strip.kind === 'action' ? t.kindAction : t.kindLookup}</span>
    </div>
  );
}

function StripCard({ strip }: Readonly<{ strip: Strip }>) {
  const titleId = useId();
  return (
    <article
      className={`strip kind-${strip.kind} status-${strip.status}`}
      style={{ viewTransitionName: `strip-${strip.n}` }}
      aria-labelledby={titleId}
    >
      <Holder strip={strip} />
      <div className="strip-body">
        <h4 id={titleId} className="strip-tool">
          {t.toolAction(strip.tool)}
        </h4>
        <p className="strip-id">{strip.tool}</p>
      </div>
      <StatusMark status={strip.status} />
    </article>
  );
}

function PendingStrip({
  strip,
  busy,
  headingRef,
  onDecide,
  docked = false,
}: Readonly<{
  strip: Strip;
  busy: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onDecide: (
    strip: Strip,
    decision: 'approve' | 'reject',
    editedArgs?: Record<string, unknown>,
  ) => Promise<void>;
  docked?: boolean;
}>) {
  const original = JSON.stringify(strip.args ?? {}, null, 2);
  const [draft, setDraft] = useState(original);
  const [error, setError] = useState('');
  const titleId = useId();
  const editorId = useId();
  const entries = Object.entries(strip.args ?? {});
  const edited = draft !== original;

  function approve() {
    if (!edited) {
      void onDecide(strip, 'approve');
      return;
    }
    try {
      const parsed = JSON.parse(draft) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      setError('');
      void onDecide(strip, 'approve', parsed as Record<string, unknown>);
    } catch {
      setError(t.invalidJson);
    }
  }

  function undo() {
    setDraft(original);
    setError('');
  }

  return (
    <article
      className="strip kind-action status-awaiting strip-pending"
      style={{ viewTransitionName: `strip-${strip.n}` }}
      aria-labelledby={titleId}
    >
      <Holder strip={strip} />
      <div className="strip-body">
        <h4 id={titleId} ref={headingRef} tabIndex={-1} className="strip-tool">
          {t.toolAction(strip.tool)}
        </h4>
        <p className="strip-id">{strip.tool}</p>
        {strip.description && <p className="strip-desc">{strip.description}</p>}

        <h5 className="args-title">{t.argumentsTitle}</h5>
        {entries.length === 0 ? (
          <p className="strip-desc">{t.noArguments}</p>
        ) : (
          <dl className="args">
            {entries.map(([key, value]) => {
              const text = asText(value);
              return (
                <div
                  key={key}
                  className={text.length > LONG_VALUE || text.includes('\n') ? 'wide' : undefined}
                >
                  <dt>{key}</dt>
                  <dd>{text}</dd>
                </div>
              );
            })}
          </dl>
        )}

        <details
          className="edit"
          onToggle={(event) => {
            if (event.currentTarget.open) {
              event.currentTarget
                .querySelector('textarea')
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }}
        >
          <summary>{t.editArguments}</summary>
          <label htmlFor={editorId} className="visually-hidden">
            {t.editArguments}
          </label>
          <textarea
            id={editorId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(12, draft.split('\n').length + 1)}
            spellCheck={false}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? `${editorId}-error` : undefined}
          />
          {edited && (
            <button type="button" className="btn btn-link" onClick={undo}>
              {t.resetArguments}
            </button>
          )}
          {error && (
            <p id={`${editorId}-error`} className="field-error">
              <AlertIcon />
              {error}
            </p>
          )}
        </details>

        <div className="decide">
          {docked && (
            <p className="more-below" aria-hidden="true">
              {t.moreBelow}
            </p>
          )}
          <button type="button" className="btn btn-approve" onClick={approve} disabled={busy}>
            <CheckIcon />
            <span>{t.approve}</span>
          </button>
          <button
            type="button"
            className="btn btn-reject"
            onClick={() => void onDecide(strip, 'reject')}
            disabled={busy}
          >
            <CloseIcon />
            <span>{t.reject}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
