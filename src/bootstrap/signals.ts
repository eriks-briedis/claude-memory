import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "out",
  "tmp",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".claude-memory"
]);

const MAX_README_CHARS = 2000;
const MAX_TREE_DEPTH = 3;
const MAX_TREE_ENTRIES_PER_DIR = 40;

const LANGUAGE_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".swift": "swift",
  ".cpp": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp"
};

export interface ProjectSignals {
  rootPath: string;
  packageJson: unknown | null;
  readme: string | null;
  readmeTruncated: boolean;
  tree: string;
  languageStats: Array<{ language: string; count: number }>;
  existingOverview: string | null;
  candidateModuleDirs: Array<{ id: string; owned_path: string; fileCount: number }>;
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function kebab(name: string): string {
  return name
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path)
      .filter((e) => !e.startsWith(".") || e === ".github" || e === ".claude")
      .filter((e) => !IGNORED_DIRS.has(e))
      .sort();
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walkTree(
  root: string,
  current: string,
  depth: number,
  out: string[],
  indent: string
): void {
  if (depth > MAX_TREE_DEPTH) return;
  const entries = listDir(current);
  const truncated = entries.length > MAX_TREE_ENTRIES_PER_DIR;
  const shown = truncated ? entries.slice(0, MAX_TREE_ENTRIES_PER_DIR) : entries;
  for (const e of shown) {
    const full = join(current, e);
    const rel = relative(root, full) || e;
    if (isDir(full)) {
      out.push(`${indent}${e}/`);
      walkTree(root, full, depth + 1, out, indent + "  ");
    } else {
      out.push(`${indent}${e}`);
    }
    void rel;
  }
  if (truncated) out.push(`${indent}… (${entries.length - MAX_TREE_ENTRIES_PER_DIR} more)`);
}

function collectLanguageStats(root: string): Array<{ language: string; count: number }> {
  const counts = new Map<string, number>();
  function recurse(dir: string, depth: number) {
    if (depth > 4) return;
    for (const e of listDir(dir)) {
      const full = join(dir, e);
      if (isDir(full)) {
        recurse(full, depth + 1);
        continue;
      }
      const lang = LANGUAGE_EXT[extname(e).toLowerCase()];
      if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
  }
  recurse(root, 0);
  return [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);
}

function collectCandidateModules(
  root: string
): Array<{ id: string; owned_path: string; fileCount: number }> {
  const roots = ["src", "services", "apps", "packages", "lib"];
  const out: Array<{ id: string; owned_path: string; fileCount: number }> = [];
  for (const r of roots) {
    const parent = join(root, r);
    if (!isDir(parent)) continue;
    for (const entry of listDir(parent)) {
      const full = join(parent, entry);
      if (!isDir(full)) continue;
      const fileCount = countFiles(full);
      if (fileCount < 2) continue;
      out.push({
        id: kebab(entry),
        owned_path: `${r}/${entry}/**`,
        fileCount
      });
    }
  }
  return out;
}

function countFiles(dir: string, depth = 0): number {
  if (depth > 4) return 0;
  let n = 0;
  for (const e of listDir(dir)) {
    const full = join(dir, e);
    if (isDir(full)) n += countFiles(full, depth + 1);
    else n += 1;
  }
  return n;
}

export function collectSignals(rootPath: string, memoryDir: string): ProjectSignals {
  const pkg = readJson(join(rootPath, "package.json"));
  const readmeRaw = readText(join(rootPath, "README.md"));
  const readme =
    readmeRaw !== null
      ? readmeRaw.length > MAX_README_CHARS
        ? readmeRaw.slice(0, MAX_README_CHARS)
        : readmeRaw
      : null;
  const readmeTruncated = readmeRaw !== null && readmeRaw.length > MAX_README_CHARS;

  const treeLines: string[] = [`${basename(rootPath)}/`];
  walkTree(rootPath, rootPath, 1, treeLines, "  ");

  const languageStats = collectLanguageStats(rootPath);

  const overviewPath = join(memoryDir, "wiki", "project", "overview.md");
  const existingOverviewRaw = readText(overviewPath);
  const existingOverview =
    existingOverviewRaw && !existingOverviewRaw.includes("_Fill in:")
      ? existingOverviewRaw
      : null;

  const candidateModuleDirs = collectCandidateModules(rootPath);

  return {
    rootPath,
    packageJson: pkg,
    readme,
    readmeTruncated,
    tree: treeLines.join("\n"),
    languageStats,
    existingOverview,
    candidateModuleDirs
  };
}

export function existsAndReadable(path: string): boolean {
  return existsSync(path);
}
