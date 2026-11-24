/**
 * Where a credential may go. The sign-in documents Granola serves name the
 * authorization, token and registration endpoints; a document that was
 * tampered with in transit could name any address, and the code and refresh
 * token would follow. So every endpoint must sit on the same site as the MCP
 * server being signed in to (mcp.granola.ai and mcp-auth.granola.ai share
 * granola.ai), over https; a loopback host is the one exception, for a test.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const IP = /^(\d{1,3}\.){3}\d{1,3}$|^\[.*\]$/;

/** The part of a host names compare on: its last two labels, or the whole of an address or a bare name. */
export const siteOf = (host: string): string => {
  const lower = host.toLowerCase();
  if (IP.test(lower) || !lower.includes(".")) return lower;
  return lower.split(".").slice(-2).join(".");
};

/** Whether `endpoint` is an https address (or loopback http) on the same site as `resource`. */
export const onSameSite = (resource: string, endpoint: string): boolean => {
  try {
    const a = new URL(resource);
    const b = new URL(endpoint);
    if (b.protocol !== "https:" && !(b.protocol === "http:" && LOOPBACK.has(b.hostname))) return false;
    return siteOf(a.hostname) === siteOf(b.hostname);
  } catch {
    return false;
  }
};
