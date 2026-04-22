import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPaths } from "../src/core/paths.js";
import { loadContext, formatContext } from "../src/core/context-loader.js";
import type { Config } from "../src/core/config.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "cm-ctx-"));
  const paths = buildPaths(root);
  mkdirSync(join(paths.wikiDir, "project"), { recursive: true });
  mkdirSync(join(paths.wikiDir, "modules", "disputes"), { recursive: true });
  writeFileSync(join(paths.wikiDir, "index.md"), "# Index\n");
  writeFileSync(
    join(paths.wikiDir, "project", "overview.md"),
    "# Overview\nProject overview text.\n"
  );
  writeFileSync(
    join(paths.wikiDir, "modules", "disputes", "index.md"),
    "# Disputes\nSee [decisions](decisions.md)\n"
  );
  writeFileSync(
    join(paths.wikiDir, "modules", "disputes", "decisions.md"),
    "# Decisions\nAll decisions go here.\n"
  );
  return paths;
}

describe("loadContext", () => {
  let paths: ReturnType<typeof buildPaths>;
  beforeEach(() => {
    paths = setup();
  });

  const config: Config = {
    project: { id: "p", memory_enabled: true },
    retrieval: {
      always_read: ["wiki/index.md", "wiki/project/overview.md"],
      max_context_tokens: 8000
    },
    modules: {
      disputes: {
        aliases: ["disputes"],
        wiki_path: "wiki/modules/disputes",
        owned_paths: [],
        related_cross_cutting: []
      }
    }
  };

  it("loads always_read pages", () => {
    const res = loadContext(paths, config, null);
    expect(res.pages.map((p) => p.path)).toEqual([
      "wiki/index.md",
      "wiki/project/overview.md"
    ]);
  });

  it("adds module index and linked pages when resolved", () => {
    const res = loadContext(paths, config, {
      id: "disputes",
      module: config.modules.disputes,
      reason: "alias-exact"
    });
    const loaded = res.pages.map((p) => p.path);
    expect(loaded).toContain("wiki/modules/disputes/index.md");
    expect(loaded).toContain("wiki/modules/disputes/decisions.md");
  });

  it("respects token budget and reports skipped pages", () => {
    const tiny: Config = {
      ...config,
      retrieval: { ...config.retrieval, max_context_tokens: 5 }
    };
    const res = loadContext(paths, tiny, null);
    expect(res.totalTokens).toBeLessThanOrEqual(5);
    expect(res.pages.length + res.skipped.length).toBeGreaterThan(0);
  });

  it("formats pages with FILE separators", () => {
    const res = loadContext(paths, config, null);
    const formatted = formatContext(res);
    expect(formatted).toContain("--- FILE: wiki/index.md ---");
  });
});
