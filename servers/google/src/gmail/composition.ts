import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import type { Deps, GrantHandle } from "./app/ports.js";
import { configError, fail } from "./domain/errors.js";
import { MAX_ATTACHMENTS_BYTES } from "./domain/compose.js";
import type { GrantRole } from "./domain/grants.js";
import { ALL_ACCOUNTS, type AccountSpec, NO_MAILBOX, type Resolved, resolveAccounts } from "./infra/accounts.js";
import { credentialsPathOf, type GrantFs, realFs } from "../grants/registry.js";
import { loadCredentials } from "../infra/credentials.js";
import { makeFiles } from "./infra/files.js";
import { makeGmailApi } from "./infra/gmailApi.js";
import { makeGmailWrite } from "./infra/gmailWrite.js";
import { htmlToText } from "./infra/htmlText.js";
import { makeGetJson, makeRequest } from "../infra/httpJson.js";
import { makeTokenProvider } from "../infra/oauth.js";
import { fileTokenStore, type InputFiles, inputFilesFrom, timeZoneOf } from "@foreverworks/mcp-kit";

const GMAIL = { service: "Gmail" } as const;

const boundary = () => `=_gmail_${randomBytes(12).toString("hex")}`;

/**
 * One credential file and everything that reaches Google through it: its own
 * token cache, its own request layer. Two grants of one account never share a
 * token, which is what keeps a read-only token off a write and the reverse.
 */
const tokenStore = (role: GrantRole, stateDir: string) => fileTokenStore(stateDir, role === "modify" ? "access_token.modify" : "access_token");

const grantBundle = (role: GrantRole, credentials: string, stateDir: string) => {
  const tokens = makeTokenProvider(() => loadCredentials(credentials), tokenStore(role, stateDir));
  const gmail = makeGmailApi(makeGetJson(tokens, GMAIL), tokens.get);
  const handle: GrantHandle = {
    role,
    credentials,
    scopes: tokens.scopes,
    declaration: async () => {
      const c = await loadCredentials(credentials);
      return { clientId: c.clientId, scopes: c.declaredScopes };
    },
    tokenInfo: gmail.tokenInfo,
    profile: gmail.profile,
  };
  return { handle, gmail, write: makeGmailWrite(makeRequest(tokens, GMAIL), boundary) };
};

/**
 * The composition root: the ONLY place that names both an interface and the
 * thing implementing it. Every other module depends on ports, which is what
 * lets the tests swap the network out without touching a line of production
 * code.
 *
 * Which grant an account's tools run on is decided HERE, once: its own modify
 * grant when that file exists, else its read-only one. The fallback is what
 * keeps reading alive where the modify grant was never consented; the write
 * use cases then refuse, loudly, before any request.
 */
export const buildDeps = (spec: AccountSpec, readInput: InputFiles, timeZone: string): Deps => {
  const { label, paths } = spec;
  const modify = spec.modify ? grantBundle("modify", spec.modify, paths.stateDir) : undefined;
  const readonly = spec.readonly ? grantBundle("readonly", spec.readonly, paths.stateDir) : undefined;
  const active = modify && (existsSync(modify.handle.credentials) || !readonly) ? modify : readonly;
  if (!active) return fail(configError(`account "${label}" has no credentials configured`));
  return {
    account: label,
    ...(spec.address ? { address: spec.address } : {}),
    gmail: active.gmail,
    write: active.write,
    grant: active.handle,
    grants: [modify, readonly].flatMap((b) => (b ? [b.handle] : [])),
    ...(spec.modify ? { modifyPath: spec.modify } : {}),
    files: makeFiles(readInput),
    htmlToText,
    timeZone,
    paths,
    boundary,
  };
};

