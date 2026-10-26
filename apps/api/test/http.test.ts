import { SignJWT } from 'jose';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryUsageStore } from '../src/tenancy/usage-store.js';
import {
  aiText,
  aiToolCall,
  API_KEY,
  createTestApp,
  EMAIL_ARGS,
  parseSse,
  sseParser,
  type TestApp,
} from './support.js';

let current: TestApp | undefined;
afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

async function start(...args: Parameters<typeof createTestApp>) {
  current = await createTestApp(...args);
  return current;
}

const auth = (tenant: string) => ({ authorization: `Bearer ${API_KEY}`, 'x-tenant-id': tenant });
const http = (t: TestApp) => request(t.app.getHttpServer());

async function createThread(t: TestApp, tenant = 'acme'): Promise<string> {
  const res = await http(t).post('/threads').set(auth(tenant)).expect(201);
  return res.body.id as string;
}

function stream(t: TestApp, path: string, body: unknown, headers: Record<string, string>) {
  return http(t)
    .post(path)
    .set(headers)
    .send(body as object)
    .buffer(true)
    .parse(sseParser);
}

describe('authentication', () => {
  it('leaves /health public', async () => {
    const t = await start([]);
    await http(t).get('/health').expect(200, { status: 'ok' });
  });

  it('requires a valid key on every thread route, including the SSE endpoints', async () => {
    const t = await start([aiText('hi')]);
    const id = await createThread(t);
    const routes = [
      () => http(t).post('/threads'),
      () => http(t).get(`/threads/${id}/history`),
      () => http(t).post(`/threads/${id}/runs`).send({ message: 'hi' }),
      () => http(t).post(`/threads/${id}/runs/resume`).send({ decision: 'approve', toolCallId: 'x' }),
    ];
    for (const route of routes) {
      const missing = await route().set('x-tenant-id', 'acme').expect(401);
      expect(missing.headers['www-authenticate']).toBe('Bearer');
      await route()
        .set({ authorization: 'Bearer wrong-key-wrong-key-wrong-key-00', 'x-tenant-id': 'acme' })
        .expect(401);
    }
    expect(t.model.remaining).toBe(1); // the model was never called
  });

  it('requires a well-formed tenant header for service keys', async () => {
    const t = await start([]);
    await http(t)
      .post('/threads')
      .set({ authorization: `Bearer ${API_KEY}` })
      .expect(400);
    await http(t)
      .post('/threads')
      .set({ authorization: `Bearer ${API_KEY}`, 'x-tenant-id': '../etc' })
      .expect(400);
  });

  describe('JWT mode', () => {
    const secret = 'jwt-test-secret-0123456789abcdef0123456789';
    const env = {
      AUTH_MODE: 'jwt',
      JWT_SECRET: secret,
      JWT_ISSUER: 'https://issuer.test',
      JWT_AUDIENCE: 'agent-api',
    };
    const sign = (claims: Record<string, unknown>, exp = '5m') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuer('https://issuer.test')
        .setAudience('agent-api')
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(new TextEncoder().encode(secret));

    it('takes the tenant from the verified claim and refuses a different header', async () => {
      const t = await start([], { env });
      const token = await sign({ tenant_id: 'acme' });
      await http(t)
        .post('/threads')
        .set({ authorization: `Bearer ${token}` })
        .expect(201);
      await http(t)
        .post('/threads')
        .set({ authorization: `Bearer ${token}`, 'x-tenant-id': 'globex' })
        .expect(403);
    });

    it('rejects expired, wrongly signed or tenant-less tokens', async () => {
      const t = await start([], { env });
      const expired = await sign({ tenant_id: 'acme' }, '-1m');
      const noTenant = await sign({});
      const forged = await new SignJWT({ tenant_id: 'acme' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-1')
        .setIssuer('https://issuer.test')
        .setAudience('agent-api')
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode('another-secret-0123456789abcdef0123456789'));
      for (const token of [expired, noTenant, forged])
        await http(t)
          .post('/threads')
          .set({ authorization: `Bearer ${token}` })
          .expect(401);
    });
  });
});

describe('tenant isolation', () => {
  it("returns 404 (not 403) when tenant B reads or resumes tenant A's thread", async () => {
    const t = await start([aiToolCall('send_email', EMAIL_ARGS), aiText('done')]);
    const id = await createThread(t, 'acme');
    const run = await stream(t, `/threads/${id}/runs`, { message: 'email ops' }, auth('acme')).expect(200);
    expect(parseSse(run.body as string).map((e) => e.event)).toContain('approval_required');

    const history = await http(t).get(`/threads/${id}/history`).set(auth('globex')).expect(404);
    expect(history.body).toEqual({ statusCode: 404, message: 'Thread not found' });
    await http(t).post(`/threads/${id}/runs`).set(auth('globex')).send({ message: 'hi' }).expect(404);
    await http(t)
      .post(`/threads/${id}/runs/resume`)
      .set(auth('globex'))
      .send({ decision: 'approve', toolCallId: 'call_send_email' })
      .expect(404);
    expect(t.deliver).not.toHaveBeenCalled();

    // Same answer as a thread that does not exist, and as a malformed id: nothing to enumerate.
    const missing = await http(t)
      .get('/threads/00000000-0000-4000-8000-000000000000/history')
      .set(auth('acme'));
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(history.body);
    await http(t).get('/threads/not-a-uuid/history').set(auth('acme')).expect(404);

    // The owner still sees it.
    const own = await http(t).get(`/threads/${id}/history`).set(auth('acme')).expect(200);
    expect(own.body.pendingApproval).toMatchObject({ tool: 'send_email' });
  });
});

describe('budgets and rate limits', () => {
  it('returns 429 before calling the model when the monthly token budget is exhausted', async () => {
    const usage = new InMemoryUsageStore();
    await usage.record('acme', { input: 900, output: 100 });
    const t = await start([aiText('never')], { env: { TENANT_MONTHLY_TOKEN_BUDGET: '1000' }, usage });
    const id = await createThread(t);
    const res = await http(t)
      .post(`/threads/${id}/runs`)
      .set(auth('acme'))
      .send({ message: 'hi' })
      .expect(429);
    expect(res.body.message).toMatch(/budget/i);
    expect(t.model.remaining).toBe(1);
    // Other tenants are unaffected.
    const other = await createThread(t, 'globex');
    await stream(t, `/threads/${other}/runs`, { message: 'hi' }, auth('globex')).expect(200);
  });

  it('records token usage per tenant after each model call', async () => {
    const t = await start([aiText('hello')]);
    const id = await createThread(t);
    await stream(t, `/threads/${id}/runs`, { message: 'hi' }, auth('acme')).expect(200);
    expect(await t.usage.monthlyTokens('acme')).toBe(120);
    expect(await t.usage.monthlyTokens('globex')).toBe(0);
  });

  it('rate-limits per tenant with Retry-After', async () => {
    const t = await start([], { env: { RATE_LIMIT_BURST: '2', RATE_LIMIT_PER_MINUTE: '1' } });
    await http(t).post('/threads').set(auth('acme')).expect(201);
    await http(t).post('/threads').set(auth('acme')).expect(201);
    const limited = await http(t).post('/threads').set(auth('acme')).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await http(t).post('/threads').set(auth('globex')).expect(201);
  });
});

describe('runs, approvals and SSE', () => {
  it('streams a full approve flow and executes the side effect exactly once', async () => {
    const t = await start([aiToolCall('send_email', EMAIL_ARGS, 'call_1'), aiText('Email sent.')]);
    const id = await createThread(t);

    const run = await stream(t, `/threads/${id}/runs`, { message: 'email ops' }, auth('acme')).expect(200);
    expect(run.headers['content-type']).toMatch(/^text\/event-stream/);
    const events = parseSse(run.body as string);
    const approval = events.find((e) => e.event === 'approval_required');
    expect(approval?.data.request).toMatchObject({
      toolCallId: 'call_1',
      tool: 'send_email',
      args: EMAIL_ARGS,
    });
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { status: 'interrupted' } });
    expect(t.deliver).not.toHaveBeenCalled();

    // A new message while an approval is pending is refused.
    await http(t).post(`/threads/${id}/runs`).set(auth('acme')).send({ message: 'hi' }).expect(409);
    // Approving a different call than the one pending is refused.
    await http(t)
      .post(`/threads/${id}/runs/resume`)
      .set(auth('acme'))
      .send({ decision: 'approve', toolCallId: 'call_other' })
      .expect(409);

    const resumed = await stream(
      t,
      `/threads/${id}/runs/resume`,
      { decision: 'approve', toolCallId: 'call_1' },
      auth('acme'),
    ).expect(200);
    const after = parseSse(resumed.body as string);
    expect(after.find((e) => e.event === 'tool_result')?.data).toMatchObject({
      tool: 'send_email',
      status: 'success',
    });
    expect(
      after
        .filter((e) => e.event === 'token')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('Email sent.');
    expect(after.at(-1)).toMatchObject({ event: 'done', data: { status: 'completed' } });
    expect(t.deliver).toHaveBeenCalledTimes(1);

    // Replaying the approval does nothing.
    await http(t)
      .post(`/threads/${id}/runs/resume`)
      .set(auth('acme'))
      .send({ decision: 'approve', toolCallId: 'call_1' })
      .expect(409);
    expect(t.deliver).toHaveBeenCalledTimes(1);

    const history = await http(t).get(`/threads/${id}/history`).set(auth('acme')).expect(200);
    expect(history.body.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(history.body.pendingApproval).toBeUndefined();
  });

  it('executes the side effect once when two approvals race', async () => {
    const t = await start([aiToolCall('send_email', EMAIL_ARGS), aiText('Sent.'), aiText('spare')]);
    const id = await createThread(t);
    await stream(t, `/threads/${id}/runs`, { message: 'email ops' }, auth('acme')).expect(200);
    const approve = () =>
      stream(
        t,
        `/threads/${id}/runs/resume`,
        { decision: 'approve', toolCallId: 'call_send_email' },
        auth('acme'),
      );
    const statuses = (await Promise.all([approve(), approve(), approve()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect(t.deliver).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid edited args with 400 and keeps the approval pending', async () => {
    const t = await start([aiToolCall('send_email', EMAIL_ARGS), aiText('ok')]);
    const id = await createThread(t);
    await stream(t, `/threads/${id}/runs`, { message: 'email ops' }, auth('acme')).expect(200);
    await http(t)
      .post(`/threads/${id}/runs/resume`)
      .set(auth('acme'))
      .send({
        decision: 'approve',
        toolCallId: 'call_send_email',
        editedArgs: { ...EMAIL_ARGS, to: 'boss@evil.test' },
      })
      .expect(400);
    await http(t)
      .post(`/threads/${id}/runs/resume`)
      .set(auth('acme'))
      .send({ decision: 'reject', toolCallId: 'call_send_email', editedArgs: EMAIL_ARGS })
      .expect(400);
    // An approval that does not name the reviewed tool call is refused.
    await http(t)
      .post(`/threads/${id}/runs/resume`)
      .set(auth('acme'))
      .send({ decision: 'approve' })
      .expect(400);
    expect(t.deliver).not.toHaveBeenCalled();
    const history = await http(t).get(`/threads/${id}/history`).set(auth('acme')).expect(200);
    expect(history.body.pendingApproval).toBeDefined();
  });

  it('validates input size and never leaks internals in errors', async () => {
    const t = await start([], { env: { MAX_MESSAGE_CHARS: '10', BODY_LIMIT: '1kb' } });
    const id = await createThread(t);
    await http(t)
      .post(`/threads/${id}/runs`)
      .set(auth('acme'))
      .send({ message: 'x'.repeat(11) })
      .expect(400);
    await http(t).post(`/threads/${id}/runs`).set(auth('acme')).send({ message: 'hi', extra: 1 }).expect(400);
    const big = await http(t)
      .post(`/threads/${id}/runs`)
      .set(auth('acme'))
      .send({ message: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
    const broken = await http(t)
      .post(`/threads/${id}/runs`)
      .set({ ...auth('acme'), 'content-type': 'application/json' })
      .send('{"message":');
    expect(broken.status).toBe(400);
    expect(JSON.stringify(broken.body)).not.toMatch(/at |node_modules|SyntaxError/);
  });

  it('turns a model failure into a generic SSE error event', async () => {
    const t = await start([]); // empty script: the model throws on first call
    const id = await createThread(t);
    const res = await stream(t, `/threads/${id}/runs`, { message: 'hi' }, auth('acme')).expect(200);
    const events = parseSse(res.body as string);
    expect(events.at(-1)).toEqual({ event: 'error', data: { type: 'error', message: 'The run failed.' } });
    expect(res.body as string).not.toMatch(/script exhausted|stack/i);
  });

  it('sets security headers', async () => {
    const t = await start([]);
    const res = await http(t).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
