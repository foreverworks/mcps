import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { envPath } from "@foreverworks/mcp-kit";

import { LABEL } from "../../domain/accounts.js";
import { googleStateDir } from "../../infra/locations.js";

/**
 * Where a Docs/Sheets/Slides grant comes from, before anything is read from it.
 *
 *   drive        the Drive product's grant, for the one label
 *                GOOGLE_EDITORS_DRIVE_ACCOUNT names
 *   credentials  a google.oauth2 credentials JSON in <root>/<label>/
 */
export type GrantSpec =
  | { readonly label: string; readonly source: "drive" }
  | {
      readonly label: string;
      readonly source: "credentials";
      readonly credentials: string;
      readonly stateDir: string;
      /** The `account` field its consent wrote: the address it must resolve to. */
      readonly address?: string;
    };

export type Config = {
  /** Every `<root>/<label>/credentials.json` is a grant. */
  readonly root: string;
  /** Where the token caches go: `<stateRoot>/<label>/`, or `<root>/<label>/state/` when unset. */
  readonly stateRoot: string | undefined;
  /** The label that runs on the Drive grant when it has no directory of its own; empty when none does. */
  readonly driveLabel: string;
  /** The account a read uses when none is named. */
  readonly defaultLabel: string | undefined;
};

/**
 * The roots come from the environment: `<GOOGLE_STATE_DIR>/editors` by
 * default, GOOGLE_EDITORS_ROOT to move it, and GOOGLE_EDITORS_STATE_DIR when
 * the token caches must live apart from the grants (credentials mounted
 * read-only). No label runs on the Drive grant unless
 * GOOGLE_EDITORS_DRIVE_ACCOUNT names one. The Drive grant has its own
 * variables (drive/infra/paths.ts).
 */
export const resolveConfig = (env: NodeJS.ProcessEnv = process.env): Config => ({
  root: envPath(env, "GOOGLE_EDITORS_ROOT") ?? join(googleStateDir(env), "editors"),
  stateRoot: envPath(env, "GOOGLE_EDITORS_STATE_DIR"),
  driveLabel: env["GOOGLE_EDITORS_DRIVE_ACCOUNT"]?.trim() ?? "",
  defaultLabel: env["GOOGLE_EDITORS_DEFAULT_ACCOUNT"]?.trim() || undefined,
});

/** Where an account's own grant lives: the one path discovery reads and a consent writes. */
export const credentialsPathOf = (config: Config, label: string): string => join(config.root, label, "credentials.json");

export type Fs = { readonly list: (dir: string) => readonly string[]; readonly read: (path: string) => string | undefined };

const addressIn = (text: string | undefined): string | undefined => {
  try {
    const raw = JSON.parse(text ?? "{}") as { account?: unknown };
    return typeof raw.account === "string" && raw.account ? raw.account : undefined;
  } catch {
    // An unparseable file is still a grant; the call that reads it says what is wrong.
    return undefined;
  }
};

/**
 * The grants, DISCOVERED like Calendar's rather than listed: consenting an
 * account and writing its credentials.json is the whole change, and it is
 * picked up on the next call, not the next restart.
 *
 * A directory wins over the Drive fallback, so the account on the Drive
 * grant can move to a grant of its own by writing one file. Sorted with the default first,
 * the rest by name.
 */
export const discover = (config: Config, fs: Fs = realFs): readonly GrantSpec[] => {
  const labels = fs
    .list(config.root)
    .filter((name) => LABEL.test(name) && name !== "state")
    .filter((name) => fs.read(credentialsPathOf(config, name)) !== undefined);

  const fromDirs = labels.map((label): GrantSpec => {
    const credentials = credentialsPathOf(config, label);
    const address = addressIn(fs.read(credentials));
    return {
      label,
      source: "credentials",
      credentials,
      stateDir: config.stateRoot ? join(config.stateRoot, label) : join(config.root, label, "state"),
      ...(address ? { address } : {}),
    };
  });
  const fromDrive: readonly GrantSpec[] =
    config.driveLabel && !labels.includes(config.driveLabel) ? [{ label: config.driveLabel, source: "drive" }] : [];

  const first = defaultOf(config, [...fromDirs, ...fromDrive].map((s) => s.label));
  return [...fromDirs, ...fromDrive].sort((a, b) =>
    a.label === first ? -1 : b.label === first ? 1 : a.label.localeCompare(b.label),
  );
};

/** The configured default, else the account on the Drive grant, else whatever was found first. */
export const defaultOf = (config: Config, labels: readonly string[]): string =>
  config.defaultLabel ?? (config.driveLabel || labels[0] || "");

const realFs: Fs = {
  list: (dir) => {
    try {
      return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
    } catch {
      return [];
    }
  },
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
};
