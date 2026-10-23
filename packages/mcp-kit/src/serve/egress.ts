import { Agent, setGlobalDispatcher } from "undici";

import { hostAllowed } from "./limits.js";

/**
 * Process-wide network policy, installed once by `serve` before anything
 * listens. These are the only two effects on globals in the repo, and they
 * live here so that no server has to know about either.
 */

/** A refused host, as the TypeError fetch itself throws for a network failure. */
const refused = (host: string): TypeError =>
  Object.assign(new TypeError(`egress to ${host} is not allowed for this server (MCP_EGRESS_ALLOW)`), { cause: { code: "EGRESS_DENIED" } });

/**
 * Only the hosts this server has business with. Private networks are the OS
 * sandbox's to close (systemd's IPAddressDeny, docs/deploying.md); this narrows
 * the public internet to the API the server wraps, so a tool that takes a URL
 * cannot be talked into fetching anything else.
 */
export const installEgress = (patterns: readonly string[]): void => {
  const inner = globalThis.fetch;
  globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return hostAllowed(url.hostname, patterns) ? inner(input, init) : Promise.reject(refused(url.hostname));
  };
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
