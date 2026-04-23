# compile — gotchas

_Non-obvious traps and hard-won knowledge._

## Sentinel `session_summary` events on empty sessions

`summarize-sessions.ts` emits a sentinel `session_summary` event (`module: null`, `summary: null`, `importance: normal`) for every `session_close` that fails to produce real summaries. This keeps the compile cursor advancing and makes "we looked, there was nothing" distinguishable from "we never looked."

Consumers that iterate `session_summary` events must tolerate `summary === null` and `module === null` — do not assume a summary payload is present.
