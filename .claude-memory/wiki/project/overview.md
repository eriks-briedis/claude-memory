# claude-memory — overview

Per-project memory wiki for Claude Code. Retrieval and event logging are driven by Claude Code hooks; a nightly compiler promotes raw events into a canonical wiki. Claude is the reasoning layer; this tool is the plumbing.

## What it does

- Scaffolds a `.claude-memory/` directory (config, wiki, raw events, state) in a project.
- Wires three Claude Code hooks into `.claude/settings.json`:
  - `UserPromptSubmit` → `hook pre-task`: resolve module from prompt, inject relevant wiki pages as `additionalContext`.
  - `PostToolUse` on Write/Edit/MultiEdit → `hook post-write`: append a `file_write` event tagged by module.
  - `Stop` → `hook session-end`: append a `session_close` event listing all files touched.
- Compiles raw events into wiki pages (deterministic → LLM → lint).
- Can bootstrap an initial wiki from the current codebase by invoking `claude -p`.

## Architecture

- `src/cli.ts` — commander entry point, dispatches to `src/commands/*`.
- `src/commands/*` — one file per subcommand (`init`, `bootstrap`, `compile`, `hook`, `doctor`, `status`).
- `src/core/*` — shared primitives: config loader, path resolver, event append/read, module resolver, context loader, token counting.
- `src/compile/*` — the three compile passes (`deterministic`, `llm`, `lint`) plus a `summarize` helper.
- `src/bootstrap/*` — signal gathering, prompt construction, and applying the LLM result to disk.
- `src/templates/*` — files copied into a new project by `init` (CLAUDE.md block, config.yaml, wiki skeleton).
- `src/util/*` — `claude.ts` shells out to the `claude` CLI; `settings-json.ts` does a scoped merge of `.claude/settings.json`.

## Key dependencies

- `commander` — CLI framework.
- `zod` — config schema validation.
- `yaml` — parses `config.yaml`.
- `@anthropic-ai/tokenizer` — token budgeting for context injection.
- `fast-fuzzy` — fuzzy matching for module resolution from prompts.
- `micromatch` — glob matching for `owned_paths`.
- `proper-lockfile` — serializes concurrent compile runs.
- `chalk` — terminal output.

## Entry points

- `bin: claude-memory` → `dist/cli.js` (built from `src/cli.ts`).
- External runtime requirement: the `claude` CLI on PATH, used by `compile` (LLM pass) and `bootstrap`.

## Runtime data layout

- `.claude-memory/config.yaml` — modules, aliases, owned paths.
- `.claude-memory/wiki/` — canonical pages (overview, conventions, modules, current/).
- `.claude-memory/raw/events/` — append-only JSONL events from hooks.
- `.claude-memory/state/` — compile cursor, session state.