export type Registry = {
  readonly labels: readonly string[];
  readonly defaultLabel: string;
  /** One account. An empty or missing label means the default one. */
  readonly get: (label?: string) => Deps;
  /** One account, or every account when the label is `*`. */
  readonly select: (label?: string) => readonly Deps[];
  /** Files coming in (attachments): this process's reader, and the words the tools describe it in. */
  readonly inputFiles: InputFiles;
  /** What the registry says about one account (its grant files, its address), or undefined. */
  readonly specOf: (label: string) => AccountSpec | undefined;
  /** The address GMAIL_ADDRESSES gives a label (whether or not it is a mailbox here), else the one its grant recorded. */
  readonly addressOf: (label: string) => string | undefined;
  /** Where that address came from: GMAIL_ADDRESSES, or the grant file that recorded it. */
  readonly addressFromOf: (label: string) => string | undefined;
  /** Every label with an address, mailbox or not. */
  readonly addressed: () => readonly string[];
  /**
   * Where the account's own gmail.modify grant is, or goes when a consent
   * writes it: GMAIL_MODIFY_ACCOUNTS' path, else `<root>/<label>/credentials.json`
   * when that variable is unset. Undefined for a label the variable leaves out.
   */
  readonly modifyPathOf: (label: string) => string | undefined;
  /** The folder mailboxes are found in when GMAIL_MODIFY_ACCOUNTS does not list them. */
  readonly grantRoot?: string;
  /**
   * One of the account's grants was replaced (a consent): drop what was built on
   * it and that grant's cached token. The next call chooses the active grant
   * again, so a modify grant consented for an account that was reading on its
   * read-only one takes over at once.
   */
  readonly forget: (label: string, role: GrantRole) => Promise<void>;
};

/**
 * Accounts are built LAZILY and then kept.
 *
 * Lazily, because a broken credentials file for one mailbox must not stop the
 * server from starting and serving the other — the failure belongs to the call
 * that touches it. Kept, because the token cache lives inside the bundle and
 * rebuilding it per call would re-read and re-refresh on every tool use.
 *
 * Where GMAIL_MODIFY_ACCOUNTS lists the mailboxes, the list is read once. Without
 * it, a mailbox is a grant on disk, found again on every lookup as Calendar's
 * are, so a consent needs no restart.
 */
export const buildRegistry = (env: NodeJS.ProcessEnv = process.env, fs: GrantFs = realFs): Registry => {
  // Read once here whatever the mode, so a malformed variable stops the process at start.
  const first = resolveAccounts(env, fs);
  const current = (): Resolved => (first.grantRoot ? resolveAccounts(env, fs) : first);
  const readInput = inputFilesFrom(env, { maxBytes: MAX_ATTACHMENTS_BYTES });
  // The readers' zone: Gmail's own, else the one the calendar already reads times in, else the process's.
  const timeZone = timeZoneOf(env, env["GMAIL_TIME_ZONE"]?.trim() ? "GMAIL_TIME_ZONE" : "CALENDAR_TIME_ZONE");
  const built = new Map<string, Deps>();

  const get = (label?: string): Deps => {
    const { accounts, defaultLabel } = current();
    if (accounts.length === 0) return fail(configError(NO_MAILBOX));
    const wanted = label?.trim() || defaultLabel;
    if (wanted === ALL_ACCOUNTS) return fail(configError(`this tool takes one account, not "${ALL_ACCOUNTS}"`));
    const spec = accounts.find((a) => a.label === wanted);
    if (!spec) {
      return fail(configError(`unknown account "${wanted}"; registered: ${accounts.map((a) => a.label).join(", ")}`));
    }
    const existing = built.get(wanted);
    if (existing) return existing;
    const deps = buildDeps(spec, readInput, timeZone);
    built.set(wanted, deps);
    return deps;
  };

  const specOf = (label: string) => current().accounts.find((a) => a.label === label);

  return {
    inputFiles: readInput,
    get labels() {
      return current().accounts.map((a) => a.label);
    },
    get defaultLabel() {
      return current().defaultLabel;
    },
    get,
    select: (label?: string) => {
      if (label?.trim() !== ALL_ACCOUNTS) return [get(label)];
      const { accounts } = current();
      return accounts.length === 0 ? fail(configError(NO_MAILBOX)) : accounts.map((a) => get(a.label));
    },
    specOf,
    addressOf: (label) => current().addresses.get(label),
    addressFromOf: (label) => current().addressFrom.get(label),
    addressed: () => [...current().addresses.keys()],
    modifyPathOf: (label) => specOf(label)?.modify ?? (first.grantRoot ? credentialsPathOf(first.grantRoot, label) : undefined),
    ...(first.grantRoot ? { grantRoot: first.grantRoot } : {}),
    forget: async (label, role) => {
      built.delete(label);
      const spec = specOf(label);
      if (spec) await tokenStore(role, spec.paths.stateDir).clear?.();
    },
  };
};
