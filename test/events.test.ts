import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPaths } from "../src/core/paths.js";
import { appendEvent, listEventFiles, readEventFile, nowIso } from "../src/core/events.js";
import type { MemoryEvent } from "../src/core/events.js";

function makeEvent(sessionId: string, file: string): MemoryEvent {
  return {
    type: "file_write",
    session_id: sessionId,
    module: null,
    files: [file],
    ts: nowIso(),
    summary: null,
    importance: "normal"
  };
}

describe("events", () => {
  it("assigns unique monotonic filenames under concurrent writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "cm-evt-"));
    const paths = buildPaths(root);
    const n = 20;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        appendEvent(paths, makeEvent("s", `f${i}.ts`))
      )
    );
    const uniq = new Set(results);
    expect(uniq.size).toBe(n);

    const files = listEventFiles(paths);
    expect(files.length).toBe(n);
    const events = files.map(readEventFile);
    expect(events.map((e) => e.files[0]).sort()).toEqual(
      Array.from({ length: n }, (_, i) => `f${i}.ts`).sort()
    );
  });
});
