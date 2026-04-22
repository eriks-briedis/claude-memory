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

  it("does not match alias as a partial word (word-boundary required)", () => {
    const cfg: Config = {
      ...config,
      modules: {
        api: {
          aliases: ["api"],
          wiki_path: "wiki/modules/api",
          owned_paths: [],
          related_cross_cutting: []
        }
      }
    };
    const r = resolveModule(cfg, "please capitalize the README", []);
    expect(r).toBeNull();
  });

  it("tokenized fuzzy search matches when a single prompt word is close to an alias", () => {
    const r = resolveModule(config, "work on dispute today please", []);
    expect(r?.id).toBe("disputes");
    expect(r?.reason).toBe("alias-fuzzy");
  });

  it("session-sticky fallback uses prior resolved module when prompt and edits are empty", () => {
    const r = resolveModule(config, "keep going", [], "disputes");
    expect(r?.id).toBe("disputes");
    expect(r?.reason).toBe("session-sticky");
  });

  it("session-sticky is ignored when the prior module no longer exists in config", () => {
    const r = resolveModule(config, "keep going", [], "removed-module");
    expect(r).toBeNull();
  });

  it("prompt resolution wins over session stickiness", () => {
    const r = resolveModule(config, "fix the clearance bug", [], "disputes");
    expect(r?.id).toBe("account-clearance");
    expect(r?.reason).toBe("alias-exact");
  });

  it("exposes the matched alias for alias-exact resolutions", () => {
    const r = resolveModule(config, "fix the clearance bug", []);
    expect(r?.matchedAlias).toBe("clearance");
  });
});
