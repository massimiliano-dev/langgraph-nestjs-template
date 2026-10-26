# api

NestJS backend that runs the LangGraph agent. Endpoints, configuration and the security model are described in
the [main README](../../README.md) and in [SECURITY.md](../../SECURITY.md).

## Layout

| Folder              | Contents                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/agent`         | Graph (ReAct loop with a `review` node that interrupts before side-effect tools), runner, LLM factory, system prompt, tools. |
| `src/auth`          | API-key and JWT guard. Every route except `/health` requires it, SSE included.                                               |
| `src/tenancy`       | Tenant context (AsyncLocalStorage), per-tenant rate limit and monthly token budget, per-thread run lock.                     |
| `src/threads`       | Thread endpoints. Every access checks that the thread belongs to the current tenant.                                         |
| `src/observability` | OpenTelemetry setup and spans with tenant, thread, model, tokens and cost.                                                   |
| `src/config`        | Environment validation with zod, model price table.                                                                          |

## Commands

```bash
pnpm --filter api dev          # tsc --watch
pnpm --filter api start:watch  # restart on build output changes (reads ../../.env)
pnpm --filter api build && pnpm --filter api start
pnpm test                      # from the repository root
```

To add a tool, follow the checklist in the main README under "Adding a tool safely".
