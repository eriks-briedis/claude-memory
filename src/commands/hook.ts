import { readFileSync } from "node:fs";
import { loadConfig } from "../core/config.js";
import { resolvePaths } from "../core/paths.js";
import { resolveModule } from "../core/resolver.js";
import { loadContext, formatContext } from "../core/context-loader.js";
import {
  addEditedFile,
  readSession,
  upsertSession
} from "../core/session-state.js";
import { appendEvent, nowIso, type MemoryEvent } from "../core/events.js";

interface HookPayload {
  session_id?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    edits?: Array<{ file_path?: string }>;
  };
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePayload(raw: string): HookPayload {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return {};
  }
}

function extractWrittenFiles(payload: HookPayload): string[] {
  const input = payload.tool_input;
  if (!input) return [];
  const files: string[] = [];
  if (typeof input.file_path === "string") files.push(input.file_path);
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) {
      if (e && typeof e.file_path === "string") files.push(e.file_path);
    }
  }
  return files;
}

export async function runPreTask(): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) return;

  const payload = parsePayload(readStdin());
  const sessionId = payload.session_id ?? "unknown";
  const prompt = payload.prompt ?? "";

  let config;
  try {
    config = loadConfig(paths.configFile);
  } catch {
    return;
  }
  if (!config.project.memory_enabled) return;

  const prior = readSession(paths, sessionId);
  const editedFiles = prior?.edited_files ?? [];
  const resolved = resolveModule(config, prompt, editedFiles);

  upsertSession(paths, sessionId, {
    resolved_module: resolved?.id ?? null,
    prompt_history: [...(prior?.prompt_history ?? []), prompt].slice(-10)
  });

  const loaded = loadContext(paths, config, resolved);
  const context = formatContext(loaded);
  if (!context) return;

  const output = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: context
    }
  };
  process.stdout.write(JSON.stringify(output));
}

export async function runPostWrite(): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) return;

  const payload = parsePayload(readStdin());
  const sessionId = payload.session_id ?? "unknown";
  const files = extractWrittenFiles(payload);
  if (files.length === 0) return;

  let config;
  try {
    config = loadConfig(paths.configFile);
  } catch {
    return;
  }
  if (!config.project.memory_enabled) return;

  for (const f of files) addEditedFile(paths, sessionId, f);
  const session = readSession(paths, sessionId);

  const event: MemoryEvent = {
    type: "file_write",
    session_id: sessionId,
    module: session?.resolved_module ?? null,
    files,
    ts: nowIso(),
    summary: null,
    importance: "normal"
  };
  await appendEvent(paths, event);
}

export async function runSessionEnd(): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) return;

  const payload = parsePayload(readStdin());
  const sessionId = payload.session_id ?? "unknown";

  let config;
  try {
    config = loadConfig(paths.configFile);
  } catch {
    return;
  }
  if (!config.project.memory_enabled) return;

  const session = readSession(paths, sessionId);
  if (!session) return;

  const event: MemoryEvent = {
    type: "session_close",
    session_id: sessionId,
    module: session.resolved_module,
    files: session.edited_files,
    ts: nowIso(),
    summary: null,
    importance: "normal"
  };
  await appendEvent(paths, event);
}
