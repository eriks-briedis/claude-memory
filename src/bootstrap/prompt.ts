import type { Config } from "../core/config.js";
import { countTokens } from "../core/tokens.js";
import type { ProjectSignals } from "./signals.js";

const PROMPT_BUDGET = 20_000;

export interface PlannedModule {
  id: string;
  aliases: string[];
  owned_paths: string[];
  source: "declared" | "inferred";
}

function truncateForBudget(parts: string[]): string {
  const joined = parts.join("\n");
  if (countTokens(joined) <= PROMPT_BUDGET) return joined;
  let n = parts.length;
  while (n > 0) {
    const candidate = parts.slice(0, n).join("\n") + "\n\n… (truncated for token budget)";
    if (countTokens(candidate) <= PROMPT_BUDGET) return candidate;
    n -= 1;
  }
  return parts[0] ?? "";
}

export function planModules(config: Config, signals: ProjectSignals): PlannedModule[] {
  const declared = Object.entries(config.modules).filter(
    ([id]) => id !== "example"
  );
  if (declared.length > 0) {
    return declared.map(([id, mod]) => ({
      id,
      aliases: mod.aliases,
      owned_paths: mod.owned_paths,
      source: "declared"
    }));
  }
  return signals.candidateModuleDirs.map((c) => ({
    id: c.id,
    aliases: [],
    owned_paths: [c.owned_path],
    source: "inferred"
  }));
}

export function buildBootstrapPrompt(
  projectId: string,
  signals: ProjectSignals,
  plannedModules: PlannedModule[]
): string {
  const pkg = signals.packageJson
    ? JSON.stringify(signals.packageJson, null, 2)
    : "(no package.json)";

  const readme = signals.readme
    ? signals.readme + (signals.readmeTruncated ? "\n…(truncated)" : "")
    : "(no README.md)";

  const languages =
    signals.languageStats.length > 0
      ? signals.languageStats
          .slice(0, 5)
          .map((l) => `${l.language}: ${l.count}`)
          .join(", ")
      : "(unknown)";

  const modulesBlock = plannedModules
    .map(
      (m) =>
        `  - ${m.id} [${m.source}]: owned_paths=${JSON.stringify(m.owned_paths)}, aliases=${JSON.stringify(m.aliases)}`
    )
    .join("\n");

  const moduleIds = plannedModules.map((m) => `"${m.id}"`).join(", ");

  const parts: string[] = [
    `You are generating the initial wiki for the project "${projectId}".`,
    "",
    "Your job: analyze the signals below and produce an overview, conventions page, and per-module index + architecture page. Keep prose tight and factual. Prefer bullet lists. Do not speculate beyond what the signals show.",
    "",
    "Signals follow.",
    "",
    "## package.json",
    pkg,
    "",
    "## README.md",
    readme,
    "",
    "## Language distribution",
    languages,
    "",
    "## Directory tree (filtered)",
    signals.tree,
    "",
    "## Planned modules",
    modulesBlock || "(no modules planned)",
    "",
    signals.existingOverview
      ? "## Existing overview (preserve tone / facts)\n" + signals.existingOverview
      : "",
    "",
    "## Output contract",
    "Respond with ONE JSON object, no commentary before or after. The shape:",
    "",
    "{",
    '  "wiki_index": "markdown for wiki/index.md (list overview, conventions, active-work, pinned, and the modules)",',
    '  "overview": "markdown for wiki/project/overview.md: what the project does, top-level architecture, key dependencies, entry points",',
    '  "conventions": "markdown for wiki/project/conventions.md: code style, test approach, commit conventions, any repo-wide invariants",',
    '  "modules": {',
    `    ${moduleIds || '"module_id"'}: {`,
    '      "aliases": ["short alias", "another alias"],',
    '      "owned_paths": ["glob/**"],',
    '      "index": "markdown for modules/<id>/index.md: link to architecture/decisions/gotchas + ## Files stub",',
    '      "architecture": "markdown for modules/<id>/architecture.md: shape, key entry points, how it relates to the rest"',
    "    }",
    "  },",
    '  "notes": "one line summary of what you produced"',
    "}",
    "",
    "Rules:",
    "- Every module listed in 'Planned modules' must appear in 'modules' with all four fields.",
    "- For declared modules, do NOT change owned_paths or aliases — copy them verbatim.",
    "- For inferred modules, you may refine aliases and keep owned_paths unless clearly wrong.",
    "- Each module's index.md must include a `## Files` section with placeholder text `_(compiler-maintained list)_`.",
    "- No backticks around the top-level JSON. No trailing commentary."
  ];

  return truncateForBudget(parts);
}
