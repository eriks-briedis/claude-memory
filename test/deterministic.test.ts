import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPaths } from "../src/core/paths.js";
import { runDeterministic, filterNewEvents, readLastCompiled } from "../src/compile/deterministic.js";
import type { Config } from "../src/core/config.js";
import type { MemoryEvent } from "../src/core/events.js";

function seedWiki(paths: ReturnType<typeof buildPaths>): void {
  mkdirSync(join(paths.wikiDir, "current"), { recursive: true });
  mkdirSync(join(paths.wikiDir, "modules", "disputes"), { recursive: true });
  writeFileSync(join(paths.wikiDir, "current", "active-work.md"), "# Active work\n\n");
  writeFileSync(
    join(paths.wikiDir, "modules", "disputes", "index.md"),
    "# disputes\n\n## Files\n\n"
  );
  mkdirSync(paths.stateDir, { recursive: true });
}

const config: Config = {
  project: { id: "p", memory_enabled: true },
  retrieval: { always_read: [], max_context_tokens: 8000 },
  modules: {
    disputes: {
      aliases: ["disputes"],
      wiki_path: "wiki/modules/disputes",
      owned_paths: ["services/disputes/**"],
      related_cross_cutting: []
    }
  }
};

function ev(module: string | null, files: string[], ts: string): MemoryEvent {
  return {
    type: "file_write",
    session_id: "s",
    module,
    files,
    ts,
    summary: null,
    importance: "normal"
  };
}

describe("runDeterministic", () => {
  it("rewrites active-work, appends files to module index, updates last-compiled", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-det-"));
    const paths = buildPaths(root);
    seedWiki(paths);
    const now = new Date().toISOString();
    const events: MemoryEvent[] = [
      ev("disputes", ["services/disputes/a.ts"], now),
      ev("disputes", ["services/disputes/b.ts"], now)
    ];
    const res = runDeterministic(paths, config, events);
    expect(res.modulesTouched).toContain("disputes");

    const active = readFileSync(join(paths.wikiDir, "current", "active-work.md"), "utf8");
    expect(active).toContain("- disputes");

    const index = readFileSync(
      join(paths.wikiDir, "modules", "disputes", "index.md"),
      "utf8"
    );
    expect(index).toContain("- services/disputes/a.ts");
    expect(index).toContain("- services/disputes/b.ts");

    expect(readLastCompiled(paths)).toBe(now);
  });

  it("filters events older than last-compiled", () => {
    const events: MemoryEvent[] = [
      ev("disputes", ["a.ts"], "2026-04-01T00:00:00.000Z"),
      ev("disputes", ["b.ts"], "2026-04-22T00:00:00.000Z")
    ];
    const filtered = filterNewEvents(events, "2026-04-15T00:00:00.000Z");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].files[0]).toBe("b.ts");
  });
});
