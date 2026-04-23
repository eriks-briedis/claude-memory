# core — decisions

_ADRs and notable technical decisions. One decision per section._

## Path-in-prompt resolver pass

The resolver matches module `owned_paths` against file paths mentioned in the user prompt. A prompt that names a file inside a module's owned paths selects that module even without an alias hit. This complements alias/keyword matching and reduces misses when users refer to code by path rather than name.

## Per-write module re-resolution

The post-write hook re-resolves the module at each write rather than trusting the module chosen at `UserPromptSubmit` time. A single session can touch multiple modules, and tagging every `file_write` with the prompt-time module mis-attributed writes across module boundaries.
