import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import {
  runPostWrite,
  runPreTask,
  runSessionEnd,
  runSessionStart
} from "../src/commands/hook.js";
import { appendEvent, type MemoryEvent } from "../src/core/events.js";
import { listEventFiles, readEventFile } from "../src/core/events.js";
import { buildPaths } from "../src/core/paths.js";
import { readSession } from "../src/core/session-state.js";

async function initRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "cm-hook-"));
  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit({});
  } finally {
    process.chdir(prev);
  }
  // Tests must not fork real compile processes from session-end.
  const cfgPath = join(root, ".claude-memory", "config.yaml");
  const cfg = readFileSync(cfgPath, "utf8").replace(
    "auto_compile: true",
    "auto_compile: false"
  );
  writeFileSync(cfgPath, cfg);
  return root;
}

async function inCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

describe("hook events", () => {
  it("post-write captures tool and change content for Edit", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPostWrite({
        session_id: "s1",
        tool_name: "Edit",
        tool_input: {
          file_path: "src/example/foo.ts",
          old_string: "return 1",
          new_string: "return 2"
        }
      })
    );
    const events = listEventFiles(buildPaths(root)).map(readEventFile);
    const writes = events.filter((e) => e.type === "file_write");
    expect(writes).toHaveLength(1);
    const c = writes[0].changes?.[0];
    expect(c?.tool).toBe("Edit");
    expect(c?.kind).toBe("edit");
    expect(c?.old_string).toBe("return 1");
    expect(c?.new_string).toBe("return 2");
  });

  it("post-write captures content for Write", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPostWrite({
        session_id: "s1",
        tool_name: "Write",
        tool_input: {
          file_path: "src/example/new.ts",
          content: "export const x = 1;\n"
        }
      })
    );
    const writes = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "file_write");
    const c = writes[0].changes?.[0];
    expect(c?.kind).toBe("write");
    expect(c?.content).toBe("export const x = 1;\n");
  });

  it("post-write expands MultiEdit into one change per edit", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPostWrite({
        session_id: "s1",
        tool_name: "MultiEdit",
        tool_input: {
          file_path: "src/example/multi.ts",
          edits: [
            { old_string: "a", new_string: "A" },
            { old_string: "b", new_string: "B" }
          ]
        }
      })
    );
    const writes = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "file_write");
    expect(writes[0].changes).toHaveLength(2);
    expect(writes[0].files).toEqual(["src/example/multi.ts"]);
  });

  it("pre-task emits a user_prompt event tagged with the resolved module", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPreTask({
        session_id: "s2",
        prompt: "work on the example module today"
      })
    );
    const prompts = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "user_prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0].prompt).toContain("example module");
    expect(prompts[0].module).toBe("example");
  });

  it("pre-task surfaces systemMessage in TUI when show_breadcrumb is enabled", async () => {
    const root = await initRepo();
    const configPath = join(root, ".claude-memory", "config.yaml");
    const yaml = readFileSync(configPath, "utf8").replace(
      "show_breadcrumb: false",
      "show_breadcrumb: true"
    );
    writeFileSync(configPath, yaml);

    const origWrite = process.stdout.write.bind(process.stdout);
    let captured = "";
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array
    ) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await inCwd(root, () =>
        runPreTask({ session_id: "sb1", prompt: "work on the example module" })
      );
    } finally {
      (process.stdout as { write: typeof process.stdout.write }).write = origWrite;
    }

    const parsed = JSON.parse(captured);
    expect(parsed.systemMessage).toMatch(/^\[claude-memory\] pre-task:/);
    expect(parsed.systemMessage).toContain("module=example");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });

  it("pre-task omits systemMessage when show_breadcrumb is disabled", async () => {
    const root = await initRepo();

    const origWrite = process.stdout.write.bind(process.stdout);
    let captured = "";
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array
    ) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await inCwd(root, () =>
        runPreTask({ session_id: "sb2", prompt: "work on the example module" })
      );
    } finally {
      (process.stdout as { write: typeof process.stdout.write }).write = origWrite;
    }

    const parsed = JSON.parse(captured);
    expect(parsed.systemMessage).toBeUndefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });

  it("session-end writes a session_close event", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPreTask({ session_id: "s3", prompt: "work on example" })
    );
    await inCwd(root, () => runSessionEnd({ session_id: "s3" }));
    const closes = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "session_close");
    expect(closes).toHaveLength(1);
  });

  it("session-end records transcript_path when provided by the Stop payload", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPreTask({ session_id: "s4", prompt: "work on example" })
    );
    await inCwd(root, () =>
      runSessionEnd({ session_id: "s4", transcript_path: "/tmp/some/transcript.jsonl" })
    );
    const closes = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "session_close");
    expect(closes).toHaveLength(1);
    expect(closes[0].transcript_path).toBe("/tmp/some/transcript.jsonl");
  });

  it("session-end omits transcript_path when the Stop payload has none", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPreTask({ session_id: "s5", prompt: "work on example" })
    );
    await inCwd(root, () => runSessionEnd({ session_id: "s5" }));
    const closes = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "session_close");
    expect(closes[0].transcript_path).toBeUndefined();
  });

  it("session-start surfaces high-importance events on stderr and as additionalContext", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    const highEvent: MemoryEvent = {
      type: "user_instruction",
      session_id: "prior",
      module: "example",
      files: [],
      prompt: "remember: ledger must reconcile within 24h",
      ts: new Date().toISOString(),
      summary: null,
      importance: "high"
    };
    await appendEvent(paths, highEvent);

    const origWrite = process.stdout.write.bind(process.stdout);
    let captured = "";
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array
    ) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await inCwd(root, () =>
        runSessionStart({ session_id: "new", source: "startup" })
      );
    } finally {
      (process.stdout as { write: typeof process.stdout.write }).write = origWrite;
    }

    const parsed = JSON.parse(captured);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "open question(s)"
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "ledger must reconcile"
    );
  });

  it("session-start excludes promoted high-importance events", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    const recentTs = new Date(Date.now() - 1 * 86400_000).toISOString();
    const promotedFile = await appendEvent(paths, {
      type: "session_summary",
      session_id: "prior",
      module: "example",
      files: [],
      ts: recentTs,
      summary: "this fact has already been merged into a wiki page",
      importance: "high"
    });
    await appendEvent(paths, {
      type: "session_summary",
      session_id: "prior",
      module: "example",
      files: [],
      ts: recentTs,
      summary: "this one is still pending promotion",
      importance: "high"
    });
    const promotedId = promotedFile.split("/").pop()!.replace(/\.json$/, "");
    await appendEvent(paths, {
      type: "promotion",
      session_id: "compile",
      module: "example",
      files: [],
      ts: new Date().toISOString(),
      summary: null,
      importance: "normal",
      consumed_event_ids: [promotedId]
    });

    const origWrite = process.stdout.write.bind(process.stdout);
    let captured = "";
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array
    ) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await inCwd(root, () =>
        runSessionStart({ session_id: "new", source: "startup" })
      );
    } finally {
      (process.stdout as { write: typeof process.stdout.write }).write = origWrite;
    }

    const parsed = JSON.parse(captured);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "still pending promotion"
    );
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain(
      "already been merged"
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "1 open question(s)"
    );
  });

  it("session-start excludes high-importance events older than 14 days", async () => {
    const root = await initRepo();
    const paths = buildPaths(root);
    const oldTs = new Date(Date.now() - 30 * 86400_000).toISOString();
    const recentTs = new Date(Date.now() - 1 * 86400_000).toISOString();
    await appendEvent(paths, {
      type: "user_instruction",
      session_id: "old",
      module: "example",
      files: [],
      prompt: "ancient note that should not resurface",
      ts: oldTs,
      summary: null,
      importance: "high"
    });
    await appendEvent(paths, {
      type: "user_instruction",
      session_id: "recent",
      module: "example",
      files: [],
      prompt: "fresh note within window",
      ts: recentTs,
      summary: null,
      importance: "high"
    });

    const origWrite = process.stdout.write.bind(process.stdout);
    let captured = "";
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array
    ) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await inCwd(root, () =>
        runSessionStart({ session_id: "new", source: "startup" })
      );
    } finally {
      (process.stdout as { write: typeof process.stdout.write }).write = origWrite;
    }

    const parsed = JSON.parse(captured);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "fresh note within window"
    );
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain(
      "ancient note"
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "1 open question(s)"
    );
  });

  it("post-write tags event via file-path resolution even when prompt did not resolve", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPreTask({ session_id: "spw1", prompt: "fix this bug" })
    );
    const sessionBefore = readSession(buildPaths(root), "spw1");
    expect(sessionBefore?.resolved_module).toBeNull();

    await inCwd(root, () =>
      runPostWrite({
        session_id: "spw1",
        tool_name: "Edit",
        tool_input: {
          file_path: "src/example/foo.ts",
          old_string: "a",
          new_string: "b"
        }
      })
    );

    const writes = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "file_write");
    expect(writes[0].module).toBe("example");

    const sessionAfter = readSession(buildPaths(root), "spw1");
    expect(sessionAfter?.resolved_module).toBe("example");
  });

  it("pre-task does not re-inject pages already sent in the same session", async () => {
    const root = await initRepo();

    const origWrite = process.stdout.write.bind(process.stdout);
    const captures: string[] = [];
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array
    ) => {
      captures.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;

    try {
      await inCwd(root, () =>
        runPreTask({ session_id: "dedup1", prompt: "work on the example module" })
      );
      await inCwd(root, () =>
        runPreTask({ session_id: "dedup1", prompt: "continue working on example" })
      );
    } finally {
      (process.stdout as { write: typeof process.stdout.write }).write = origWrite;
    }

    expect(captures).toHaveLength(1);
    const first = JSON.parse(captures[0]);
    const firstContext: string = first.hookSpecificOutput?.additionalContext ?? "";
    expect(firstContext.length).toBeGreaterThan(0);
  });

  it("post-write falls back to session.resolved_module when file path matches no module", async () => {
    const root = await initRepo();
    await inCwd(root, () =>
      runPreTask({ session_id: "spw2", prompt: "work on the example module" })
    );
    await inCwd(root, () =>
      runPostWrite({
        session_id: "spw2",
        tool_name: "Write",
        tool_input: { file_path: "README.md", content: "x" }
      })
    );
    const writes = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "file_write");
    expect(writes[0].module).toBe("example");
  });

  it("truncates long content with a marker", async () => {
    const root = await initRepo();
    const huge = "x".repeat(2000);
    await inCwd(root, () =>
      runPostWrite({
        session_id: "s1",
        tool_name: "Write",
        tool_input: { file_path: "big.ts", content: huge }
      })
    );
    const writes = listEventFiles(buildPaths(root))
      .map(readEventFile)
      .filter((e) => e.type === "file_write");
    const c = writes[0].changes?.[0];
    expect(c?.content_truncated).toBe(true);
    expect(c?.content?.length ?? 0).toBeLessThan(huge.length);
  });
});
