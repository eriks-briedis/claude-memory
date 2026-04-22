import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  mkdirSync(dirname(paths.lastCompiledFile), { recursive: true });
  writeFileSync(paths.lastCompiledFile, ts);
}

function withinDays(iso: string, days: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < days * 86400_000;
}

function rewriteActiveWork(paths: MemoryPaths, modulesLast7d: string[]): void {
  const file = join(paths.wikiDir, "current", "active-work.md");
  mkdirSync(dirname(file), { recursive: true });
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

function rewriteOpenQuestions(paths: MemoryPaths, events: MemoryEvent[]): void {
  const file = join(paths.wikiDir, "current", "open-questions.md");
  mkdirSync(dirname(file), { recursive: true });
  const lines = [
    "# Open questions",
    "",
    "_Compiler-maintained. High-importance events that have not yet been promoted into a canonical wiki page._",
    ""
  ];
  if (events.length === 0) {
    lines.push("- (none)");
  } else {
    const sorted = [...events].sort((a, b) => (a.ts < b.ts ? 1 : -1));
    for (const e of sorted) {
      const when = e.ts.slice(0, 19).replace("T", " ") + "Z";
      const mod = e.module ?? "(unscoped)";
      const body = (e.prompt ?? e.summary ?? e.files.join(", ") ?? "").trim();
      const preview = body.length > 200 ? body.slice(0, 200) + "…" : body;
      lines.push(`- **${when}** · \`${mod}\` · ${e.type}${preview ? ` — ${preview}` : ""}`);
    }
  }
  writeFileSync(file, lines.join("\n") + "\n");
}

function rewriteModuleFileList(
  paths: MemoryPaths,
  config: Config,
  moduleId: string,
  files: string[]
): void {
  const mod = config.modules[moduleId];
  if (!mod) return;
  const indexPath = join(paths.memoryDir, mod.wiki_path, "index.md");
  if (!existsSync(indexPath)) return;
  const content = readFileSync(indexPath, "utf8");
  const idx = content.indexOf(FILES_HEADER);
  const sorted = [...new Set(files)].sort();
  const bullets = sorted.length > 0 ? sorted.map((f) => `- ${f}`).join("\n") : "_(none)_";
  const block = `${FILES_HEADER}\n\n${bullets}\n`;

  let next: string;
  if (idx === -1) {
    const sep = content.endsWith("\n") ? "" : "\n";
    next = `${content}${sep}\n${block}`;
  } else {
    next = content.slice(0, idx).trimEnd() + "\n\n" + block;
  }
  writeFileSync(indexPath, next);
}

/**
 * Gather every distinct file ever recorded per module across the whole event log.
 * The compile pass receives only new events, but file lists must reflect full history
 * to avoid append-only drift. The caller passes `allEvents` for this reason.
 */
function collectFilesPerModule(events: MemoryEvent[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.module || e.type !== "file_write") continue;
    const files = Array.isArray(e.files) ? e.files : [];
    const set = map.get(e.module) ?? new Set<string>();
    for (const f of files) set.add(f);
    map.set(e.module, set);
  }
  const out = new Map<string, string[]>();
  for (const [k, v] of map) out.set(k, [...v]);
  return out;
}

export function runDeterministic(
  paths: MemoryPaths,
  config: Config,
  newEvents: MemoryEvent[],
  allEvents: MemoryEvent[]
): DeterministicResult {
  const modulesTouched = new Set<string>();
  const openQuestions: MemoryEvent[] = [];

  for (const e of newEvents) {
    if (typeof e.ts !== "string") continue;
    if (e.module) modulesTouched.add(e.module);
    if (e.importance === "high") openQuestions.push(e);
  }

  const last7Days = new Set<string>();
  for (const e of allEvents) {
    if (e.module && typeof e.ts === "string" && withinDays(e.ts, 7)) {
      last7Days.add(e.module);
    }
  }
  rewriteActiveWork(paths, [...last7Days]);

  const historicOpen = allEvents.filter((e) => e.importance === "high");
  rewriteOpenQuestions(paths, historicOpen);

  const filesPerModule = collectFilesPerModule(allEvents);
  for (const [moduleId, files] of filesPerModule) {
    rewriteModuleFileList(paths, config, moduleId, files);
  }

  const maxTs = newEvents.reduce(
    (m, e) => (typeof e.ts === "string" && e.ts > m ? e.ts : m),
    ""
  );
  if (maxTs) writeLastCompiled(paths, maxTs);

  return { modulesTouched: [...modulesTouched], openQuestions };
}

export function filterNewEvents(
  events: MemoryEvent[],
  lastCompiled: string | null
): MemoryEvent[] {
  if (!lastCompiled) return events;
  return events.filter((e) => typeof e.ts === "string" && e.ts > lastCompiled);
}

export { readLastCompiled };
