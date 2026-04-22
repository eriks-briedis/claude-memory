import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { Config } from "./config.js";
import type { MemoryPaths } from "./paths.js";
import type { ResolvedModule } from "./resolver.js";
import { countTokens } from "./tokens.js";

export interface LoadedPage {
  path: string;
  content: string;
  tokens: number;
}

export interface LoadResult {
  pages: LoadedPage[];
  skipped: string[];
  totalTokens: number;
}

const MD_LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;

function readRelative(paths: MemoryPaths, relPath: string): string | null {
  const abs = join(paths.memoryDir, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

function extractMdLinks(content: string, basePath: string): string[] {
  const links: string[] = [];
  for (const match of content.matchAll(MD_LINK_RE)) {
    const target = match[1];
    if (!target || target.startsWith("http") || target.startsWith("#")) continue;
    const resolved = resolve(dirname(basePath), target);
    links.push(resolved);
  }
  return links;
}

function toRelative(paths: MemoryPaths, absolute: string): string {
  const prefix = paths.memoryDir.endsWith("/")
    ? paths.memoryDir
    : `${paths.memoryDir}/`;
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
}

export function loadContext(
  paths: MemoryPaths,
  config: Config,
  resolved: ResolvedModule | null
): LoadResult {
  const budget = config.retrieval.max_context_tokens;
  const pages: LoadedPage[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let total = 0;

  const queue: string[] = [...config.retrieval.always_read];

  if (resolved) {
    const indexRel = `${resolved.module.wiki_path}/index.md`;
    queue.push(indexRel);
    const indexAbs = join(paths.memoryDir, indexRel);
    if (existsSync(indexAbs)) {
      const indexContent = readFileSync(indexAbs, "utf8");
      for (const linkAbs of extractMdLinks(indexContent, indexAbs)) {
        queue.push(toRelative(paths, linkAbs));
      }
    }
  }

  for (const rel of queue) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const content = readRelative(paths, rel);
    if (content === null) continue;
    const tokens = countTokens(content);
    if (total + tokens > budget) {
      skipped.push(rel);
      continue;
    }
    pages.push({ path: rel, content, tokens });
    total += tokens;
  }

  return { pages, skipped, totalTokens: total };
}

export function formatContext(result: LoadResult): string {
  if (result.pages.length === 0) return "";
  const parts = result.pages.map(
    (p) => `--- FILE: ${p.path} ---\n${p.content.trimEnd()}\n`
  );
  return parts.join("\n");
}
