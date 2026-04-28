import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync, openSync, statSync, truncateSync } from "node:fs";
import { join } from "node:path";
import type { MemoryPaths } from "../core/paths.js";

const LOG_MAX_BYTES = 1_000_000;

export type Spawner = (
  command: string,
  args: string[],
  options: SpawnOptions
) => { unref: () => void };

interface TriggerOpts {
  /** Override the spawn function. Tests inject a stub here. */
  spawnFn?: Spawner;
  /** Override the bin path. Defaults to `process.argv[1]`. */
  binPath?: string;
}

function rotateIfLarge(file: string): void {
  try {
    const st = statSync(file);
    if (st.size > LOG_MAX_BYTES) truncateSync(file, 0);
  } catch {
    /* missing file is fine */
  }
}

/**
 * Spawn a detached `claude-memory compile` so the user's session ends immediately.
 * Errors are swallowed: auto-compile must never break Stop.
 */
export function triggerAutoCompile(
  paths: MemoryPaths,
  opts: TriggerOpts = {}
): boolean {
  const bin = opts.binPath ?? process.argv[1];
  if (!bin || !existsSync(bin)) return false;

  mkdirSync(paths.stateDir, { recursive: true });
  const logPath = join(paths.stateDir, "compile.log");
  rotateIfLarge(logPath);

  const spawnFn = opts.spawnFn ?? nodeSpawn;
  try {
    const out = openSync(logPath, "a");
    const err = openSync(logPath, "a");
    const child = spawnFn(process.execPath, [bin, "compile"], {
      cwd: paths.root,
      detached: true,
      stdio: ["ignore", out, err],
      env: process.env
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
