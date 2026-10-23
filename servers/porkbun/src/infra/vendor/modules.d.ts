/**
 * `@porkbunllc/mcp-server` ships JavaScript without type declarations. Rather
 * than claim a shape by hand, every export this server uses is declared
 * `unknown` here and PARSED in `vendor.ts`, so a version that changes a shape
 * fails at startup (and in the tests) instead of misbehaving.
 */
declare module "@porkbunllc/mcp-server/dist/tools.js" {
  export const tools: unknown;
  export const FUNDING_LOCAL: unknown;
  export const PAY_WITH_USDC_NOTE: unknown;
  export const PAY_DIRECT_OPENING: unknown;
  export const PAY_DIRECT_PARAMS: unknown;
}

declare module "@porkbunllc/mcp-server/dist/api.js" {
  export const loadConfig: unknown;
}

declare module "@porkbunllc/mcp-server/dist/server.js" {
  export const BASE_INSTRUCTIONS: unknown;
  export const SERVER_VERSION: unknown;
}

declare module "@porkbunllc/mcp-server/dist/profiles.js" {
  export const PROFILES: unknown;
  export const redact: unknown;
}
