import { execFile, spawn } from "node:child_process";
import { chmod, copyFile, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { writeJsonFile } from "@foreverworks/mcp-kit";

import { isClientFileName } from "../domain/clientFile.js";
import type { Gcloud } from "../app/ports.js";

const run = promisify(execFile);

/**
 * The effects setup has on this computer: the browser, gcloud, and the client
 * file. Each is a plain function, and none prints: the flow says what happened.
 */

/** The command that opens a URL in the default browser, per platform. Windows' `start` would split the URL at each `&`, so it goes through url.dll. */
const opener = (url: string): readonly [string, readonly string[]] =>
  process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];

/**
 * Opens a URL in the person's browser. False when nothing could open it (no
 * opener installed, no desktop, as in an SSH session), so the flow shows the
 * URL to copy instead; it shows it either way.
 */
export const openUrl = (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    const [command, args] = opener(url);
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      const timer = setTimeout(() => {
        child.unref();
        resolve(true);
      }, 3000);
      child.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });

/** gcloud when it is installed and an account is signed in to it; a program that is missing or signed out is undefined. */
export const findGcloud = async (): Promise<Gcloud | undefined> => {
  // gcloud is a .cmd script on Windows, which only a shell runs; every argument here is setup's own.
  const gcloud = (args: readonly string[]) => run("gcloud", args, { timeout: 5 * 60 * 1000, shell: process.platform === "win32" });
  let account: string | undefined;
  try {
    account = (await gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"])).stdout.trim().split(/\r?\n/)[0];
  } catch {
    return undefined;
  }
  if (!account) return undefined;
  return {
    account,
    createProject: async (projectId, name) => void (await gcloud(["projects", "create", projectId, `--name=${name}`])),
    enableApis: async (projectId, apis) => void (await gcloud(["services", "enable", ...apis, `--project=${projectId}`])),
  };
};

/**
 * Waits for Google's client file to appear in a folder: the newest
 * `client_secret_*.json` modified after `since`, checked once a second until
 * the signal stops it. A browser writes a download under another name and
 * renames it when it is complete, so a file found is whole.
 */
export const watchForClient =
  (dir: string, since: number) =>
  async (signal: AbortSignal): Promise<string> => {
    for (;;) {
      signal.throwIfAborted();
      const names = (await readdir(dir).catch(() => [] as string[])).filter(isClientFileName);
      const found = (
        await Promise.all(
          names.map(async (name) => {
            const info = await stat(join(dir, name)).catch(() => undefined);
            return info && info.mtimeMs >= since ? { path: join(dir, name), at: info.mtimeMs } : undefined;
          }),
        )
      )
        .filter((f) => f !== undefined)
        .sort((a, b) => b.at - a.at)[0];
      if (found) return found.path;
      await sleep(1000, undefined, { signal });
    }
  };

/**
 * Moves the client file into place: its folder 0700, the file 0600, a file it
 * replaces kept as `.bak` (grants made on the old client carry their own copy
 * of it, so they keep working). The download is removed, so the secret is not
 * left in Downloads.
 */
export const keepClientFile =
  (to: string) =>
  async (from: string): Promise<string> => {
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    if (from === to) {
      await chmod(to, 0o600);
      return to;
    }
    const client = JSON.parse(await readFile(from, "utf8")) as unknown;
    if ((await readFile(to, "utf8").catch(() => undefined)) !== undefined) {
      await copyFile(to, `${to}.bak`);
      await chmod(`${to}.bak`, 0o600);
    }
    await writeJsonFile(to, client, { mode: 0o600 });
    await unlink(from);
    return to;
  };
