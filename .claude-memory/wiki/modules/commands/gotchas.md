# commands — gotchas

_Non-obvious traps and hard-won knowledge._

## `post-write` module tag is not session-sticky

Don't assume the module on a `file_write` event matches the module resolved by `pre-task` for the same session. `post-write` re-resolves per write using the file path and original prompt, so events within one session can be tagged across multiple modules.

## Path-in-prompt can override alias-exact resolution

When a prompt contains a file path, the resolver's path-in-prompt pass can win over alias-exact matches (see `core/resolver.ts` and `test/resolver.test.ts`). If a hook appears to tag a prompt to an "unexpected" module, check whether a path literal in the prompt pointed at that module's `owned_paths`.
