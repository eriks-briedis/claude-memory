import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ModuleSchema = z.object({
  aliases: z.array(z.string()).default([]),
  wiki_path: z.string(),
  owned_paths: z.array(z.string()).default([]),
  related_cross_cutting: z.array(z.string()).default([])
});

const ConfigSchema = z.object({
  project: z.object({
    id: z.string(),
    memory_enabled: z.boolean().default(true)
  }),
  retrieval: z
    .object({
      always_read: z.array(z.string()).default([]),
      max_context_tokens: z.number().int().positive().default(8000),
      show_breadcrumb: z.boolean().default(false)
    })
    .default({ always_read: [], max_context_tokens: 8000, show_breadcrumb: false }),
  modules: z.record(z.string(), ModuleSchema).default({})
});

export type Config = z.infer<typeof ConfigSchema>;
export type ModuleConfig = z.infer<typeof ModuleSchema>;

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw);
  return ConfigSchema.parse(parsed);
}

export function parseConfig(raw: string): Config {
  return ConfigSchema.parse(parseYaml(raw));
}
