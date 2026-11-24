import { isSecureUrl, stateDirOf } from "@foreverworks/mcp-kit";

import type { Config } from "../app/ports.js";

export const DEFAULT_UPSTREAM = "https://mcp.granola.ai/mcp";
/** A loopback address nothing needs to listen on: the browser lands there and the person copies the address. */
export const DEFAULT_REDIRECT = "http://127.0.0.1:8977/callback";

export const configFrom = (env: NodeJS.ProcessEnv): Config => {
  const scope = env["GRANOLA_SCOPE"]?.trim();
  const redirectUri = env["GRANOLA_REDIRECT_URI"]?.trim() || DEFAULT_REDIRECT;
  // A plain throw: a process whose sign-in would land somewhere unsafe must not start.
  if (!isSecureUrl(redirectUri)) throw new Error(`GRANOLA_REDIRECT_URI "${redirectUri}" must be an https address, or an http one on a loopback host`);
  return {
    upstreamUrl: env["GRANOLA_MCP_URL"]?.trim() || DEFAULT_UPSTREAM,
    redirectUri,
    ...(scope ? { scope } : {}),
    clientName: "MCP bridge for Granola",
  };
};

export const stateDirFrom = (env: NodeJS.ProcessEnv): string => stateDirOf(env, "granola", "GRANOLA_STATE_DIR");
