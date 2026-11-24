/**
 * An in-process stand-in for Granola: its MCP server behind a bearer check (the real
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

import { KNOWN_TOOLS as FORWARDED, WITHHELD_TOOLS as WITHHELD } from "../src/domain/tools.js";

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
  readonly behaviour: { refreshStatus?: number | undefined; refuseRefresh: boolean; refreshDelayMs: number; onMcp?: (token: string) => Promise<void> | void; omitRefreshToken: boolean; tokenHost?: string | undefined; redirectToken: boolean };
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
    behaviour: { refuseRefresh: false, refreshDelayMs: 0, omitRefreshToken: false, redirectToken: false },
  };

  const dir = await mkdtemp(join(tmpdir(), "fake-granola-"));
  const innerToken = "inner-token-for-the-fake-0001";
  await writeFile(join(dir, "token"), innerToken);
  const inner = await serve({
    name: "fake-granola",
    version: "1",
    policy: Object.fromEntries([...FORWARDED, ...WITHHELD, "brand_new_tool"].map((name) => [name, { access: "write" as const }])),
    register: (server: McpServer) => {
      server.registerTool(
        "search_meetings",
        {
          description: "Find the user's meetings by query.",
          inputSchema: { query: z.string().describe("What to look for"), limit: z.number().int().min(1).max(100).default(30).describe("Meetings per page") },
        },
        async (args: { query: string; limit: number }) => {
          fake.calls.push({ name: "search_meetings", args });
          return { content: [{ type: "text" as const, text: JSON.stringify({ meetings: [`${args.query} (${String(args.limit)})`] }) }] };
        },
      );
      server.registerTool("get_meeting_transcript", { description: "Verbatim transcript.", inputSchema: { meeting_id: z.string() } }, async (args: { meeting_id: string }) => {
        fake.calls.push({ name: "get_meeting_transcript", args });
        // Odd spacing and quotes on purpose: the bridge must not touch a transcript's text.
        const text = args.meeting_id === "free-plan" ? "Transcripts need a paid plan" : '[00:00:01] Speaker A:  "Hello,   world"\n[00:00:04] Speaker B: caf\u00e9 \u2014 ok';
        return { content: [{ type: "text" as const, text }], isError: args.meeting_id === "free-plan" ? true : undefined } as never;
      });
      for (const name of [...FORWARDED.filter((n) => n !== "search_meetings" && n !== "get_meeting_transcript"), ...WITHHELD, "brand_new_tool"]) {
        server.registerTool(name, { description: `Granola's ${name}.`, inputSchema: {} }, async (args: Record<string, unknown>) => {
          fake.calls.push({ name, args });
          return { content: [{ type: "text" as const, text: `${name} ran` }] };
        });
      }
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
        return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [`${origin}/auth/v1`], scopes_supported: ["mcp"] });
      }
      if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server/auth/v1") {
        return json(res, 200, {
          issuer: `${origin}/auth/v1`,
          authorization_endpoint: `${origin}/auth/v1/oauth/authorize`,
          token_endpoint: `${fake.behaviour.tokenHost === undefined ? origin : origin.replace("127.0.0.1", fake.behaviour.tokenHost)}/auth/v1/oauth/token`,
          registration_endpoint: `${origin}/auth/v1/oauth/clients/register`,
          scopes_supported: ["mcp", "offline_access"],
          grant_types_supported: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      }
      if (req.method === "POST" && url.pathname === "/auth/v1/oauth/clients/register") {
        const registration = JSON.parse(body) as Record<string, unknown>;
        fake.registrations.push(registration);
        // Like Granola, check the authorization-code metadata at registration.
        const redirects = registration["redirect_uris"] as string[] | undefined;
        const grants = registration["grant_types"] as string[] | undefined;
        if (registration["token_endpoint_auth_method"] !== "none" || !grants?.includes("authorization_code") || !redirects?.every((u) => /^http:\/\/127\.0\.0\.1[:/]/.test(u))) {
          return json(res, 400, { error: "invalid_client_metadata" });
        }
        return json(res, 201, { client_id: `client-${fake.registrations.length}` });
      }
      if (req.method === "POST" && url.pathname === "/auth/v1/oauth/token" && fake.behaviour.redirectToken) {
        return json(res, 307, {}, { location: `${origin}/elsewhere` });
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
          json(res, 200, { access_token: access, token_type: "bearer", expires_in: 3600, scope: "mcp offline_access", ...(fake.behaviour.omitRefreshToken ? {} : { refresh_token: refresh }) });
        };
        if (form.get("grant_type") === "authorization_code") {
          const challenge = fake.codes.get(form.get("code") ?? "");
          if (challenge === undefined || sha256url(form.get("code_verifier") ?? "") !== challenge) return json(res, 400, { error: "invalid_grant", error_description: "bad code or verifier" });
          fake.codes.delete(form.get("code") ?? "");
          return issue();
        }
        if (fake.behaviour.refreshDelayMs > 0) await new Promise((r) => setTimeout(r, fake.behaviour.refreshDelayMs));
        if (fake.behaviour.refreshStatus !== undefined) return json(res, fake.behaviour.refreshStatus, { error: "temporarily_unavailable" });
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
