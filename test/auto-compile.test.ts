import { describe, it, expect } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPaths } from "../src/core/paths.js";
import { triggerAutoCompile, type Spawner } from "../src/commands/auto-compile.js";

function recordingSpawner() {
  const calls: { command: string; args: string[]; options: unknown }[] = [];
  const spawnFn: Spawner = (command, args, options) => {
    calls.push({ command, args, options });
    return { unref: () => {} };
  };
  return { calls, spawnFn };
}

describe("triggerAutoCompile", () => {
  it("invokes the bin with `compile` and detaches", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-auto-"));
    const paths = buildPaths(root);
    const bin = join(root, "fake-cli.js");
    writeFileSync(bin, "// fake");

    const { calls, spawnFn } = recordingSpawner();
    const ok = triggerAutoCompile(paths, { binPath: bin, spawnFn });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(process.execPath);
    expect(calls[0].args).toEqual([bin, "compile"]);
    const opts = calls[0].options as { detached: boolean; cwd: string };
    expect(opts.detached).toBe(true);
    expect(opts.cwd).toBe(paths.root);
    expect(existsSync(join(paths.stateDir, "compile.log"))).toBe(true);
  });

  it("returns false when bin path does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-auto-"));
    const paths = buildPaths(root);
    const { calls, spawnFn } = recordingSpawner();
    const ok = triggerAutoCompile(paths, {
      binPath: join(root, "does-not-exist.js"),
      spawnFn
    });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rotates the log file once it exceeds 1 MB", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-auto-"));
    const paths = buildPaths(root);
    const bin = join(root, "fake-cli.js");
    writeFileSync(bin, "// fake");
    mkdirSync(paths.stateDir, { recursive: true });
    const logPath = join(paths.stateDir, "compile.log");
    writeFileSync(logPath, "x".repeat(1_000_001));

    const { spawnFn } = recordingSpawner();
    triggerAutoCompile(paths, { binPath: bin, spawnFn });

    expect(statSync(logPath).size).toBe(0);
  });

  it("swallows spawn errors and does not throw", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-auto-"));
    const paths = buildPaths(root);
    const bin = join(root, "fake-cli.js");
    writeFileSync(bin, "// fake");

    const throwingSpawn: Spawner = () => {
      throw new Error("simulated spawn failure");
    };
    const ok = triggerAutoCompile(paths, { binPath: bin, spawnFn: throwingSpawn });
    expect(ok).toBe(false);
  });
});
