import { isIP } from "node:net";

import { type AllowedHost, HOST_NAME, hostPort } from "./public.js";

/**
 * Where the HTTP listener binds (MCP_HTTP_HOST) and which Host names it
 * answers besides the loopback ones (MCP_HTTP_ALLOWED_HOSTS), for a server that
 * runs in a container and is reached over a private network on a published
 * port, not on the machine's own loopback.
 *
 * Both unset is the listener this kit always had: 127.0.0.1, and a Host of
 * `127.0.0.1:<port>` or `localhost:<port>`.
 */

/** The address a listener binds when MCP_HTTP_HOST is not set. */
export const LOOPBACK_ADDRESS = "127.0.0.1";

/**
 * MCP_HTTP_HOST: an IP address (`0.0.0.0` for every IPv4 interface, `::` for
 * every one of both families, or one interface's address) or `localhost`. Not
 * a name to resolve: where a process listens should not depend on a lookup.
 */
export const bindHostFrom = (raw: string): string => {
  const value = raw.trim();
  if (value.toLowerCase() === "localhost") return "localhost";
  if (isIP(value) === 0) {
    throw new Error(`MCP_HTTP_HOST "${raw}" is not an IP address: write 0.0.0.0 for every IPv4 interface, :: for every interface, or one interface's address`);
  }
  return value;
};

/** Whether an address can be reached from this machine only: 127.0.0.0/8, ::1 and `localhost`. */
export const isLoopbackAddress = (host: string): boolean => {
  const value = host.toLowerCase();
  return value === "localhost" || value === "::1" || (isIP(value) === 4 && value.startsWith("127."));
};

/**
 * MCP_HTTP_ALLOWED_HOSTS: the Host header values the server answers in
 * addition to the loopback ones, separated by commas. `name` accepts that name
 * on any port (or none); `name:port` only that port, as the header writes it.
 * A name is a DNS name or an IPv4 address; the comparison ignores case and a
 * trailing dot. An entry that is not one (a URL, say) is a process that must
 * not start.
 */
export const allowedHostsFrom = (raw: string): readonly AllowedHost[] => {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) throw new Error(`MCP_HTTP_ALLOWED_HOSTS "${raw}" names no host`);
  return entries.map((entry) => {
    const parsed = hostPort(entry);
    if (parsed === undefined || !HOST_NAME.test(parsed.name)) {
      throw new Error(`MCP_HTTP_ALLOWED_HOSTS entry "${entry}" is not a host name: write mcp.internal for any port, or mcp.internal:8080 for one port`);
    }
    return { name: parsed.name, port: parsed.port };
  });
};

/** An allowed host as the startup line writes it. */
export const allowedHostText = (host: AllowedHost): string => (host.port === undefined ? host.name : `${host.name}:${host.port}`);

/** An address as it goes into a URL: IPv6 in brackets. */
export const urlHost = (address: string): string => (address.includes(":") ? `[${address}]` : address);
