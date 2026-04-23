import { Searcher } from "fast-fuzzy";
import micromatch from "micromatch";
import type { Config, ModuleConfig } from "./config.js";

export interface ResolvedModule {
  id: string;
  module: ModuleConfig;
  reason:
    | "alias-exact"
    | "path-in-prompt"
    | "alias-fuzzy"
    | "recent-edits"
    | "session-sticky";
  score?: number;
  matchedAlias?: string;
  matchedPath?: string;
}

const FUZZY_THRESHOLD = 0.85;
const MIN_FUZZY_TOKEN_LEN = 4;
const MIN_PATH_PREFIX_LEN = 4;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasMatchesPrompt(alias: string, prompt: string): boolean {
  if (!alias) return false;
  const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
  return re.test(prompt);
}

function tokenize(prompt: string): string[] {
  return prompt
    .split(/[^A-Za-z0-9_-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_FUZZY_TOKEN_LEN);
}

function pathPrefix(glob: string): string {
  let end = glob.length;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" || ch === "?" || ch === "[" || ch === "{") {
      end = i;
      break;
    }
  }
  let pref = glob.slice(0, end);
  while (pref.endsWith("/")) pref = pref.slice(0, -1);
  return pref;
}

export function resolveFromPathsInPrompt(
  config: Config,
  prompt: string
): ResolvedModule | null {
  const lower = prompt.toLowerCase();
  const matches: Array<{ id: string; module: ModuleConfig; prefix: string }> = [];
  for (const [id, mod] of Object.entries(config.modules)) {
    let bestPrefix: string | null = null;
    for (const glob of mod.owned_paths) {
      const pref = pathPrefix(glob);
      if (pref.length < MIN_PATH_PREFIX_LEN) continue;
      if (!lower.includes(pref.toLowerCase())) continue;
      if (!bestPrefix || pref.length > bestPrefix.length) bestPrefix = pref;
    }
    if (bestPrefix) matches.push({ id, module: mod, prefix: bestPrefix });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.prefix.length - a.prefix.length);
  if (matches.length > 1 && matches[0].prefix.length === matches[1].prefix.length) {
    return null;
  }
  return {
    id: matches[0].id,
    module: matches[0].module,
    reason: "path-in-prompt",
    matchedPath: matches[0].prefix
  };
}

export function resolveFromPrompt(config: Config, prompt: string): ResolvedModule | null {
  const pathHit = resolveFromPathsInPrompt(config, prompt);
  if (pathHit) return pathHit;

  for (const [id, mod] of Object.entries(config.modules)) {
    for (const alias of mod.aliases) {
      if (aliasMatchesPrompt(alias, prompt)) {
        return { id, module: mod, reason: "alias-exact", matchedAlias: alias };
      }
    }
  }

  const candidates: Array<{ id: string; module: ModuleConfig; alias: string }> = [];
  for (const [id, mod] of Object.entries(config.modules)) {
    for (const alias of mod.aliases) {
      candidates.push({ id, module: mod, alias });
    }
  }
  if (candidates.length === 0) return null;

  const searcher = new Searcher(candidates, {
    keySelector: (c) => c.alias,
    threshold: FUZZY_THRESHOLD,
    returnMatchData: true
  });

  const tokens = tokenize(prompt);
  let best: { item: { id: string; module: ModuleConfig; alias: string }; score: number } | null =
    null;
  for (const token of tokens) {
    const hits = searcher.search(token);
    for (const h of hits) {
      if (!best || h.score > best.score) best = h;
    }
  }
  if (!best) return null;
  return {
    id: best.item.id,
    module: best.item.module,
    reason: "alias-fuzzy",
    score: best.score,
    matchedAlias: best.item.alias
  };
}

export function resolveFromEditedFiles(
  config: Config,
  editedFiles: string[]
): ResolvedModule | null {
  if (editedFiles.length === 0) return null;
  const matches: Array<{ id: string; module: ModuleConfig; hits: number }> = [];
  for (const [id, mod] of Object.entries(config.modules)) {
    if (mod.owned_paths.length === 0) continue;
    const hits = editedFiles.filter((f) => micromatch.isMatch(f, mod.owned_paths)).length;
    if (hits > 0) matches.push({ id, module: mod, hits });
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.hits - a.hits);
  if (matches.length > 1 && matches[0].hits === matches[1].hits) return null;
  return { id: matches[0].id, module: matches[0].module, reason: "recent-edits" };
}

function resolveFromPriorSession(
  config: Config,
  priorModuleId: string | null | undefined
): ResolvedModule | null {
  if (!priorModuleId) return null;
  const mod = config.modules[priorModuleId];
  if (!mod) return null;
  return { id: priorModuleId, module: mod, reason: "session-sticky" };
}

export function resolveModule(
  config: Config,
  prompt: string,
  editedFiles: string[],
  priorModuleId?: string | null
): ResolvedModule | null {
  return (
    resolveFromPrompt(config, prompt) ??
    resolveFromEditedFiles(config, editedFiles) ??
    resolveFromPriorSession(config, priorModuleId)
  );
}
