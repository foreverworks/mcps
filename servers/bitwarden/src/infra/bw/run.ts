import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { cliError, fail } from "../../domain/errors.js";

/** The official CLI's entry point, from the pinned `@bitwarden/cli` in this workspace. Run by this Node, never from PATH. */
const BW_JS = join(dirname(createRequire(import.meta.url).resolve("@bitwarden/cli/package.json")), "build", "bw.js");

/** In testing, `bw status` took 2.7 s and `bw list items` 3.1 s; a sync over a slow link takes longer. */
const TIMEOUT_MS = 90_000;

export type BwResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

/**
 * One `bw` invocation. Secrets go in through the environment or stdin, never
 * argv, which every local user can read in /proc. `BW_NOINTERACTION` makes a
 * prompt an error rather than a hang.
 */
export type RunBw = (args: readonly string[], options?: { readonly env?: Readonly<Record<string, string>>; readonly input?: string }) => Promise<BwResult>;

export const makeRunBw =
  (appDataDir: string): RunBw =>
  (args, options = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [BW_JS, ...args], {
        env: {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: appDataDir,
          BITWARDENCLI_APPDATA_DIR: appDataDir,
          BW_NOINTERACTION: "true",
          ...options.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` });
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr: signal === "SIGKILL" ? `timed out after ${TIMEOUT_MS / 1000}s` : stderr });
      });
      child.stdin.end(options.input ?? "");
    });

/** Calls run one at a time: every one reads and writes the CLI's single data.json. */
export const serialized = (run: RunBw): RunBw => {
  let tail: Promise<unknown> = Promise.resolve();
  return (args, options) => {
    const next = tail.then(() => run(args, options));
    tail = next.catch(() => undefined);
    return next;
  };
};

/** The CLI's own words for a failure, one line, with anything that looks like a session key cut out. */
export const bwMessage = (result: BwResult): string =>
  (result.stderr.trim() || result.stdout.trim() || `bw exited ${result.code}`).split("\n")[0]!.replace(/[A-Za-z0-9+/=]{40,}/g, "<redacted>").slice(0, 300);

export const failed = (result: BwResult): never => fail(cliError(bwMessage(result)));
