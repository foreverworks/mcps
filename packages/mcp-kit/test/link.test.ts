import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpServer, type ProtocolEra } from "@modelcontextprotocol/server";

import { describe, expect, it } from "vitest";

import { offerLink } from "../src/call.js";
import { makeHandled } from "../src/envelope.js";
import { makeErrorKit } from "../src/errors.js";
import type { ToolPolicy } from "../src/policy.js";
import { guard } from "../src/serve/guard.js";
import { answeredResult, LINK_ANSWER_KEY } from "../src/serve/link.js";
import { MCP_PATH, serve } from "../src/serve.js";
import { connectInMemory, elicitingClient, type ElicitAnswer, type Elicited, testClient } from "../src/smoke.js";

type E = { kind: "refused"; message: string };
const kit = makeErrorKit<E>("link-test");
const handled = makeHandled<E>({ asAppError: kit.asAppError, remedyFor: () => "begin again" });

const URL_ = "https://sign-in.example/authorize?state=s1&code_challenge=c1";
const LINK = { url: URL_, message: "Sign in as ana@example.com to grant mail.", next: "ask the user for the address the browser lands on; pass it to complete_it" };
const BEGUN = { url: URL_, expires_at: "2026-10-22T12:15:00.000Z", next: "give the user the url; pass the address it lands on to complete_it" };

const policy: ToolPolicy = { begin_it: { access: "write" }, begin_badly: { access: "write" }, read_it: { access: "read" } };
const begins: string[] = [];
const register = (server: McpServer): void => {
  server.registerTool(
    "begin_it",
    { description: "begins", inputSchema: {} },
    handled(async () => {
      begins.push("begun");
      offerLink(LINK);
      return BEGUN;
    }),
  );
  server.registerTool(
    "begin_badly",
    { description: "begins, then fails", inputSchema: {} },
    handled(async () => {
      offerLink(LINK);
      return kit.fail({ kind: "refused", message: "no" });
    }),
  );
  server.registerTool("read_it", { description: "reads", inputSchema: {} }, handled(async () => ({ read: true })));
};

type Answer = ElicitAnswer["action"] | "throw";
type Elicitation = { readonly form?: Record<string, never>; readonly url?: Record<string, never> };

/** A client of `era` over an in-memory pair (as stdio is: one client, requests both ways), answering every elicitation with `answer`. */
const connect = async (era: ProtocolEra, { elicitation, answer = "accept", midCall }: { elicitation?: Elicitation; answer?: Answer; midCall?: boolean } = {}) => {
  const lines: string[] = [];
  begins.length = 0;
  const make = () => {
    const server = new McpServer({ name: "t", version: "0" });
    register(guard(server, { service: "svc", policy, log: (l) => lines.push(l), ...(midCall === undefined ? {} : { midCall }) }));
    return server;
  };
  const { client, asked } =
    elicitation === undefined
      ? { client: testClient("c", era), asked: [] as Elicited[] }
      : elicitingClient(
          "c",
          () => {
            if (answer === "throw") throw new Error("the client could not show it");
            return { action: answer };
          },
          elicitation,
          era,
        );
  await connectInMemory(make, client);
  const audit = () => lines.map((l) => JSON.parse(l.replace(/^audit /, "")) as Record<string, unknown>);
  return { client, asked, audit };
};

const json = (result: unknown) => JSON.parse((result as { content: [{ text: string }] }).content[0].text) as Record<string, unknown>;

describe.each(["legacy", "modern"] as const)("a link a call hands a person, protocol %s", (era) => {
  it("is offered by a client that can, with the whole URL and the call's line, and leaves the result once accepted", async () => {
    const { client, asked, audit } = await connect(era, { elicitation: { form: {}, url: {} } });
    const result = await client.callTool({ name: "begin_it", arguments: {} });
    expect(asked).toEqual([expect.objectContaining({ mode: "url", message: LINK.message, url: URL_ })]);
    expect(result.isError).toBeUndefined();
    expect(json(result)).toEqual({ expires_at: BEGUN.expires_at, [LINK_ANSWER_KEY]: "accept", next: LINK.next });
    expect(begins).toEqual(["begun"]);
    expect(audit()).toEqual([
      expect.objectContaining({ tool: "begin_it", outcome: "asked", asked: "link" }),
      expect.objectContaining({ tool: "begin_it", outcome: "ok", link: "accept" }),
    ]);
  });

  it("stays in the result when the person declines or cancels, which the result says", async () => {
    for (const answer of ["decline", "cancel"] as const) {
      const { client, audit } = await connect(era, { elicitation: { url: {} }, answer });
      const result = await client.callTool({ name: "begin_it", arguments: {} });
      expect(json(result)).toEqual({ url: URL_, expires_at: BEGUN.expires_at, [LINK_ANSWER_KEY]: answer, next: BEGUN.next });
      expect(audit()[1]).toMatchObject({ outcome: "ok", link: answer });
    }
  });

  it("is not offered by a client without URL elicitation: the result carries it, as before", async () => {
    for (const elicitation of [undefined, {}, { form: {} }]) {
      const { client, asked, audit } = await connect(era, elicitation === undefined ? {} : { elicitation });
      expect(json(await client.callTool({ name: "begin_it", arguments: {} }))).toEqual(BEGUN);
      expect(asked).toEqual([]);
      expect(audit()).toEqual([expect.objectContaining({ outcome: "ok", link: "unsupported" })]);
    }
  });

  it("is not offered where no question can reach the client mid-call, whatever it declares", async () => {
    const { client, asked } = await connect(era, { elicitation: { url: {} }, midCall: false });
    expect(json(await client.callTool({ name: "begin_it", arguments: {} }))).toEqual(BEGUN);
    expect(asked).toEqual([]);
  });

  it("is never offered by a call that failed, and a call that offers none is untouched", async () => {
    const { client, asked, audit } = await connect(era, { elicitation: { url: {} } });
    expect((await client.callTool({ name: "begin_badly", arguments: {} })).isError).toBe(true);
    expect(json(await client.callTool({ name: "read_it", arguments: {} }))).toEqual({ read: true });
    expect(asked).toEqual([]);
    expect(audit().map((l) => l["link"])).toEqual([undefined, undefined]);
  });
});

