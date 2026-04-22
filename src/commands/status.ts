import { existsSync, readFileSync } from "node:fs";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { resolvePaths } from "../core/paths.js";
import { listEventFiles } from "../core/events.js";

export async function runStatus(): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) {
    console.error(chalk.red("No .claude-memory/ found in this directory or any parent."));
    process.exit(1);
  }

  const config = loadConfig(paths.configFile);
  const eventFiles = listEventFiles(paths);
  const lastCompiled = existsSync(paths.lastCompiledFile)
    ? readFileSync(paths.lastCompiledFile, "utf8").trim()
    : "never";

  console.log(chalk.bold("claude-memory status"));
  console.log(`  root:           ${paths.root}`);
  console.log(`  project_id:     ${config.project.id}`);
  console.log(`  memory_enabled: ${config.project.memory_enabled}`);
  console.log(`  modules:        ${Object.keys(config.modules).length}`);
  for (const id of Object.keys(config.modules)) {
    console.log(`    - ${id}`);
  }
  console.log(`  events:         ${eventFiles.length}`);
  console.log(`  last_compiled:  ${lastCompiled}`);
  console.log(`  token_budget:   ${config.retrieval.max_context_tokens}`);
}
