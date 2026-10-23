import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { fileTokenStore } from "@foreverworks/mcp-kit";

import { ALL_ACCOUNTS, LABEL } from "../domain/accounts.js";
import { configError, fail } from "../domain/errors.js";

/**
 * Grants kept one per account under a root: `<root>/<label>/credentials.json`,
 * the file a consent writes and the only thing that makes an account. Calendar
 * reads its accounts this way, and so does every product that holds one grant
 * per account on one API (Tasks, Contacts, Meet).
 */

export type GrantSpec = {
  readonly label: string;
  /** What the grant must resolve to: the `account` its consent recorded. */
  readonly address?: string;
  readonly credentials: string;
  /** The grant's token cache. */
  readonly stateDir: string;
};

/** What discovery reads: the subdirectories of a root, and a file's text (undefined when it cannot be read). */
export type GrantFs = { readonly list: (dir: string) => readonly string[]; readonly read: (path: string) => string | undefined };

/** An account's grant file under the root: the one path discovery reads and a consent writes. */
export const credentialsPathOf = (root: string, label: string): string => join(root, label, "credentials.json");

/** Where an account's token cache lives. */
export const cacheDirOf = (root: string, label: string): string => join(root, label, "state");

/** Every account with a grant under the root, by name, each with the address its consent recorded. */
export const discoverGrants = (root: string, fs: GrantFs = realFs): readonly GrantSpec[] =>
  fs
    .list(root)
    .filter((name) => LABEL.test(name) && name !== "state")
    .filter((name) => fs.read(credentialsPathOf(root, name)) !== undefined)
    .sort((a, b) => a.localeCompare(b))
    .map((label): GrantSpec => {
      const credentials = credentialsPathOf(root, label);
      let address: string | undefined;
      try {
        const raw = JSON.parse(fs.read(credentials) ?? "{}") as { account?: unknown };
        address = typeof raw.account === "string" ? raw.account : undefined;
      } catch {
        // An unparseable file is still an account; the call that touches it says what is wrong.
      }
      return { label, ...(address ? { address } : {}), credentials, stateDir: cacheDirOf(root, label) };
    });

export const realFs: GrantFs = {
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

export type GrantRegistry<D> = {
  /** The product, as consent and remedies name it. */
  readonly product: string;
  readonly root: string;
  /** The accounts with a grant, as the disk has them now. */
  readonly labels: readonly string[];
  /** One account; empty means the first by name. */
  readonly get: (label?: string) => D;
  /** One account, or every account for `*` (and for empty, when `emptyIsAll`). */
  readonly select: (label?: string, emptyIsAll?: boolean) => readonly D[];
  readonly specOf: (label: string) => GrantSpec | undefined;
  /** Where an account's grant lives, or goes when it is consented. */
  readonly credentialsPath: (label: string) => string;
  /** The account's grant was replaced: drop what was built on it and its cached token. */
  readonly forget: (label: string) => Promise<void>;
};

/**
 * Accounts DISCOVERED on every lookup, so a grant consented after start is
 * served without a restart, and each BUILT once, lazily: a broken grant for
 * one account does not stop the others, and the token cache inside is kept
 * rather than refreshed on every call.
 */
export const makeGrantRegistry = <D>(product: string, root: string, build: (spec: GrantSpec) => D, fs: GrantFs = realFs): GrantRegistry<D> => {
  const built = new Map<string, D>();
  const current = () => discoverGrants(root, fs);

  const get = (label?: string): D => {
    const specs = current();
    const wanted = label?.trim() || specs[0]?.label || "";
    if (wanted === ALL_ACCOUNTS) return fail(configError(`this tool takes one account, not "${ALL_ACCOUNTS}"`));
    const spec = specs.find((s) => s.label === wanted);
    if (!spec) {
      const known = specs.map((s) => s.label).join(", ") || "none";
      return fail(configError(`no ${product} grant for "${wanted || "any account"}" under ${root} (have: ${known})`));
    }
    const existing = built.get(wanted);
    if (existing) return existing;
    const deps = build(spec);
    built.set(wanted, deps);
    return deps;
  };

  return {
    product,
    root,
    get labels() {
      return current().map((s) => s.label);
    },
    get,
    select: (label, emptyIsAll = true) => {
      const wanted = label?.trim() ?? "";
      return wanted === ALL_ACCOUNTS || (wanted === "" && emptyIsAll) ? current().map((s) => get(s.label)) : [get(wanted)];
    },
    specOf: (label) => current().find((s) => s.label === label),
    credentialsPath: (label) => credentialsPathOf(root, label),
    forget: async (label) => {
      built.delete(label);
      await fileTokenStore(cacheDirOf(root, label)).clear?.();
    },
  };
};
