import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface MemoryPaths {
  root: string;
  memoryDir: string;
  configFile: string;
  wikiDir: string;
  rawDir: string;
  eventsDir: string;
  stateDir: string;
  sessionsDir: string;
  lastCompiledFile: string;
  eventCounterFile: string;
}

export function findMemoryRoot(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".claude-memory", "config.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function buildPaths(root: string): MemoryPaths {
  const memoryDir = join(root, ".claude-memory");
  return {
    root,
    memoryDir,
    configFile: join(memoryDir, "config.yaml"),
    wikiDir: join(memoryDir, "wiki"),
    rawDir: join(memoryDir, "raw"),
    eventsDir: join(memoryDir, "raw", "events"),
    stateDir: join(memoryDir, "state"),
    sessionsDir: join(memoryDir, "state", "sessions"),
    lastCompiledFile: join(memoryDir, "state", "last-compiled.txt"),
    eventCounterFile: join(memoryDir, "raw", "events", ".counter")
  };
}

export function resolvePaths(startDir: string = process.cwd()): MemoryPaths | null {
  const root = findMemoryRoot(startDir);
  return root ? buildPaths(root) : null;
}
