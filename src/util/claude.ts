import { spawn } from "node:child_process";

export interface InvokeOptions {
  timeoutMs?: number;
}

export async function invokeClaude(
  prompt: string,
  opts: InvokeOptions = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", "--output-format=json"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          proc.kill("SIGTERM");
          reject(new Error(`claude timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
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
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

export function extractJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    const result =
      typeof parsed === "object" && parsed !== null && "result" in parsed
        ? (parsed as { result: unknown }).result
        : parsed;
    if (typeof result === "string") {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;
    } else if (typeof result === "object" && result !== null) {
      return result as T;
    }
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* fall through */
      }
    }
  }
  return fallback;
}
