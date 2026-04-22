import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { loadConfig } from "../src/core/config.js";

function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  return fn().finally(() => process.chdir(prev));
}

describe("runInit", () => {
  it("scaffolds memory dir, config, wiki, hooks, and CLAUDE.md", async () => {
    const root = mkdtempSync(join(tmpdir(), "cm-init-"));
    await withCwd(root, () => runInit({}));

    expect(existsSync(join(root, ".claude-memory", "config.yaml"))).toBe(true);
    expect(existsSync(join(root, ".claude-memory", "wiki", "index.md"))).toBe(true);
    expect(
      existsSync(join(root, ".claude-memory", "wiki", "modules", "example", "index.md"))
    ).toBe(true);
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);

    const cfg = loadConfig(join(root, ".claude-memory", "config.yaml"));
    expect(cfg.project.id).toBeTruthy();
    expect(cfg.modules.example).toBeDefined();

    const settings = JSON.parse(
      readFileSync(join(root, ".claude", "settings.json"), "utf8")
    );
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe(
      "claude-memory hook pre-task"
    );
  });

  it("preserves existing CLAUDE.md and inserts block at end", async () => {
    const root = mkdtempSync(join(tmpdir(), "cm-init-"));
    writeFileSync(join(root, "CLAUDE.md"), "# Project rules\n\nBe kind.\n");
    await withCwd(root, () => runInit({}));

    const content = readFileSync(join(root, "CLAUDE.md"), "utf8");
    expect(content).toContain("# Project rules");
    expect(content).toContain("<!-- claude-memory:start -->");
    expect(content).toContain("<!-- claude-memory:end -->");
  });

  it("preserves other tools' hook entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "cm-init-"));
    mkdirSync(join(root, ".claude"));
    writeFileSync(
      join(root, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "custom" }] }
          ]
        }
      })
    );
    await withCwd(root, () => runInit({}));
    const settings = JSON.parse(
      readFileSync(join(root, ".claude", "settings.json"), "utf8")
    );
    const post = settings.hooks.PostToolUse;
    expect(post.find((m: { matcher: string }) => m.matcher === "Bash")).toBeDefined();
    expect(
      post.find((m: { matcher: string }) => m.matcher === "Write|Edit|MultiEdit")
    ).toBeDefined();
  });
});
