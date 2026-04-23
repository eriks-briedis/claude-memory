# commands — decisions

_ADRs and notable technical decisions. One decision per section._

## Post-write re-resolves module per event

The `post-write` hook re-resolves the module for each write rather than reusing whatever `pre-task` resolved at session start. A single session can span multiple modules (e.g. a prompt about `commands` that ends up editing files in `core`), so a session-sticky module would mis-tag events. Resolution inputs for a post-write event are the file path plus the session's original prompt.

## Session-end records a transcript

`hook session-end` appends the usual `session_close` event *and* writes a transcript snapshot for the compile pipeline's `summarize-sessions` pass to consume. The session-end breadcrumb reflects this: `session-end: module=X, N file(s) touched, transcript recorded`. This is the only hook that does meaningful I/O beyond appending one event — kept here (not in compile) because the transcript is only available at session close.
