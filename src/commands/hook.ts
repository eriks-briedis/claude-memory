import { readFileSync } from "node:fs";
import { loadConfig } from "../core/config.js";
import { resolvePaths } from "../core/paths.js";
import { resolveFromEditedFiles, resolveModule } from "../core/resolver.js";
import { loadContext, formatContext } from "../core/context-loader.js";
import {
  addEditedFile,
  readSession,
  upsertSession
} from "../core/session-state.js";
import {
  appendEvent,
  collectPromotedIds,
  listEventFiles,
  nowIso,
  readEventFile,
  truncate,
  type FileChange,
  type MemoryEvent
} from "../core/events.js";

interface EditSpec {
  file_path?: string;
  old_string?: string;
  new_string?: string;
}

interface HookPayload {
  session_id?: string;
  cwd?: string;
  prompt?: string;
  source?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    edits?: EditSpec[];
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

function breadcrumb(msg: string): void {
  process.stderr.write(`[claude-memory] ${msg}\n`);
}

function extractChanges(payload: HookPayload): FileChange[] {
  const input = payload.tool_input;
  const tool = payload.tool_name ?? "";
  if (!input) return [];
  const changes: FileChange[] = [];

  if (tool === "Write" && typeof input.file_path === "string") {
    const c = truncate(input.content);
    changes.push({
      file: input.file_path,
      tool,
      kind: "write",
      ...(c.text !== undefined ? { content: c.text } : {}),
      ...(c.truncated ? { content_truncated: true } : {})
    });
    return changes;
  }

  if (tool === "Edit" && typeof input.file_path === "string") {
    const o = truncate(input.old_string);
    const n = truncate(input.new_string);
    changes.push({
      file: input.file_path,
      tool,
      kind: "edit",
      ...(o.text !== undefined ? { old_string: o.text } : {}),
      ...(o.truncated ? { old_truncated: true } : {}),
      ...(n.text !== undefined ? { new_string: n.text } : {}),
      ...(n.truncated ? { new_truncated: true } : {})
    });
    return changes;
  }

  if (tool === "MultiEdit" && typeof input.file_path === "string") {
    const filePath = input.file_path;
    for (const e of input.edits ?? []) {
      const o = truncate(e.old_string);
      const n = truncate(e.new_string);
      changes.push({
        file: e.file_path ?? filePath,
        tool,
        kind: "edit",
        ...(o.text !== undefined ? { old_string: o.text } : {}),
        ...(o.truncated ? { old_truncated: true } : {}),
        ...(n.text !== undefined ? { new_string: n.text } : {}),
        ...(n.truncated ? { new_truncated: true } : {})
      });
    }
    return changes;
  }

  if (typeof input.file_path === "string") {
    changes.push({ file: input.file_path, tool, kind: "write" });
  }
  return changes;
}

function filesFromChanges(changes: FileChange[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of changes) {
    if (!seen.has(c.file)) {
      seen.add(c.file);
      out.push(c.file);
    }
  }
  return out;
}

export async function runPreTask(inputPayload?: HookPayload): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) return;

  const payload = inputPayload ?? parsePayload(readStdin());
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
  const resolved = resolveModule(
    config,
    prompt,
    editedFiles,
    prior?.resolved_module
  );

  upsertSession(paths, sessionId, {
    resolved_module: resolved?.id ?? null,
    prompt_history: [...(prior?.prompt_history ?? []), prompt].slice(-10)
  });

  if (prompt.trim().length > 0) {
    const promptTrunc = truncate(prompt);
    const promptEvent: MemoryEvent = {
      type: "user_prompt",
      session_id: sessionId,
      module: resolved?.id ?? null,
      files: [],
      prompt: promptTrunc.text ?? prompt,
      ts: nowIso(),
      summary: null,
      importance: "normal"
    };
    await appendEvent(paths, promptEvent);
  }

  const loaded = loadContext(paths, config, resolved);
  const alreadyInjected = new Set(prior?.injected_pages ?? []);
  const newPages = loaded.pages.filter((p) => !alreadyInjected.has(p.path));
  const context = formatContext({ ...loaded, pages: newPages });

  const newPagePaths = newPages.map((p) => p.path);
  if (newPagePaths.length > 0) {
    upsertSession(paths, sessionId, {
      injected_pages: [...(prior?.injected_pages ?? []), ...newPagePaths]
    });
  }

  const moduleLabel = resolved
    ? `${resolved.id} (${resolved.reason}${resolved.matchedAlias ? `:${resolved.matchedAlias}` : ""})`
    : "none";
  const deduped = loaded.pages.length - newPages.length;
  const skippedNote = loaded.skipped.length > 0 ? `, skipped ${loaded.skipped.length}` : "";
  const dedupNote = deduped > 0 ? `, deduped ${deduped}` : "";
  const summary = `pre-task: module=${moduleLabel}, loaded ${newPages.length} page(s), ${loaded.totalTokens} token(s)${skippedNote}${dedupNote}`;
  breadcrumb(summary);

  const output: {
    systemMessage?: string;
    hookSpecificOutput?: {
      hookEventName: "UserPromptSubmit";
      additionalContext: string;
    };
  } = {};

  if (config.retrieval.show_breadcrumb) {
    output.systemMessage = `[claude-memory] ${summary}`;
  }

  if (context) {
    output.hookSpecificOutput = {
      hookEventName: "UserPromptSubmit",
      additionalContext: context
    };
  }

  if (output.systemMessage || output.hookSpecificOutput) {
    process.stdout.write(JSON.stringify(output));
  }
}

