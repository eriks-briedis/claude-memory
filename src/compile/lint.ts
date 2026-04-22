import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { MemoryPaths } from "../core/paths.js";

const MD_LINK_RE = /\[[^\]]+\]\(([^)]+)\)/g;

export interface LintIssue {
  kind: "broken-link" | "missing-index-entry";
  file: string;
  detail: string;
}

function walkMd(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkMd(full, out);
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

export function lintWiki(paths: MemoryPaths): LintIssue[] {
  const issues: LintIssue[] = [];
  const pages = walkMd(paths.wikiDir);

  for (const page of pages) {
    const content = readFileSync(page, "utf8");
    for (const match of content.matchAll(MD_LINK_RE)) {
      const target = match[1];
      if (!target || target.startsWith("http") || target.startsWith("#") || target.startsWith("mailto:")) {
        continue;
      }
      const bare = target.split("#")[0];
      if (!bare) continue;
      const abs = resolve(dirname(page), bare);
      if (!existsSync(abs)) {
        issues.push({
          kind: "broken-link",
          file: relative(paths.memoryDir, page),
          detail: `-> ${target}`
        });
      }
    }
  }

  for (const page of pages) {
    if (!page.endsWith("index.md")) continue;
    const dir = dirname(page);
    const linked = new Set<string>();
    const content = readFileSync(page, "utf8");
    for (const m of content.matchAll(MD_LINK_RE)) {
      const t = (m[1] ?? "").split("#")[0];
      if (!t || t.startsWith("http")) continue;
      linked.add(resolve(dir, t));
    }
    for (const entry of readdirSync(dir)) {
      if (entry === "index.md" || !entry.endsWith(".md")) continue;
      const abs = join(dir, entry);
      if (!linked.has(abs)) {
        issues.push({
          kind: "missing-index-entry",
          file: relative(paths.memoryDir, page),
          detail: `${entry} not linked from index`
        });
      }
    }
  }

  return issues;
}
