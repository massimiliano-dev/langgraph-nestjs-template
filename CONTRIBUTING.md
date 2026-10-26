# Contributing

Thanks for helping. Issues and pull requests are welcome.

1. `pnpm install`, then `pnpm test` (unit tests and evals in replay mode, no network or API key needed).
2. Keep changes focused and covered by tests. Changes to the approval flow, authentication or tenant isolation
   need a test that shows the attack failing (see `apps/api/test/graph.test.ts` and `http.test.ts`).
3. New tools follow "Adding a tool safely" in the README. If agent behaviour changes, update the eval dataset
   and re-record with `EVAL_RECORD=1 pnpm eval` using synthetic inputs only; review the recording diff.
4. Never commit credentials, `.env` files, real customer data or unscrubbed model output. Report
   vulnerabilities privately, see [SECURITY.md](SECURITY.md).

Code style is enforced by ESLint and Prettier (`pnpm lint`, `pnpm format`). Before opening a PR:
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
