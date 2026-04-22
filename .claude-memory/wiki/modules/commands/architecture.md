# commands — architecture

Subcommands (all dispatched from `src/cli.ts` via `commander`):

- `init.ts` — scaffold `.claude-memory/`, merge `.claude/settings.json`, inject the `CLAUDE.md` block.
- `bootstrap.ts` — drive the bootstrap pipeline in `src/bootstrap/*`.
- `compile.ts` — run the deterministic → LLM → lint passes from `src/compile/*`, under a lockfile.
- `hook.ts` — subcommands for the three Claude Code hooks (`pre-task`, `post-write`, `session-end`).
- `doctor.ts` — health check and `--suggest-cron` output.
- `status.ts` — show current memory state (pending events, last compile, etc.).

Each command is thin: argument parsing + orchestration. Real logic lives in `core/`, `compile/`, `bootstrap/`.
