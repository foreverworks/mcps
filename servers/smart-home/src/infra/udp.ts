import { createSocket } from "node:dgram";
import { lookup } from "node:dns/promises";

import { hostAllowed } from "@foreverworks/mcp-kit";

import { fail } from "../domain/errors.js";
import { CONFIG_VARIABLE } from "./config.js";

/**
 * One request and its answer over UDP: send, wait, send again while the plan
 * allows, and keep only a datagram from the device's own address that the
 * caller recognises as the answer. A fresh socket per exchange, so an answer
 * that arrives late cannot be read as the next request's.
 */

export type Plan = {
  /** How long to wait for an answer after each send. */
  readonly waitMs: number;
  /** Sends in all: 1 for a request that must not happen twice (an IR code), more for one that may. */
  readonly attempts: number;
  readonly accept: (reply: Uint8Array) => boolean;
};

export type Outcome = { readonly reply: Uint8Array } | { readonly reply?: undefined; readonly why: string };

export type Exchange = (to: { readonly host: string; readonly port: number }, packet: Uint8Array, plan: Plan) => Promise<Outcome>;

/** `egress`: MCP_EGRESS_ALLOW's hosts, applied here as the kit applies them to every fetch; undefined, no limit. */
export const makeUdpExchange =
  (egress: readonly string[] | undefined): Exchange =>
  async (to, packet, plan) => {
    if (egress !== undefined && !hostAllowed(to.host, egress)) {
      fail({ kind: "config", variable: "MCP_EGRESS_ALLOW", message: `egress to ${to.host} is not allowed for this server (MCP_EGRESS_ALLOW)` });
    }
    const address = await lookup(to.host, { family: 4 }).then(
      (a) => a.address,
      () => fail({ kind: "config", variable: CONFIG_VARIABLE, message: `the blaster's host ${to.host} does not resolve to an IPv4 address` }),
    );
    return new Promise<Outcome>((resolve) => {
      const socket = createSocket("udp4");
      let sent = 0;
      let timer: NodeJS.Timeout | undefined;
      let done = false;
      const finish = (outcome: Outcome): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(outcome);
      };
      socket.on("message", (message, from) => {
        const reply = new Uint8Array(message);
        if (from.address === address && plan.accept(reply)) finish({ reply });
      });
      socket.on("error", (error: NodeJS.ErrnoException) => finish({ why: `the network refused the datagram (${error.code ?? error.message})` }));
      const send = (): void => {
        sent += 1;
        socket.send(packet, to.port, address, (error) => {
          if (error) finish({ why: `the datagram could not be sent (${(error as NodeJS.ErrnoException).code ?? error.message})` });
        });
        timer = setTimeout(() => (sent < plan.attempts ? send() : finish({ why: `no answer from ${address} in ${(plan.waitMs * plan.attempts) / 1000} s` })), plan.waitMs);
      };
      socket.bind(0, send);
    });
  };
