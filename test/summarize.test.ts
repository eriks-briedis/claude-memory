import { describe, it, expect } from "vitest";
import { summarizeChange, summarizeEvent } from "../src/compile/summarize.js";
import type { FileChange, MemoryEvent } from "../src/core/events.js";

describe("summarizeChange", () => {
  it("formats a Write change with line count and preview", () => {
    const c: FileChange = {
      file: "src/foo.ts",
      tool: "Write",
      kind: "write",
      content: "export const x = 1;\nconsole.log(x);\n"
    };
    const s = summarizeChange(c);
    expect(s).toContain("Write src/foo.ts");
    expect(s).toContain("+3L");
    expect(s).toContain("export const x = 1;");
  });

  it("formats an Edit change with old/new line counts and previews", () => {
    const c: FileChange = {
      file: "src/foo.ts",
      tool: "Edit",
      kind: "edit",
      old_string: "return 1",
      new_string: "return 2"
    };
    const s = summarizeChange(c);
    expect(s).toContain("Edit src/foo.ts");
    expect(s).toContain("1L → 1L");
    expect(s).toContain("return 1");
    expect(s).toContain("return 2");
  });

  it("marks truncation", () => {
    const c: FileChange = {
      file: "big.ts",
      tool: "Write",
      kind: "write",
      content: "x".repeat(90),
      content_truncated: true
    };
    expect(summarizeChange(c)).toContain("(truncated)");
  });
});

describe("summarizeEvent", () => {
  it("summarizes file_write with nested change lines", () => {
    const e: MemoryEvent = {
      type: "file_write",
      session_id: "s",
      module: "example",
      files: ["a.ts"],
      ts: "2026-04-22T12:00:00.000Z",
      summary: null,
      importance: "normal",
      changes: [
        {
          file: "a.ts",
          tool: "Edit",
          kind: "edit",
          old_string: "a",
          new_string: "b"
        }
      ]
    };
    const s = summarizeEvent(e);
    expect(s).toContain("file_write");
    expect(s).toContain("Edit a.ts");
    expect(s).toContain("example");
  });

  it("summarizes user_prompt with prompt preview", () => {
    const e: MemoryEvent = {
      type: "user_prompt",
      session_id: "s",
      module: "example",
      files: [],
      prompt: "explain the ledger invariant",
      ts: "2026-04-22T12:00:00.000Z",
      summary: null,
      importance: "normal"
    };
    expect(summarizeEvent(e)).toContain("explain the ledger");
  });
});
