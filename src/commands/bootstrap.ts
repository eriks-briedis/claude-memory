import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { resolvePaths } from "../core/paths.js";
import { countTokens } from "../core/tokens.js";
import { collectSignals } from "../bootstrap/signals.js";
import { buildBootstrapPrompt, planModules } from "../bootstrap/prompt.js";
import {
  applyBootstrap,
  printSummary,
  type BootstrapResponse
} from "../bootstrap/apply.js";
import {
  invokeClaude,
  parseJsonResponse,
  type StreamEvent
} from "../util/claude.js";

export interface BootstrapOptions {
  dryRun?: boolean;
  force?: boolean;
  noConfig?: boolean;
  verbose?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface StreamProgress {
  assistantTurns: number;
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  toolUses: Array<{ name: string; turn: number }>;
  rateLimitWarned: boolean;
  sawInit: boolean;
}

function handleStreamEvent(
  event: StreamEvent,
  progress: StreamProgress,
  verbose: boolean
): void {
  if (verbose) {
    const type =
      typeof event.subtype === "string"
        ? `${event.type}/${event.subtype}`
        : event.type;
    process.stderr.write(chalk.dim(`[event] ${type}\n`));
  }

  if (event.type === "system" && event.subtype === "init" && !progress.sawInit) {
    progress.sawInit = true;
    const model = typeof event.model === "string" ? event.model : "unknown";
    const sid =
      typeof event.session_id === "string" ? event.session_id.slice(0, 8) : "?";
    const permMode =
      typeof event.permissionMode === "string" ? event.permissionMode : "?";
    console.log(
      chalk.dim(
        `  connected: model=${model} session=${sid} permission=${permMode}`
      )
    );
    return;
  }

  if (event.type === "assistant") {
    progress.assistantTurns += 1;
    const msg = event.message as
      | { content?: Array<Record<string, unknown>>; usage?: Record<string, unknown> }
      | undefined;
    const usage = msg?.usage;
    if (usage) {
      const o =
        typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      const i =
        typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const c =
        typeof usage.cache_read_input_tokens === "number"
          ? usage.cache_read_input_tokens
          : 0;
      progress.outputTokens += o;
      progress.inputTokens += i;
      progress.cacheReadTokens += c;
    }
    const blocks = msg?.content ?? [];
    for (const b of blocks) {
      if (b.type === "tool_use" && typeof b.name === "string") {
        progress.toolUses.push({
          name: b.name,
          turn: progress.assistantTurns
        });
        const input = b.input as Record<string, unknown> | undefined;
        const hint = summarizeToolInput(b.name, input);
        console.log(
          chalk.dim(
            `  [turn ${progress.assistantTurns}] tool: ${b.name}${hint ? ` (${hint})` : ""}`
          )
        );
      }
    }
    return;
  }

  if (event.type === "rate_limit_event" && !progress.rateLimitWarned) {
    const info = event.rate_limit_info as Record<string, unknown> | undefined;
    const status = info && typeof info.status === "string" ? info.status : "?";
    if (status !== "allowed") {
      progress.rateLimitWarned = true;
      console.log(
        chalk.yellow(
          `  rate limit: status=${status}${
            info?.rateLimitType ? ` (${info.rateLimitType})` : ""
          }`
        )
      );
    }
    return;
  }

  if (event.type === "system" && event.subtype === "hook_response" && verbose) {
    const hookName = typeof event.hook_name === "string" ? event.hook_name : "?";
    const outcome = typeof event.outcome === "string" ? event.outcome : "?";
    console.log(chalk.dim(`  hook: ${hookName} → ${outcome}`));
    return;
  }
}

function summarizeToolInput(
  name: string,
  input: Record<string, unknown> | undefined
): string | null {
  if (!input) return null;
  if (name === "Read" || name === "Write" || name === "Edit") {
    return typeof input.file_path === "string" ? input.file_path : null;
  }
  if (name === "Bash") {
    return typeof input.command === "string"
      ? input.command.slice(0, 60)
      : null;
  }
  if (name === "Glob") {
    return typeof input.pattern === "string" ? input.pattern : null;
  }
  if (name === "Grep") {
    return typeof input.pattern === "string" ? input.pattern : null;
  }
  return null;
}

export async function runBootstrap(opts: BootstrapOptions): Promise<void> {
  const verbose = !!opts.verbose;
  const paths = resolvePaths(process.cwd());
  if (!paths) {
    console.error(
      chalk.red("No .claude-memory/ found. Run `claude-memory init` first.")
    );
    process.exit(1);
  }

  const config = loadConfig(paths.configFile);
  const signals = collectSignals(paths.root, paths.memoryDir);
  const planned = planModules(config, signals);

  if (planned.length === 0) {
    console.error(
      chalk.yellow(
        "No modules declared in config.yaml and no candidate modules detected in the repo. Edit config.yaml manually or add source dirs under src/, services/, apps/, or packages/."
      )
    );
    process.exit(2);
  }

  const declaredCount = planned.filter((p) => p.source === "declared").length;
  const inferredCount = planned.filter((p) => p.source === "inferred").length;
  console.log(
    chalk.dim(
      `Planned modules: ${declaredCount} declared, ${inferredCount} inferred from repo structure.`
    )
  );
  for (const p of planned) {
    console.log(
      chalk.dim(`  - ${p.id} [${p.source}] ${p.owned_paths.join(", ")}`)
    );
  }

  const prompt = buildBootstrapPrompt(config.project.id, signals, planned);
  const promptTokens = countTokens(prompt);
  console.log(
    chalk.dim(
      `Prompt: ${prompt.length.toLocaleString()} chars, ~${promptTokens.toLocaleString()} tokens.`
    )
  );
  if (verbose) {
    console.log(chalk.dim("─── prompt begin ───"));
    console.log(prompt);
    console.log(chalk.dim("─── prompt end ───"));
  }

  const debugDir = join(paths.memoryDir, "state");
  const debugPath = join(debugDir, "bootstrap-last-response.txt");

  console.log(chalk.dim("Invoking `claude -p --output-format=stream-json`…"));
  const progress: StreamProgress = {
    assistantTurns: 0,
    outputTokens: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    toolUses: [],
    rateLimitWarned: false,
    sawInit: false
  };
  const invokeStart = Date.now();
  const ticker = setInterval(() => {
    const elapsed = formatDuration(Date.now() - invokeStart);
    const bits = [
      `elapsed=${elapsed}`,
      `turns=${progress.assistantTurns}`,
      `out=${progress.outputTokens}t`
    ];
    if (progress.toolUses.length > 0) bits.push(`tools=${progress.toolUses.length}`);
    process.stderr.write(chalk.dim(`  …${bits.join(" ")}\n`));
  }, 10000);

  let stdout: string;
  let stderrOut: string;
  let durationMs: number;
  try {
    const result = await invokeClaude(prompt, {
      stream: true,
      onEvent: (event) => handleStreamEvent(event, progress, verbose),
      onStderr: verbose
        ? (chunk) => process.stderr.write(chalk.dim(`[claude stderr] ${chunk}`))
        : undefined
    });
    stdout = result.stdout;
    stderrOut = result.stderr;
    durationMs = result.durationMs;
  } catch (err) {
    clearInterval(ticker);
    const e = err as Error & { stderr?: string; exitCode?: number };
    console.error(chalk.red(`claude invocation failed: ${e.message}`));
    if (e.exitCode !== undefined) {
      console.error(chalk.dim(`  exit code: ${e.exitCode}`));
    }
    if (e.stderr && e.stderr.trim().length > 0) {
      console.error(chalk.dim("  claude stderr:"));
      for (const line of e.stderr.trimEnd().split("\n")) {
        console.error(chalk.dim(`    ${line}`));
      }
    }
    console.error(
      chalk.dim(
        "Tip: run `claude -p --output-format=json <<< \"hi\"` to verify the CLI works, then re-run with --verbose."
      )
    );
    process.exit(3);
  }
  clearInterval(ticker);

  console.log(
    chalk.dim(
      `claude finished in ${formatDuration(durationMs)}: ${progress.assistantTurns} turn(s), ${progress.outputTokens} output tokens, ${progress.toolUses.length} tool call(s).`
    )
  );
  if (stderrOut.trim().length > 0 && !verbose) {
    console.log(
      chalk.dim(
        `  (stderr: ${stderrOut.trim().split("\n").length} line(s); use --verbose to see)`
      )
    );
  }

  mkdirSync(dirname(debugPath), { recursive: true });
  writeFileSync(debugPath, stdout);

  const diag = parseJsonResponse<BootstrapResponse>(stdout);
  if (diag.wrapper) {
    const w = diag.wrapper;
    const bits: string[] = [];
    if (w.sessionId) bits.push(`session=${w.sessionId.slice(0, 8)}`);
    if (w.durationMs !== undefined) bits.push(`claude_dur=${formatDuration(w.durationMs)}`);
    if (w.inputTokens !== undefined) bits.push(`in=${w.inputTokens}t`);
    if (w.outputTokens !== undefined) bits.push(`out=${w.outputTokens}t`);
    if (w.totalCostUsd !== undefined) bits.push(`cost=$${w.totalCostUsd.toFixed(4)}`);
    if (w.isError) bits.push(chalk.red("is_error=true"));
    if (w.subtype) bits.push(`subtype=${w.subtype}`);
    if (bits.length > 0) console.log(chalk.dim(`  ${bits.join(" ")}`));
  }
  console.log(chalk.dim(`  parse stage: ${diag.stage}`));

  if (verbose) {
    console.log(chalk.dim("─── raw response begin ───"));
    console.log(stdout);
    console.log(chalk.dim("─── raw response end ───"));
  }

  const response = diag.value ?? {};
  if (!response.overview && !response.modules) {
    console.error(
      chalk.red("Could not parse a valid bootstrap response from claude.")
    );
    if (diag.error) console.error(chalk.red(`  parse error: ${diag.error}`));
    console.error(chalk.dim(`  raw response saved to: ${debugPath}`));
    const preview = stdout.slice(0, 500).replace(/\n/g, "\n    ");
    console.error(chalk.dim("  first 500 chars:"));
    console.error(chalk.dim(`    ${preview}${stdout.length > 500 ? "…" : ""}`));
    if (diag.wrapper?.isError) {
      console.error(
        chalk.yellow(
          "  claude reported is_error=true — the model refused or hit an error; inspect the saved response."
        )
      );
    }
    if (response.notes) console.error(chalk.dim(`  model notes: ${response.notes}`));
    console.error(
      chalk.dim(
        "Re-run with --verbose for the full prompt + response, or edit the wiki manually."
      )
    );
    process.exit(4);
  }

  const returnedModules = Object.keys(response.modules ?? {});
  const plannedIds = new Set(planned.map((p) => p.id));
  const missing = [...plannedIds].filter((id) => !returnedModules.includes(id));
  const unexpected = returnedModules.filter((id) => !plannedIds.has(id));
  if (missing.length > 0) {
    console.log(
      chalk.yellow(
        `  warning: model omitted ${missing.length} planned module(s): ${missing.join(", ")}`
      )
    );
  }
  if (unexpected.length > 0) {
    console.log(
      chalk.yellow(
        `  warning: model returned ${unexpected.length} unplanned module(s): ${unexpected.join(", ")}`
      )
    );
  }

  const updateConfig =
    !opts.noConfig &&
    planned.some((p) => p.source === "inferred") &&
    !!response.modules;

  const result = applyBootstrap(paths, response, {
    force: !!opts.force,
    dryRun: !!opts.dryRun,
    updateConfig
  });

  printSummary(result, !!opts.dryRun);

  if (!opts.dryRun && result.written.length > 0) {
    console.log("");
    console.log(chalk.bold("Next steps:"));
    console.log("  1. Review .claude-memory/wiki/project/overview.md");
    console.log("  2. Review module aliases in .claude-memory/config.yaml");
    console.log("  3. Run: claude-memory doctor");
  }
}
