<!-- claude-memory:template -->
# claude-memory wiki

- [Project overview](project/overview.md)
- [Conventions](project/conventions.md)
- [Active work](current/active-work.md)
- [Pinned context](current/pinned.md)

## Modules

- [bootstrap](modules/bootstrap/index.md) — initial wiki generation from a codebase via `claude -p`
- [commands](modules/commands/index.md) — CLI subcommands (init, bootstrap, compile, hook, doctor, status)
- [compile](modules/compile/index.md) — nightly deterministic + LLM + lint passes over raw events
- [core](modules/core/index.md) — config, paths, event log, resolver, context loader, tokens
- [templates](modules/templates/index.md) — scaffolding templates for `init`
- [util](modules/util/index.md) — shared helpers (claude CLI wrapper, settings.json merge)
