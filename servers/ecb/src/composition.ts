import type { Deps } from "./app/ports.js";
import { type EcbOptions, makeEcb } from "./infra/ecb.js";

/** The ECB's calendar: a fixing's date and "today" are Frankfurt dates (CET and CEST), whatever the host's zone. */
export const ECB_TIME_ZONE = "Europe/Berlin";

/**
 * The composition root: the only module naming both a port and what
 * implements it. Nothing here touches the network; the ECB is read when a tool
 * asks.
 */
export const buildDeps = (options: EcbOptions & { readonly now?: () => number } = {}): Deps => {
  const { now = Date.now, ...ecb } = options;
  return { rates: makeEcb(now, ecb), now, timeZone: ECB_TIME_ZONE };
};
