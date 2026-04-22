# Conventions

## Language & build

- TypeScript, ESM (`"type": "module"`). Target Node.js ≥ 20.
- Build: `tsc` + `scripts/copy-templates.mjs` (copies `src/templates/**` to `dist/`).
- Published artifact: `dist/` + `README.md` + `CHANGELOG.md`. Bin entry is `dist/cli.js`.

## Layout

- `src/cli.ts` — CLI entry; each subcommand lives in `src/commands/<name>.ts`.
- `src/core/*` — pure, reusable primitives shared across commands and compile passes.
- `src/compile/*` — the three passes plus summarize; each pass is its own module.
- `src/bootstrap/*` — `signals` (gather) → `prompt` (build) → `apply` (write).
- Tests in `test/`, one file per source module, using Vitest (`vitest run`).

## Testing

- Framework: Vitest. Run with `npm test`; watch mode `npm run test:watch`.
- Tests colocated by subject (e.g. `resolver.test.ts` covers `core/resolver.ts`).
- Favor unit tests over end-to-end; filesystem effects use temp dirs.

## Config & data

- User config is `yaml`, validated with `zod` schemas in `core/config.ts`.
- Events are append-only JSONL under `.claude-memory/raw/events/`.
- `.claude/settings.json` is merged, never overwritten — see `util/settings-json.ts`.

## CLI style

- `commander`-based; subcommands mirror files in `src/commands/`.
- User-facing output uses `chalk`; stderr is for breadcrumbs (e.g. `[claude-memory] loaded N pages`).

## Invariants

- Compile runs are serialized with `proper-lockfile` — never bypass the lock.
- LLM pass is scoped to changed modules only; the deterministic pass must run first.
- Hooks must be fast and non-blocking: heavy work belongs in `compile`, not in a hook.
- Canonical wiki pages are only rewritten by the compiler or `bootstrap` — not by ad-hoc edits from Claude.

## Commits & versioning

- Semver via `package.json`. Release commits follow the pattern seen in history: `X.Y.Z release. <summary>`.
- `CHANGELOG.md` is maintained alongside version bumps.
