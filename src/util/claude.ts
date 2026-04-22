import { spawn } from "node:child_process";

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface InvokeOptions {
  timeoutMs?: number;
  onStderr?: (chunk: string) => void;
  stream?: boolean;
  includePartialMessages?: boolean;
  onEvent?: (event: StreamEvent) => void;
}

export interface InvokeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  finalEvent?: StreamEvent;
}

export async function invokeClaude(
  prompt: string,
  opts: InvokeOptions = {}
): Promise<InvokeResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const args = opts.stream
      ? ["-p", "--output-format=stream-json", "--verbose"]
      : ["-p", "--output-format=json"];
    if (opts.stream && opts.includePartialMessages) {
      args.push("--include-partial-messages");
    }
    const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let lineBuf = "";
    let finalEvent: StreamEvent | undefined;
    let settled = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          proc.kill("SIGTERM");
          reject(new Error(`claude timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: StreamEvent;
      try {
        event = JSON.parse(trimmed) as StreamEvent;
      } catch {
        return;
      }
      if (event.type === "result") {
        finalEvent = event;
      }
      opts.onEvent?.(event);
    };

    proc.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (!opts.stream) return;
      lineBuf += s;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const l of lines) handleLine(l);
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (opts.stream && lineBuf.trim().length > 0) handleLine(lineBuf);
      const durationMs = Date.now() - started;
      const exitCode = code ?? -1;
      if (exitCode !== 0) {
        const err = new Error(`claude exited ${exitCode}: ${stderr.trim()}`);
        (err as Error & { stderr?: string; exitCode?: number }).stderr = stderr;
        (err as Error & { stderr?: string; exitCode?: number }).exitCode = exitCode;
        reject(err);
        return;
      }
      const resolvedStdout =
        opts.stream && finalEvent ? JSON.stringify(finalEvent) : stdout;
      resolve({ stdout: resolvedStdout, stderr, exitCode, durationMs, finalEvent });
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

export interface ParseDiagnostics<T> {
  value: T | null;
  stage: "wrapper-object" | "wrapper-result-object" | "wrapper-result-embedded" | "raw-embedded" | "none";
  error?: string;
  wrapper?: {
    sessionId?: string;
    durationMs?: number;
    totalCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    isError?: boolean;
    subtype?: string;
  };
}

function readWrapperMeta(obj: Record<string, unknown>): ParseDiagnostics<unknown>["wrapper"] {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" ? v : undefined;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const usage =
    obj.usage && typeof obj.usage === "object"
      ? (obj.usage as Record<string, unknown>)
      : undefined;
  return {
    sessionId: str(obj.session_id),
    durationMs: num(obj.duration_ms),
    totalCostUsd: num(obj.total_cost_usd),
    inputTokens: usage ? num(usage.input_tokens) : undefined,
    outputTokens: usage ? num(usage.output_tokens) : undefined,
    isError: typeof obj.is_error === "boolean" ? obj.is_error : undefined,
    subtype: str(obj.subtype)
  };
}

export function parseJsonResponse<T>(raw: string): ParseDiagnostics<T> {
  let wrapperMeta: ParseDiagnostics<T>["wrapper"];
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      if ("result" in parsed) {
        wrapperMeta = readWrapperMeta(parsed as Record<string, unknown>);
        const result = (parsed as { result: unknown }).result;
        if (typeof result === "object" && result !== null) {
          return { value: result as T, stage: "wrapper-result-object", wrapper: wrapperMeta };
        }
        if (typeof result === "string") {
          const m = result.match(/\{[\s\S]*\}/);
          if (m) {
            try {
              return {
                value: JSON.parse(m[0]) as T,
                stage: "wrapper-result-embedded",
                wrapper: wrapperMeta
              };
            } catch (err) {
              return {
                value: null,
                stage: "wrapper-result-embedded",
                wrapper: wrapperMeta,
                error: `embedded JSON in result string did not parse: ${errMsg(err)}`
              };
            }
          }
          return {
            value: null,
            stage: "wrapper-result-embedded",
            wrapper: wrapperMeta,
            error: "no {...} block found inside result string"
          };
        }
        return {
          value: null,
          stage: "wrapper-result-object",
          wrapper: wrapperMeta,
          error: `wrapper.result had unexpected type: ${typeof result}`
        };
      }
      return { value: parsed as T, stage: "wrapper-object" };
    }
    return {
      value: null,
      stage: "none",
      error: `top-level JSON was ${typeof parsed}, not an object`
    };
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return { value: JSON.parse(m[0]) as T, stage: "raw-embedded" };
      } catch (err) {
        return {
          value: null,
          stage: "raw-embedded",
          error: `embedded {...} block did not parse: ${errMsg(err)}`
        };
      }
    }
    return {
      value: null,
      stage: "none",
      error: "output is not JSON and contains no {...} block"
    };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function extractJson<T>(raw: string, fallback: T): T {
  const d = parseJsonResponse<T>(raw);
  return d.value ?? fallback;
}
