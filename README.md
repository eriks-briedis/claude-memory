```
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗    ███╗   ███╗███████╗███╗   ███╗ ██████╗ ██████╗ ██╗   ██╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝    ████╗ ████║██╔════╝████╗ ████║██╔═══██╗██╔══██╗╚██╗ ██╔╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗      ██╔████╔██║█████╗  ██╔████╔██║██║   ██║██████╔╝ ╚████╔╝
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝      ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██║   ██║██╔══██╗  ╚██╔╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗    ██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║╚██████╔╝██║  ██║   ██║
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝    ╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝
```

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

Four hooks fire during Claude Code sessions:

| Event | Hook command | Job |
|---|---|---|
| `SessionStart` | `claude-memory hook session-start` | Surface high-importance events (e.g. pending `user_instruction` items) from prior sessions as `additionalContext` |
| `UserPromptSubmit` | `claude-memory hook pre-task` | Resolve module from prompt, load relevant wiki pages, inject as `additionalContext` |
| `PostToolUse` on Write/Edit/MultiEdit | `claude-memory hook post-write` | Append a `file_write` event tagged with the resolved module |
| `Stop` | `claude-memory hook session-end` | Write a `session_close` event with all files touched |

Module resolution for `pre-task` tries, in order: exact alias match (word-bounded),
recent-edits from the current session, fuzzy alias match over prompt tokens, and
finally session-sticky (the prior turn's module) so short follow-ups like
"keep going" carry the active module forward. `wiki/current/pinned.md` is always
loaded, regardless of which module is resolved.

A nightly `claude-memory compile` (via cron/launchd) promotes raw events into
the canonical wiki:

1. Deterministic pass: dedup events, rewrite `active-work.md`, append new files
   to module indexes, flag high-importance events missing wiki coverage.
2. LLM pass (scoped to changed modules): invokes `claude -p` with each module's
   current `decisions.md` + `gotchas.md` + new events; accepts a JSON response
   to update those pages.
3. Lint pass: flags broken links and missing index entries.

Set up the cron with `claude-memory doctor --suggest-cron`.

## Bootstrap

`claude-memory bootstrap` seeds the initial wiki from the current codebase by
invoking `claude -p`. It gathers repo signals (`package.json`, README excerpt,
language mix, filtered tree, planned modules), builds a strict-JSON prompt,
streams progress from the model (`model`, `session_id`, per-turn tool calls, a
10s `elapsed/turns/tokens/tool-count` ticker, and a final summary with cache
read tokens and `total_cost_usd`), and writes the validated response to
`.claude-memory/wiki/`. Use `--dry-run` to preview, `--force` to overwrite an
existing wiki, and `-v`/`--verbose` to dump the full prompt, raw response, and
stream events. The raw response is saved to
`.claude-memory/state/bootstrap-last-response.txt` on every run for inspection.

## Observability

By default, the `pre-task` hook writes a one-line stderr breadcrumb visible
under `claude --debug`:

```
[claude-memory] pre-task: module=bootstrap (alias-exact:bootstrap), loaded 4 page(s), 1243 token(s)
```

Set `retrieval.show_breadcrumb: true` in `.claude-memory/config.yaml` to also
surface that summary as a `systemMessage` in the regular Claude Code TUI
transcript, so you can see retrieval decisions in-context without debug mode.

## Commands

- `claude-memory init [--force]` — scaffold a new project
- `claude-memory bootstrap [--dry-run] [--force] [--no-config]` — generate the initial wiki from the current codebase via `claude -p`
- `claude-memory compile [--no-llm]` — run the compile pipeline
- `claude-memory status` — summary of config, event count, last compile
- `claude-memory doctor [--suggest-cron]` — validate configuration
- `claude-memory hook {session-start,pre-task,post-write,session-end}` — internal, invoked by Claude Code

## License

MIT
