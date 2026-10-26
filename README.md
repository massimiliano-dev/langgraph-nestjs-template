# langgraph-nestjs-template

A production-oriented **NestJS + LangGraph.js** agent backend with a minimal **Next.js** chat.

[![CI](https://github.com/massimiliano-dev/langgraph-nestjs-template/actions/workflows/ci.yml/badge.svg)](https://github.com/massimiliano-dev/langgraph-nestjs-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Scaffolds that wire NestJS, a ReAct agent and a PostgreSQL checkpointer already exist. This template is about
what comes after the demo, when the agent calls tools that change things and several customers share one
deployment:

- **Human approval before side effects.** Tools marked `sideEffects: true` pause the graph with `interrupt()`.
  They never run without an explicit approve, and the (possibly edited) arguments are validated again.
- **Tenant isolation.** Every thread belongs to a tenant. Every access checks ownership and answers 404 for
  anyone else's thread. Checkpoint keys are namespaced by tenant as a second layer.
- **Cost control.** Per-tenant rate limit and monthly token budget, checked before every run.
- **Observability with cost.** OpenTelemetry spans per run, model call and tool call, with tenant, tokens and
  estimated USD cost. No prompt text in traces unless you opt in.
- **Evals in CI.** A small dataset replayed from recorded model responses on every PR (deterministic and free),
  and nightly against the real model.

> Status: template, 0.x. It compiles, is typed end to end and is tested, but the business logic is deliberately
> minimal. Read [SECURITY.md](SECURITY.md) before you put it in front of users.

## What is real and what is a placeholder

| Area                | Production-ready building block                                                                     | Placeholder you must replace                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Agent graph         | ReAct loop, approval gate (`review` node), zod validation, tool-call caps, untrusted-output wrapper | The two tools: `search_docs` (fake corpus) and `send_email` (only logs)                            |
| Persistence         | `PostgresSaver` in a dedicated schema, shared `pg` pool, threads and usage tables                   | Boot-time DDL (`DB_AUTO_MIGRATE`): move it to a migration job if you prefer                        |
| Authentication      | API keys (constant-time) or JWT (`jose`: signature, issuer, audience, expiry, algorithm allow-list) | Key distribution and rotation, your identity provider                                              |
| Tenancy             | `TenantContext` (AsyncLocalStorage), ownership checks, 404 on foreign threads                       | Tenant resolution and authorization: plug in a real registry (see [Multi-tenancy](#multi-tenancy)) |
| Rate limit / budget | Interfaces + token bucket + PostgreSQL usage store                                                  | In-memory bucket is per process: use Redis with several replicas. Plans per tenant                 |
| Concurrency         | One run per thread (`PgAdvisoryRunLock`), so a double "approve" cannot execute twice                | -                                                                                                  |
| HTTP hardening      | Helmet, JSON-only body with size limit, CORS allow-list, generic errors, SSE behind the same guards | -                                                                                                  |
| Observability       | OTLP traces, per-tenant tokens and cost, content capture off by default                             | The collector's `debug` exporter: point it to your backend                                         |
| Evals               | Dataset, replay runner, record mode, scrubbing, nightly workflow                                    | Three cases: grow the dataset with real scenarios                                                  |
| Web                 | Server-side proxy (key never reaches the browser), CSRF checks, CSP                                 | No user login: the tenant comes from `AGENT_DEMO_TENANT_ID`                                        |

## Architecture

```text
 Browser ──► Next.js (apps/web)                       NestJS API (apps/api)
             route handlers /api/threads/*  ───────►  AuthGuard ─► TenantGuard ─► RateLimitGuard
             add API key + tenant (server-side)        │  (API key | JWT)  (x-tenant-id | claim)
                                                        ▼
                                              ThreadsController ─► ThreadsService
                                                │ requireThread(tenant, id) → 404 if not yours
                                                │ budget check → 429      │ run lock → 409
                                                ▼
                                              AgentRunner ── SSE events ──► client
                                                │  thread_id = "<tenant>:<thread>"
                                                ▼
                         ┌──────────── LangGraph StateGraph ─────────────┐
                         │ START → agent ──(no tool calls)──────► END     │
                         │           │──(read-only calls)──► tools ─┐    │
                         │           └─(side-effect call)─► review  │    │
                         │                     interrupt() ⇄ human  │    │
                         │                               └► tools ──┴► agent
                         └────────────────────────────────────────────────┘
                                  │ checkpoints                 │ spans
                                  ▼                             ▼
                     PostgreSQL (schema "agent")        OTel Collector (OTLP)
                     checkpoints, threads, tenant_usage
```

## Quick start

Requirements: Node.js 22.18+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env
# Fill in OPENAI_API_KEY (or the AZURE_OPENAI_* block), then generate one key and use it for both
# API_KEYS and AGENT_API_KEY:   openssl rand -hex 32
docker compose up --build
```

Open <http://127.0.0.1:3001> and try "What is the refund policy?" or "Send an email to ops@example.com saying
hi". The API listens on <http://127.0.0.1:3000>, the collector prints spans with `docker compose logs -f
otel-collector`. All ports are bound to 127.0.0.1. If 5432 is taken, set `POSTGRES_PORT` in `.env`.

Local development without containers for the apps:

```bash
docker compose up -d postgres otel-collector
pnpm --filter api build && pnpm --filter api start   # reads ../../.env
pnpm dev:web                                         # http://127.0.0.1:3001
# Watch mode for the API (two terminals): pnpm --filter api dev   and   pnpm --filter api start:watch
```

Checks: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## API

All routes except `GET /health` need `Authorization: Bearer <key or JWT>`. With API keys, the caller also
sends `x-tenant-id`; with JWTs the tenant comes from the verified claim.

| Method | Path                       | Body                                                                 | Response                                                 |
| ------ | -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| GET    | `/health`                  | -                                                                    | `{ "status": "ok" }`                                     |
| POST   | `/threads`                 | -                                                                    | `{ id, createdAt }`                                      |
| GET    | `/threads/:id/history`     | -                                                                    | messages + pending approval, rebuilt from the checkpoint |
| POST   | `/threads/:id/runs`        | `{ "message": "..." }`                                               | SSE stream                                               |
| POST   | `/threads/:id/runs/resume` | `{ "decision": "approve" \| "reject", "toolCallId", "editedArgs"? }` | SSE stream                                               |

SSE events: `token` (`{ text }`), `tool_result` (`{ toolCallId, tool, status }`), `approval_required`
(`{ request: { toolCallId, tool, description, args } }`), `done` (`{ status: "completed" | "interrupted",
usage }`), `error` (`{ message }`, always generic).

Status codes: 401 unauthenticated, 400 invalid input or tenant header, 403 tenant header that contradicts the
JWT, 404 unknown or foreign thread, 409 thread busy / approval pending / nothing to approve / stale
`toolCallId`, 413 body too large, 429 rate limit (`Retry-After`) or budget exhausted.

```bash
KEY=... # one of API_KEYS
T=$(curl -s -X POST 127.0.0.1:3000/threads -H "authorization: Bearer $KEY" -H 'x-tenant-id: acme' | jq -r .id)
curl -N -X POST 127.0.0.1:3000/threads/$T/runs -H "authorization: Bearer $KEY" -H 'x-tenant-id: acme' \
  -H 'content-type: application/json' -d '{"message":"Email ops@example.com: deploy done"}'
curl -N -X POST 127.0.0.1:3000/threads/$T/runs/resume -H "authorization: Bearer $KEY" -H 'x-tenant-id: acme' \
  -H 'content-type: application/json' -d '{"decision":"approve","toolCallId":"<id from approval_required>"}'
```

## How human approval works

1. The model answers with tool calls. If any of them targets a tool with `sideEffects: true`, the graph routes
   to the `review` node instead of `tools`.
2. `review` validates each side-effect call with its zod schema and calls `interrupt()` with
   `{ toolCallId, tool, description, args }`. The run stops, the checkpoint is saved, the client receives
   `approval_required` and `done: interrupted`. Invalid calls are not shown to a human: they fail in `tools`.
3. The client calls `POST /threads/:id/runs/resume` with `approve` or `reject`, optionally `editedArgs` and the
   `toolCallId` it showed to the user (a mismatch returns 409, so nobody approves a call they did not see). The
   API validates `editedArgs` up front (400) and resumes with `new Command({ resume })`.
4. `review` runs again from the top (that is how `interrupt()` works), receives the decision and stores it in
   state. It has no side effects, so re-running it is harmless. A malformed decision counts as a rejection.
5. `tools` executes approved calls only, after validating the final arguments **again**. Rejected calls produce
   an error `ToolMessage` telling the model not to retry. `tools` never interrupts, so the resume mechanism can
   never execute a side effect twice; the per-thread run lock stops two concurrent approvals.

Side-effect tools receive the tool-call id: pass it as an idempotency key to the downstream system.

## Adding a tool safely

1. Put it in `apps/api/src/agent/tools/` with `defineTool({ name, description, schema, sideEffects, execute })`
   and register it in `tools/index.ts`.
2. **Does it change anything outside the process** (send, write, pay, delete, call a webhook)? Then
   `sideEffects: true`. When in doubt, true.
3. Make the zod schema strict: lengths, formats, enums, allow-lists (see the recipient domain check in
   `send-email.ts`). The schema is the contract the model is forced through, twice for side effects.
4. Scope by tenant from `ctx.tenantId`, never from arguments the model chose.
5. Use `ctx.toolCallId` as idempotency key for side effects; honour `ctx.signal`.
6. Return plain text. It is wrapped in `<tool_output>` and treated as untrusted. Keep it short (it is truncated
   at 8,000 characters) and do not include secrets: it is stored in checkpoints and sent to the model.
7. Throw on failure: the model gets a generic message, the details stay in your logs.
8. Least privilege for the credentials the tool uses: read-only tokens for read-only tools.
9. Add a graph test (approval required, rejection never runs, invalid args never run) and an eval case.

## Multi-tenancy

- `TenantGuard` resolves the tenant: from the verified JWT claim (`JWT_TENANT_CLAIM`), or from `x-tenant-id`
  when a trusted service authenticates with an API key. Tenant ids must match `^[a-z0-9][a-z0-9_-]{0,62}$`.
- `TenantContextInterceptor` binds it to `AsyncLocalStorage`; services read `TenantContext.require()`, which
  throws outside a tenant request (fail closed). No request-scoped providers.
- `ThreadsRepository` has no "find by id" without a tenant. Foreign, unknown and malformed thread ids all
  return the same 404. Checkpoint `thread_id` is `<tenant>:<thread>`.
- Rate limits, budgets, usage and spans are all keyed by tenant.

**Plugging in `@massimiliano-dev/nestjs-prisma-tenants`.** The sibling project
[nestjs-prisma-tenants](https://github.com/massimiliano-dev/nestjs-prisma-tenants) (database-per-tenant
registry, strategies, `authorizeTenant`, circuit breakers) is not on npm yet, so it is not a dependency. When
it is, replace `TenantGuard` + `TenantContext` with its module and strategies, keep the ownership check in
`ThreadsService.requireThread`, and decide where agent data lives: one shared agent schema (as here, isolated
by `tenant_id`) or one checkpointer per tenant database.

## Observability

`OTEL_ENABLED=true` starts the OpenTelemetry Node SDK (traces only) with an OTLP/HTTP exporter to
`OTEL_EXPORTER_OTLP_ENDPOINT`. Spans:

| Span          | Attributes                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `agent.run`   | `tenant.id`, `thread.id`, `llm.model`, `llm.tokens.input`, `llm.tokens.output`, `llm.cost.usd`, `agent.run.kind`, `agent.run.status` |
| `llm.call`    | `tenant.id`, `thread.id`, `llm.model`, `llm.tokens.input`, `llm.tokens.output`, `llm.cost.usd`, `llm.tool_calls`                     |
| `tool.<name>` | `tenant.id`, `thread.id`, `tool.name`, `tool.side_effects`, `tool.decision`                                                          |

Cost is estimated from the price table in `apps/api/src/config/pricing.ts` (USD per 1M tokens, override with
`LLM_PRICING_JSON`). Unknown models get no cost attribute rather than a wrong one. Group by `tenant.id` in your
backend for per-tenant spend; the `tenant_usage` table has the same totals per month.

Prompt text, completions and tool arguments are **not** recorded. `OTEL_CAPTURE_CONTENT=true` adds them
(truncated); the bundled collector config still deletes them unless you remove its `attributes/strip-content`
processor. If you enable LangSmith tracing, the API logs a warning at boot: it ships prompts to a third party.

## Evals

```text
evals/
  dataset.jsonl          one case per line: answer / read-only tool / side effect must interrupt
  recordings/<id>.json   recorded model responses (content, tool calls, token counts only)
  agent.eval.test.ts     vitest runner; score = passed / total, must be >= EVAL_MIN_SCORE (default 0.8)
```

- **Replay** (default, part of `pnpm test` and PR CI): the real graph and tools run against a scripted model
  that returns the recorded responses. Deterministic, offline, free. It checks the graph and tools, not the
  model.
- **Live** (`EVAL_LIVE=1 pnpm eval`, nightly workflow): calls the configured model. The side-effect tool is a
  spy in all modes: evals never send anything.
- **Record** (`EVAL_RECORD=1 pnpm eval`): live, then rewrites `recordings/`. Output is scrubbed (key patterns
  and the configured key values) and a test fails if a recording looks like it contains a credential. Review
  the diff before committing. The shipped recordings are hand-written seeds (`"source": "seed"`).

`.github/workflows/nightly-eval.yml` runs on a schedule and on demand with `contents: read` only. Configure
the `OPENAI_API_KEY` (or `AZURE_OPENAI_API_KEY`) secret and optional variables `LLM_PROVIDER`, `OPENAI_MODEL`,
`EVAL_MIN_SCORE`, `AZURE_OPENAI_*`. Without secrets (forks, fresh copies) the job skips with a notice.

## Use this template

1. Click **Use this template** on GitHub (or `gh repo create my-agent --template
massimiliano-dev/langgraph-nestjs-template`).
2. Update `package.json` metadata, `LICENSE` holder, the security contact in `SECURITY.md`.
3. Replace the placeholder tools, then the tenancy and authentication placeholders (see the table above).
4. Enable private vulnerability reporting, Dependabot and CodeQL in the repository settings.
5. Add the eval secrets if you want the nightly run.

## Project layout

```text
apps/api/src
  agent/          graph.ts (StateGraph + approval gate), runner.ts (streaming, usage, history), tools/
  auth/           AuthGuard (API key | JWT), constant-time key check
  tenancy/        TenantContext, TenantGuard, rate limiter, usage store + budget, run lock
  threads/        controller (SSE), service (ownership, validation), repository
  config/         zod-validated env (fail fast), price table
  observability/  OTel SDK bootstrap, span helpers
  database/       pg pool, PostgresSaver, DDL
apps/api/test     graph, HTTP (auth, tenants, budget, SSE, approvals), config tests
apps/web          Next.js App Router chat + server-side proxy
evals/            dataset, recordings, runner
infra/            OpenTelemetry Collector config
```

## License

[MIT](LICENSE) © Massimiliano Polce
