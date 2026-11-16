/**
 * The global `fetch`, looked up at every call.
 *
 * Hold this wherever a fetch is kept as a value (a default, an option, a field
 * of an adapter), never `fetch` itself. A server builds its dependencies before
 * `serve` replaces `globalThis.fetch` with the one that enforces
 * MCP_EGRESS_ALLOW, so a reference to `fetch` taken while building is the
 * unwrapped function, and its requests are never checked against the list.
 * This one reads the global when a request is made, so it is always the
 * function in force: the egress guard in production, a test's stub in a test.
 */
export const liveFetch: typeof fetch = (input, init) => fetch(input, init);
