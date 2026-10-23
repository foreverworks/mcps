import { localMoment } from "@foreverworks/receipts/domain";

import { daysLeft, EXPIRY_WARNING_DAYS } from "../../domain/token.js";
import type { Deps } from "../ports.js";

/**
 * Is this alive, as whom, and for how long.
 *
 * `probe` mints a real access token, so a refused refresh token fails HERE with
 * its remedy rather than surfacing later as an empty order list.
 */
export const checkHealth = async (deps: Deps) => {
  const facts = await deps.tokenFacts();
  const { accessExpiresAt } = await deps.bolt.probe();
  const history = await deps.bolt.history();
  const latest = history[0];
  const left = daysLeft(facts, deps.now());

  return {
    ok: true,
    userId: facts.userId,
    refreshTokenExpiresAt: facts.expiresAt === undefined ? undefined : new Date(facts.expiresAt * 1000).toISOString(),
    refreshTokenDaysLeft: left,
    refreshTokenExpiringSoon: left !== undefined && left < EXPIRY_WARNING_DAYS,
    accessTokenExpiresAt: new Date(accessExpiresAt * 1000).toISOString(),
    orders: history.length,
    latestOrder: latest
      ? { orderId: latest.order_id, localDate: localMoment(latest.order_created_timestamp * 1000, deps.timeZone).date, state: latest.order_state }
      : undefined,
    storedOrderDetails: await deps.store.count(),
    credentialsPath: deps.paths.credentials.path,
    stateDir: deps.paths.stateDir,
    timeZone: deps.timeZone,
  };
};
