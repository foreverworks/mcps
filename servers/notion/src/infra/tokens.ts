import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { envPath, unsetPath } from "@foreverworks/mcp-kit";

import { LABEL } from "../domain/accounts.js";
import { configError, fail } from "../domain/errors.js";

/**
 * The workspaces and their integration tokens, from files: one per workspace,
 * `notion-<label>`, holding the token and nothing else. The accounts are what
 * the files say; no list of them exists anywhere in the code.
 *
 * Where, from the environment ONLY: `NOTION_TOKENS_DIR`, else systemd's
 * `CREDENTIALS_DIRECTORY` (what `LoadCredential=notion-work:...` gives a unit,
 * readable by it alone). No default under the home directory, on purpose: a
 * default pointing at real tokens is how a test or a hand-run copy ends up
 * writing to someone's workspace.
 *
 * An empty file is a workspace this deployment has no token for (a credential
 * a unit declares but nothing fills), so it is not an account.
 */
export const TOKEN_PREFIX = "notion-";

export const tokensDirFrom = (env: NodeJS.ProcessEnv): string | undefined =>
  envPath(env, "NOTION_TOKENS_DIR") ?? envPath(env, "CREDENTIALS_DIRECTORY");

const code = (cause: unknown): string => (cause as NodeJS.ErrnoException).code ?? "error";

/** The labels a directory's file names carry, sorted: `notion-<label>`, with a label that cannot walk out of it. */
const labelsNamed = (names: readonly string[]): readonly string[] =>
  names
    .filter((n) => n.startsWith(TOKEN_PREFIX))
    .map((n) => n.slice(TOKEN_PREFIX.length))
    .filter((label) => LABEL.test(label))
    .sort();

/** Whether a token file holds anything; the token itself is not kept. */
const nonEmpty = (path: string): boolean => {
  try {
    return readFileSync(path, "utf8").trim() !== "";
  } catch {
    return false;
  }
};

/**
 * The labels of the non-empty token files right now, by their names alone and
 * synchronously, for what is said at start (the server's instructions). Never
 * fails: a directory that is missing or unreadable names none, and the first
 * call that needs a token says why.
 */
export const labelsIn = (dir: string | undefined): readonly string[] => {
  if (dir === undefined) return [];
  try {
    return labelsNamed(readdirSync(dir)).filter((label) => nonEmpty(join(dir, `${TOKEN_PREFIX}${label}`)));
  } catch {
    return [];
  }
};

/** Every non-empty token file in `dir`, by label, sorted by label. Named by file, never by value. */
export const loadTokens = async (dir: string | undefined): Promise<ReadonlyMap<string, string>> => {
  if (dir === undefined) {
    return fail(configError(`${unsetPath("NOTION_TOKENS_DIR")}: point it at the notion-<label> token files, or run under systemd with LoadCredential=notion-<label>`));
  }
  let names: readonly string[];
  try {
    names = await readdir(dir);
  } catch (cause) {
    return fail(configError(`the tokens directory ${dir} cannot be read (${code(cause)})`));
  }
  const labels = labelsNamed(names);
  const tokens = new Map<string, string>();
  for (const label of labels) {
    let token: string;
    try {
      token = (await readFile(join(dir, `${TOKEN_PREFIX}${label}`), "utf8")).trim();
    } catch (cause) {
      return fail(configError(`${TOKEN_PREFIX}${label} in ${dir} cannot be read (${code(cause)})`));
    }
    if (/\s/.test(token)) return fail(configError(`${TOKEN_PREFIX}${label} in ${dir} holds more than one token`));
    if (token !== "") tokens.set(label, token);
  }
  return tokens;
};

/** How long a read of the token files is trusted: a token file added or replaced is seen within this. */
export const TOKENS_TTL_MS = 60_000;

export type TokenFiles = {
  /** The tokens as last read, re-read at most once a minute. */
  readonly current: () => Promise<ReadonlyMap<string, string>>;
  /** Read them again now: after a 401, a replaced file is picked up without a restart. */
  readonly reload: () => Promise<ReadonlyMap<string, string>>;
};

export const makeTokenFiles = (dir: string | undefined, now: () => number = Date.now): TokenFiles => {
  let cache: { readonly at: number; readonly value: Promise<ReadonlyMap<string, string>> } | undefined;
  const read = (force: boolean): Promise<ReadonlyMap<string, string>> => {
    if (!force && cache !== undefined && now() - cache.at < TOKENS_TTL_MS) return cache.value;
    const value = loadTokens(dir);
    cache = { at: now(), value };
    // A failed read is not remembered: a directory fixed while a session is open works on the next call.
    value.catch(() => {
      if (cache?.value === value) cache = undefined;
    });
    return value;
  };
  return { current: () => read(false), reload: () => read(true) };
};
