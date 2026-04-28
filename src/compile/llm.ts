import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { Config } from "../core/config.js";
import type { MemoryPaths } from "../core/paths.js";
import { appendEvent, nowIso, type MemoryEvent } from "../core/events.js";
import { summarizeEvent } from "./summarize.js";
import { extractJson, invokeClaude } from "../util/claude.js";

const PAGES = ["decisions.md", "gotchas.md"] as const;
type PageName = (typeof PAGES)[number];

interface ModelResponse {
  pages?: Partial<Record<PageName, string | null>>;
  no_update?: boolean;
  notes?: string;
}

const CROSS_CUTTING_TYPES = new Set(["session_summary", "learned_fact", "user_instruction"]);

function isRelevantToModule(e: MemoryEvent, moduleId: string): boolean {
  if (e.module === moduleId) return true;
  if (e.module === null && e.importance === "high" && CROSS_CUTTING_TYPES.has(e.type)) {
    return true;
  }
  return false;
}

function buildPrompt(
  moduleId: string,
  currentPages: Record<PageName, string>,
  events: MemoryEvent[]
): string {
  const relevant = events.filter((e) => isRelevantToModule(e, moduleId));
  const summaries = relevant.map(summarizeEvent).join("\n");

  return [
    `You are updating the wiki for module "${moduleId}".`,
    "",
    "Current pages:",
    ...PAGES.flatMap((p) => [
      `--- FILE: ${p} ---`,
      currentPages[p].trimEnd(),
      ""
    ]),
    "Activity since the last compile (one line per event; `+NL` = lines added, `AL → BL` = edit size):",
    summaries || "(none)",
    "",
    "Update decisions.md and gotchas.md ONLY if the activity above reveals material worth promoting to canonical wiki content (decisions made, traps discovered, API contracts established). Do not paraphrase existing content.",
    "",
    "Respond with a single JSON object and nothing else:",
    "{",
    '  "no_update": boolean,',
    '  "pages": { "decisions.md": "full new content or null", "gotchas.md": "full new content or null" },',
    '  "notes": "one-line reason"',
    "}",
    "",
    "If a page does not need changes, set its value to null."
  ].join("\n");
}

function loadPages(moduleDir: string): Record<PageName, string> {
  const out = {} as Record<PageName, string>;
  for (const p of PAGES) {
    const file = join(moduleDir, p);
    out[p] = existsSync(file) ? readFileSync(file, "utf8") : "";
  }
  return out;
}

function writePage(moduleDir: string, page: PageName, content: string): void {
  writeFileSync(join(moduleDir, page), content.endsWith("\n") ? content : content + "\n");
}

const UNPARSEABLE: ModelResponse = { no_update: true, notes: "unparseable model response" };

export async function runLlmPass(
  paths: MemoryPaths,
  config: Config,
  modulesTouched: string[],
  events: MemoryEvent[]
): Promise<void> {
  for (const moduleId of modulesTouched) {
    const mod = config.modules[moduleId];
    if (!mod) continue;
    const moduleDir = join(paths.memoryDir, mod.wiki_path);
    if (!existsSync(moduleDir)) continue;

    const currentPages = loadPages(moduleDir);
    const prompt = buildPrompt(moduleId, currentPages, events);

    let raw: string;
    try {
      const result = await invokeClaude(prompt);
      raw = result.stdout;
    } catch (err) {
      console.error(
        chalk.yellow(
          `[llm] ${moduleId}: skipped (${err instanceof Error ? err.message : String(err)})`
        )
      );
      continue;
    }

    const response = extractJson<ModelResponse>(raw, UNPARSEABLE);
    if (response.no_update) {
      console.log(chalk.dim(`[llm] ${moduleId}: no update`));
      continue;
    }
    const pages = response.pages ?? {};
    let wrote = false;
    for (const p of PAGES) {
      const next = pages[p];
      if (typeof next === "string" && next.trim().length > 0) {
        writePage(moduleDir, p, next);
        console.log(chalk.green(`[llm] ${moduleId}: updated ${p}`));
        wrote = true;
      }
    }
    if (wrote) {
      const consumed = events
        .filter((e) => isRelevantToModule(e, moduleId) && e.importance === "high" && e._id)
        .map((e) => e._id as string);
      if (consumed.length > 0) {
        await appendEvent(paths, {
          type: "promotion",
          session_id: "compile",
          module: moduleId,
          files: [],
          ts: nowIso(),
          summary: null,
          importance: "normal",
          consumed_event_ids: consumed
        });
        console.log(
          chalk.dim(`[llm] ${moduleId}: promoted ${consumed.length} event(s)`)
        );
      }
    }
  }
}
