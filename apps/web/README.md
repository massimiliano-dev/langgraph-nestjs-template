# web

Minimal Next.js chat for the agent API: streams answers over SSE and shows pending tool calls with Approve and
Reject buttons.

- The browser never sees the API key. Requests go to the route handlers in `app/api/threads/**`, which add the
  key server-side and proxy to the API.
- The route handlers accept same-origin JSON requests only, and the app sends a Content Security Policy.
- There is no login: the tenant comes from `AGENT_DEMO_TENANT_ID`. Add your own authentication before exposing it.

```bash
pnpm --filter web dev    # http://localhost:3001, reads ../../.env
```

See the [main README](../../README.md) for the full stack and configuration.
