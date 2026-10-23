/**
 * Shared test plumbing: a state dir in a temp folder, a clock tests move, and
 * the server connected through the kit's guard to an in-memory client, over a
 * fake SPV and fake mail and vault servers. The isolation setup refuses every
 * other request; nothing reaches a real account.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";

import type { DukPort } from "../src/app/ports.js";
import { buildDeps } from "../src/composition.js";
import { asAppError } from "../src/domain/errors.js";
import type { TransportFor } from "../src/infra/upstream/mcp.js";
import { vocabulary } from "../src/mcp/envelope.js";
import { policyFor } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

export const stateDir = (): string => mkdtempSync(join(tmpdir(), "anaf-spv-state-"));

/** A clock that moves only when the server sleeps (or a test says so). 2026-10-12 12:00 UTC. */
export const makeClock = (start = Date.UTC(2026, 9, 12, 12, 0, 0)) => {
  const clock = { t: start };
  return { clock, now: () => clock.t, sleep: async (ms: number) => void (clock.t += ms) };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

export type World = {
  readonly env: NodeJS.ProcessEnv;
  readonly fetch: typeof fetch;
  readonly transportFor?: TransportFor;
  readonly clock: ReturnType<typeof makeClock>;
  readonly duk?: DukPort;
};

export const connected = async (world: World) => {
  const { deps, stop } = buildDeps(world.env, {
    fetch: world.fetch,
    ...(world.transportFor === undefined ? {} : { transportFor: world.transportFor }),
    now: world.clock.now,
    sleep: world.clock.sleep,
    pollMs: 2_000,
    ...(world.duk === undefined ? {} : { duk: world.duk }),
  });
  const server = new McpServer({ name: "anaf-spv", version: "test" });
  registerAll(guard(server, { service: "anaf-spv", policy: policyFor(deps), log: () => undefined, vocabulary }), deps);
  const client = await connectInMemory(server);
  return {
    call: async (name: string, args: Record<string, unknown> = {}) => parse(await client.callTool({ name, arguments: args })),
    client,
    deps,
    close: async () => {
      stop();
      await client.close();
    },
  };
};

export const errorOf = async (run: () => unknown) => {
  try {
    await run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};
