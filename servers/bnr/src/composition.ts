import type { Deps } from "./app/ports.js";
import { type BnrOptions, makeBnr } from "./infra/bnr.js";

/** BNR's calendar: a fixing's date and "today" are Bucharest dates, whatever the host's zone. */
export const BNR_TIME_ZONE = "Europe/Bucharest";

/**
 * The composition root: the only module naming both a port and what
 * implements it. Nothing here touches the network; BNR is read when a tool
 * asks.
 */
export const buildDeps = (options: BnrOptions & { readonly now?: () => number } = {}): Deps => {
  const { now = Date.now, ...bnr } = options;
  return { rates: makeBnr(now, bnr), now, timeZone: BNR_TIME_ZONE };
};
