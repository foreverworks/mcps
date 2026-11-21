import { stateDirOf } from "@foreverworks/mcp-kit";

import type { Config } from "../app/ports.js";

export const DEFAULT_UPSTREAM = "https://api.mobbin.com/mcp";
/** A loopback address nothing needs to listen on: the browser lands there and the person copies the address. */
export const DEFAULT_REDIRECT = "http://127.0.0.1:8976/callback";

export const configFrom = (env: NodeJS.ProcessEnv): Config => {
  const scope = env["MOBBIN_SCOPE"]?.trim();
  return {
    upstreamUrl: env["MOBBIN_MCP_URL"]?.trim() || DEFAULT_UPSTREAM,
    redirectUri: env["MOBBIN_REDIRECT_URI"]?.trim() || DEFAULT_REDIRECT,
    ...(scope ? { scope } : {}),
    clientName: "MCP bridge for Mobbin",
  };
};

export const stateDirFrom = (env: NodeJS.ProcessEnv): string => stateDirOf(env, "mobbin", "MOBBIN_STATE_DIR");
