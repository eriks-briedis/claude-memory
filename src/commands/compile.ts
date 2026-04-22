import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import lockfile from "proper-lockfile";
import { loadConfig } from "../core/config.js";
import { resolvePaths, type MemoryPaths } from "../core/paths.js";
import { listEventFiles, readEventFile } from "../core/events.js";
import {
  filterNewEvents,
  readLastCompiled,
  runDeterministic
} from "../compile/deterministic.js";
import { lintWiki } from "../compile/lint.js";
import { runLlmPass } from "../compile/llm.js";

function ensureLockFile(paths: MemoryPaths): string {
  mkdirSync(paths.stateDir, { recursive: true });
  const lockPath = join(paths.stateDir, "compile.lock");
  if (!existsSync(lockPath)) closeSync(openSync(lockPath, "a"));
  return lockPath;
}

async function runCompileLocked(
  paths: MemoryPaths,
  opts: { llm?: boolean }
): Promise<void> {
  const config = loadConfig(paths.configFile);
  const lastCompiled = readLastCompiled(paths);
  const eventFiles = listEventFiles(paths);
  const allEvents = [];
  for (const f of eventFiles) {
    try {
      const e = readEventFile(f);
      if (typeof e.ts !== "string") {
        console.error(chalk.yellow(`skipping ${f}: missing "ts"`));
        continue;
      }
      allEvents.push(e);
    } catch (err) {
      console.error(
        chalk.yellow(
          `skipping ${f}: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }
  const newEvents = filterNewEvents(allEvents, lastCompiled);

  if (newEvents.length === 0) {
    console.log(chalk.dim("No new events since last compile."));
  } else {
    console.log(
      chalk.dim(
        `Processing ${newEvents.length} events since ${lastCompiled ?? "beginning"}.`
      )
    );
  }

  const det = runDeterministic(paths, config, newEvents, allEvents);
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

export async function runCompile(opts: { llm?: boolean }): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) {
    console.error(
      chalk.red("No .claude-memory/ found. Run `claude-memory init` first.")
    );
    process.exit(1);
  }

  const lockPath = ensureLockFile(paths);
  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(lockPath, {
      retries: { retries: 0 },
      stale: 10 * 60 * 1000
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already being held")) {
      console.error(
        chalk.red(
          "another claude-memory compile is already running (lock: " +
            lockPath +
            "). Wait for it to finish or delete the lock if stale."
        )
      );
      process.exit(3);
    }
    throw err;
  }

  try {
    await runCompileLocked(paths, opts);
  } finally {
    if (release) await release();
  }
}