export async function runPostWrite(inputPayload?: HookPayload): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) return;

  const payload = inputPayload ?? parsePayload(readStdin());
  const sessionId = payload.session_id ?? "unknown";
  const changes = extractChanges(payload);
  if (changes.length === 0) return;
  const files = filesFromChanges(changes);

  let config;
  try {
    config = loadConfig(paths.configFile);
  } catch {
    return;
  }
  if (!config.project.memory_enabled) return;

  for (const f of files) addEditedFile(paths, sessionId, f);
  const session = readSession(paths, sessionId);

  const pathHit = resolveFromEditedFiles(config, files);
  const resolvedModule = pathHit?.id ?? session?.resolved_module ?? null;

  if (pathHit && session && session.resolved_module !== pathHit.id) {
    upsertSession(paths, sessionId, { resolved_module: pathHit.id });
  }

  const event: MemoryEvent = {
    type: "file_write",
    session_id: sessionId,
    module: resolvedModule,
    files,
    changes,
    ts: nowIso(),
    summary: null,
    importance: "normal"
  };
  await appendEvent(paths, event);
  breadcrumb(
    `post-write: module=${event.module ?? "none"}${pathHit ? ` (path-matched)` : ""}, tool=${payload.tool_name ?? "?"}, ${files.length} file(s): ${files.join(", ")}`
  );
}

export async function runSessionEnd(inputPayload?: HookPayload): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) return;

  const payload = inputPayload ?? parsePayload(readStdin());
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
    importance: "normal",
    ...(typeof payload.transcript_path === "string" && payload.transcript_path
      ? { transcript_path: payload.transcript_path }
      : {})
  };
  await appendEvent(paths, event);
  breadcrumb(
    `session-end: module=${event.module ?? "none"}, ${event.files.length} file(s) touched${event.transcript_path ? ", transcript recorded" : ""}`
  );
}

const SESSION_START_INJECTION_DAYS = 14;

function readHighImportance(paths: ReturnType<typeof resolvePaths>): MemoryEvent[] {
  if (!paths) return [];
  const cutoff = Date.now() - SESSION_START_INJECTION_DAYS * 86400_000;
  const all: MemoryEvent[] = [];
  for (const f of listEventFiles(paths)) {
    try {
      all.push(readEventFile(f));
    } catch {
      /* ignore malformed */
    }
  }
  const promoted = collectPromotedIds(all);
  const out = all.filter((e) => {
    if (e.importance !== "high") return false;
    if (e._id && promoted.has(e._id)) return false;
    const t = Date.parse(e.ts);
    return !Number.isNaN(t) && t >= cutoff;
  });
  return out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

export async function runSessionStart(inputPayload?: HookPayload): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) return;

  const payload = inputPayload ?? parsePayload(readStdin());

  let config;
  try {
    config = loadConfig(paths.configFile);
  } catch {
    return;
  }
  if (!config.project.memory_enabled) return;

  const openItems = readHighImportance(paths);
  if (openItems.length === 0) {
    breadcrumb(`session-start (${payload.source ?? "unknown"}): no open questions`);
    return;
  }

  const MAX_SHOWN = 5;
  const shown = openItems.slice(0, MAX_SHOWN);
  const lines = shown.map((e) => {
    const when = e.ts.slice(0, 10);
    const mod = e.module ?? "(unscoped)";
    const body = (e.prompt ?? e.summary ?? e.files.join(", ") ?? "").trim();
    const preview = body.length > 120 ? body.slice(0, 120) + "…" : body;
    return `  • ${when} [${mod}] ${preview}`;
  });
  const more = openItems.length > MAX_SHOWN ? ` (+${openItems.length - MAX_SHOWN} more)` : "";

  breadcrumb(
    `session-start: ${openItems.length} open question(s) from prior sessions${more}`
  );
  for (const line of lines) process.stderr.write(line + "\n");
  process.stderr.write(
    `  see .claude-memory/wiki/current/open-questions.md for the full list\n`
  );

  const additionalContext = [
    `${openItems.length} open question(s) flagged in prior sessions (importance: high):`,
    ...lines,
    openItems.length > MAX_SHOWN
      ? `(${openItems.length - MAX_SHOWN} more omitted; full list in .claude-memory/wiki/current/open-questions.md)`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext
    }
  };
  process.stdout.write(JSON.stringify(output));
}
