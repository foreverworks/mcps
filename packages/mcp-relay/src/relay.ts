import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import {
  admit,
  allowedHostText,
  type Bucket,
  clientFor,
  hostAccepted,
  LOOPBACK_ADDRESS,
  loadTokens,
  MCP_PATH,
  pathnameOf,
  plainReply,
  urlHost,
} from "@foreverworks/mcp-kit";

import { forwardMcp } from "./forward.js";
import type { RelaySettings } from "./settings.js";
import { closeUpstream, upstreamAt } from "./upstream.js";

/**
 * The relay's listener: the front of a server, as far as a client can see.
 * One route, `/mcp`; the bearer tokens of MCP_HTTP_TOKENS_DIR; the Host check
 * of MCP_HTTP_ALLOWED_HOSTS; the kit's limits on size, time and rate per
 * client; and the same plain answers (401, 421, 404, 405, 413, 429) a server
 * gives, in the same order, so a client that works against the server works
 * against this. What lies behind the route is forwardMcp's.
 */
export type Started = {
  readonly port: number;
  readonly address: string;
  readonly close: () => Promise<void>;
};

export type StartOptions = {
  readonly settings: RelaySettings;
  /** The bearer token the upstream accepts from this relay. */
  readonly upstreamToken: string;
  /** Where the log lines go; stderr by default. */
  readonly log?: (line: string) => void;
};

const FORWARDED = new Set(["POST", "GET", "DELETE"]);

export const startRelay = async ({ settings, upstreamToken, log = (line) => console.error(line) }: StartOptions): Promise<Started> => {
  const tokens = await loadTokens(settings.tokens);
  const upstream = upstreamAt(settings.upstream, upstreamToken);
  const { limits } = settings;
  const bindAddress = settings.host ?? LOOPBACK_ADDRESS;
  const allowedHosts = settings.allowedHosts ?? [];
  const relay = { limits, transfer: { upstream, inbox: settings.inbox, outbox: settings.outbox, maxFileBytes: settings.maxFileBytes, log } };
  const buckets = new Map<string, Bucket>();
  const state = { bound: 0 };

  const server = createServer((req, res) => {
    const client = clientFor(req.headers.authorization, tokens);
    if (client === undefined) return plainReply(res, 401, "unauthorized");
    if (!hostAccepted(req.headers.host, state.bound, [], allowedHosts)) return plainReply(res, 421, "wrong host");
    if (pathnameOf(req.url) !== MCP_PATH) return plainReply(res, 404, "not found");
    if (!FORWARDED.has(req.method ?? "")) return plainReply(res, 405, "the relay forwards POST, GET and DELETE only");
    const step = admit(buckets, client, Date.now(), limits);
    if (!step.allowed) return plainReply(res, 429, "too many requests", { "retry-after": String(step.retryAfterSec) });
    void forwardMcp(relay, req, res);
  });
  // A client that trickles its request cannot hold a socket, as on a server.
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(settings.port, bindAddress, resolve);
  });
  const bound = (server.address() as AddressInfo).port;
  state.bound = bound;

  const folders = [settings.inbox === undefined ? undefined : `inbox ${settings.inbox}`, settings.outbox === undefined ? undefined : `outbox ${settings.outbox}`].filter((part) => part !== undefined);
  log(
    `relay: listening on http://${urlHost(bindAddress)}:${bound}${MCP_PATH} for ${[...tokens.keys()].join(", ")}` +
      `${allowedHosts.length === 0 ? "" : `, and Host ${allowedHosts.map(allowedHostText).join(", ")}`}; ` +
      `forwarding to ${settings.upstream}${MCP_PATH}; ${folders.length === 0 ? "no files carried (set MCP_RELAY_INBOX, MCP_RELAY_OUTBOX)" : `carrying files for ${folders.join(" and ")}`}` +
      `${settings.plainHttp ? "; WARNING: the upstream is plain http (MCP_RELAY_ALLOW_PLAIN_HTTP=1), so its token and the files cross the network as they are: only for a network that is encrypted already" : ""}`,
  );

  return {
    port: bound,
    address: (server.address() as AddressInfo).address,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      closeUpstream(upstream);
    },
  };
};
