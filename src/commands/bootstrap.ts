import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { resolvePaths } from "../core/paths.js";
import { collectSignals } from "../bootstrap/signals.js";
import { buildBootstrapPrompt, planModules } from "../bootstrap/prompt.js";
import {
  applyBootstrap,
  printSummary,
  type BootstrapResponse
} from "../bootstrap/apply.js";
import { extractJson, invokeClaude } from "../util/claude.js";

export interface BootstrapOptions {
  dryRun?: boolean;
  force?: boolean;
  noConfig?: boolean;
}

export async function runBootstrap(opts: BootstrapOptions): Promise<void> {
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

  const prompt = buildBootstrapPrompt(config.project.id, signals, planned);

  let raw: string;
  try {
    console.log(chalk.dim("Invoking `claude -p`…"));
    raw = await invokeClaude(prompt);
  } catch (err) {
    console.error(
      chalk.red(
        `claude invocation failed: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    process.exit(3);
  }

  const fallback: BootstrapResponse = {};
  const response = extractJson<BootstrapResponse>(raw, fallback);
  if (!response.overview && !response.modules) {
    console.error(
      chalk.red(
        "Could not parse a valid bootstrap response from claude. Re-run with more context or edit the wiki manually."
      )
    );
    if (response.notes) console.error(chalk.dim(`notes: ${response.notes}`));
    process.exit(4);
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
