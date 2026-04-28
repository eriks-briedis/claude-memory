# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.3] - 2026-04-28

### Fixed
- **SessionStart context noise.** `runSessionStart` injected every
  high-importance event ever recorded, even after its content had been
  promoted into a canonical wiki page. The hook now only surfaces
  high-importance events from the last 14 days, capping the recurring
  injection to a sliding window. The on-disk `open-questions.md` is
  unchanged and still lists the full history.

## [0.6.2] - 2026-04-28

### Fixed
- **Duplicate context injection within a session.** The `UserPromptSubmit` hook
  previously re-injected the same wiki pages on every prompt in a conversation.
  Pages are now tracked in session state (`injected_pages`) and each page is
  sent at most once per session.

## [0.6.1] - 2026-04-23

### Fixed
- **Duplicate session summarization.** The `Stop` hook fires once per
  `claude` invocation, so a session with multiple sub-invocations accumulated
  multiple `session_close` events sharing the same `session_id`.
  `runSessionSummaryPass` now deduplicates by `session_id` before the LLM
  loop, so each session is summarized exactly once instead of once per Stop.

## [0.6.0] - 2026-04-23

### Added
- **Session-end transcript summarization.** The `Stop` hook now captures the
  Claude Code `transcript_path` on the `session_close` event. A new compile
  pass (`compile/summarize-sessions.ts`) replays un-summarized transcripts
  through `claude -p` and emits `session_summary` events — one per module
  discussed — which then feed the LLM pass alongside regular `file_write`
  events. Review-style sessions that touched no files now leave durable
  memory instead of vanishing at Stop.
- **`session_summary` and `learned_fact` event types.** Both are first-class
  inputs to the LLM pass. `learned_fact` is for Claude to volunteer during a
  session; the CLAUDE.md template now documents the schema and when to use
  `importance: high`.
- **Module-null high-importance events now reach the LLM.** Previously the
  LLM pass filtered strictly by `e.module === moduleId`, so cross-cutting
  summaries and user instructions never surfaced. The filter now also admits
  `session_summary`, `learned_fact`, and `user_instruction` events with
  `module: null` when `importance: high`.
- **`path-in-prompt` resolution pass.** If the user pastes a literal path
  matching any module's `owned_paths` prefix (`services/disputes/...`,
  `src/compile/...`), that module wins — even over an incidentally-appearing
  alias word in the same sentence. Longest matching prefix wins; equal-length
  ties return null. New `ResolvedModule.matchedPath` exposes the match.
- **Per-write module re-resolution in `post-write`.** `file_write` events are
  now tagged using `resolveFromEditedFiles` against the actual file path, not
  just the stale `session.resolved_module` decided at prompt time. A confident
  hit also promotes `session.resolved_module` so subsequent writes in the
  same session benefit. Cuts the null/wrong-module tagging rate dramatically
  on ambiguous prompts like "fix this bug".
- **GitHub Actions.** `test.yml` runs `npm ci && npm run build && npm test`
  on every branch push and PR. `publish.yml` publishes to npm on push to
  `master` via Trusted Publishing (OIDC, no long-lived tokens) with
  `--provenance`; already-published versions are detected and skipped.

### Changed
- **Resolver cascade re-ordered: path → alias → fuzzy.** Path-in-prompt now
  runs *before* alias-exact. When both could match, pasted paths are the more
  specific signal of intent.

## [0.5.1] - 2026-04-23

### Added
- **`retrieval.show_breadcrumb` config flag** (default `false`). When enabled,
  the `pre-task` hook emits a `systemMessage` alongside `additionalContext`,
  surfacing the retrieval summary in the regular TUI transcript instead of
  only on debug stderr — e.g. `[claude-memory] pre-task: module=bootstrap
  (alias-exact:bootstrap), loaded 4 page(s), 1243 token(s)`. New installs
  see the option in the scaffolded `config.yaml`; existing installs need to
  add `show_breadcrumb: true` under `retrieval:` manually.

## [0.5.0] - 2026-04-23

### Changed
- **Alias matching now requires word boundaries.** The exact-alias pass in
  `core/resolver.ts` uses `\b<alias>\b` instead of raw `String.includes`, so
  alias `"api"` no longer matches the word "capitalize" and alias `"auth"`
  no longer matches "authoritative". Expect fewer false-positive retrievals
  — and a few prompts that previously matched loosely may now fall through
  to fuzzy or stickiness.
