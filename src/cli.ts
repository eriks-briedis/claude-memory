#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("claude-memory")
  .description("Per-project memory wiki for Claude Code.")
  .version("0.1.0");

program
  .command("init")
  .description("Scaffold .claude-memory/ and wire Claude Code hooks for this repo.")
  .option("--force", "Overwrite existing .claude-memory/ directory.")
  .action(async (opts) => {
    const { runInit } = await import("./commands/init.js");
    await runInit(opts);
  });

const hook = program
  .command("hook")
  .description("Internal hook dispatcher (invoked by Claude Code, not users).");

hook
  .command("pre-task")
  .action(async () => {
    const { runPreTask } = await import("./commands/hook.js");
    await runPreTask();
  });

hook
  .command("post-write")
  .action(async () => {
    const { runPostWrite } = await import("./commands/hook.js");
    await runPostWrite();
  });

hook
  .command("session-end")
  .action(async () => {
    const { runSessionEnd } = await import("./commands/hook.js");
    await runSessionEnd();
  });

program
  .command("compile")
  .description("Run deterministic + LLM compile passes over recent raw events.")
  .option("--no-llm", "Skip the LLM compile pass.")
  .action(async (opts) => {
    const { runCompile } = await import("./commands/compile.js");
    await runCompile(opts);
  });

program
  .command("status")
  .description("Print config summary, last compile time, and event counts.")
  .action(async () => {
    const { runStatus } = await import("./commands/status.js");
    await runStatus();
  });

program
  .command("doctor")
  .description("Validate configuration and environment.")
  .option("--suggest-cron", "Print a paste-ready cron line for nightly compile.")
  .action(async (opts) => {
    const { runDoctor } = await import("./commands/doctor.js");
    await runDoctor(opts);
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
