import { join } from "node:path";

import { envPath } from "@foreverworks/mcp-kit";

import { configError, fail } from "../domain/errors.js";
import type { Paths } from "../app/ports.js";

import { LABEL } from "../../domain/accounts.js";
import { discoverGrants, type GrantFs, realFs } from "../../grants/registry.js";
import { gmailGrantRootOf, googleStateDir } from "../../infra/locations.js";

export { ALL_ACCOUNTS } from "../../domain/accounts.js";

export type AccountSpec = {
  readonly label: string;
  /** The mailbox this label must resolve to, when the registry says. */
  readonly address?: string;
  /** A gmail.readonly grant, which another program may share. */
  readonly readonly?: string;
  /** This server's own gmail.modify grant. */
  readonly modify?: string;
  readonly paths: Paths;
};

export type Resolved = {
  readonly accounts: readonly AccountSpec[];
  /** The account a tool uses when none is named; empty when no mailbox is configured. */
  readonly defaultLabel: string;
  /**
   * Every configured address, mailbox or not: consent checks each product's
   * grant against it, so a label that only has a calendar still has one place
   * to say who it is.
   */
  readonly addresses: ReadonlyMap<string, string>;
  /** Where each address came from: GMAIL_ADDRESSES, or the grant file whose consent recorded it. */
  readonly addressFrom: ReadonlyMap<string, string>;
  /**
   * Where a mailbox's grant is found and a consent writes it, when
   * GMAIL_MODIFY_ACCOUNTS does not say: `<root>/<label>/credentials.json`.
   * Undefined while that variable lists the mailboxes.
   */
  readonly grantRoot?: string;
};

/** What a call says when no mailbox is configured at all. */
export const NO_MAILBOX =
  "no mailbox is set up: run `npx @foreverworks/mcp-google setup` in a terminal, or begin_consent for gmail, or set GMAIL_MODIFY_ACCOUNTS (label=path of each account's gmail.modify grant), GMAIL_ACCOUNTS, or both";

/**
 * An account's state, and where its attachments land: GMAIL_ATTACHMENTS_DIR/<label> when set (a
 * folder the caller can read), else attachments/ in the state dir.
 */
const pathsFor = (stateDir: string, label: string, env: NodeJS.ProcessEnv): Paths => {
  const outbox = envPath(env, "GMAIL_ATTACHMENTS_DIR");
  return { stateDir, attachmentsDir: outbox ? join(outbox, label) : join(stateDir, "attachments") };
};

/**
 * One registry var: `personal=/path/creds.json,work=/path/creds.json`, in
 * order. Label and path rather than a convention over one root, because a
 * credential file may live where something else keeps it (a read-only grant
 * another program shares), and a COPY in a tidier layout would be a second
 * file for one credential that a re-consent rewrites only one of.
 */
export const parsePairs = (spec: string, what: string): readonly (readonly [string, string])[] => {
  const pairs = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry): readonly [string, string] => {
      const at = entry.indexOf("=");
      if (at < 1) return fail(configError(`${what} entry "${entry}" is not label=value`));
      const label = entry.slice(0, at).trim();
      const value = entry.slice(at + 1).trim();
      if (!LABEL.test(label)) return fail(configError(`account label "${label}" must match ${String(LABEL)}`));
      if (!value) return fail(configError(`account "${label}" has no value in ${what}`));
      return [label, value];
    });
  const seen = new Set<string>();
  for (const [label] of pairs) {
    if (seen.has(label)) return fail(configError(`account label "${label}" appears twice in ${what}`));
    seen.add(label);
  }
  return pairs;
};

/**
 * The registry, from the environment:
 *
 *   GMAIL_MODIFY_ACCOUNTS   label=path of each account's own gmail.modify grant
 *   GMAIL_ACCOUNTS          label=path of each gmail.readonly grant (optional)
 *   GMAIL_ADDRESSES         label=address, which health and consent check the grants against
 *   GMAIL_STATE_DIR         the token caches, <dir>/<label>/
 *   GMAIL_DEFAULT_ACCOUNT   the account a read uses when none is named; else the first
 *
 * An account is any label in either of the first two. With
 * GMAIL_MODIFY_ACCOUNTS unset, the modify grants are the ones consent (or
 * `setup`) wrote under `<state>/gmail/<label>/credentials.json`, and each
 * mailbox's address is the one its grant recorded, unless GMAIL_ADDRESSES
 * names another: a variable that is set always wins. None at all is a server
 * whose Gmail tools answer with a config error naming these.
 */
export const resolveAccounts = (env: NodeJS.ProcessEnv = process.env, fs: GrantFs = realFs): Resolved => {
  const stateRoot = envPath(env, "GMAIL_STATE_DIR") ?? join(googleStateDir(env), "gmail", "state");
  const readonly = new Map(parsePairs(env["GMAIL_ACCOUNTS"]?.trim() ?? "", "GMAIL_ACCOUNTS"));
  const listed = env["GMAIL_MODIFY_ACCOUNTS"]?.trim() ?? "";
  const grantRoot = listed ? undefined : gmailGrantRootOf(env);
  const found = grantRoot ? discoverGrants(grantRoot, fs) : [];
  const modify = grantRoot ? new Map(found.map((g) => [g.label, g.credentials] as const)) : new Map(parsePairs(listed, "GMAIL_MODIFY_ACCOUNTS"));
  const configured = parsePairs(env["GMAIL_ADDRESSES"]?.trim() ?? "", "GMAIL_ADDRESSES");
  const recorded = found.flatMap((g) => (g.address ? [[g.label, g.address, g.credentials] as const] : []));
  const addresses = new Map([...recorded.map(([label, address]) => [label, address] as const), ...configured]);
  const addressFrom = new Map([...recorded.map(([label, , file]) => [label, file] as const), ...configured.map(([label]) => [label, "GMAIL_ADDRESSES"] as const)]);
  const labels = [...new Set([...readonly.keys(), ...modify.keys()])];

  const accounts = labels.map((label): AccountSpec => {
    const address = addresses.get(label);
    const ro = readonly.get(label);
    const rw = modify.get(label);
    return {
      label,
      ...(address ? { address } : {}),
      ...(ro ? { readonly: ro } : {}),
      ...(rw ? { modify: rw } : {}),
      paths: pathsFor(join(stateRoot, label), label, env),
    };
  });

  const wanted = env["GMAIL_DEFAULT_ACCOUNT"]?.trim();
  if (wanted && !labels.includes(wanted)) return fail(configError(`GMAIL_DEFAULT_ACCOUNT "${wanted}" is not registered`));

  return { accounts, defaultLabel: wanted || labels[0] || "", addresses, addressFrom, ...(grantRoot ? { grantRoot } : {}) };
};
