import { Searcher } from "fast-fuzzy";
import micromatch from "micromatch";
import type { Config, ModuleConfig } from "./config.js";

export interface ResolvedModule {
  id: string;
  module: ModuleConfig;
  reason: "alias-exact" | "alias-fuzzy" | "recent-edits";
  score?: number;
}

const FUZZY_THRESHOLD = 0.85;

export function resolveFromPrompt(config: Config, prompt: string): ResolvedModule | null {
  const lower = prompt.toLowerCase();
  for (const [id, mod] of Object.entries(config.modules)) {
    for (const alias of mod.aliases) {
      if (alias && lower.includes(alias.toLowerCase())) {
        return { id, module: mod, reason: "alias-exact" };
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
  const hits = searcher.search(prompt);
  if (hits.length === 0) return null;
  const best = hits[0];
  return {
    id: best.item.id,
    module: best.item.module,
    reason: "alias-fuzzy",
    score: best.score
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

export function resolveModule(
  config: Config,
  prompt: string,
  editedFiles: string[]
): ResolvedModule | null {
  return resolveFromPrompt(config, prompt) ?? resolveFromEditedFiles(config, editedFiles);
}
