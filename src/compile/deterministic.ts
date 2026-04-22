import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../core/config.js";
import type { MemoryPaths } from "../core/paths.js";
import type { MemoryEvent } from "../core/events.js";

export interface DeterministicResult {
  modulesTouched: string[];
  openQuestions: MemoryEvent[];
}

const ACTIVE_HEADER = "# Active work";
const FILES_HEADER = "## Files";

function readLastCompiled(paths: MemoryPaths): string | null {
  if (!existsSync(paths.lastCompiledFile)) return null;
  const val = readFileSync(paths.lastCompiledFile, "utf8").trim();
  return val || null;
}

function writeLastCompiled(paths: MemoryPaths, ts: string): void {
  writeFileSync(paths.lastCompiledFile, ts);
}

function dedupEvents(events: MemoryEvent[]): MemoryEvent[] {
  const seen = new Set<string>();
  const out: MemoryEvent[] = [];
  for (const e of events) {
    const bucket = e.ts.slice(0, 13);
    for (const f of e.files) {
      const key = `${e.type}:${f}:${bucket}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(e);
  }
  return out;
}

function withinDays(iso: string, days: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < days * 86400_000;
}

function rewriteActiveWork(paths: MemoryPaths, modulesLast7d: string[]): void {
  const file = join(paths.wikiDir, "current", "active-work.md");
  const lines = [
    ACTIVE_HEADER,
    "",
    "_Compiler-maintained. Modules touched in the last 7 days._",
    ""
  ];
  if (modulesLast7d.length === 0) {
    lines.push("- (none)");
  } else {
    for (const m of modulesLast7d.sort()) lines.push(`- ${m}`);
  }
  writeFileSync(file, lines.join("\n") + "\n");
}

function appendFilesToModuleIndex(
  paths: MemoryPaths,
  config: Config,
  moduleId: string,
  files: string[]
): void {
  const mod = config.modules[moduleId];
  if (!mod) return;
  const indexPath = join(paths.memoryDir, mod.wiki_path, "index.md");
  if (!existsSync(indexPath)) return;
  let content = readFileSync(indexPath, "utf8");
  const idx = content.indexOf(FILES_HEADER);
  const existing = new Set<string>();
  if (idx !== -1) {
    const tail = content.slice(idx);
    for (const m of tail.matchAll(/^- (.+)$/gm)) existing.add(m[1]);
  }
  const toAdd = files.filter((f) => !existing.has(f));
  if (toAdd.length === 0) return;
  const bullets = toAdd.map((f) => `- ${f}`).join("\n");
  if (idx === -1) {
    const sep = content.endsWith("\n") ? "" : "\n";
    content = `${content}${sep}\n${FILES_HEADER}\n\n${bullets}\n`;
  } else {
    content = `${content.trimEnd()}\n${bullets}\n`;
  }
  writeFileSync(indexPath, content);
}

export function runDeterministic(
  paths: MemoryPaths,
  config: Config,
  events: MemoryEvent[]
): DeterministicResult {
  const clean = dedupEvents(events);

  const modulesTouched = new Set<string>();
  const filesPerModule = new Map<string, Set<string>>();
  const openQuestions: MemoryEvent[] = [];

  for (const e of clean) {
    if (e.module) {
      modulesTouched.add(e.module);
      if (e.files.length > 0) {
        const set = filesPerModule.get(e.module) ?? new Set<string>();
        for (const f of e.files) set.add(f);
        filesPerModule.set(e.module, set);
      }
    }
    if (e.importance === "high") openQuestions.push(e);
  }

  const last7Days = new Set<string>();
  for (const e of clean) {
    if (e.module && withinDays(e.ts, 7)) last7Days.add(e.module);
  }
  rewriteActiveWork(paths, [...last7Days]);

  for (const [moduleId, files] of filesPerModule) {
    appendFilesToModuleIndex(paths, config, moduleId, [...files]);
  }

  const maxTs = events.reduce((m, e) => (e.ts > m ? e.ts : m), "");
  if (maxTs) writeLastCompiled(paths, maxTs);

  return { modulesTouched: [...modulesTouched], openQuestions };
}

export function filterNewEvents(
  events: MemoryEvent[],
  lastCompiled: string | null
): MemoryEvent[] {
  if (!lastCompiled) return events;
  return events.filter((e) => e.ts > lastCompiled);
}

export { readLastCompiled };
