import { unlessCancelled } from "@foreverworks/mcp-kit";

import { grantHealth } from "../../grants/health.js";
import { describeThrown, fail, inputError, remedyFor } from "../domain/errors.js";
import { canRead, REQUIRED_SCOPES, scopeOf, type Source, SOURCES } from "../domain/grants.js";
import { type Found, mergePeople } from "../domain/people.js";
import type { Deps } from "./ports.js";

export type FindRequest = {
  readonly query: string;
  readonly sources: readonly Source[];
  /** Per account and source. */
  readonly limit: number;
};

type Unavailable = { readonly account: string; readonly source: Source; readonly reason: string };

/**
 * A person by name (or the start of an address, a phone number, an
 * organisation) across every account and every place an address is kept: the
 * account's contacts, the addresses Gmail saved from mail ("other contacts"),
 * and a Workspace domain's directory. A source an account cannot read (no
 * grant for it, or no directory because the account is not a Workspace one)
 * is listed under `unavailable` with the reason, never read as "nobody".
 */
export const findPeople = async (accounts: readonly Deps[], request: FindRequest) => {
  const query = request.query.trim();
  if (!query) return fail(inputError("give a name, or the start of an address, to search for"));
  // Per account, per source, in the order asked, so the answer reads the same on every run.
  const read = await Promise.all(
    accounts.map(async (deps) => {
      let granted: readonly string[];
      try {
        granted = await deps.grant.scopes();
      } catch (thrown) {
        // A dead grant is that account's answer, for every source, not the whole call's.
        unlessCancelled("the search stopped before every account was read");
        const reason = describeThrown(thrown);
        return request.sources.map((source) => ({ found: [], unavailable: { account: deps.grant.account, source, reason } }));
      }
      return Promise.all(
        request.sources.map(async (source): Promise<{ readonly found: readonly Found[]; readonly unavailable?: Unavailable }> => {
          const account = deps.grant.account;
          if (!canRead(granted, source)) return { found: [], unavailable: { account, source, reason: `the grant lacks ${scopeOf(source)}` } };
          try {
            const people = await deps.people.search(source, query, request.limit);
            return { found: people.map((person) => ({ account, source, person })) };
          } catch (thrown) {
            unlessCancelled("the search stopped before every source was read");
            return { found: [], unavailable: { account, source, reason: describeThrown(thrown) } };
          }
        }),
      );
    }),
  );
  const each = read.flat();
  const found = each.map((r) => r.found);
  const unavailable = each.flatMap((r) => (r.unavailable ? [r.unavailable] : []));
  const people = mergePeople(found.flat());
  return {
    query,
    people,
    searched: { accounts: accounts.map((d) => d.grant.account), sources: request.sources },
    ...(unavailable.length ? { unavailable } : {}),
  };
};

/** The grant's health, with which sources it reads. */
export const checkHealth = async (deps: Deps) => {
  const health = await grantHealth(deps.grant, { required: REQUIRED_SCOPES, probe: deps.people.probe, remedyFor });
  return { ...health, sources: Object.fromEntries(SOURCES.map((s) => [s, canRead(health.scopes, s)])) };
};