describe("a link the client fails to show", () => {
  it("ends the call with the SDK's failure, once: the sign-in it began stays open for the next begin to replace", async () => {
    const { client, audit } = await connect("legacy", { elicitation: { url: {} }, answer: "throw" });
    const result = await client.callTool({ name: "begin_it", arguments: {} });
    expect(result.isError).toBe(true);
    expect(begins).toEqual(["begun"]);
    expect(audit()).toEqual([expect.objectContaining({ outcome: "asked", asked: "link" })]);
  });
});

describe("answeredResult", () => {
  const begun = { content: [{ type: "text", text: JSON.stringify(BEGUN) }] };

  it("keeps what follows the JSON, such as the links to saved files", () => {
    const withFile = { content: [...begun.content, { type: "resource_link", uri: "file:///outbox/a.pdf", name: "a.pdf" }] };
    expect((answeredResult(withFile, LINK, "accept") as { content: unknown[] }).content.slice(1)).toEqual(withFile.content.slice(1));
  });

  it("leaves a failure, a result that is not one JSON object, and an accepted link the result never named", () => {
    const failed = { ...begun, isError: true };
    const list = { content: [{ type: "text", text: "[1,2]" }] };
    expect(answeredResult(failed, LINK, "accept")).toBe(failed);
    expect(answeredResult(list, LINK, "accept")).toBe(list);
    const other = { content: [{ type: "text", text: JSON.stringify({ page: "https://elsewhere.example", next: "x" }) }] };
    expect(json(answeredResult(other, LINK, "accept"))).toEqual({ page: "https://elsewhere.example", [LINK_ANSWER_KEY]: "accept", next: LINK.next });
  });
});

describe("a link over HTTP", () => {
  const httpServe = async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-link-"));
    const tokenFile = join(dir, "token");
    const token = "link-test-token-0123456789";
    await writeFile(tokenFile, `${token}\n`);
    const lines: string[] = [];
    const served = await serve({ name: "t", version: "0", register, policy, env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: tokenFile }, log: (l) => lines.push(l) });
    const url = new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`);
    const transport = () => new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } });
    return { served, transport, audit: () => lines.map((l) => JSON.parse(l.replace(/^audit /, "")) as Record<string, unknown>) };
  };

  it("is offered to a 2026-07-28 client: the question is the call's result, and the retry brings the answer", async () => {
    const { served, transport, audit } = await httpServe();
    try {
      const { client, asked } = elicitingClient("c", () => ({ action: "accept" }), { url: {} }, "modern");
      await client.connect(transport());
      begins.length = 0;
      expect(json(await client.callTool({ name: "begin_it", arguments: {} }))).toEqual({ expires_at: BEGUN.expires_at, [LINK_ANSWER_KEY]: "accept", next: LINK.next });
      expect(asked).toEqual([expect.objectContaining({ mode: "url", url: URL_ })]);
      expect(begins).toEqual(["begun"]);
      expect(audit().map((l) => [l["outcome"], l["link"] ?? l["asked"]])).toEqual([
        ["asked", "link"],
        ["ok", "accept"],
      ]);
      await client.close();
    } finally {
      await served.close();
    }
  });

  it("is never offered to a 2025-11-25 client: its stateless transport cannot carry the question back", async () => {
    const { served, transport, audit } = await httpServe();
    try {
      const { client, asked } = elicitingClient("c", () => ({ action: "accept" }), { url: {} });
      await client.connect(transport());
      expect(json(await client.callTool({ name: "begin_it", arguments: {} }))).toEqual(BEGUN);
      expect(asked).toEqual([]);
      expect(audit()).toEqual([expect.objectContaining({ tool: "begin_it", link: "unsupported" })]);
      await client.close();
    } finally {
      await served.close();
    }
  });
});
