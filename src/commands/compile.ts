import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { resolvePaths } from "../core/paths.js";
import { listEventFiles, readEventFile } from "../core/events.js";
import {
  filterNewEvents,
  readLastCompiled,
  runDeterministic
} from "../compile/deterministic.js";
import { lintWiki } from "../compile/lint.js";
import { runLlmPass } from "../compile/llm.js";

export async function runCompile(opts: { llm?: boolean }): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) {
    console.error(
      chalk.red("No .claude-memory/ found. Run `claude-memory init` first.")
    );
    process.exit(1);
  }

  const config = loadConfig(paths.configFile);
  const lastCompiled = readLastCompiled(paths);
  const allEvents = listEventFiles(paths).map(readEventFile);
  const newEvents = filterNewEvents(allEvents, lastCompiled);

  if (newEvents.length === 0) {
    console.log(chalk.dim("No new events since last compile."));
  } else {
    console.log(
      chalk.dim(`Processing ${newEvents.length} events since ${lastCompiled ?? "beginning"}.`)
    );
  }

  const det = runDeterministic(paths, config, newEvents);
  console.log(
    chalk.green(
      `Deterministic pass: ${det.modulesTouched.length} module(s) touched, ${det.openQuestions.length} open question(s).`
    )
  );

  if (opts.llm !== false && det.modulesTouched.length > 0) {
    await runLlmPass(paths, config, det.modulesTouched, newEvents);
  }

  const issues = lintWiki(paths);
  if (issues.length > 0) {
    console.error(chalk.yellow(`Lint found ${issues.length} issue(s):`));
    for (const i of issues) {
      console.error(`  [${i.kind}] ${i.file} ${i.detail}`);
    }
    process.exit(2);
  }
  console.log(chalk.green("Lint: ok."));
}
