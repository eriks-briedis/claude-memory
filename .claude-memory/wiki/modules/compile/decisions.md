# compile — decisions

_ADRs and notable technical decisions. One decision per section._

## Session summarization feeds the LLM pass

Raw hook events (`user_prompt`, `file_write`, `session_close`) are intentionally thin — they record what happened, not why. On their own they are insufficient signal for the LLM compile pass to produce meaningful wiki updates.

To bridge that gap, `src/compile/summarize-sessions.ts` runs before the LLM pass. It reads session transcripts and emits higher-level events (`session_summary`, `learned_fact`) that carry intent and rationale. The LLM pass then consumes these summaries alongside raw events.

## New event types: `session_summary` and `learned_fact`

Added to `core/events.ts` and emitted by `summarize-sessions.ts`. These are the canonical signal for "why" a change was made; raw `file_write` events remain the canonical signal for "what" changed.
