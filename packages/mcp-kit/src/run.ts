import { spawn } from "node:child_process";
import { constants } from "node:os";

export type RunResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Output went past `maxBytes` and the rest was dropped: what is here is the start, not the whole. */
  readonly truncated: boolean;
};

export type RunOptions = {
  readonly timeoutMs: number;
  /** The child's whole environment; the server's own when absent. */
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  /** Output kept per stream, in bytes; the rest is dropped and `truncated` says so. Default 4 MiB. */
  readonly maxBytes?: number;
};

/** How long after the deadline's kill the output pipes may take to close before the result is given anyway. */
const AFTER_KILL_MS = 5_000;

/**
 * Runs a program with no shell on this side, a deadline, and output capped
 * (4 MiB per stream by default). Never throws for a non-zero exit; the caller
 * decides what one means. Exit 127 means the program could not be started
 * (not installed, or not on PATH); 124 that it was killed at the deadline;
 * 128 + n that something else killed it with signal n (137: SIGKILL, the
 * kernel's OOM killer among others).
 *
 * The program leads a process group of its own, and the deadline kills the
 * whole group: a tool that starts others (ocrmypdf starts tesseract and
 * ghostscript, ssh a proxy command) would otherwise leave them running and
 * holding the output pipes open, and the call would wait for them past its
 * deadline. Measured: `bash -c "sleep 12 & sleep 12"` with a 1 s deadline
 * resolved after 12 s when only the direct child was killed.
 */
export const run = (argv: readonly string[], options: RunOptions): Promise<RunResult> =>
  new Promise((resolve) => {
    const [cmd, ...args] = argv;
    if (cmd === undefined) {
      resolve({ code: 127, stdout: "", stderr: "empty command", truncated: false });
      return;
    }
    const cap = options.maxBytes ?? 4 * 1024 * 1024;
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? process.env,
      detached: true,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outSize = 0;
    let errSize = 0;
    let truncated = false;
    child.stdout.on("data", (chunk: Buffer) => {
      outSize += chunk.length;
      if (outSize <= cap) out.push(chunk);
      else truncated = true;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errSize += chunk.length;
      if (errSize <= cap) err.push(chunk);
      else truncated = true;
    });

    let settled = false;
    let deadlineHit = false;
    let grace: NodeJS.Timeout | undefined;
    const settle = (result: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      resolve(result);
    };
    const collected = (code: number, note?: string): RunResult => {
      const stderr = Buffer.concat(err).toString("utf8");
      return { code, stdout: Buffer.concat(out).toString("utf8"), stderr: note === undefined ? stderr : `${stderr}\n${note}`.trim(), truncated };
    };
    const deadlineNote = `killed by SIGKILL after ${options.timeoutMs} ms`;

    const timer = setTimeout(() => {
      deadlineHit = true;
      try {
        // detached: the child leads a group, and the negative pid names all of it.
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      // A process that left the group can still hold a pipe: answer without waiting for it.
      grace = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        settle(collected(124, deadlineNote));
      }, AFTER_KILL_MS);
    }, options.timeoutMs);

    child.on("error", (e) => settle({ code: 127, stdout: "", stderr: e.message, truncated: false }));
    child.on("close", (code, signal) => {
      if (deadlineHit) settle(collected(124, deadlineNote));
      else if (code !== null) settle(collected(code));
      else settle(collected(128 + (signal === null ? 0 : (constants.signals[signal] ?? 0)), `killed by ${signal ?? "a signal"}`));
    });
  });
