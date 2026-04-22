# templates — architecture

Not TypeScript code — a tree of template files bundled into `dist/` by `scripts/copy-templates.mjs` at build time.

Contents:

- `CLAUDE.md.tmpl` — the scoped `<!-- claude-memory -->` block appended to a project's `CLAUDE.md`.
- `config.yaml.tmpl` — starter `.claude-memory/config.yaml` with example module definitions.
- `wiki/` — initial wiki skeleton (`index.md`, `project/`, `current/`, `modules/example/`).

Read at runtime by `src/commands/init.ts` (and indirectly by `bootstrap`).
