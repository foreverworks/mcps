import { join } from "node:path";

import { envPath, timeZoneOf } from "@foreverworks/mcp-kit";

import { configError, fail } from "../domain/errors.js";

import { discoverGrants, type GrantFs, type GrantSpec, realFs } from "../../grants/registry.js";
import { googleStateDir } from "../../infra/locations.js";

export { ALL_ACCOUNTS } from "../../domain/accounts.js";
export { cacheDirOf, credentialsPathOf } from "../../grants/registry.js";

export type AccountSpec = GrantSpec;

export type Resolved = {
  readonly accounts: readonly AccountSpec[];
  readonly defaultLabel: string;
  readonly root: string;
  readonly timeZone: string;
};

/**
 * The accounts are DISCOVERED, not listed: every `<root>/<label>/credentials.json`
 * is one, and the address it must resolve to is the `account` field its consent
 * wrote into it (src/grants/registry.ts).
 *
 * That keeps the accounts out of the server's configuration: consenting a new
 * account is the whole change, with no restart.
 *
 * Sorted, the default account (CALENDAR_DEFAULT_ACCOUNT) first and the rest by
 * name, so the order is the same on every run and an event both accounts see
 * keeps the default account's copy.
 */
export const resolveAccounts = (env: NodeJS.ProcessEnv = process.env, fs: GrantFs = realFs): Resolved => {
  const root = envPath(env, "CALENDAR_ROOT") ?? join(googleStateDir(env), "calendar");
  const timeZone = timeZoneOf(env, "CALENDAR_TIME_ZONE");
  const wanted = env["CALENDAR_DEFAULT_ACCOUNT"]?.trim();
  const accounts = [...discoverGrants(root, fs)].sort((a, b) => (a.label === wanted ? -1 : b.label === wanted ? 1 : a.label.localeCompare(b.label)));
  const labels = accounts.map((a) => a.label);
  if (wanted && !labels.includes(wanted)) return fail(configError(`CALENDAR_DEFAULT_ACCOUNT "${wanted}" has no grant under ${root}`));
  return { accounts, defaultLabel: wanted || labels[0] || "", root, timeZone };
};
