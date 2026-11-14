import { isIPv4, isIPv6 } from "node:net";

import type { ToolPolicy } from "../policy.js";
import { ceilingRefusing, type GuardSettings } from "./confirm.js";

/**
 * A server anyone may call, with no sign-in (MCP_HTTP_PUBLIC_HOSTS): for one
 * whose tools read public data, such as a central bank's exchange rates,
 * hosted at a public HTTPS address that a reverse proxy forwards to its
 * loopback port. ChatGPT and Claude connect to such a server from their own
 * machines, with no credentials at all.
 *
 * Only who is let in changes, and how callers are told apart; the route, the
 * guard and the limits on a request's size and time are the token server's.
 * The proxy owns everything a public address needs that is not MCP: TLS, the
 * firewall, and any static file (a privacy page, `/.well-known/...`).
 */

/**
 * The client name of every public caller, for the guard and the audit line.
 * Never an address: an audit line with one would be a log of personal data.
 */
export const PUBLIC_CLIENT = "public";

/** A host name the proxy forwards, and the port clients reach it on (443 unless listed with another). */
export type PublicHost = { readonly name: string; readonly port: number };

/** A host name MCP_HTTP_ALLOWED_HOSTS lists: any port when it names none, else that port as the request's Host header writes it. */
export type AllowedHost = { readonly name: string; readonly port: number | undefined };

const HTTPS_PORT = 443;

/** A DNS name: dot-separated labels of letters, digits and inner hyphens, at most 63 characters each. */
export const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * A host as written in a Host header or the list: its name in lower case
 * without a trailing dot, and its port if it carries one. Undefined for an IP
 * literal in brackets, which no listed name matches, and for a port that is
 * not one.
 */
export const hostPort = (text: string): { readonly name: string; readonly port: number | undefined } | undefined => {
  const value = text.trim().toLowerCase();
  if (value.startsWith("[")) return undefined;
  const colon = value.lastIndexOf(":");
  const name = (colon < 0 ? value : value.slice(0, colon)).replace(/\.$/, "");
  if (colon < 0) return { name, port: undefined };
  const port = value.slice(colon + 1);
  return /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535 ? { name, port: Number(port) } : undefined;
};

/**
 * MCP_HTTP_PUBLIC_HOSTS: the host names the proxy forwards, separated by
 * commas, each with `:<port>` when clients reach it on a port other than 443.
 * A list that names nothing, or an entry that is not a host name (a URL, say),
 * is a process that must not start.
 */
export const publicHostsFrom = (raw: string): readonly PublicHost[] => {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) throw new Error(`MCP_HTTP_PUBLIC_HOSTS "${raw}" names no host`);
  return entries.map((entry) => {
    const parsed = hostPort(entry);
    if (parsed === undefined || !HOST_NAME.test(parsed.name)) {
      throw new Error(`MCP_HTTP_PUBLIC_HOSTS entry "${entry}" is not a host name: write rates.example.com, or rates.example.com:8443 for a port other than 443`);
    }
    return { name: parsed.name, port: parsed.port ?? HTTPS_PORT };
  });
};

/**
 * Whether a request's Host header is one this server answers: the loopback
 * ones for its own port (a health check on the machine, or a proxy that sends
 * its upstream's address), on a public server each listed name, with or
 * without its port, and on any server each of MCP_HTTP_ALLOWED_HOSTS
 * (serve/bind.ts). Anything else was not meant for this server, and on
 * loopback it is how a DNS-rebinding page shows itself.
 */
export const hostAccepted = (
  header: string | undefined,
  bound: number,
  publicHosts: readonly PublicHost[],
  allowedHosts: readonly AllowedHost[] = [],
): boolean => {
  if (header === `127.0.0.1:${bound}` || header === `localhost:${bound}`) return true;
  const asked = hostPort(header ?? "");
  if (asked === undefined) return false;
  return (
    publicHosts.some((host) => host.name === asked.name && host.port === (asked.port ?? HTTPS_PORT)) ||
    allowedHosts.some((host) => host.name === asked.name && (host.port === undefined || host.port === asked.port))
  );
};

