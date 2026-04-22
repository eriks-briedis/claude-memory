# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-04-22

### Added
- `SessionStart` hook (`claude-memory hook session-start`) surfaces
  high-importance events from prior sessions when Claude Code opens a session.
  Emits a stderr breadcrumb (visible in the TUI) listing up to 5 recent
  items, and injects the full list into the turn as `additionalContext` so
  Claude can act on them without re-reading `open-questions.md`.
- `init` now wires the new hook into `.claude/settings.json`; `doctor`
  verifies it.

### Migration
Existing projects should re-run `claude-memory init --force` (idempotent) to
pick up the new hook entry, or add it manually to `.claude/settings.json`.

## [0.2.0] - 2026-04-22

### Changed
- **Compile is now deterministic across the full event history.** The module
  `## Files` section is rewritten from all historical `file_write` events on
  every run, not append-only, so renames and deletes drop out of the list.
  `runDeterministic` signature now takes both `newEvents` (advances
  `last-compiled.txt`) and `allEvents` (reconciles state).
- LLM prompts now receive a compact one-line summary per event (`Edit src/foo.ts:
  3L → 3L ("return 1" → "return 2")`) instead of the raw JSON event stream.
  Prompts shrink dramatically on busy modules while preserving what the model
  needs to decide whether to promote material.
- `dedupEvents` was a no-op (always pushed every event) — removed. Downstream
  `Set`-based collection already dedupes.

### Added
- `wiki/current/open-questions.md` is now regenerated on every compile from
  all `importance: high` events across history. Previously these were counted
  in the summary line and then discarded.
- `compile` takes an advisory lock on `state/compile.lock` via
  `proper-lockfile`. A concurrent compile exits 3 with a clear message rather
  than racing on `last-compiled.txt` and wiki writes.

## [0.1.3] - 2026-04-22

### Fixed
- `compile` no longer crashes on events that are missing `ts` or `files`.
  Malformed event files are now skipped with a stderr warning naming the
  offending path, instead of aborting the whole pipeline.

## [0.1.2] - 2026-04-22

### Added
- `file_write` events now include a `changes[]` array capturing the tool used
  (`Write` / `Edit` / `MultiEdit`), the change kind, and the actual
  `old_string` / `new_string` (or `content`) truncated to 500 chars with
  `*_truncated` markers.
- New `user_prompt` event emitted by the pre-task hook, tagged with the
  resolved module, so the compiler can correlate prompts with subsequent
  writes.
- Post-write stderr breadcrumb now reports the tool name.
- Hook entrypoints (`runPreTask`, `runPostWrite`, `runSessionEnd`) accept an
  optional payload argument for direct testing.

## [0.1.1] - 2026-04-22

### Added
- Stderr breadcrumbs from all three hooks so session activity is visible in
  Claude Code:
  - `pre-task: module=<id> (<reason>), loaded N page(s), T token(s)`
  - `post-write: module=<id>, N file(s): <paths>`
  - `session-end: module=<id>, N file(s) touched`

## [0.1.0] - 2026-04-22

### Added
- Initial release.
- CLI: `init`, `compile`, `status`, `doctor`, and internal `hook` dispatcher.
- `UserPromptSubmit` / `PostToolUse` / `Stop` hooks wired into
  `.claude/settings.json` during `init`.
- Module resolver: alias exact + fuzzy, recent-edits glob fallback.
- Token-budgeted context loader driven by `config.yaml`.
- Append-only event log with lock-protected per-day counter.
- Compile pipeline: deterministic pass (active-work rewrite, file lists,
  open-question flagging), LLM pass via `claude -p`, wiki lint.
- Starter wiki skeleton with a sample module seeded by `init`.

[0.3.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.3.0
[0.2.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.2.0
[0.1.3]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.1.3
[0.1.2]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.1.2
[0.1.1]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.1.0
