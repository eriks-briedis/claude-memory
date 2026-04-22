# compile — architecture

Three passes, run in order by `src/commands/compile.ts` under a `proper-lockfile` lock:

1. `deterministic.ts` — dedup events, rewrite `current/active-work.md`, append new files to module indexes, flag high-importance events lacking wiki coverage.
2. `llm.ts` — for each changed module, call `claude -p` with the module's `decisions.md` + `gotchas.md` + new events; parse a JSON response and update those pages. Supports `--no-llm` to skip this pass.
3. `lint.ts` — flag broken links and missing index entries.

`summarize.ts` provides shared helpers for shaping event batches into prompts. Consumes events via `core/events.ts` and config via `core/config.ts`; shells to Claude via `util/claude.ts`.
