import { createHash, createHmac, randomInt } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { inputFilesFrom, once, stateDirOf } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { MAX_INPUT_FILE_BYTES } from "./domain/note.js";
import type { Hmac } from "./domain/totp.js";
import { makeRunBw, serialized, type RunBw } from "./infra/bw/run.js";
import { makeBwVault } from "./infra/bwVault.js";
import { loadCredentials } from "./infra/credentials.js";
import { makePwnedRange } from "./infra/pwned.js";

const hmac: Hmac = (algorithm, key, message) => new Uint8Array(createHmac(algorithm.toLowerCase(), key).update(message).digest());

/**
 * The CLI's data directory: BITWARDEN_STATE_DIR, else the kit's default for
 * state (stateDirOf), created 0700 on the first call that runs the CLI.
 */
const lazyRun = (env: NodeJS.ProcessEnv): RunBw => {
  const ready = once(async () => {
    const dir = stateDirOf(env, "bitwarden", "BITWARDEN_STATE_DIR");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return serialized(makeRunBw(dir));
  });
  return async (args, options) => (await ready())(args, options);
};

/**
 * The composition root: the only module naming both the port and what
 * implements it. The secrets are read on the first call that needs them and
 * kept for the life of the process; a failed read is retried on the next call.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env): Deps => ({
  vault: makeBwVault({
    run: lazyRun(env),
    credentials: once(() => loadCredentials(env)),
    serverUrl: env["BITWARDEN_SERVER"]?.trim() || undefined,
    now: Date.now,
  }),
  now: Date.now,
  randomInt: (max) => randomInt(max),
  hmac,
  defaultCollection: env["BITWARDEN_DEFAULT_COLLECTION"]?.trim() || undefined,
  readInput: inputFilesFrom(env, { maxBytes: MAX_INPUT_FILE_BYTES }),
  sha1: (text) => createHash("sha1").update(text, "utf8").digest("hex"),
  pwnedRange: makePwnedRange(),
});
