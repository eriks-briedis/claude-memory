import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { buildPaths } from "../core/paths.js";
import { installHooks } from "../util/settings-json.js";

const HERE = dirname(fileURLToPath(import.meta.url));
function resolveTemplatesDir(): string {
  const distCandidate = join(HERE, "..", "templates");
  if (existsSync(distCandidate)) return distCandidate;
  const srcCandidate = join(HERE, "..", "..", "src", "templates");
  return srcCandidate;
}
const TEMPLATES_DIR = resolveTemplatesDir();

const CLAUDE_MD_START = "<!-- claude-memory:start -->";
const CLAUDE_MD_END = "<!-- claude-memory:end -->";

function deriveProjectId(cwd: string): string {
  try {
    const url = execSync("git remote get-url origin", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
    const match = url.match(/[/:]([^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch {
    /* no remote */
  }
  return basename(cwd);
}

function renderTemplate(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function copyTemplateTree(srcDir: string, dstDir: string, vars: Record<string, string>) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const stat = statSync(src);
    if (stat.isDirectory()) {
      copyTemplateTree(src, join(dstDir, entry), vars);
      continue;
    }
    const dstName = entry.endsWith(".tmpl") ? entry.slice(0, -".tmpl".length) : entry;
    const dst = join(dstDir, dstName);
    if (entry.endsWith(".tmpl")) {
      writeFileSync(dst, renderTemplate(readFileSync(src, "utf8"), vars));
    } else {
      cpSync(src, dst);
    }
  }
}

function upsertClaudeMd(repoRoot: string, block: string): void {
  const path = join(repoRoot, "CLAUDE.md");
  if (!existsSync(path)) {
    writeFileSync(path, block.endsWith("\n") ? block : block + "\n");
    return;
  }
  const content = readFileSync(path, "utf8");
  const startIdx = content.indexOf(CLAUDE_MD_START);
  const endIdx = content.indexOf(CLAUDE_MD_END);
  if (startIdx !== -1 && endIdx !== -1) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + CLAUDE_MD_END.length);
    writeFileSync(path, before + block.trim() + after);
    return;
  }
  const sep = content.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, content + sep + block);
}

export async function runInit(opts: { force?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const paths = buildPaths(cwd);
  if (existsSync(paths.memoryDir) && !opts.force) {
    console.error(
      chalk.red(`.claude-memory/ already exists at ${cwd}. Re-run with --force to overwrite.`)
    );
    process.exit(1);
  }

  const projectId = deriveProjectId(cwd);
  const vars = { project_id: projectId };

  const templateMemory = join(TEMPLATES_DIR);
  mkdirSync(paths.memoryDir, { recursive: true });
  mkdirSync(paths.eventsDir, { recursive: true });
  mkdirSync(paths.stateDir, { recursive: true });
  mkdirSync(paths.sessionsDir, { recursive: true });

  copyTemplateTree(join(templateMemory, "wiki"), paths.wikiDir, vars);

  const configTpl = readFileSync(join(templateMemory, "config.yaml.tmpl"), "utf8");
  writeFileSync(paths.configFile, renderTemplate(configTpl, vars));

  const claudeBlockTpl = readFileSync(
    join(templateMemory, "CLAUDE.md.tmpl"),
    "utf8"
  );
  upsertClaudeMd(cwd, renderTemplate(claudeBlockTpl, vars));

  const settingsPath = join(cwd, ".claude", "settings.json");
  installHooks(settingsPath);

  console.log(chalk.green(`Initialized claude-memory in ${cwd}`));
  console.log(`  project_id: ${projectId}`);
  console.log(`  hooks written to: ${settingsPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Edit .claude-memory/config.yaml — add real modules.");
  console.log("  2. Fill in .claude-memory/wiki/project/overview.md.");
  console.log("  3. Run: claude-memory doctor");
}

