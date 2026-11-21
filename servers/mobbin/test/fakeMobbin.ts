/**
 * An in-process stand-in for Mobbin: its MCP server behind a bearer check (the real
 * thing is the kit's own server, so the protocol is the real protocol), and the
 * authorization server it points at, with dynamic registration and a token endpoint
 * that rotates refresh tokens and checks PKCE. Everything on one loopback origin.
 */
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve, type McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

export type Fake = {
  readonly origin: string;
  readonly mcpUrl: string;
  /** Access tokens the MCP endpoint accepts. */
  readonly validAccess: Set<string>;
  /** Refresh tokens the token endpoint accepts. */
  readonly validRefresh: Set<string>;
  /** code -> the PKCE challenge it was issued under. */
  readonly codes: Map<string, string>;
  readonly registrations: unknown[];
  readonly tokenRequests: URLSearchParams[];
  /** Bearer tokens seen on tools/call requests, in order. */
  readonly callTokens: string[];
  readonly calls: { readonly name: string; readonly args: unknown }[];
  readonly behaviour: { refuseRefresh: boolean; refreshDelayMs: number; onMcp?: (token: string) => Promise<void> | void; omitRefreshToken: boolean };
  readonly close: () => Promise<void>;
};

const sha256url = (value: string): string => createHash("sha256").update(value).digest("base64url");

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
};

export const startFake = async (): Promise<Fake> => {
  const state = { counter: 0 };
  const fake: Omit<Fake, "origin" | "mcpUrl" | "close"> = {
    validAccess: new Set(),
    validRefresh: new Set(),
    codes: new Map(),
    registrations: [],
    tokenRequests: [],
    callTokens: [],
    calls: [],
    behaviour: { refuseRefresh: false, refreshDelayMs: 0, omitRefreshToken: false },
  };

  const dir = await mkdtemp(join(tmpdir(), "fake-mobbin-"));
  const innerToken = "inner-token-for-the-fake-0001";
  await writeFile(join(dir, "token"), innerToken);
  const inner = await serve({
    name: "fake-mobbin",
    version: "1",
    policy: { search_screens: { access: "read" }, search_flows: { access: "read" }, search_sections: { access: "read" }, delete_everything: { access: "write" } },
    register: (server: McpServer) => {
      server.registerTool(
        "search_screens",
        {
          description: "Find screens in Mobbin's library.",
          inputSchema: { query: z.string().describe("What to look for"), mode: z.enum(["standard", "deep"]).default("standard").describe("deep spends AI credits") },
        },
        async (args: { query: string; mode: string }) => {
          fake.calls.push({ name: "search_screens", args });
          return { content: [{ type: "text" as const, text: JSON.stringify({ screens: [`${args.query} (${args.mode})`] }) }] };
        },
      );
      for (const name of ["search_flows", "search_sections"]) {
        server.registerTool(name, { description: `Find ${name.slice(7)}.`, inputSchema: { query: z.string() } }, async (args: { query: string }) => {
          fake.calls.push({ name, args });
          return { content: [{ type: "text" as const, text: `${name}: ${args.query}` }], isError: args.query === "boom" ? true : undefined } as never;
        });
      }
      server.registerTool("delete_everything", { description: "Not classified by the bridge.", inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: "gone" }] }));
    },
    env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: join(dir, "token") },
    log: () => undefined,
  });

  let origin = "";
  const http = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://x");
      const body = await readBody(req);
      if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [`${origin}/auth/v1`], scopes_supported: ["openid"] });
      }
      if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server/auth/v1") {
        return json(res, 200, {
          issuer: `${origin}/auth/v1`,
          authorization_endpoint: `${origin}/auth/v1/oauth/authorize`,
          token_endpoint: `${origin}/auth/v1/oauth/token`,
          registration_endpoint: `${origin}/auth/v1/oauth/clients/register`,
          scopes_supported: ["openid", "profile", "email", "offline_access"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      }
      if (req.method === "POST" && url.pathname === "/auth/v1/oauth/clients/register") {
        fake.registrations.push(JSON.parse(body));
        return json(res, 201, { client_id: `client-${fake.registrations.length}` });
      }
      if (req.method === "POST" && url.pathname === "/auth/v1/oauth/token") {
        const form = new URLSearchParams(body);
        fake.tokenRequests.push(form);
        const issue = (): void => {
          state.counter += 1;
          const access = `access-${state.counter}`;
          const refresh = `refresh-${state.counter}`;
          fake.validAccess.add(access);
          fake.validRefresh.add(refresh);
          json(res, 200, { access_token: access, token_type: "bearer", expires_in: 3600, scope: "openid offline_access", ...(fake.behaviour.omitRefreshToken ? {} : { refresh_token: refresh }) });
        };
        if (form.get("grant_type") === "authorization_code") {
          const challenge = fake.codes.get(form.get("code") ?? "");
          if (challenge === undefined || sha256url(form.get("code_verifier") ?? "") !== challenge) return json(res, 400, { error: "invalid_grant", error_description: "bad code or verifier" });
          fake.codes.delete(form.get("code") ?? "");
          return issue();
        }
        if (fake.behaviour.refreshDelayMs > 0) await new Promise((r) => setTimeout(r, fake.behaviour.refreshDelayMs));
        const presented = form.get("refresh_token") ?? "";
        if (fake.behaviour.refuseRefresh || !fake.validRefresh.has(presented)) return json(res, 400, { error: "invalid_grant", error_description: "refresh token is not valid" });
        fake.validRefresh.delete(presented);
        return issue();
      }
      if (url.pathname === "/mcp") {
        const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (!fake.validAccess.has(token)) {
          return json(res, 401, { error: "unauthorized" }, { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
        }
        await fake.behaviour.onMcp?.(token);
        if (body.includes('"tools/call"')) fake.callTokens.push(token);
        const forwarded = await fetch(`http://127.0.0.1:${String(inner.port)}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${innerToken}`, "content-type": "application/json", accept: req.headers.accept ?? "application/json" },
          body,
        });
        res.writeHead(forwarded.status, { "content-type": forwarded.headers.get("content-type") ?? "application/json" }).end(await forwarded.text());
        return;
      }
      json(res, 404, { error: "not found" });
    })().catch(() => {
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
  return {
    ...fake,
    origin,
    mcpUrl: `${origin}/mcp`,
    close: async () => {
      await inner.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
};
