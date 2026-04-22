import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { Config } from "../core/config.js";
import type { MemoryPaths } from "../core/paths.js";
import type { MemoryEvent } from "../core/events.js";

const PAGES = ["decisions.md", "gotchas.md"] as const;
type PageName = (typeof PAGES)[number];

interface ModelResponse {
  pages?: Partial<Record<PageName, string | null>>;
  no_update?: boolean;
  notes?: string;
}

function buildPrompt(
  moduleId: string,
  currentPages: Record<PageName, string>,
  events: MemoryEvent[]
): string {
  const eventDump = events
    .filter((e) => e.module === moduleId)
    .map((e) => JSON.stringify(e))
    .join("\n");

  return [
    `You are updating the wiki for module "${moduleId}".`,
    "",
    "Current pages:",
    ...PAGES.flatMap((p) => [
      `--- FILE: ${p} ---`,
      currentPages[p].trimEnd(),
      ""
    ]),
    "New raw events since the last compile:",
    eventDump || "(none)",
    "",
    "Update decisions.md and gotchas.md ONLY if the new events contain material worth promoting to canonical wiki content (decisions made, traps discovered). Do not paraphrase existing content.",
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

async function invokeClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", "--output-format=json"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function extractJson(output: string): ModelResponse {
  try {
    const parsed = JSON.parse(output);
    const result =
      typeof parsed === "object" && parsed !== null && "result" in parsed
        ? (parsed as { result: unknown }).result
        : parsed;
    if (typeof result === "string") {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]) as ModelResponse;
    } else if (typeof result === "object" && result !== null) {
      return result as ModelResponse;
    }
  } catch {
    const m = output.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as ModelResponse;
      } catch {
        /* fall through */
      }
    }
  }
  return { no_update: true, notes: "unparseable model response" };
}

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
      raw = await invokeClaude(prompt);
    } catch (err) {
      console.error(
        chalk.yellow(
          `[llm] ${moduleId}: skipped (${err instanceof Error ? err.message : String(err)})`
        )
      );
      continue;
    }

    const response = extractJson(raw);
    if (response.no_update) {
      console.log(chalk.dim(`[llm] ${moduleId}: no update`));
      continue;
    }
    const pages = response.pages ?? {};
    for (const p of PAGES) {
      const next = pages[p];
      if (typeof next === "string" && next.trim().length > 0) {
        writePage(moduleDir, p, next);
        console.log(chalk.green(`[llm] ${moduleId}: updated ${p}`));
      }
    }
  }
}