/** MCP_HTTP_CLIENT_IP_HEADER: a header name, in lower case as Node keys request headers. */
export const clientIpHeaderFrom = (raw: string): string => {
  const name = raw.trim().toLowerCase();
  if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) throw new Error(`MCP_HTTP_CLIENT_IP_HEADER "${raw}" is not a header name`);
  return name;
};

/** An address without the brackets and port some proxies write around it (`[2001:db8::1]:443`, `192.0.2.1:443`), and without an IPv6 zone. */
const bare = (text: string): string => {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(text);
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(text);
  return (bracketed?.[1] ?? v4WithPort?.[1] ?? text).replace(/%.*$/, "");
};

/** A dotted IPv4 address as the two 16-bit groups it fills at the end of an IPv6 one. */
const dotted = (v4: string): number[] => {
  const [a = 0, b = 0, c = 0, d = 0] = v4.split(".").map(Number);
  return [(a << 8) | b, (c << 8) | d];
};

/** A valid IPv6 address's eight groups, `::` expanded. */
const hextets = (address: string): readonly number[] => {
  const groups = (part: string): number[] => (part === "" ? [] : part.split(":").flatMap((g) => (g.includes(".") ? dotted(g) : [parseInt(g, 16)])));
  const [head = "", tail] = address.split("::");
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
};

/**
 * An address as a rate-limit key: an IPv4 address as itself (also when it
 * comes mapped into IPv6, so one caller is one key on either socket family),
 * an IPv6 address as its /64. One IPv6 host commonly holds a whole /64 and can
 * take a new address in it at will, so counting single addresses would let it
 * walk past its limit. Undefined for anything that is not an address.
 */
const addressKey = (text: string): string | undefined => {
  const address = bare(text.trim());
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return undefined;
  const groups = hextets(address);
  const [g6 = 0, g7 = 0] = groups.slice(6);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255].join(".");
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
};

/**
 * The key a public caller's rate limit counts under: its address, from the
 * header the proxy sets when MCP_HTTP_CLIENT_IP_HEADER names one, else the
 * connection's own (which, behind a proxy, is the proxy's, so every caller
 * shares one bucket).
 *
 * The header's LAST address is the one taken. A proxy appends the address it
 * saw to an `X-Forwarded-For` the client may already have filled, so only the
 * last entry is not the client's to choose; a header holding one address
 * (`CF-Connecting-IP`) reads the same. A value that is not an address falls
 * back to the connection's.
 */
export const callerKey = (header: string | readonly string[] | undefined, socketAddress: string | undefined): string => {
  const value = typeof header === "string" ? header : (header ?? []).join(",");
  return addressKey(value.split(",").at(-1) ?? "") ?? addressKey(socketAddress ?? "") ?? "unknown";
};

/**
 * The tools a public caller could run that are not `read`, each with its
 * class. A public server must have none: with no sign-in, anyone can call it,
 * so only tools that change nothing may run there. A `write` or `money` tool
 * may stay registered when a ceiling refuses it (MCP_MAX_ACCESS, or
 * MCP_CLIENT_MAX_ACCESS for the client `public`), because the guard refuses
 * every call by that same ceiling before the tool runs (ceilingRefusing).
 */
export const beyondRead = (policy: ToolPolicy, settings: GuardSettings): readonly string[] =>
  Object.entries(policy)
    .filter(([, rule]) => rule.access !== "read" && ceilingRefusing(rule.access, settings, PUBLIC_CLIENT) === undefined)
    .map(([name, rule]) => `${name} (${rule.access})`)
    .sort();

/** Refuse to start a public server that could do anything but read. */
export const checkPublic = (name: string, policy: ToolPolicy, settings: GuardSettings): void => {
  const above = beyondRead(policy, settings);
  if (above.length === 0) return;
  throw new Error(
    `${name}: MCP_HTTP_PUBLIC_HOSTS serves this server with no sign-in, so anyone can call it, and only read tools may run there; ` +
      `${above.join(", ")} could. Set MCP_MAX_ACCESS=read to refuse every other tool, or serve it with tokens instead.`,
  );
};
