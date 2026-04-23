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

  it("resolves via path-in-prompt when the user pastes an owned_paths prefix", () => {
    const r = resolveModule(
      config,
      "take a look at services/disputes/handler.ts please",
      []
    );
    expect(r?.id).toBe("disputes");
    expect(r?.reason).toBe("path-in-prompt");
    expect(r?.matchedPath).toBe("services/disputes");
  });

  it("path-in-prompt prefers the longest matching prefix on nested paths", () => {
    const cfg: Config = {
      ...config,
      modules: {
        "account-clearance": config.modules["account-clearance"],
        "account-clearance-ui": {
          aliases: ["clearance-ui"],
          wiki_path: "wiki/modules/account-clearance-ui",
          owned_paths: ["ui/account-clearance/components/**"],
          related_cross_cutting: []
        }
      }
    };
    const r = resolveModule(
      cfg,
      "look at ui/account-clearance/components/row.tsx",
      []
    );
    expect(r?.id).toBe("account-clearance-ui");
    expect(r?.reason).toBe("path-in-prompt");
  });

  it("path-in-prompt returns null when two modules have equally long prefixes", () => {
    const cfg: Config = {
      ...config,
      modules: {
        a: {
          aliases: [],
          wiki_path: "wiki/modules/a",
          owned_paths: ["pkg/a/**"],
          related_cross_cutting: []
        },
        b: {
          aliases: [],
          wiki_path: "wiki/modules/b",
          owned_paths: ["pkg/b/**"],
          related_cross_cutting: []
        }
      }
    };
    const r = resolveModule(cfg, "touching pkg/a and pkg/b", []);
    expect(r).toBeNull();
  });

  it("path-in-prompt wins over alias-exact when the user pastes a file path", () => {
    // Pasted path is a stronger signal of intent than an alias word appearing
    // incidentally in the surrounding sentence.
    const r = resolveModule(
      config,
      "fix the clearance bug in services/disputes/foo.ts",
      []
    );
    expect(r?.reason).toBe("path-in-prompt");
    expect(r?.id).toBe("disputes");
  });

  it("path-in-prompt beats fuzzy match on a near-miss alias", () => {
    const r = resolveModule(
      config,
      "check services/disputes/handler.ts for the dispte edge case",
      []
    );
    expect(r?.id).toBe("disputes");
    expect(r?.reason).toBe("path-in-prompt");
  });
});
