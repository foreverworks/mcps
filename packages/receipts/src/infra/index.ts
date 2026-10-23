/**
 * The adapters every receipts server shares: the store of settled orders, the
 * exports, and the paths, time zone and credentials from the environment. The pacer both
 * apps' APIs need is the kit's (makePacer). The API adapters themselves are
 * each server's own.
 */
export { credentialsReader } from "./credentials.js";
export { makeFiles } from "./files.js";
export { makeOrderStore } from "./orderStore.js";
export { envPrefix, resolvePaths, resolveTimeZone } from "./paths.js";

/**
 * How long an order history (or a page of it) is reused. Every tool starts
 * from it, a new order can land at any time, and five minutes is short enough
 * that "I just ordered, where is it" answers itself by the time anyone asks twice.
 */
export const HISTORY_TTL_MS = 5 * 60_000;
