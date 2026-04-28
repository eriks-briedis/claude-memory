import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPaths } from "../src/core/paths.js";
import {
  appendEvent,
  collectPromotedIds,
  eventIdFromFile,
  listEventFiles,
  readEventFile,
  nowIso
} from "../src/core/events.js";
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

  it("populates _id on read and strips it on append", async () => {
    const root = mkdtempSync(join(tmpdir(), "cm-evt-"));
    const paths = buildPaths(root);
    const file = await appendEvent(paths, {
      ...makeEvent("s", "a.ts"),
      _id: "should-be-stripped"
    });
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk._id).toBeUndefined();
    const reloaded = readEventFile(file);
    expect(reloaded._id).toBe(eventIdFromFile(file));
    expect(reloaded._id).toMatch(/^\d{4}-\d{2}-\d{2}_\d+$/);
  });

  it("collectPromotedIds aggregates consumed_event_ids across promotion events", () => {
    const events: MemoryEvent[] = [
      {
        type: "promotion",
        session_id: "compile",
        module: "a",
        files: [],
        ts: nowIso(),
        summary: null,
        importance: "normal",
        consumed_event_ids: ["x", "y"]
      },
      {
        type: "promotion",
        session_id: "compile",
        module: "b",
        files: [],
        ts: nowIso(),
        summary: null,
        importance: "normal",
        consumed_event_ids: ["y", "z"]
      },
      {
        type: "session_summary",
        session_id: "noise",
        module: null,
        files: [],
        ts: nowIso(),
        summary: "ignored",
        importance: "high"
      }
    ];
    const ids = collectPromotedIds(events);
    expect([...ids].sort()).toEqual(["x", "y", "z"]);
  });
});
