import { Agent, setGlobalDispatcher } from "undici";

import { egressFrom, hostAllowed } from "./limits.js";

/**
 * Process-wide network policy, installed by `serve` before anything listens.
 * These are the only two effects on globals in the repo, and they live here so
 * that no server has to know about either.
 */

/** A refused host, as the TypeError fetch itself throws for a network failure. */
const refused = (host: string): TypeError =>
  Object.assign(new TypeError(`egress to ${host} is not allowed for this server (MCP_EGRESS_ALLOW)`), { cause: { code: "EGRESS_DENIED" } });

/** The fetch each installed guard wraps, so that installing again replaces the guard instead of stacking another on it. */
const wrapped = new WeakMap<typeof fetch, typeof fetch>();

/**
 * Only the hosts this server has business with. Private networks are the OS
 * sandbox's to close (systemd's IPAddressDeny, docs/deploying.md); this narrows
 * the public internet to the API the server wraps, so a tool that takes a URL
 * cannot be talked into fetching anything else.
 *
 * Installing again replaces the list in force: the newest call wins.
 */
export const installEgress = (patterns: readonly string[]): void => {
  const current = globalThis.fetch;
  const inner = wrapped.get(current) ?? current;
  const guard: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return hostAllowed(url.hostname, patterns) ? inner(input, init) : Promise.reject(refused(url.hostname));
  };
  wrapped.set(guard, inner);
  globalThis.fetch = guard;
};

/**
 * MCP_EGRESS_ALLOW applied: the list it names goes in force, and with the
 * variable unset nothing changes. `serve` calls this itself, but a function
 * that has already run by then has already seen the unguarded fetch, so an
 * entry point that builds anything before it serves (every server does, and
 * the receipts servers' `runServer` is one) calls this first. A fetch kept as
 * a value should be `liveFetch` in any case: that one finds the guard whenever
 * it was installed.
 */
export const guardEgress = (env: NodeJS.ProcessEnv): void => {
  const patterns = egressFrom(env);
  if (patterns !== undefined) installEgress(patterns);
};

/**
 * Keep upstream TLS connections for MCP_KEEPALIVE_MS instead of Node's 4 s,
 * because an agent's calls arrive seconds apart and each new connection to an
 * API pays a TLS handshake. Unset leaves Node's default.
 *
 * The connections stay HTTP/1.1 (`allowH2: false`): undici 8 made HTTP/2 its
 * default, and moving every API the servers wrap to another protocol is a
 * change of its own, not a side effect of a dependency update.
 */
export const installKeepAlive = (env: NodeJS.ProcessEnv): void => {
  const ms = Number(env["MCP_KEEPALIVE_MS"] ?? "");
  if (!Number.isFinite(ms) || ms <= 0) return;
  setGlobalDispatcher(new Agent({ keepAliveTimeout: ms, keepAliveMaxTimeout: ms, connections: 16, allowH2: false }));
};
