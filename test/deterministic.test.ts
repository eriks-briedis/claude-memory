import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPaths } from "../src/core/paths.js";
import {
  runDeterministic,
  filterNewEvents,
  readLastCompiled
} from "../src/compile/deterministic.js";
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

function ev(
  module: string | null,
  files: string[],
  ts: string,
  overrides: Partial<MemoryEvent> = {}
): MemoryEvent {
  return {
    type: "file_write",
    session_id: "s",
    module,
    files,
    ts,
    summary: null,
    importance: "normal",
    ...overrides
  };
}

describe("runDeterministic", () => {
  it("rewrites active-work, reconciles the module file list, updates last-compiled", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-det-"));
    const paths = buildPaths(root);
    seedWiki(paths);
    const now = new Date().toISOString();
    const events: MemoryEvent[] = [
      ev("disputes", ["services/disputes/a.ts"], now),
      ev("disputes", ["services/disputes/b.ts"], now)
    ];
    const res = runDeterministic(paths, config, events, events);
    expect(res.modulesTouched).toContain("disputes");

    const active = readFileSync(
      join(paths.wikiDir, "current", "active-work.md"),
      "utf8"
    );
    expect(active).toContain("- disputes");

    const index = readFileSync(
      join(paths.wikiDir, "modules", "disputes", "index.md"),
      "utf8"
    );
    expect(index).toContain("- services/disputes/a.ts");
    expect(index).toContain("- services/disputes/b.ts");

    expect(readLastCompiled(paths)).toBe(now);
  });

  it("removes files from the index when history no longer lists them", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-det-"));
    const paths = buildPaths(root);
    seedWiki(paths);
    writeFileSync(
      join(paths.wikiDir, "modules", "disputes", "index.md"),
      "# disputes\n\n## Files\n\n- services/disputes/old.ts\n"
    );
    const now = new Date().toISOString();
    const events = [ev("disputes", ["services/disputes/new.ts"], now)];
    runDeterministic(paths, config, events, events);
    const index = readFileSync(
      join(paths.wikiDir, "modules", "disputes", "index.md"),
      "utf8"
    );
    expect(index).toContain("- services/disputes/new.ts");
    expect(index).not.toContain("old.ts");
  });

  it("writes open-questions.md from high-importance events", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-det-"));
    const paths = buildPaths(root);
    seedWiki(paths);
    const events = [
      ev("disputes", ["a.ts"], new Date().toISOString(), {
        type: "user_instruction",
        importance: "high",
        prompt: "remember: the ledger must reconcile within 24h"
      })
    ];
    runDeterministic(paths, config, events, events);
    const open = readFileSync(
      join(paths.wikiDir, "current", "open-questions.md"),
      "utf8"
    );
    expect(open).toContain("user_instruction");
    expect(open).toContain("ledger must reconcile");
  });

  it("excludes promoted high-importance events from open-questions", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-det-"));
    const paths = buildPaths(root);
    seedWiki(paths);
    const promotedFact = ev("disputes", [], new Date().toISOString(), {
      type: "session_summary",
      importance: "high",
      summary: "fact already merged into wiki",
      _id: "2026-04-23_001"
    });
    const stillOpen = ev("disputes", [], new Date().toISOString(), {
      type: "session_summary",
      importance: "high",
      summary: "fact not yet merged",
      _id: "2026-04-23_002"
    });
    const promotion = ev("disputes", [], new Date().toISOString(), {
      type: "promotion",
      importance: "normal",
      consumed_event_ids: ["2026-04-23_001"]
    });
    const all = [promotedFact, stillOpen, promotion];
    runDeterministic(paths, config, all, all);
    const open = readFileSync(
      join(paths.wikiDir, "current", "open-questions.md"),
      "utf8"
    );
    expect(open).toContain("not yet merged");
    expect(open).not.toContain("already merged");
  });

  it("writes (none) to open-questions when empty", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-det-"));
    const paths = buildPaths(root);
    seedWiki(paths);
    const events = [ev("disputes", ["a.ts"], new Date().toISOString())];
    runDeterministic(paths, config, events, events);
    const open = readFileSync(
      join(paths.wikiDir, "current", "open-questions.md"),
      "utf8"
    );
    expect(open).toContain("(none)");
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
