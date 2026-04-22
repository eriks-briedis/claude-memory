import type { FileChange, MemoryEvent } from "../core/events.js";

const SNIPPET_LIMIT = 80;

function firstLine(s: string | undefined, limit = SNIPPET_LIMIT): string {
  if (!s) return "";
  const line = s.split("\n")[0] ?? "";
  return line.length > limit ? line.slice(0, limit) + "…" : line;
}

function lineCount(s: string | undefined): number {
  if (!s) return 0;
  return s.split("\n").length;
}

export function summarizeChange(c: FileChange): string {
  const head = `${c.tool} ${c.file}`;
  if (c.kind === "write") {
    const lines = lineCount(c.content);
    const preview = firstLine(c.content);
    const trunc = c.content_truncated ? " (truncated)" : "";
    return `${head}: +${lines}L${trunc}${preview ? ` "${preview}"` : ""}`;
  }
  const oldL = lineCount(c.old_string);
  const newL = lineCount(c.new_string);
  const oldPrev = firstLine(c.old_string, 60);
  const newPrev = firstLine(c.new_string, 60);
  const trunc = c.old_truncated || c.new_truncated ? " (truncated)" : "";
  return `${head}: ${oldL}L → ${newL}L${trunc}${oldPrev || newPrev ? ` ("${oldPrev}" → "${newPrev}")` : ""}`;
}

export function summarizeEvent(e: MemoryEvent): string {
  const ts = e.ts?.slice(0, 19) ?? "?";
  const mod = e.module ?? "(unscoped)";
  switch (e.type) {
    case "file_write": {
      const changes = (e.changes ?? []).map(summarizeChange);
      if (changes.length === 0 && e.files.length > 0) {
        return `[${ts}] ${mod} file_write: ${e.files.join(", ")}`;
      }
      return `[${ts}] ${mod} file_write\n    - ${changes.join("\n    - ")}`;
    }
    case "user_prompt": {
      const preview = firstLine(e.prompt, 200);
      return `[${ts}] ${mod} user_prompt: ${preview}`;
    }
    case "user_instruction": {
      const preview = firstLine(e.prompt ?? e.summary ?? "", 200);
      return `[${ts}] ${mod} user_instruction (${e.importance}): ${preview}`;
    }
    case "session_close": {
      return `[${ts}] ${mod} session_close: ${e.files.length} file(s) touched`;
    }
    default:
      return `[${ts}] ${mod} ${e.type}`;
  }
}
