import { randomUUID } from "node:crypto";

import type { Deps, TasksDue } from "./app/ports.js";
import { configError, fail } from "./domain/errors.js";
import { ALL_ACCOUNTS, type AccountSpec, cacheDirOf, credentialsPathOf, resolveAccounts } from "./infra/accounts.js";
import { makeCalendarApi } from "./infra/calendarApi.js";
import { loadCredentials } from "../infra/credentials.js";
import { makeRequest } from "../infra/httpJson.js";
import { makeTokenProvider } from "../infra/oauth.js";
import { fileTokenStore } from "@foreverworks/mcp-kit";

/**
 * The composition root: the ONLY place that names both an interface and the
 * thing implementing it, which is what lets the tests swap the network out
 * without touching a line of production code.
 */
export const buildDeps = (spec: AccountSpec, timeZone: string): Deps => {
  const tokens = makeTokenProvider(() => loadCredentials(spec.credentials), fileTokenStore(spec.stateDir));
  return {
    account: spec.label,
    ...(spec.address ? { address: spec.address } : {}),
    timeZone,
    calendar: makeCalendarApi(makeRequest(tokens, { service: "Google Calendar" })),
    grant: { credentials: spec.credentials, scopes: tokens.scopes },
    now: () => Date.now(),
    newId: () => randomUUID(),
  };
};

export type Registry = {
  /** The accounts with a grant, as the disk has them now. */
  readonly labels: readonly string[];
  readonly defaultLabel: string;
  readonly root: string;
  readonly timeZone: string;
  /** One account. An empty label means the default one. */
  readonly get: (label?: string) => Deps;
  /** One account, or every account when the label is `*`. */
  readonly select: (label?: string) => readonly Deps[];
  /** What the disk says about one account (its grant file, the address it recorded), or undefined. */
  readonly specOf: (label: string) => AccountSpec | undefined;
  /** Where an account's grant lives, or goes when it is consented. */
  readonly credentialsPath: (label: string) => string;
  /** The account's grant was replaced: drop what was built on it and its cached token. */
  readonly forget: (label: string) => Promise<void>;
  /** Tasks due in a window, when the server has a Tasks product to ask. */
  readonly tasksDue?: TasksDue;
};

/**
 * Accounts are DISCOVERED on every lookup, so a grant consented after start is
 * served without a restart; each is BUILT lazily and then kept: lazily, so a
 * broken grant for one account does not stop the server serving the other;
 * kept, because the token cache lives inside and rebuilding it per call would
 * refresh on every use.
 */
export const buildRegistry = (env: NodeJS.ProcessEnv = process.env, extras: { readonly tasksDue?: TasksDue } = {}): Registry => {
  const { root, timeZone } = resolveAccounts(env);
  const built = new Map<string, Deps>();
  const current = () => resolveAccounts(env);

  const get = (label?: string): Deps => {
    const { accounts, defaultLabel } = current();
    const wanted = label?.trim() || defaultLabel;
    if (wanted === ALL_ACCOUNTS) return fail(configError(`this tool takes one account, not "${ALL_ACCOUNTS}"`));
    const spec = accounts.find((a) => a.label === wanted);
    if (!spec) {
      const known = accounts.map((a) => a.label).join(", ") || "none";
      return fail(configError(`no calendar grant for "${wanted}" under ${root} (have: ${known})`));
    }
    const existing = built.get(wanted);
    if (existing) return existing;
    const deps = buildDeps(spec, timeZone);
    built.set(wanted, deps);
    return deps;
  };

  return {
    get labels() {
      return current().accounts.map((a) => a.label);
    },
    get defaultLabel() {
      return current().defaultLabel;
    },
    root,
    timeZone,
    get,
    select: (label?: string) => (label?.trim() === ALL_ACCOUNTS ? current().accounts.map((a) => get(a.label)) : [get(label)]),
    specOf: (label) => current().accounts.find((a) => a.label === label),
    credentialsPath: (label) => credentialsPathOf(root, label),
    forget: async (label) => {
      built.delete(label);
      await fileTokenStore(cacheDirOf(root, label)).clear?.();
    },
    ...(extras.tasksDue ? { tasksDue: extras.tasksDue } : {}),
  };
};
