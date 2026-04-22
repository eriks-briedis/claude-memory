# util — architecture

- `claude.ts` — wrapper around the external `claude` CLI; used by `compile/llm.ts` and `bootstrap/apply.ts`. Centralizes process spawning, stdin/stdout handling, and error surfaces.
- `settings-json.ts` — scoped merge of `.claude/settings.json` so `init` can add hooks without clobbering user-authored settings.

No dependencies on `core/`, `compile/`, or `commands/` — these are leaf modules.
