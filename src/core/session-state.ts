import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryPaths } from "./paths.js";

export interface SessionState {
  session_id: string;
  started_at: string;
  last_updated: string;
  resolved_module: string | null;
  edited_files: string[];
  prompt_history: string[];
  injected_pages: string[];
}

function sessionFile(paths: MemoryPaths, sessionId: string): string {
  return join(paths.sessionsDir, `${sessionId}.json`);
}

export function readSession(paths: MemoryPaths, sessionId: string): SessionState | null {
  const file = sessionFile(paths, sessionId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SessionState;
  } catch {
    return null;
  }
}

export function writeSession(paths: MemoryPaths, state: SessionState): void {
  mkdirSync(paths.sessionsDir, { recursive: true });
  const file = sessionFile(paths, state.session_id);
  state.last_updated = new Date().toISOString();
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function upsertSession(
  paths: MemoryPaths,
  sessionId: string,
  patch: Partial<SessionState>
): SessionState {
  const now = new Date().toISOString();
  const existing = readSession(paths, sessionId);
  const merged: SessionState = existing
    ? { ...existing, ...patch }
    : {
        session_id: sessionId,
        started_at: now,
        last_updated: now,
        resolved_module: null,
        edited_files: [],
        prompt_history: [],
        injected_pages: [],
        ...patch
      };
  writeSession(paths, merged);
  return merged;
}

export function addEditedFile(
  paths: MemoryPaths,
  sessionId: string,
  file: string
): SessionState | null {
  const existing = readSession(paths, sessionId);
  if (!existing) return null;
  if (!existing.edited_files.includes(file)) existing.edited_files.push(file);
  writeSession(paths, existing);
  return existing;
}
