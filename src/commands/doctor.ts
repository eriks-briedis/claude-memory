import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { resolvePaths } from "../core/paths.js";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

function check(name: string, fn: () => { ok: boolean; detail?: string }): Check {
  try {
    const { ok, detail } = fn();
    return { name, ok, detail };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function runDoctor(opts: { suggestCron?: boolean }): Promise<void> {
  const paths = resolvePaths(process.cwd());
  if (!paths) {
    console.error(chalk.red("No .claude-memory/ found. Run `claude-memory init` first."));
    process.exit(1);
  }

  const checks: Check[] = [];

  checks.push(
    check("config.yaml loads and validates", () => {
      loadConfig(paths.configFile);
      return { ok: true };
    })
  );

  const config = loadConfig(paths.configFile);

  checks.push(
    check("wiki always_read pages exist", () => {
      const missing = config.retrieval.always_read.filter(
        (rel) => !existsSync(join(paths.memoryDir, rel))
      );
      return {
        ok: missing.length === 0,
        detail: missing.length ? `missing: ${missing.join(", ")}` : undefined
      };
    })
  );

  checks.push(
    check("module wiki directories exist", () => {
      const missing: string[] = [];
      for (const [id, mod] of Object.entries(config.modules)) {
        if (!existsSync(join(paths.memoryDir, mod.wiki_path))) missing.push(id);
      }
      return {
        ok: missing.length === 0,
        detail: missing.length ? `missing: ${missing.join(", ")}` : undefined
      };
    })
  );

  checks.push(
    check(".claude/settings.json has claude-memory hooks", () => {
      const settingsPath = join(paths.root, ".claude", "settings.json");
      if (!existsSync(settingsPath)) return { ok: false, detail: "file missing" };
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const commands = JSON.stringify(settings.hooks ?? {});
      const present =
        commands.includes("claude-memory hook pre-task") &&
        commands.includes("claude-memory hook post-write") &&
        commands.includes("claude-memory hook session-end");
      return {
        ok: present,
        detail: present ? undefined : "re-run `claude-memory init --force`"
      };
    })
  );

  checks.push(
    check("`claude` CLI available on PATH", () => {
      const out = execSync("command -v claude", {
        stdio: ["ignore", "pipe", "ignore"]
      })
        .toString()
        .trim();
      return { ok: !!out, detail: out || "not found" };
    })
  );

  let allOk = true;
  for (const c of checks) {
    const mark = c.ok ? chalk.green("✓") : chalk.red("✗");
    const detail = c.detail ? chalk.dim(` — ${c.detail}`) : "";
    console.log(`  ${mark} ${c.name}${detail}`);
    if (!c.ok) allOk = false;
  }

  if (opts.suggestCron) {
    console.log("");
    console.log(chalk.bold("Suggested cron line (3am nightly):"));
    console.log(`  0 3 * * * cd ${paths.root} && claude-memory compile`);
  }

  process.exit(allOk ? 0 : 1);
}
