import type { Deps } from "./app/ports.js";
import { confirmDomainsFrom } from "./domain/actions.js";
import { fail } from "./domain/errors.js";
import { makeConnection } from "./infra/connection.js";
import { makeHomeAssistant } from "./infra/homeAssistant.js";
import { makeRest, type RestOptions } from "./infra/rest.js";
import { makeSocket, type OpenSocket, openNodeSocket } from "./infra/socket.js";

export type BuildOptions = RestOptions & {
  readonly env?: NodeJS.ProcessEnv;
  readonly openSocket?: OpenSocket;
  readonly socketTimeoutMs?: number;
  readonly now?: () => number;
};

/**
 * The composition root: the only module naming both a port and what
 * implements it. Nothing here reads a setting or touches the network: every
 * call reads HOME_ASSISTANT_URL, the token and HOME_ASSISTANT_CONFIRM_DOMAINS
 * again, so the server starts and lists its tools with none of them, and a
 * corrected setting takes effect on the next call.
 */
export const buildDeps = (options: BuildOptions = {}): Deps => {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const connection = makeConnection(env, now);
  const rest = makeRest(connection, options);
  const socket = makeSocket(connection, options.openSocket ?? openNodeSocket, options.socketTimeoutMs);
  return {
    ha: makeHomeAssistant(rest, socket),
    instance: () => ({ url: connection.base().toString().replace(/\/$/, "") }),
    confirmDomains: () => {
      const parsed = confirmDomainsFrom(env["HOME_ASSISTANT_CONFIRM_DOMAINS"]);
      return "problem" in parsed ? fail({ kind: "config", variable: "HOME_ASSISTANT_CONFIRM_DOMAINS", message: `HOME_ASSISTANT_CONFIRM_DOMAINS: ${parsed.problem}` }) : parsed.domains;
    },
    now,
  };
};