- **Fuzzy fallback actually works now.** Previously `Searcher.search(prompt)`
  compared the full prompt string to short aliases at threshold 0.85 — a
  pairing that almost never cleared the bar. The resolver now tokenizes the
  prompt (`[^A-Za-z0-9_-]+` split, minimum 4-char tokens) and searches each
  token against aliases, keeping the best score. The second-chance resolver
  is no longer effectively dead.

### Added
- **Session-sticky fallback.** `resolveModule` now accepts an optional
  `priorModuleId` and returns the prior turn's module (reason:
  `session-sticky`) when prompt resolution and recent-edits both fail. Short
  follow-up prompts like "keep going" or "fix that" carry the active module
  forward instead of falling off into no-module retrieval.
- `wiki/current/pinned.md` is now auto-included in every `pre-task` context
  load. Previously the template advertised it as "always in context" but
  nothing read it unless users added it to `retrieval.always_read` manually.
- `ResolvedModule.matchedAlias` exposes which alias fired, and the pre-task
  breadcrumb surfaces it: `module=foo (alias-exact:login)`.

## [0.4.1] - 2026-04-23

### Added
- `bootstrap` now streams events from `claude -p` via
  `--output-format=stream-json --verbose`. Prints `model`, `session_id`, and
  permission mode within ~100ms of connecting; emits per-turn lines for each
  tool call the model makes; a 10s ticker surfaces live
  `elapsed/turns/output-tokens/tool-count` counters; warns on
  `rate_limit_event` when status is not `allowed`; final summary reports
  turns, output tokens, tool calls, claude-reported duration, cache read
  tokens, and `total_cost_usd`.
- `bootstrap --verbose` / `-v`: dumps the full prompt, the full raw response,
  every stream event type, and the `claude` stderr stream.
- `bootstrap` writes the raw claude response to
  `.claude-memory/state/bootstrap-last-response.txt` on every run — useful
  for diffing between attempts and for inspection on parse failure.
- New `parseJsonResponse<T>` diagnostic helper in `util/claude.ts` reports
  the parse stage (`wrapper-object` / `wrapper-result-object` /
  `wrapper-result-embedded` / `raw-embedded` / `none`) and extracts wrapper
  metadata (session id, usage, cost, `is_error`).
- `invokeClaude` gained `stream`, `includePartialMessages`, `onEvent`, and
  `onStderr` options, and now returns `{stdout, stderr, exitCode,
  durationMs, finalEvent}` instead of a bare string.

### Changed
- `bootstrap` now prints each planned module (id, source, owned paths), the
  prompt size in chars + tokens, and warns when the model omits planned
  modules or returns unplanned ones.
- On claude failure, `bootstrap` prints the exit code, full stderr, and a
  reproducer hint instead of only the error message.
- On parse failure, `bootstrap` prints the specific parse error, the first
  500 chars of the response, flags `is_error=true` when claude reported it,
  and points at the saved debug file.

## [0.4.0] - 2026-04-22

### Added
- `claude-memory bootstrap [--dry-run] [--force] [--no-config]` generates the
  initial wiki from the current project. Collects signals (package.json,
  README, filtered directory tree, language tally, candidate modules under
  src/ / services/ / apps/ / packages/), invokes `claude -p` with a
  structured prompt, and writes overview, conventions, and per-module
  index/architecture pages. Updates `config.yaml` modules block if none were
  declared. Safe by default — only overwrites template pages; `decisions.md`,
  `gotchas.md`, `pinned.md`, `active-work.md`, `open-questions.md` are never
  touched.
- `src/util/claude.ts` — shared `invokeClaude` + `extractJson` helpers
  factored out of `compile/llm.ts`. Now reused by bootstrap.
- Template files include a `<!-- claude-memory:template -->` sentinel so
  bootstrap can distinguish default scaffolding from user-curated content.

### Changed
- `compile/llm.ts` now imports from `util/claude.ts` (pure refactor, no
  behavior change).

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

[0.6.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.6.0
[0.5.1]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.5.1
[0.5.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.5.0
[0.4.1]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.4.1
[0.4.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.4.0
[0.3.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.3.0
[0.2.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.2.0
[0.1.3]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.1.3
[0.1.2]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.1.2
[0.1.1]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/@briedis/claude-memory/v/0.1.0
