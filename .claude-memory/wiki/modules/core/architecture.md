# core — architecture

Pure modules with no CLI concerns:

- `config.ts` — load and validate `.claude-memory/config.yaml` with `zod`; expose module definitions.
- `paths.ts` — resolve all well-known paths under `.claude-memory/` and `.claude/`.
- `events.ts` — append/read JSONL events in `raw/events/`.
- `resolver.ts` — map a prompt or file path to a module using aliases (`fast-fuzzy`) and `owned_paths` globs (`micromatch`).
- `context-loader.ts` — select relevant wiki pages for a prompt within a token budget.
- `session-state.ts` — track files touched during a Claude Code session, consumed by `session-end`.
- `tokens.ts` — token counting via `@anthropic-ai/tokenizer`.

Depended on by `commands/*`, `compile/*`, and `bootstrap/*`. Does not shell out or call the LLM.
