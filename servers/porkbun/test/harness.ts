import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { confirmingClient, guard, type GuardSettings, InMemoryTransport, McpServer, type Transport } from "@foreverworks/mcp-kit";
import { vi } from "vitest";

import { buildDeps } from "../src/composition.js";
import { policyFor } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { loadToolsets } from "../src/mcp/toolsets.js";

/** Fake keys in a temp dir: nothing here reads a real credential. */
export const FAKE_KEY = "pk1_fake_0123456789abcdef";
export const FAKE_SECRET = "sk1_fake_fedcba9876543210";

export const keyFiles = (): { readonly PORKBUN_API_KEY_FILE: string; readonly PORKBUN_SECRET_API_KEY_FILE: string } => {
  const dir = mkdtempSync(join(tmpdir(), "porkbun-keys-"));
  writeFileSync(join(dir, "api-key"), `${FAKE_KEY}\n`);
  writeFileSync(join(dir, "secret-api-key"), `${FAKE_SECRET}\n`);
  return { PORKBUN_API_KEY_FILE: join(dir, "api-key"), PORKBUN_SECRET_API_KEY_FILE: join(dir, "secret-api-key") };
};

export type Sent = { readonly url: string; readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body: unknown };

/** A fetch that answers from `route` and records every request; installed as the global the vendor calls. */
export const stubFetch = (route: (url: string, method: string) => Response | Promise<Response>): Sent[] => {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    sent.push({ url, method, headers: { ...(init?.headers as Record<string, string> | undefined) }, body });
    return route(url, method);
  });
  return sent;
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Result = { readonly isError?: boolean; readonly content: readonly { readonly type: string; readonly text: string }[] };

/** The server confirms money calls with the user here (MCP_CONFIRM=elicit), so a test sees the line the user reads. */
export const CONFIRMING: GuardSettings = { maxAccess: "money", confirm: "elicit" };

/**
 * The server as `serve` builds it (the kit's guard around our registration), on an in-memory transport,
 * with a client that answers each confirmation with `answer` and records the lines it was shown.
 * PORKBUN_TOOLSETS in `env` loads those toolsets, as in index.ts.
 */
export const connect = async (env: NodeJS.ProcessEnv, settings: GuardSettings = CONFIRMING, answer: (line: string) => boolean = () => true) => {
  const deps = buildDeps(env);
  const { policy } = loadToolsets(policyFor(deps.porkbun.catalog), env);
  const audit: string[] = [];
  const server = new McpServer({ name: "porkbun", version: "test" });
  registerAll(guard(server, { service: "porkbun", policy, settings, log: (line) => audit.push(line) }), deps, policy);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide as Transport);
  const { client, asked } = confirmingClient("test", answer);
  await client.connect(clientSide as Transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as Result;
    const text = result.content[0]?.text ?? "";
    return { isError: result.isError === true, text, value: JSON.parse(text) as Record<string, unknown> };
  };
  return { client, call, audit, asked };
};
