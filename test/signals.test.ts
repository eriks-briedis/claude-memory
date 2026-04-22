import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSignals } from "../src/bootstrap/signals.js";

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "cm-sig-"));
  mkdirSync(join(root, "src", "auth"), { recursive: true });
  mkdirSync(join(root, "src", "billing"), { recursive: true });
  mkdirSync(join(root, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo" }));
  writeFileSync(join(root, "README.md"), "# Demo\nHello.\n");
  writeFileSync(join(root, "src", "auth", "login.ts"), "export const x = 1;");
  writeFileSync(join(root, "src", "auth", "token.ts"), "export const y = 2;");
  writeFileSync(join(root, "src", "billing", "invoice.ts"), "export const z = 3;");
  writeFileSync(join(root, "src", "billing", "charge.ts"), "export const w = 4;");
  writeFileSync(join(root, "node_modules", "junk", "noise.js"), "nope");
  return root;
}

describe("collectSignals", () => {
  it("collects package.json, README, and tree excluding ignored dirs", () => {
    const root = scaffold();
    const s = collectSignals(root, join(root, ".claude-memory"));
    expect(s.packageJson).toEqual({ name: "demo" });
    expect(s.readme).toContain("Demo");
    expect(s.tree).toContain("src/");
    expect(s.tree).toContain("auth/");
    expect(s.tree).toContain("billing/");
    expect(s.tree).not.toContain("node_modules");
  });

  it("proposes candidate modules from src/ children with >=2 files", () => {
    const root = scaffold();
    const s = collectSignals(root, join(root, ".claude-memory"));
    const ids = s.candidateModuleDirs.map((m) => m.id).sort();
    expect(ids).toEqual(["auth", "billing"]);
    const auth = s.candidateModuleDirs.find((m) => m.id === "auth");
    expect(auth?.owned_path).toBe("src/auth/**");
  });

  it("detects primary language from file extensions", () => {
    const root = scaffold();
    const s = collectSignals(root, join(root, ".claude-memory"));
    expect(s.languageStats[0].language).toBe("typescript");
  });

  it("truncates long READMEs and marks them", () => {
    const root = scaffold();
    writeFileSync(join(root, "README.md"), "x".repeat(3000));
    const s = collectSignals(root, join(root, ".claude-memory"));
    expect(s.readmeTruncated).toBe(true);
    expect(s.readme?.length).toBe(2000);
  });

  it("ignores template placeholder in existing overview", () => {
    const root = scaffold();
    mkdirSync(join(root, ".claude-memory", "wiki", "project"), { recursive: true });
    writeFileSync(
      join(root, ".claude-memory", "wiki", "project", "overview.md"),
      "# demo — overview\n\n_Fill in: xxx_\n"
    );
    const s = collectSignals(root, join(root, ".claude-memory"));
    expect(s.existingOverview).toBeNull();
  });

  it("preserves user-edited overview content", () => {
    const root = scaffold();
    mkdirSync(join(root, ".claude-memory", "wiki", "project"), { recursive: true });
    writeFileSync(
      join(root, ".claude-memory", "wiki", "project", "overview.md"),
      "# demo — overview\n\nWe do auth and billing.\n"
    );
    const s = collectSignals(root, join(root, ".claude-memory"));
    expect(s.existingOverview).toContain("We do auth");
  });
});
