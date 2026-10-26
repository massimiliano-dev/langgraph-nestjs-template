# evals

Regression evals for the agent. Cases live in `dataset.jsonl`; each one states the input and what must happen,
for example "must interrupt before `send_email`".

| Mode   | Command                   | Model                               | Used by                                         |
| ------ | ------------------------- | ----------------------------------- | ----------------------------------------------- |
| Replay | `pnpm eval`               | Recorded responses in `recordings/` | Pull request CI: fast, deterministic, free      |
| Live   | `EVAL_LIVE=1 pnpm eval`   | Real model, needs keys              | Nightly workflow, fails under `EVAL_MIN_SCORE`  |
| Record | `EVAL_RECORD=1 pnpm eval` | Real model, writes `recordings/`    | You, after changing prompts, tools or the model |

The recordings in the repository are hand-written seeds (`"source": "seed"`). Re-record them once with a real
key. Recordings are scrubbed before writing, and a test fails if one looks like it contains a credential:
always review the diff before committing them.
