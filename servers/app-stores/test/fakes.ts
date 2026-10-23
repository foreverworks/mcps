/**
 * Shared test plumbing: invented credentials (a P-256 key standing in for an
 * App Store Connect .p8, an RSA key in a service account JSON, both made for
 * the run and written to a temp dir), a fetch that answers both stores from a
 * script, and the server through the kit's guard. No real account, no network.
 */
import { generateKeyPairSync, type KeyObject, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";

import { buildDeps } from "../src/composition.js";
import { asAppError, remedyFor } from "../src/domain/errors.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

export const KEY_ID = "ABCDE12345";
export const ISSUER = "6f1c2a9e-0b3d-4c5e-8f70-1a2b3c4d5e6f";
export const SA_EMAIL = "reviews-reader@example-project.iam.gserviceaccount.com";
export const PACKAGE = "com.example.habits";
export const NOW = 1_790_000_000;

/** Fresh invented credentials in files, and the environment that names them. */
export const credentials = () => {
  const dir = mkdtempSync(join(tmpdir(), "app-stores-"));
  const asc = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const sa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(join(dir, "AuthKey.p8"), asc.privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(
    join(dir, "service-account.json"),
    JSON.stringify({
      type: "service_account",
      project_id: "example-project",
      private_key_id: "0123456789abcdef0123456789abcdef01234567",
      private_key: sa.privateKey.export({ type: "pkcs8", format: "pem" }),
      client_email: SA_EMAIL,
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  );
  const env: NodeJS.ProcessEnv = {
    ASC_KEY_ID: KEY_ID,
    ASC_ISSUER_ID: ISSUER,
    ASC_PRIVATE_KEY_FILE: join(dir, "AuthKey.p8"),
    PLAY_SERVICE_ACCOUNT_FILE: join(dir, "service-account.json"),
    PLAY_PACKAGES: PACKAGE,
    APP_STORES_OUTBOX_DIR: join(dir, "outbox"),
  };
  return { env, dir, ascPublic: asc.publicKey, saPublic: sa.publicKey };
};

/** A JWT's parts, and whether `key` signed it. */
export const decodeJwt = (jwt: string, key: KeyObject, alg: "ES256" | "RS256") => {
  const [h, c, s] = jwt.split(".") as [string, string, string];
  const json = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;
  const signed = verify("sha256", Buffer.from(`${h}.${c}`), alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key, Buffer.from(s, "base64url"));
  return { header: json(h), claims: json(c), signed };
};

export type Asked = { readonly url: URL; readonly method: string; readonly headers: Record<string, string>; readonly body: string | undefined };

export type Answer = { readonly status?: number; readonly json?: unknown } | "drop";

/** A fetch that answers from `route` and records every request. */
export const stores = (route: (asked: Asked) => Answer) => {
  const asked: Asked[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
    const one: Asked = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    asked.push(one);
    const answer = route(one);
    if (answer === "drop") throw new TypeError("fetch failed: socket hang up");
    return new Response(JSON.stringify(answer.json ?? {}), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
};

/** Google's token endpoint, granting an hour. */
export const TOKEN_ANSWER = { json: { access_token: "ya29.invented-token", expires_in: 3599, token_type: "Bearer" } };

/** The server through the guard, as a client sees it. */
export const connected = async (env: NodeJS.ProcessEnv, fetch: typeof globalThis.fetch) => {
  const deps = buildDeps(env, { fetch, sleep: async () => undefined, nowEpoch: () => NOW });
  const server = new McpServer({ name: "app-stores", version: "test" });
  registerAll(guard(server, { service: "app-stores", policy: POLICY, log: () => undefined, vocabulary: { asAppError, remedyFor } }), deps);
  const client = await connectInMemory(server);
  const raw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => JSON.parse(((await raw(name, args)) as { content: { text: string }[] }).content[0]?.text ?? "{}");
  return { call, raw, client };
};

// ---- invented store data -------------------------------------------------------------------------

export const APPS = { data: [{ type: "apps", id: "1234567890", attributes: { name: "Habits", bundleId: "com.example.habits" } }], links: { self: "x" } };

export const ascReview = (id: string, over: Record<string, unknown> = {}, response?: string) => ({
  type: "customerReviews",
  id,
  attributes: { rating: 2, title: "Lost my streak", body: "The streak reset after the update.", reviewerNickname: "ana.p", createdDate: "2026-10-20T08:15:00-07:00", territory: "ROU", ...over },
  relationships: { response: { data: response === undefined ? null : { type: "customerReviewResponses", id: response } } },
});

export const ascResponse = (id: string, text: string, state = "PUBLISHED") => ({
  type: "customerReviewResponses",
  id,
  attributes: { responseBody: text, lastModifiedDate: "2026-10-21T10:00:00-07:00", state },
});

export const playReview = (id: string, reply?: string) => ({
  reviewId: id,
  authorName: "Ion Ionescu",
  comments: [
    {
      userComment: {
        text: "\tReminders stopped after the update",
        lastModified: { seconds: "1790000000", nanos: 0 },
        starRating: 1,
        reviewerLanguage: "ro",
        device: "a52q",
        androidOsVersion: 34,
        appVersionName: "1.4.0",
      },
    },
    ...(reply === undefined ? [] : [{ developerComment: { text: reply, lastModified: { seconds: "1790003600", nanos: 0 } } }]),
  ],
});
