import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    const originalExit = process.exit;
    let exitCode: number | undefined;
    (process as { exit: (code?: number) => never }).exit = ((code?: number) => {
      exitCode = code;
      throw new Error("process.exit:" + code);
    }) as typeof process.exit;

    try {
      const first = runCompile({ llm: false });
      const second = runCompile({ llm: false }).catch((e) => e);
      await first;
      const err = await second;
      expect(exitCode).toBe(3);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("process.exit:3");
    } finally {
      process.chdir(prev);
      (process as { exit: (code?: number) => never }).exit = originalExit;
    }
  });
});
