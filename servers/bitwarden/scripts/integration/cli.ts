/**
 * The pinned Bitwarden CLI as a second, independent client of the same
 * account: its own data folder, its own login and unlock. It reads back what
 * the server stored, as Bitwarden's apps would see it, and nothing here
 * writes. Secrets go in through the environment, never the arguments.
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { TestAccount } from "./account.js";

const BW_JS = join(dirname(createRequire(import.meta.url).resolve("@bitwarden/cli/package.json")), "build", "bw.js");

const run = (dir: string, args: readonly string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [BW_JS, ...args], {
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        HOME: dir,
        BITWARDENCLI_APPDATA_DIR: dir,
        BW_NOINTERACTION: "true",
        ...(process.env["NODE_EXTRA_CA_CERTS"] ? { NODE_EXTRA_CA_CERTS: process.env["NODE_EXTRA_CA_CERTS"] } : {}),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

export type Reader = { readonly item: (id: string) => Promise<Record<string, unknown>> };

export const makeReader = async (server: string, account: TestAccount): Promise<Reader> => {
  const dir = await mkdtemp(join(tmpdir(), "bw-reader-"));
  const must = async (args: readonly string[], env: Record<string, string> = {}): Promise<string> => {
    const result = await run(dir, args, env);
    if (result.code !== 0) throw new Error(`bw ${args[0]}: ${(result.stderr || result.stdout).split("\n")[0]}`);
    return result.stdout;
  };
  await must(["config", "server", server]);
  await must(["login", "--apikey"], { BW_CLIENTID: account.clientId, BW_CLIENTSECRET: account.clientSecret });
  const session = (await must(["unlock", "--passwordenv", "BW_MASTER_PASSWORD", "--raw"], { BW_MASTER_PASSWORD: account.masterPassword })).trim();
  return {
    item: async (id) => {
      await must(["sync"], { BW_SESSION: session });
      return JSON.parse(await must(["get", "item", id], { BW_SESSION: session })) as Record<string, unknown>;
    },
  };
};
