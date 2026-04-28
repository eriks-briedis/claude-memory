import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import lockfile from "proper-lockfile";
import type { MemoryPaths } from "./paths.js";

export type EventType =
  | "file_write"
  | "session_close"
  | "session_summary"
  | "learned_fact"
  | "user_instruction"
  | "user_prompt"
  | "promotion";
export type Importance = "normal" | "high";

export interface FileChange {
  file: string;
  tool: string;
  kind: "write" | "edit";
  content?: string;
  content_truncated?: boolean;
  old_string?: string;
  new_string?: string;
  old_truncated?: boolean;
  new_truncated?: boolean;
}

export interface MemoryEvent {
  type: EventType;
  session_id: string;
  module: string | null;
  files: string[];
  changes?: FileChange[];
  prompt?: string;
  ts: string;
  summary: string | null;
  importance: Importance;
  transcript_path?: string;
  consumed_event_ids?: string[];
  /** Basename of the source file (no extension). Set by `readEventFile`; not persisted. */
  _id?: string;
}

export function eventIdFromFile(file: string): string {
  return basename(file).replace(/\.json$/, "");
}

export function collectPromotedIds(events: MemoryEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.type !== "promotion") continue;
    if (!Array.isArray(e.consumed_event_ids)) continue;
    for (const id of e.consumed_event_ids) out.add(id);
  }
  return out;
}

const PREVIEW_LIMIT = 500;

export function truncate(value: string | undefined): { text?: string; truncated: boolean } {
  if (typeof value !== "string") return { truncated: false };
  if (value.length <= PREVIEW_LIMIT) return { text: value, truncated: false };
  return { text: value.slice(0, PREVIEW_LIMIT) + "…", truncated: true };
}

function today(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ensureCounterFile(paths: MemoryPaths): void {
  mkdirSync(paths.eventsDir, { recursive: true });
  if (!existsSync(paths.eventCounterFile)) {
    closeSync(openSync(paths.eventCounterFile, "a"));
  }
}

async function nextCounter(paths: MemoryPaths, date: string): Promise<number> {
  ensureCounterFile(paths);
  const release = await lockfile.lock(paths.eventCounterFile, {
    retries: { retries: 100, minTimeout: 10, maxTimeout: 200, factor: 1.5 },
    stale: 5000
  });
  try {
    let counter = 0;
    const existing = readdirSync(paths.eventsDir).filter(
      (f) => f.startsWith(`${date}_`) && f.endsWith(".json")
    );
    for (const f of existing) {
      const match = f.match(/^\d{4}-\d{2}-\d{2}_(\d+)\.json$/);
      if (!match) continue;
      const n = parseInt(match[1], 10);
      if (n > counter) counter = n;
    }
    const next = counter + 1;
    writeFileSync(paths.eventCounterFile, String(next));
    return next;
  } finally {
    await release();
  }
}

export async function appendEvent(
  paths: MemoryPaths,
  event: MemoryEvent
): Promise<string> {
  const date = event.ts.slice(0, 10);
  const n = await nextCounter(paths, date);
  const file = join(paths.eventsDir, `${date}_${String(n).padStart(3, "0")}.json`);
  const { _id: _ignored, ...persisted } = event;
  writeFileSync(file, JSON.stringify(persisted, null, 2));
  return file;
}

export function listEventFiles(paths: MemoryPaths): string[] {
  if (!existsSync(paths.eventsDir)) return [];
  return readdirSync(paths.eventsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}_\d+\.json$/.test(f))
    .sort()
    .map((f) => join(paths.eventsDir, f));
}

export function readEventFile(file: string): MemoryEvent {
  const event = JSON.parse(readFileSync(file, "utf8")) as MemoryEvent;
  event._id = eventIdFromFile(file);
  return event;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayDate(): string {
  return today();
}
