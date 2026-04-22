# bootstrap — architecture

Three-step pipeline invoked by `claude-memory bootstrap`:

1. `signals.ts` — gather repo signals: `package.json`, README excerpt, language distribution, filtered directory tree, planned modules from `config.yaml`.
2. `prompt.ts` — build the prompt sent to `claude -p`, including the strict JSON output contract (wiki_index, overview, conventions, modules).
3. `apply.ts` — validate the model's JSON response and write it to `.claude-memory/wiki/` (with `--dry-run` and `--force` gates).

Called from `src/commands/bootstrap.ts`. Shells out via `src/util/claude.ts`. Does not touch the event log or compile state — it only seeds canonical wiki pages.
