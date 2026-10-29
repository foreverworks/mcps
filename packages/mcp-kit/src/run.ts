import { spawn } from "node:child_process";

export type RunResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

export type RunOptions = {
  readonly timeoutMs: number;
  /** The child's whole environment; the server's own when absent. */
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  /** Output kept per stream, in bytes; the rest is dropped. Default 4 MiB. */
  readonly maxBytes?: number;
};

/**
 * Runs a program with no shell on this side, a deadline, and output capped
 * (4 MiB by default). Never throws for a non-zero exit; the caller decides
 * what one means. Exit 127 means the program could not be started (not
 * installed, or not on PATH); 124 that it was killed at the deadline.
 */
export const run = (argv: readonly string[], options: RunOptions): Promise<RunResult> =>
  new Promise((resolve) => {
    const [cmd, ...args] = argv;
    if (cmd === undefined) {
      resolve({ code: 127, stdout: "", stderr: "empty command" });
      return;
    }
    const cap = options.maxBytes ?? 4 * 1024 * 1024;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: options.env ?? process.env, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outSize = 0;
    let errSize = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      outSize += chunk.length;
      if (outSize <= cap) out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errSize += chunk.length;
      if (errSize <= cap) err.push(chunk);
    });
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
