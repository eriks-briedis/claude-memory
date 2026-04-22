import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";

vi.mock("../src/util/claude.js", async () => {
  return {
    invokeClaude: vi.fn(),
    extractJson: (raw: string, fallback: unknown) => {
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    parseJsonResponse: (raw: string) => {
      try {
        return { value: JSON.parse(raw), stage: "wrapper-object" };
      } catch (err) {
        return {
          value: null,
          stage: "none",
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }
  };
});

import { invokeClaude } from "../src/util/claude.js";
type InvokeResult = { stdout: string; stderr: string; exitCode: number; durationMs: number };
const mockInvoke = (raw: string): InvokeResult => ({
  stdout: raw,
  stderr: "",
  exitCode: 0,
  durationMs: 0
});
import { runBootstrap } from "../src/commands/bootstrap.js";
import { loadConfig } from "../src/core/config.js";

async function initRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cm-bs-"));
  mkdirSync(join(root, "src", "auth"), { recursive: true });
  mkdirSync(join(root, "src", "billing"), { recursive: true });
  writeFileSync(join(root, "src", "auth", "a.ts"), "export const a = 1;");
  writeFileSync(join(root, "src", "auth", "b.ts"), "export const b = 2;");
  writeFileSync(join(root, "src", "billing", "c.ts"), "export const c = 3;");
  writeFileSync(join(root, "src", "billing", "d.ts"), "export const d = 4;");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo" }));

  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit({});
  } finally {
    process.chdir(prev);
  }
  return root;
}

const fakeResponse = {
  wiki_index: "# demo wiki\n\n- overview",
  overview: "# demo\n\nWhat this project does.\n",
  conventions: "# conventions\n\nNamed exports only.\n",
  modules: {
    auth: {
      aliases: ["auth", "login"],
      owned_paths: ["src/auth/**"],
      index: "# auth\n\n## Files\n\n_(compiler-maintained list)_\n",
      architecture: "# auth architecture\n\nToken-based.\n"
    },
    billing: {
      aliases: ["billing"],
      owned_paths: ["src/billing/**"],
      index: "# billing\n\n## Files\n\n_(compiler-maintained list)_\n",
      architecture: "# billing architecture\n\nStripe.\n"
    }
  },
  notes: "wrote initial wiki for demo"
};

describe("runBootstrap", () => {
  beforeEach(() => {
    vi.mocked(invokeClaude).mockReset();
  });

  it("writes all target files and updates config.yaml for inferred modules", async () => {
    vi.mocked(invokeClaude).mockResolvedValueOnce(mockInvoke(JSON.stringify(fakeResponse)));
    const root = await initRepo();
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runBootstrap({});
    } finally {
      process.chdir(prev);
    }
    const overview = readFileSync(
      join(root, ".claude-memory", "wiki", "project", "overview.md"),
      "utf8"
    );
    expect(overview).toContain("What this project does");
    const authArch = readFileSync(
      join(root, ".claude-memory", "wiki", "modules", "auth", "architecture.md"),
      "utf8"
    );
    expect(authArch).toContain("Token-based");
    const cfg = loadConfig(join(root, ".claude-memory", "config.yaml"));
    expect(cfg.modules.auth).toBeDefined();
    expect(cfg.modules.billing).toBeDefined();
    expect(cfg.modules.example).toBeUndefined();
  });

  it("dry-run writes nothing", async () => {
    vi.mocked(invokeClaude).mockResolvedValueOnce(mockInvoke(JSON.stringify(fakeResponse)));
    const root = await initRepo();
    const before = readFileSync(
      join(root, ".claude-memory", "wiki", "project", "overview.md"),
      "utf8"
    );
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runBootstrap({ dryRun: true });
    } finally {
      process.chdir(prev);
    }
    const after = readFileSync(
      join(root, ".claude-memory", "wiki", "project", "overview.md"),
      "utf8"
    );
    expect(after).toBe(before);
  });

  it("--no-config leaves config.yaml untouched", async () => {
    vi.mocked(invokeClaude).mockResolvedValueOnce(mockInvoke(JSON.stringify(fakeResponse)));
    const root = await initRepo();
    const configBefore = readFileSync(
      join(root, ".claude-memory", "config.yaml"),
      "utf8"
    );
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runBootstrap({ noConfig: true });
    } finally {
      process.chdir(prev);
    }
    const configAfter = readFileSync(
      join(root, ".claude-memory", "config.yaml"),
      "utf8"
    );
    expect(configAfter).toBe(configBefore);
  });
});
