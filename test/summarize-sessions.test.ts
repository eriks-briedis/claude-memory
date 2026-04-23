import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { loadConfig } from "../src/core/config.js";
import { resolvePaths } from "../src/core/paths.js";
import type { MemoryEvent } from "../src/core/events.js";

vi.mock("../src/util/claude.js", async () => {
  return {
    invokeClaude: vi.fn(),
    parseJsonResponse: (raw: string) => {
      try {
        return { value: JSON.parse(raw), stage: "wrapper-object" };
      } catch (err) {
        return {
          value: null,
          stage: "none",
          error: err instanceof Error ? err.message : String(err)
        };
      }
    },
    extractJson: (raw: string, fallback: unknown) => {
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    }
  };
});

import { invokeClaude } from "../src/util/claude.js";
import { runSessionSummaryPass } from "../src/compile/summarize-sessions.js";

type InvokeResult = { stdout: string; stderr: string; exitCode: number; durationMs: number };
const ok = (raw: string): InvokeResult => ({
  stdout: raw,
  stderr: "",
  exitCode: 0,
  durationMs: 0
});

async function setup(): Promise<{
  paths: ReturnType<typeof resolvePaths>;
  config: ReturnType<typeof loadConfig>;
  transcriptPath: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "cm-ss-"));
  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit({});
  } finally {
    process.chdir(prev);
  }
  const paths = resolvePaths(root)!;
  const config = loadConfig(paths.configFile);
  const transcriptPath = join(root, "transcript.jsonl");
  writeFileSync(transcriptPath, "user: hi\nassistant: hello\n");
  return { paths, config, transcriptPath };
}

function closeEvent(
  session_id: string,
  transcript_path: string | undefined,
  module: string | null = null
): MemoryEvent {
  return {
    type: "session_close",
    session_id,
    module,
    files: ["src/a.ts"],
    ts: "2026-04-23T10:00:00.000Z",
    summary: null,
    importance: "normal",
    transcript_path
  };
}

function loadEvents(paths: NonNullable<ReturnType<typeof resolvePaths>>): MemoryEvent[] {
  return readdirSync(paths.eventsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(paths.eventsDir, f), "utf8")) as MemoryEvent);
}

describe("runSessionSummaryPass", () => {
  beforeEach(() => {
    vi.mocked(invokeClaude).mockReset();
  });

  it("emits one session_summary per valid model summary", async () => {
    const { paths, config, transcriptPath } = await setup();
    vi.mocked(invokeClaude).mockResolvedValueOnce(
      ok(
        JSON.stringify({
          no_update: false,
          summaries: [
            { module: "example", summary: "Confirmed the auth middleware is idempotent.", importance: "high" }
          ]
        })
      )
    );
    const close = closeEvent("s1", transcriptPath);
    const added = await runSessionSummaryPass(paths!, config, [close]);
    const summaries = added.filter((e) => e.type === "session_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].module).toBe("example");
    expect(summaries[0].importance).toBe("high");
    expect(summaries[0].summary).toContain("idempotent");
  });

  it("emits a sentinel event when model returns no_update (prevents retry loop)", async () => {
    const { paths, config, transcriptPath } = await setup();
    vi.mocked(invokeClaude).mockResolvedValueOnce(ok(JSON.stringify({ no_update: true })));
    const close = closeEvent("s2", transcriptPath);
    await runSessionSummaryPass(paths!, config, [close]);
    const summaries = loadEvents(paths!).filter((e) => e.type === "session_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].session_id).toBe("s2");
    expect(summaries[0].summary).toBeNull();
    expect(summaries[0].module).toBeNull();
  });

  it("emits a sentinel when the model response is unparseable", async () => {
    const { paths, config, transcriptPath } = await setup();
    vi.mocked(invokeClaude).mockResolvedValueOnce(ok("not json at all"));
    const close = closeEvent("s3", transcriptPath);
    await runSessionSummaryPass(paths!, config, [close]);
    const summaries = loadEvents(paths!).filter((e) => e.type === "session_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].summary).toBeNull();
  });

  it("emits a sentinel when transcript is missing", async () => {
    const { paths, config } = await setup();
    const close = closeEvent("s4", "/does/not/exist.jsonl");
    await runSessionSummaryPass(paths!, config, [close]);
    const summaries = loadEvents(paths!).filter((e) => e.type === "session_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].summary).toBeNull();
  });

  it("does NOT emit a sentinel when invokeClaude throws (transient error — retry later)", async () => {
    const { paths, config, transcriptPath } = await setup();
    vi.mocked(invokeClaude).mockRejectedValueOnce(new Error("claude not found"));
    const close = closeEvent("s5", transcriptPath);
    await runSessionSummaryPass(paths!, config, [close]);
    const summaries = loadEvents(paths!).filter((e) => e.type === "session_summary");
    expect(summaries).toHaveLength(0);
  });

  it("skips sessions that already have any session_summary (including sentinels)", async () => {
    const { paths, config, transcriptPath } = await setup();
    const close = closeEvent("s6", transcriptPath);
    const sentinel: MemoryEvent = {
      type: "session_summary",
      session_id: "s6",
      module: null,
      files: [],
      ts: "2026-04-23T10:05:00.000Z",
      summary: null,
      importance: "normal"
    };
    const added = await runSessionSummaryPass(paths!, config, [close, sentinel]);
    expect(added).toHaveLength(0);
    expect(invokeClaude).not.toHaveBeenCalled();
  });

  it("drops summaries whose module is not in config (falls back to null)", async () => {
    const { paths, config, transcriptPath } = await setup();
    vi.mocked(invokeClaude).mockResolvedValueOnce(
      ok(
        JSON.stringify({
          summaries: [
            { module: "ghost-module", summary: "cross-cutting fact", importance: "normal" }
          ]
        })
      )
    );
    const close = closeEvent("s7", transcriptPath);
    await runSessionSummaryPass(paths!, config, [close]);
    const summaries = loadEvents(paths!).filter(
      (e) => e.type === "session_summary" && e.session_id === "s7"
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0].module).toBeNull();
    expect(summaries[0].summary).toBe("cross-cutting fact");
  });

  it("calls LLM once when multiple session_close events share the same session_id", async () => {
    const { paths, config, transcriptPath } = await setup();
    vi.mocked(invokeClaude).mockResolvedValue(
      ok(JSON.stringify({ summaries: [{ module: null, summary: "a fact", importance: "normal" }] }))
    );
    const close1 = closeEvent("s9", transcriptPath);
    const close2 = closeEvent("s9", transcriptPath);
    const close3 = closeEvent("s9", transcriptPath);
    await runSessionSummaryPass(paths!, config, [close1, close2, close3]);
    expect(invokeClaude).toHaveBeenCalledTimes(1);
    const summaries = loadEvents(paths!).filter(
      (e) => e.type === "session_summary" && e.session_id === "s9"
    );
    expect(summaries).toHaveLength(1);
  });

  it("deduplicates multiple summaries targeting the same module", async () => {
    const { paths, config, transcriptPath } = await setup();
    vi.mocked(invokeClaude).mockResolvedValueOnce(
      ok(
        JSON.stringify({
          summaries: [
            { module: "example", summary: "first", importance: "normal" },
            { module: "example", summary: "second", importance: "normal" }
          ]
        })
      )
    );
    const close = closeEvent("s8", transcriptPath);
    await runSessionSummaryPass(paths!, config, [close]);
    const summaries = loadEvents(paths!).filter(
      (e) => e.type === "session_summary" && e.session_id === "s8" && e.module === "example"
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0].summary).toBe("first");
  });
});
