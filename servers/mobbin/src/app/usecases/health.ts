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
 * and when its access token ends, whether a refresh works (tried when the
 * access token is due, or when asked), whether Mobbin answers and which of its
 * tools are offered here. Never prints a token, and never fails: a failure is
 * the answer.
 */
export const health = async (deps: Deps, args: { readonly testRefresh: boolean }) => {
  const { stores, config, now } = deps;
  const grant = await stores.grant.read();
  const client = await stores.client.read();
  const pending = await stores.pending.read();
  const base = {
    client_registered: client !== undefined,
    sign_in_open: pending !== undefined,
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
  const refresh = await (due || args.testRefresh ? deps.access.force().then(() => ({ ok: true as const, tried: true }), (thrown: unknown) => ({ ok: false as const, tried: true, error: reason(thrown) })) : Promise.resolve({ ok: true as const, tried: false }));
  const after = (await stores.grant.read()) ?? grant;
  const seen = refresh.ok ? await deps.upstream.listTools().then((tools) => ({ tools }), (thrown: unknown) => ({ error: reason(thrown) })) : undefined;
  if (seen !== undefined && "tools" in seen) await deps.rememberTools(seen.tools);
  return {
    ok: refresh.ok && seen !== undefined && "tools" in seen,
    grant: { present: true, access_expires_at: isoOf(after.expiresAtEpoch), access_expires_in_seconds: Math.max(0, after.expiresAtEpoch - now()), ...(after.scope === undefined ? {} : { scope: after.scope }) },
    refresh: refresh.tried ? (refresh.ok ? "worked" : { failed: refresh.error }) : "not needed yet (the access token is still good); pass test_refresh to try it now",
    ...base,
    ...(seen === undefined ? {} : "tools" in seen ? { upstream_reachable: true, upstream_tool_count: seen.tools.length, tools: tourOf(seen.tools) } : { upstream_error: seen.error }),
    ...(refresh.ok ? {} : { next: "The grant no longer works: call begin_authorization and sign in again." }),
  };
};
