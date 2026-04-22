import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { Document, parseDocument } from "yaml";
import type { MemoryPaths } from "../core/paths.js";

const TEMPLATE_MARKERS = [
  "<!-- claude-memory:template -->",
  "_Fill in:",
  "_Describe the module",
  "_ADRs and notable",
  "_Non-obvious traps"
];

const MAX_TEMPLATE_LENGTH = 800;

const NEVER_TOUCH = new Set([
  "decisions.md",
  "gotchas.md",
  "pinned.md",
  "active-work.md",
  "open-questions.md"
]);

export interface ModuleResponse {
  aliases: string[];
  owned_paths: string[];
  index: string;
  architecture: string;
}

export interface BootstrapResponse {
  wiki_index?: string;
  overview?: string;
  conventions?: string;
  modules?: Record<string, Partial<ModuleResponse>>;
  notes?: string;
}

export interface ApplyOptions {
  force: boolean;
  dryRun: boolean;
  updateConfig: boolean;
}

export interface ApplyResult {
  written: string[];
  skipped: Array<{ path: string; reason: string }>;
  configUpdated: boolean;
}

export function isUnfilledTemplate(content: string): boolean {
  if (content.length > MAX_TEMPLATE_LENGTH) return false;
  return TEMPLATE_MARKERS.some((m) => content.includes(m));
}

function baseName(p: string): string {
  return p.split("/").pop() ?? p;
}

function canOverwrite(path: string, opts: ApplyOptions): { ok: boolean; reason?: string } {
  const name = baseName(path);
  if (NEVER_TOUCH.has(name)) return { ok: false, reason: "protected file" };
  if (!existsSync(path)) return { ok: true };
  if (opts.force) return { ok: true };
  const existing = readFileSync(path, "utf8");
  if (isUnfilledTemplate(existing)) return { ok: true };
  return { ok: false, reason: "user-edited (use --force to overwrite)" };
}

function writeIfAllowed(
  path: string,
  content: string,
  opts: ApplyOptions,
  result: ApplyResult
): void {
  const check = canOverwrite(path, opts);
  if (!check.ok) {
    result.skipped.push({ path, reason: check.reason ?? "unknown" });
    return;
  }
  if (opts.dryRun) {
    result.written.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const body = content.endsWith("\n") ? content : content + "\n";
  writeFileSync(path, body);
  result.written.push(path);
}

export function applyBootstrap(
  paths: MemoryPaths,
  response: BootstrapResponse,
  opts: ApplyOptions
): ApplyResult {
  const result: ApplyResult = { written: [], skipped: [], configUpdated: false };

  const wikiIndex = join(paths.wikiDir, "index.md");
  if (response.wiki_index) {
    writeIfAllowed(wikiIndex, response.wiki_index, opts, result);
  }

  const overview = join(paths.wikiDir, "project", "overview.md");
  if (response.overview) {
    writeIfAllowed(overview, response.overview, opts, result);
  }

  const conventions = join(paths.wikiDir, "project", "conventions.md");
  if (response.conventions) {
    writeIfAllowed(conventions, response.conventions, opts, result);
  }

  const modules = response.modules ?? {};
  for (const [id, mod] of Object.entries(modules)) {
    const dir = join(paths.wikiDir, "modules", id);
    if (mod.index) {
      writeIfAllowed(join(dir, "index.md"), mod.index, opts, result);
    }
    if (mod.architecture) {
      writeIfAllowed(join(dir, "architecture.md"), mod.architecture, opts, result);
    }
    if (!opts.dryRun) {
      mkdirSync(dir, { recursive: true });
      const decisionsPath = join(dir, "decisions.md");
      const gotchasPath = join(dir, "gotchas.md");
      if (!existsSync(decisionsPath)) {
        writeFileSync(
          decisionsPath,
          `# ${id} — decisions\n\n_ADRs and notable technical decisions. One decision per section._\n`
        );
      }
      if (!existsSync(gotchasPath)) {
        writeFileSync(
          gotchasPath,
          `# ${id} — gotchas\n\n_Non-obvious traps and hard-won knowledge._\n`
        );
      }
    }
  }

  if (opts.updateConfig) {
    result.configUpdated = updateConfigModules(paths, modules, opts);
  }

  return result;
}

function updateConfigModules(
  paths: MemoryPaths,
  modules: Record<string, Partial<ModuleResponse>>,
  opts: ApplyOptions
): boolean {
  if (Object.keys(modules).length === 0) return false;
  if (!existsSync(paths.configFile)) return false;
  const doc = parseDocument(readFileSync(paths.configFile, "utf8"));
  const nextModules = buildModulesDoc(modules);
  doc.set("modules", nextModules.get("modules"));
  if (!opts.dryRun) {
    writeFileSync(paths.configFile, doc.toString());
  }
  return true;
}

function buildModulesDoc(modules: Record<string, Partial<ModuleResponse>>): Document {
  const doc = new Document({
    modules: Object.fromEntries(
      Object.entries(modules).map(([id, mod]) => [
        id,
        {
          aliases: mod.aliases ?? [],
          wiki_path: `wiki/modules/${id}`,
          owned_paths: mod.owned_paths ?? [],
          related_cross_cutting: []
        }
      ])
    )
  });
  return doc;
}

export function printSummary(result: ApplyResult, dryRun: boolean): void {
  const verb = dryRun ? "would write" : "wrote";
  if (result.written.length > 0) {
    console.log(chalk.green(`${verb} ${result.written.length} file(s):`));
    for (const p of result.written) console.log(`  ${p}`);
  }
  if (result.skipped.length > 0) {
    console.log(chalk.yellow(`skipped ${result.skipped.length} file(s):`));
    for (const s of result.skipped) {
      console.log(`  ${s.path} — ${s.reason}`);
    }
  }
  if (result.configUpdated) {
    console.log(chalk.green(`config.yaml modules block ${dryRun ? "would be" : "was"} updated`));
  }
}
