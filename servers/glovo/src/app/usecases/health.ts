import type { Deps } from "../ports.js";
import { receiptFor } from "./details.js";

/**
 * Is this alive, and as whom.
 *
 * `probe` mints a real access token, so a refused refresh token fails HERE with
 * its remedy rather than surfacing later as an empty order list. Then one page
 * of history and one detail call for the newest order, which proves both
 * endpoints the tools depend on. No order count: the history is 15 orders a
 * page, so counting a long history (1,000 orders is ~67 paced calls) is not a
 * health check.
 * No expiry either: Glovo's refresh token states none.
 */
export const checkHealth = async (deps: Deps) => {
  const facts = await deps.tokenFacts();
  const { accessExpiresAt } = await deps.glovo.probe();
  const page = await deps.glovo.historyPage(undefined);
  const newest = page.orders[0];
  const latest = newest ? await receiptFor(deps, newest.orderId) : undefined;

  return {
    ok: true,
    userId: facts.userId,
    accessTokenExpiresAt: new Date(accessExpiresAt * 1000).toISOString(),
    firstPageOrders: page.orders.length,
    moreHistory: page.next !== undefined,
    latestOrder: latest
      ? { orderId: latest.orderId, store: latest.store, state: latest.state, localDate: latest.localDate, total: latest.total }
      : undefined,
    storedOrderDetails: await deps.store.count(),
    credentialsPath: deps.paths.credentials.path,
    stateDir: deps.paths.stateDir,
    timeZone: deps.timeZone,
  };
};
