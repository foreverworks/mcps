import { isoOf } from "../../domain/authorization.js";
import { asAppError } from "../../domain/errors.js";
import { tourOf } from "../../domain/tools.js";
import type { Deps } from "../ports.js";

const reason = (thrown: unknown): { readonly kind: string; readonly message: string } => {
  const known = asAppError(thrown);
  return known === undefined ? { kind: "unexpected", message: String(thrown).slice(0, 300) } : { kind: known.kind, message: known.message };
};

/**
 * Whether this server can serve Mobbin now, and what is missing: the grant
 * and when its access token ends, whether Mobbin answers and which of its
 * tools are offered here. Read-only: it never refreshes, so it never rotates
 * the grant (refresh_grant does that, and a call refreshes a due token by
 * itself). Never prints a token, and never fails: a failure is the answer.
 */
export const health = async (deps: Deps) => {
  const { stores, config, now } = deps;
  const grant = await stores.grant.read();
  const base = {
    client_registered: (await stores.client.read()) !== undefined,
    sign_in_open: (await stores.pending.read()) !== undefined,
    upstream: config.upstreamUrl,
  };
  if (grant === undefined) {
    return {
      ok: false,
      grant: { present: false },
      ...base,
      next: "No grant yet: call begin_authorization, open its link in a browser signed in to Mobbin, then pass the address it lands on to complete_authorization.",
    };
  }
  const due = grant.expiresAtEpoch - now() <= 60;
  const summary = { present: true, access_expires_at: isoOf(grant.expiresAtEpoch), access_expires_in_seconds: Math.max(0, grant.expiresAtEpoch - now()), ...(grant.scope === undefined ? {} : { scope: grant.scope }) };
  if (due) {
    return { ok: true, grant: summary, ...base, next: "The access token is due; the next call refreshes it. Call refresh_grant to prove the refresh works now." };
  }
  const seen = await deps.upstream.listTools().then((tools) => ({ tools }), (thrown: unknown) => ({ error: reason(thrown) }));
  if ("tools" in seen) await deps.rememberTools(seen.tools);
  return {
    ok: "tools" in seen,
    grant: summary,
    ...base,
    ...("tools" in seen ? { upstream_reachable: true, upstream_tool_count: seen.tools.length, tools: tourOf(seen.tools) } : { upstream_error: seen.error }),
  };
};

/** Refresh the grant now: proves the refresh token works. Rotates the grant (the new pair is saved first), so it is a write. */
export const refreshGrant = async (deps: Deps) => {
  await deps.access.force();
  const after = await deps.stores.grant.read();
  return { ok: true, refreshed: true, ...(after === undefined ? {} : { access_expires_at: isoOf(after.expiresAtEpoch) }) };
};
