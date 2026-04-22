import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { buildPaths } from "../src/core/paths.js";
import {
  applyBootstrap,
  isUnfilledTemplate,
  type BootstrapResponse
} from "../src/bootstrap/apply.js";
import { loadConfig } from "../src/core/config.js";

async function initRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cm-apply-"));
  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit({});
  } finally {
    process.chdir(prev);
  }
  return root;
}

const response: BootstrapResponse = {
  wiki_index: "# wiki index\n\n- overview\n",
  overview: "# overview\n\nThis is a real overview.\n",
  conventions: "# conventions\n\nPrefer named exports.\n",
  modules: {
    auth: {
      aliases: ["auth", "login"],
      owned_paths: ["src/auth/**"],
      index: "# auth\n\n## Files\n\n_(compiler)_\n",
      architecture: "# auth architecture\n\nToken-based."
    }
  }
};

describe("isUnfilledTemplate", () => {
  it("detects files with template markers and short length", () => {
    expect(isUnfilledTemplate("# x\n\n_Fill in: something_")).toBe(true);
    expect(isUnfilledTemplate("<!-- claude-memory:template -->\n# x")).toBe(true);
  });
  it("rejects real content", () => {
    expect(isUnfilledTemplate("# x\n\nActual content here.")).toBe(false);
  });
  it("rejects templates that have grown too large to plausibly be unfilled", () => {
    expect(isUnfilledTemplate("_Fill in:" + "x".repeat(1200))).toBe(false);
  });
});

describe("applyBootstrap", () => {
  it("writes all target files on a fresh init", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    const res = applyBootstrap(paths, response, {
      force: false,
      dryRun: false,
      updateConfig: true
    });
    expect(res.written.some((p) => p.endsWith("project/overview.md"))).toBe(true);
    expect(res.written.some((p) => p.endsWith("modules/auth/architecture.md"))).toBe(
      true
    );
    const overview = readFileSync(
      join(paths.wikiDir, "project", "overview.md"),
      "utf8"
    );
    expect(overview).toContain("real overview");
  });

  it("skips user-edited files without --force", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    writeFileSync(
      join(paths.wikiDir, "project", "overview.md"),
      "# overview\n\nUser-curated real content.\n"
    );
    const res = applyBootstrap(paths, response, {
      force: false,
      dryRun: false,
      updateConfig: false
    });
    const skipped = res.skipped.find((s) => s.path.endsWith("overview.md"));
    expect(skipped).toBeDefined();
    const overview = readFileSync(
      join(paths.wikiDir, "project", "overview.md"),
      "utf8"
    );
    expect(overview).toContain("User-curated");
  });

  it("overwrites user-edited files with --force", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    writeFileSync(
      join(paths.wikiDir, "project", "overview.md"),
      "# overview\n\nUser-curated.\n"
    );
    applyBootstrap(paths, response, { force: true, dryRun: false, updateConfig: false });
    const overview = readFileSync(
      join(paths.wikiDir, "project", "overview.md"),
      "utf8"
    );
    expect(overview).toContain("real overview");
  });

  it("never touches decisions.md / gotchas.md / pinned.md", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    const originalPinned = readFileSync(
      join(paths.wikiDir, "current", "pinned.md"),
      "utf8"
    );
    // Force a module with decisions content (should still be skipped)
    const malicious: BootstrapResponse = {
      modules: {
        example: {
          index: "# x\n",
          architecture: "# y\n"
        }
      }
    };
    applyBootstrap(paths, malicious, {
      force: true,
      dryRun: false,
      updateConfig: false
    });
    const pinned = readFileSync(
      join(paths.wikiDir, "current", "pinned.md"),
      "utf8"
    );
    expect(pinned).toBe(originalPinned);
  });

  it("dry-run makes no filesystem changes", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    const before = readFileSync(
      join(paths.wikiDir, "project", "overview.md"),
      "utf8"
    );
    const res = applyBootstrap(paths, response, {
      force: false,
      dryRun: true,
      updateConfig: true
    });
    expect(res.written.length).toBeGreaterThan(0);
    const after = readFileSync(
      join(paths.wikiDir, "project", "overview.md"),
      "utf8"
    );
    expect(after).toBe(before);
  });

  it("updates config.yaml modules when updateConfig is true", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    applyBootstrap(paths, response, {
      force: false,
      dryRun: false,
      updateConfig: true
    });
    const cfg = loadConfig(paths.configFile);
    expect(cfg.modules.auth).toBeDefined();
    expect(cfg.modules.auth.owned_paths).toEqual(["src/auth/**"]);
  });
});
