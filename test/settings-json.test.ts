import { describe, it, expect } from "vitest";
import {
  CLAUDE_MEMORY_HOOKS,
  mergeHooks,
  type ClaudeSettings
} from "../src/util/settings-json.js";

describe("mergeHooks", () => {
  it("adds our hooks to an empty settings file", () => {
    const result = mergeHooks({}, CLAUDE_MEMORY_HOOKS);
    expect(result.hooks?.UserPromptSubmit?.length).toBe(1);
    expect(result.hooks?.PostToolUse?.[0].matcher).toBe("Write|Edit|MultiEdit");
  });

  it("is idempotent on repeat invocation", () => {
    const once = mergeHooks({}, CLAUDE_MEMORY_HOOKS);
    const twice = mergeHooks(once, CLAUDE_MEMORY_HOOKS);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("preserves unrelated hooks owned by other tools", () => {
    const base: ClaudeSettings = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "my-custom-hook" }]
          }
        ]
      }
    };
    const merged = mergeHooks(base, CLAUDE_MEMORY_HOOKS);
    const post = merged.hooks?.PostToolUse ?? [];
    expect(post.find((m) => m.matcher === "Bash")?.hooks[0].command).toBe(
      "my-custom-hook"
    );
    expect(post.find((m) => m.matcher === "Write|Edit|MultiEdit")).toBeDefined();
  });

  it("dedupes a command within an existing matcher", () => {
    const base: ClaudeSettings = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command", command: "claude-memory hook pre-task" }]
          }
        ]
      }
    };
    const merged = mergeHooks(base, CLAUDE_MEMORY_HOOKS);
    expect(merged.hooks?.UserPromptSubmit?.[0].hooks.length).toBe(1);
  });
});
