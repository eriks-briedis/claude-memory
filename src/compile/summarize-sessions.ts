import { existsSync, readFileSync } from "node:fs";
import chalk from "chalk";
import type { Config } from "../core/config.js";
import type { MemoryPaths } from "../core/paths.js";
import {
  appendEvent,
  listEventFiles,
  nowIso,
  readEventFile,
  type Importance,
  type MemoryEvent
} from "../core/events.js";
import { extractJson, invokeClaude } from "../util/claude.js";

interface ModelSummary {
  module?: string | null;
  summary?: string;
  importance?: Importance;
}

interface ModelResponse {
  summaries?: ModelSummary[];
  no_update?: boolean;
}

const TRANSCRIPT_CHAR_LIMIT = 120_000;
const SUMMARY_CHAR_LIMIT = 1200;

function readTranscript(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    if (raw.length <= TRANSCRIPT_CHAR_LIMIT) return raw;
    const head = raw.slice(0, TRANSCRIPT_CHAR_LIMIT / 2);
    const tail = raw.slice(raw.length - TRANSCRIPT_CHAR_LIMIT / 2);
    return `${head}\n\n…[transcript truncated]…\n\n${tail}`;
  } catch {
    return null;
  }
}

function buildPrompt(
  sessionId: string,
  moduleHint: string | null,
  moduleIds: string[],
  transcript: string
): string {
  return [
    `You are distilling a Claude Code session into durable memory for session "${sessionId}".`,
    moduleHint
      ? `The session was tagged with module "${moduleHint}" at prompt time; re-attribute as needed.`
      : "No module was resolved at prompt time; infer from content.",
    `Known modules: ${moduleIds.length > 0 ? moduleIds.join(", ") : "(none declared)"}.`,
    "",
    "Extract facts that are worth remembering next time: invariants confirmed, APIs clarified, gotchas discovered, decisions made, rationale established. Ignore chit-chat and ephemeral tool output.",
    "",
    "Respond with a single JSON object and nothing else:",
    "{",
    '  "no_update": boolean,',
    '  "summaries": [',
    '    { "module": "module-id or null", "summary": "one paragraph, <200 words", "importance": "normal" | "high" }',
    "  ]",
    "}",
    "",
    "Rules:",
    "- Emit at most one summary per module.",
    "- Use \"high\" only for facts a future session would regret not seeing.",
    "- If the session produced nothing memorable, set no_update=true and omit summaries.",
    "- module MUST be one of the known modules above, or null for cross-cutting facts.",
    "",
    "--- TRANSCRIPT ---",
    transcript
  ].join("\n");
}

const UNPARSEABLE: ModelResponse = { no_update: true };

function clampSummary(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= SUMMARY_CHAR_LIMIT) return trimmed;
  return trimmed.slice(0, SUMMARY_CHAR_LIMIT) + "…";
}

function validateModule(
  moduleIds: Set<string>,
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string") return null;
  return moduleIds.has(raw) ? raw : null;
}

async function summarizeSession(
  paths: MemoryPaths,
  config: Config,
  closeEvent: MemoryEvent
): Promise<number> {
  const transcript = closeEvent.transcript_path
    ? readTranscript(closeEvent.transcript_path)
    : null;
  if (!transcript || transcript.trim().length === 0) return 0;

  const moduleIds = Object.keys(config.modules);
  const prompt = buildPrompt(
    closeEvent.session_id,
    closeEvent.module,
    moduleIds,
    transcript
  );

  let raw: string;
  try {
    const result = await invokeClaude(prompt, { timeoutMs: 3 * 60_000 });
    raw = result.stdout;
  } catch (err) {
    console.error(
      chalk.yellow(
        `[session-summary] ${closeEvent.session_id}: skipped (${err instanceof Error ? err.message : String(err)})`
      )
    );
    return 0;
  }

  const response = extractJson<ModelResponse>(raw, UNPARSEABLE);
  if (response.no_update || !response.summaries || response.summaries.length === 0) {
    console.log(chalk.dim(`[session-summary] ${closeEvent.session_id}: no update`));
    return 0;
  }

  const idSet = new Set(moduleIds);
  const seen = new Set<string>();
  let added = 0;
  for (const s of response.summaries) {
    const summary = clampSummary(typeof s.summary === "string" ? s.summary : "");
    if (!summary) continue;
    const mod = validateModule(idSet, s.module ?? null);
    const key = mod ?? "__null__";
    if (seen.has(key)) continue;
    seen.add(key);
    const importance: Importance = s.importance === "high" ? "high" : "normal";
    const event: MemoryEvent = {
      type: "session_summary",
      session_id: closeEvent.session_id,
      module: mod,
      files: closeEvent.files,
      ts: nowIso(),
      summary,
      importance
    };
    await appendEvent(paths, event);
    added++;
  }
  console.log(
    chalk.green(
      `[session-summary] ${closeEvent.session_id}: ${added} summary event(s) added`
    )
  );
  return added;
}

export async function runSessionSummaryPass(
  paths: MemoryPaths,
  config: Config,
  allEvents: MemoryEvent[]
): Promise<MemoryEvent[]> {
  const summarized = new Set(
    allEvents
      .filter((e) => e.type === "session_summary")
      .map((e) => e.session_id)
  );
  const pending = allEvents.filter(
    (e) =>
      e.type === "session_close" &&
      typeof e.transcript_path === "string" &&
      !summarized.has(e.session_id)
  );

  if (pending.length === 0) return [];

  const existing = new Set(listEventFiles(paths));
  for (const sc of pending) {
    await summarizeSession(paths, config, sc);
  }
  const added: MemoryEvent[] = [];
  for (const f of listEventFiles(paths)) {
    if (existing.has(f)) continue;
    try {
      added.push(readEventFile(f));
    } catch {
      /* ignore */
    }
  }
  return added;
}
