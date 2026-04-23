import { describe, it, expect } from "vitest";
import { closeSync, mkdirSync, mkdtempSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { runInit } from "../src/commands/init.js";
import { runCompile } from "../src/commands/compile.js";

async function initRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cm-lock-"));
  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit({});
  } finally {
    process.chdir(prev);
  }
  return root;
}

describe("compile lock", () => {
  it("blocks a second concurrent compile", async () => {
    const root = await initRepo();
    const prev = process.cwd();
    process.chdir(root);

    // Manually hold the lock so compile immediately sees contention.
    const lockPath = join(root, ".claude-memory/state/compile.lock");
    mkdirSync(join(root, ".claude-memory/state"), { recursive: true });
    closeSync(openSync(lockPath, "a"));
    const release = await lockfile.lock(lockPath, { retries: 0 });

    const originalExit = process.exit;
    let exitCode: number | undefined;
    (process as { exit: (code?: number) => never }).exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit:" + code);
    }) as typeof process.exit;

    try {
      let err: Error | undefined;
      try {
        await runCompile({ llm: false });
      } catch (e) {
        err = e as Error;
      }
      expect(exitCode).toBe(3);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("process.exit:3");
    } finally {
      await release();
      process.chdir(prev);
      (process as { exit: (code?: number) => never }).exit = originalExit;
    }
  });
});
