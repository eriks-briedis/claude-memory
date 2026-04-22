import { describe, it, expect } from "vitest";
import { resolveModule } from "../src/core/resolver.js";
import type { Config } from "../src/core/config.js";

const config: Config = {
  project: { id: "p", memory_enabled: true },
  retrieval: { always_read: [], max_context_tokens: 8000 },
  modules: {
    "account-clearance": {
      aliases: ["account clearances", "clearance", "clearance module"],
      wiki_path: "wiki/modules/account-clearance",
      owned_paths: ["services/account-clearance/**", "ui/account-clearance/**"],
      related_cross_cutting: []
    },
    disputes: {
      aliases: ["disputes", "dispute handling"],
      wiki_path: "wiki/modules/disputes",
      owned_paths: ["services/disputes/**"],
      related_cross_cutting: []
    }
  }
};

describe("resolveModule", () => {
  it("matches exact alias substring", () => {
    const r = resolveModule(config, "fix the clearance bug", []);
    expect(r?.id).toBe("account-clearance");
    expect(r?.reason).toBe("alias-exact");
  });

  it("falls back to fuzzy match when exact alias missing", () => {
    const r = resolveModule(config, "work on dispute handlings today", []);
    expect(r?.id).toBe("disputes");
  });

  it("resolves from recent edits when prompt has no cue", () => {
    const r = resolveModule(config, "continue where we left off", [
      "services/disputes/foo.ts"
    ]);
    expect(r?.id).toBe("disputes");
    expect(r?.reason).toBe("recent-edits");
  });

  it("returns null when edits are ambiguous across modules with equal hits", () => {
    const r = resolveModule(config, "something generic", [
      "services/disputes/a.ts",
      "services/account-clearance/b.ts"
    ]);
    expect(r).toBeNull();
  });

  it("returns null when no signals match", () => {
    const r = resolveModule(config, "unrelated prompt", ["README.md"]);
    expect(r).toBeNull();
  });
});
