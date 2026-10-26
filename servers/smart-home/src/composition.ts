import { randomInt } from "node:crypto";

import { egressFrom } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { makeBlasters } from "./infra/blasters.js";
import { aes } from "./infra/cipher.js";
import { makeCatalogSource } from "./infra/config.js";
import { type Exchange, makeUdpExchange } from "./infra/udp.js";

export type BuildOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly exchange?: Exchange;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
};

/**
 * The composition root: the only module naming both a port and what
 * implements it. Nothing here touches the network: a tool reaches a blaster
 * when it is called, so the server starts and lists its tools with no
 * catalog, and those tools answer with the variable that is missing.
 */
export const buildDeps = (options: BuildOptions = {}): Deps => {
  const env = options.env ?? process.env;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    blasters: makeBlasters({
      exchange: options.exchange ?? makeUdpExchange(egressFrom(env)),
      cipher: aes,
      now: options.now ?? Date.now,
      sleep,
      random: options.random ?? (() => randomInt(0, 0x8000) / 0x8000),
    }),
    catalog: makeCatalogSource(env),
    sleep,
  };
};
