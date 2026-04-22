# claude-memory

Per-project memory wiki for Claude Code. Drives retrieval and event logging
through hooks so Claude is the reasoning layer, not the enforcement layer.

## Install

```
npm install -g @briedis/claude-memory
```

Requires Node.js 20+ and the `claude` CLI on PATH (for the nightly LLM compile).

## Use in a project

```
cd path/to/repo
claude-memory init
```

`init` creates:

- `.claude-memory/` — config, wiki, raw events, state
- `.claude/settings.json` — Claude Code hooks wiring (merged, not overwritten)
- `CLAUDE.md` — scoped `<!-- claude-memory -->` block with reasoning rules

Edit `.claude-memory/config.yaml` to define your modules, then `claude-memory doctor`.

## How it works

Three hooks fire during Claude Code sessions:

| Event | Hook command | Job |
|---|---|---|
| `UserPromptSubmit` | `claude-memory hook pre-task` | Resolve module from prompt, load relevant wiki pages, inject as `additionalContext` |
| `PostToolUse` on Write/Edit/MultiEdit | `claude-memory hook post-write` | Append a `file_write` event tagged with the resolved module |
| `Stop` | `claude-memory hook session-end` | Write a `session_close` event with all files touched |

A nightly `claude-memory compile` (via cron/launchd) promotes raw events into
the canonical wiki:

1. Deterministic pass: dedup events, rewrite `active-work.md`, append new files
   to module indexes, flag high-importance events missing wiki coverage.
2. LLM pass (scoped to changed modules): invokes `claude -p` with each module's
   current `decisions.md` + `gotchas.md` + new events; accepts a JSON response
   to update those pages.
3. Lint pass: flags broken links and missing index entries.

Set up the cron with `claude-memory doctor --suggest-cron`.

## Commands

- `claude-memory init [--force]` — scaffold a new project
- `claude-memory bootstrap [--dry-run] [--force] [--no-config]` — generate the initial wiki from the current codebase via `claude -p`
- `claude-memory compile [--no-llm]` — run the compile pipeline
- `claude-memory status` — summary of config, event count, last compile
- `claude-memory doctor [--suggest-cron]` — validate configuration
- `claude-memory hook {session-start,pre-task,post-write,session-end}` — internal, invoked by Claude Code

## License

MIT
