import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface HookCommand {
  type: "command";
  command: string;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

export interface HooksBlock {
  [event: string]: HookMatcher[];
}

export interface ClaudeSettings {
  hooks?: HooksBlock;
  [key: string]: unknown;
}

export const CLAUDE_MEMORY_HOOKS: HooksBlock = {
  SessionStart: [
    { hooks: [{ type: "command", command: "claude-memory hook session-start" }] }
  ],
  UserPromptSubmit: [
    { hooks: [{ type: "command", command: "claude-memory hook pre-task" }] }
  ],
  PostToolUse: [
    {
      matcher: "Write|Edit|MultiEdit",
      hooks: [{ type: "command", command: "claude-memory hook post-write" }]
    }
  ],
  Stop: [
    { hooks: [{ type: "command", command: "claude-memory hook session-end" }] }
  ]
};

function readSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings;
  } catch {
    return {};
  }
}

function mergeMatcher(
  existing: HookMatcher[] = [],
  incoming: HookMatcher
): HookMatcher[] {
  const match = existing.find(
    (m) => (m.matcher ?? "") === (incoming.matcher ?? "")
  );
  if (!match) return [...existing, incoming];
  const commands = new Set(match.hooks.map((h) => h.command));
  const additions = incoming.hooks.filter((h) => !commands.has(h.command));
  return existing.map((m) =>
    m === match ? { ...m, hooks: [...m.hooks, ...additions] } : m
  );
}

export function mergeHooks(base: ClaudeSettings, incoming: HooksBlock): ClaudeSettings {
  const hooks: HooksBlock = { ...(base.hooks ?? {}) };
  for (const [event, matchers] of Object.entries(incoming)) {
    let current = hooks[event] ?? [];
    for (const m of matchers) current = mergeMatcher(current, m);
    hooks[event] = current;
  }
  return { ...base, hooks };
}

export function writeSettings(path: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
}

export function installHooks(settingsPath: string): void {
  const existing = readSettings(settingsPath);
  const merged = mergeHooks(existing, CLAUDE_MEMORY_HOOKS);
  writeSettings(settingsPath, merged);
}
