import { spawn } from "node:child_process";

export type RunResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

/**
 * Runs a program with no shell on this side, a deadline, and output capped at
 * 4 MiB. Never throws for a non-zero exit; the caller decides what one means.
 */
export const run = (argv: readonly string[], options: { readonly timeoutMs: number; readonly env?: NodeJS.ProcessEnv }): Promise<RunResult> =>
  new Promise((resolve) => {
    const [cmd, ...args] = argv;
    if (cmd === undefined) {
      resolve({ code: 127, stdout: "", stderr: "empty command" });
      return;
    }
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: options.env ?? process.env });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const take = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 4 * 1024 * 1024) into.push(chunk);
    };
    child.stdout.on("data", take(out));
    child.stderr.on("data", take(err));
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout: "", stderr: e.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(err).toString("utf8");
      resolve({ code: code ?? 124, stdout: Buffer.concat(out).toString("utf8"), stderr: signal === null ? stderr : `${stderr}\nkilled by ${signal} after ${options.timeoutMs} ms`.trim() });
    });
  });
