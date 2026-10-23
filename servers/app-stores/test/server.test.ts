/**
 * The server as a client sees it, through the kit's guard, against a scripted
 * App Store Connect and Google Play: the tokens each store gets, the requests
 * each tool sends, the answers it gives, and the reply rules (no public reply
 * replaced unasked, the same reply twice sent once).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { checkPolicy, idempotentWrites } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { APPS, type Asked, ascResponse, ascReview, connected, credentials, decodeJwt, ISSUER, KEY_ID, NOW, PACKAGE, playReview, SA_EMAIL, stores, TOKEN_ANSWER } from "./fakes.js";

const ASC = "api.appstoreconnect.apple.com";
const PLAY = "androidpublisher.googleapis.com";
const isToken = (a: Asked) => a.url.host === "oauth2.googleapis.com";

describe("the app-stores server", () => {
  it("classifies every tool, declares both replies idempotent, and has no money tool", () => {
    expect(() => checkPolicy("app-stores", (s) => registerAll(s, buildDeps({})), POLICY)).not.toThrow();
    expect(idempotentWrites(POLICY)).toEqual(["reply_app_store_review", "reply_play_review"]);
    expect(Object.values(POLICY).some((p) => p.access === "money")).toBe(false);
  });

  it("is healthy without credentials, saying each store is not configured", async () => {
    const { fetch, asked } = stores(() => ({ status: 500 }));
    const out = await (await connected({}, fetch)).call("health");
    expect(out).toMatchObject({ ok: true, appStore: { configured: false, message: expect.stringContaining("ASC_KEY_ID") }, play: { configured: false, message: expect.stringContaining("PLAY_SERVICE_ACCOUNT_FILE") } });
    expect(asked).toEqual([]);
  });

  it("signs App Store Connect's token with the key (ES256, its kid, 19 minutes) and lists the apps the key sees", async () => {
    const { env, ascPublic, saPublic } = credentials();
    const { fetch, asked } = stores((a) => (isToken(a) ? TOKEN_ANSWER : a.url.host === ASC ? { json: APPS } : { json: { reviews: [] } }));
    const out = await (await connected(env, fetch)).call("health");
    expect(out).toEqual({
      ok: true,
      appStore: { configured: true, ok: true, apps: [{ id: "1234567890", bundleId: "com.example.habits", name: "Habits" }] },
      play: { configured: true, ok: true, account: SA_EMAIL, packages: [{ package: PACKAGE, ok: true }] },
    });
    const ascCall = asked.find((a) => a.url.host === ASC);
    const asc = decodeJwt((ascCall?.headers["authorization"] ?? "").replace(/^Bearer /, ""), ascPublic, "ES256");
    expect(asc).toEqual({ header: { alg: "ES256", typ: "JWT", kid: KEY_ID }, claims: { iss: ISSUER, iat: NOW, exp: NOW + 1140, aud: "appstoreconnect-v1" }, signed: true });
    // Google gets an assertion signed with the service account's key, and the API its access token.
    const grant = new URLSearchParams(asked.find(isToken)?.body ?? "");
    expect(grant.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(decodeJwt(grant.get("assertion") ?? "", saPublic, "RS256")).toMatchObject({
      claims: { iss: SA_EMAIL, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: NOW, exp: NOW + 3600 },
      signed: true,
    });
    expect(asked.find((a) => a.url.host === PLAY)?.headers["authorization"]).toBe("Bearer ya29.invented-token");
  });

  it("reads App Store reviews with their replies, filtered as asked, and the cursor to read on", async () => {
    const { env } = credentials();
    const { fetch, asked } = stores((a) =>
      a.url.pathname === "/v1/apps"
        ? { json: APPS }
        : {
            json: {
              data: [ascReview("r-1", {}, "resp-1"), ascReview("r-2", { rating: 1, title: "" })],
              included: [ascResponse("resp-1", "Thank you, a fix is in 1.4.1.", "PENDING_PUBLISH")],
              links: { next: "https://api.appstoreconnect.apple.com/v1/apps/1234567890/customerReviews?cursor=Mi4w&limit=2" },
            },
          },
    );
    const out = await (await connected(env, fetch)).call("list_app_store_reviews", { app: "com.example.habits", rating: [1, 2], replied: false, sort: "lowest", limit: 2 });
    expect(out).toEqual({
      app: { id: "1234567890", bundleId: "com.example.habits", name: "Habits" },
      reviews: [
        {
          id: "r-1",
          rating: 2,
          title: "Lost my streak",
          text: "The streak reset after the update.",
          author: "ana.p",
          at: "2026-10-20T08:15:00-07:00",
          territory: "ROU",
          reply: { text: "Thank you, a fix is in 1.4.1.", at: "2026-10-21T10:00:00-07:00", state: "pending" },
        },
        { id: "r-2", rating: 1, text: "The streak reset after the update.", author: "ana.p", at: "2026-10-20T08:15:00-07:00", territory: "ROU", reply: null },
      ],
      nextCursor: "Mi4w",
    });
    const q = asked.find((a) => a.url.pathname.endsWith("/customerReviews"))?.url.searchParams;
    expect(q?.get("filter[rating]")).toBe("1,2");
    expect(q?.get("exists[publishedResponse]")).toBe("false");
    expect(q?.get("sort")).toBe("rating");
    expect(q?.get("include")).toBe("response");
  });

  it("names the apps the key sees when asked for one it does not", async () => {
    const { env } = credentials();
    const { fetch } = stores(() => ({ json: APPS }));
    const out = await (await connected(env, fetch)).call("list_app_store_reviews", { app: "com.example.other" });
    expect(out.error).toMatchObject({ kind: "not_found", message: "the App Store Connect key sees no app com.example.other; it sees com.example.habits (1234567890)" });
  });

  it("reads Play reviews of the one configured package, with Google's dates and the 7-day window", async () => {
    const { env } = credentials();
    const { fetch, asked } = stores((a) =>
      isToken(a) ? TOKEN_ANSWER : { json: { reviews: [playReview("gp:1", "Thanks, fixed in 1.4.1")], tokenPagination: { nextPageToken: "next-1" } } },
    );
    const out = await (await connected(env, fetch)).call("list_play_reviews", { limit: 5, translate_to: "en" });
    expect(out).toEqual({
      package: PACKAGE,
      reviews: [
        {
          id: "gp:1",
          rating: 1,
          text: "Reminders stopped after the update",
          author: "Ion Ionescu",
          at: "2026-09-21T14:13:20Z",
          language: "ro",
          appVersion: "1.4.0",
          device: "a52q",
          androidApi: 34,
          reply: { text: "Thanks, fixed in 1.4.1", at: "2026-09-21T15:13:20Z" },
        },
      ],
      nextCursor: "next-1",
      window: "reviews written or changed in the last 7 days (Google's limit)",
    });
    const list = asked.find((a) => a.url.host === PLAY);
    expect(list?.url.pathname).toBe(`/androidpublisher/v3/applications/${PACKAGE}/reviews`);
    expect(Object.fromEntries(list?.url.searchParams ?? [])).toEqual({ maxResults: "5", translationLanguage: "en" });
  });

  describe("replies", () => {
    /** An App Store whose review r-1 holds whatever reply was last posted. */
    const appStoreWith = (initial?: string) => {
      let reply = initial;
      return stores((a) => {
        if (a.method === "POST") {
          reply = (JSON.parse(a.body ?? "{}") as { data: { attributes: { responseBody: string } } }).data.attributes.responseBody;
          return { status: 201, json: { data: ascResponse("resp-9", reply, "PENDING_PUBLISH") } };
        }
        return reply === undefined ? { json: { data: ascReview("r-1") } } : { json: { data: ascReview("r-1", {}, "resp-1"), included: [ascResponse("resp-1", reply)] } };
      });
    };
    const posts = (asked: readonly Asked[]) => asked.filter((a) => a.method === "POST");

    it("publishes an App Store reply naming the review, and the same text again sends nothing", async () => {
      const { env } = credentials();
      const { fetch, asked } = appStoreWith();
      const { call } = await connected(env, fetch);
      const first = await call("reply_app_store_review", { review: "r-1", text: "  Sorry about that: 1.4.1 restores streaks.  " });
      expect(first).toMatchObject({ review: "r-1", changed: true, replaced: false, reply: { text: "Sorry about that: 1.4.1 restores streaks.", state: "pending" } });
      expect(JSON.parse(posts(asked)[0]?.body ?? "{}")).toEqual({
        data: {
          type: "customerReviewResponses",
          attributes: { responseBody: "Sorry about that: 1.4.1 restores streaks." },
          relationships: { review: { data: { type: "customerReviews", id: "r-1" } } },
        },
      });
      const again = await call("reply_app_store_review", { review: "r-1", text: "Sorry about that: 1.4.1 restores streaks." });
      expect(again).toMatchObject({ changed: false });
      expect(posts(asked)).toHaveLength(1);
    });

    it("refuses to replace a public reply unless asked, then replaces it", async () => {
      const { env } = credentials();
      const { fetch, asked } = appStoreWith("Thanks for the feedback!");
      const { call } = await connected(env, fetch);
      const refused = await call("reply_app_store_review", { review: "r-1", text: "A new answer" });
      expect(refused.error).toMatchObject({ kind: "input", message: expect.stringContaining('already has a public reply (2026-10-21T10:00:00-07:00): "Thanks for the feedback!"') });
      expect(posts(asked)).toHaveLength(0);
      expect(await call("reply_app_store_review", { review: "r-1", text: "A new answer", replace: true })).toMatchObject({ changed: true, replaced: true });
      expect(posts(asked)).toHaveLength(1);
    });

    it("publishes a Play reply within Google's 350 characters, read first like the App Store's", async () => {
      const { env } = credentials();
      let reply: string | undefined;
      const { fetch, asked } = stores((a) => {
        if (isToken(a)) return TOKEN_ANSWER;
        if (a.method === "POST") {
          reply = (JSON.parse(a.body ?? "{}") as { replyText: string }).replyText;
          return { json: { result: { replyText: reply, lastEdited: { seconds: "1790007200", nanos: 0 } } } };
        }
        return { json: playReview("gp:1", reply) };
      });
      const { call, raw } = await connected(env, fetch);
      const out = await call("reply_play_review", { review: "gp:1", text: "Fixed in 1.4.1, thank you." });
      expect(out).toEqual({ package: PACKAGE, review: "gp:1", changed: true, replaced: false, reply: { text: "Fixed in 1.4.1, thank you.", at: "2026-09-21T16:13:20Z" }, note: "published under the developer's name" });
      expect(asked.find((a) => a.method === "POST" && a.url.host === PLAY)?.url.pathname).toBe(`/androidpublisher/v3/applications/${PACKAGE}/reviews/gp%3A1:reply`);
      expect(await call("reply_play_review", { review: "gp:1", text: "Fixed in 1.4.1, thank you." })).toMatchObject({ changed: false });
      const long = await raw("reply_play_review", { review: "gp:1", text: "x".repeat(351) });
      expect(long.isError).toBe(true);
      expect(asked.filter((a) => a.method === "POST" && a.url.host === PLAY)).toHaveLength(1);
    });

    it("never sends a reply again after a dropped connection: the outcome is unknown", async () => {
      const { env } = credentials();
      const { fetch, asked } = stores((a) => (a.method === "POST" ? "drop" : { json: { data: ascReview("r-1") } }));
      const out = await (await connected(env, fetch)).call("reply_app_store_review", { review: "r-1", text: "Thanks!" });
      expect(out.error).toMatchObject({ kind: "outcome_unknown", remedy: expect.stringContaining("read the review again") });
      expect(posts(asked)).toHaveLength(1);
    });
  });

  it("merges crash and screenshot feedback newest first, and pages one kind with its cursor", async () => {
    const { env } = credentials();
    const crash = { type: "betaFeedbackCrashSubmissions", id: "c-1", attributes: { createdDate: "2026-10-21T09:00:00Z", comment: "It closed when I tapped Done", email: "tester@example.com", deviceModel: "iPhone16,1", osVersion: "26.0", appPlatform: "IOS", buildBundleId: "com.example.habits" }, relationships: { build: { data: { type: "builds", id: "b-1" } } } };
    const shot = { type: "betaFeedbackScreenshotSubmissions", id: "s-1", attributes: { createdDate: "2026-10-22T09:00:00Z", comment: "Button cut off", email: null, deviceModel: "iPhone17,3", osVersion: "26.1", appPlatform: "IOS", buildBundleId: "com.example.habits", screenshots: [{ url: "https://example.com/s1.png", width: 1179, height: 2556, expirationDate: "2026-10-23T09:00:00Z" }] }, relationships: { build: { data: { type: "builds", id: "b-1" } } } };
    const included = [{ type: "builds", id: "b-1", attributes: { version: "42" } }];
    const { fetch, asked } = stores((a) =>
      a.url.pathname === "/v1/apps"
        ? { json: APPS }
        : a.url.pathname.endsWith("betaFeedbackCrashSubmissions")
          ? { json: { data: [crash], included, links: { next: "https://api.appstoreconnect.apple.com/x?cursor=QQ" } } }
          : { json: { data: [shot], included } },
    );
    const { call } = await connected(env, fetch);
    const both = await call("list_testflight_feedback", { limit: 1 });
    expect(both.feedback.map((f: { id: string; kind: string }) => `${f.kind}:${f.id}`)).toEqual(["screenshot:s-1", "crash:c-1"]);
    expect(both.feedback[1]).toEqual({
      id: "c-1",
      kind: "crash",
      at: "2026-10-21T09:00:00Z",
      comment: "It closed when I tapped Done",
      tester: "tester@example.com",
      device: { model: "iPhone16,1", os: "26.0", platform: "IOS" },
      build: { id: "b-1", number: "42", bundleId: "com.example.habits" },
    });
    expect(both.feedback[0].screenshots).toEqual([{ url: "https://example.com/s1.png", width: 1179, height: 2556, expiresAt: "2026-10-23T09:00:00Z" }]);
    expect(both.more).toContain("more crash feedback");
    const crashes = await call("list_testflight_feedback", { kind: "crash", cursor: "QQ" });
    expect(crashes).toMatchObject({ nextCursor: "QQ" });
    expect(asked.at(-1)?.url.searchParams.get("cursor")).toBe("QQ");
    expect((await call("list_testflight_feedback", { cursor: "QQ" })).error).toMatchObject({ kind: "input" });
  });

  it("saves a crash log whole to the outbox, links it, and shows its first lines", async () => {
    const { env } = credentials();
    const log = Array.from({ length: 60 }, (_, i) => (i === 0 ? "Exception Type:  EXC_CRASH (SIGABRT)" : `line ${i}`)).join("\n");
    const { fetch } = stores((a) => (a.url.pathname === "/v1/betaFeedbackCrashSubmissions/c-1/crashLog" ? { json: { data: { type: "betaCrashLogs", id: "l-1", attributes: { logText: log } } } } : { status: 404 }));
    const { raw } = await connected(env, fetch);
    const result = (await raw("get_testflight_crash_log", { submission: "c-1" })) as { content: { type: string; text?: string; uri?: string }[] };
    const out = JSON.parse(result.content[0]?.text ?? "{}") as { path: string; sha256: string; size: number; lines: number; head: string[] };
    expect(out).toMatchObject({ submission: "c-1", sha256: createHash("sha256").update(log).digest("hex"), size: Buffer.byteLength(log), lines: 60 });
    expect(out.head).toHaveLength(40);
    expect(out.head[0]).toBe("Exception Type:  EXC_CRASH (SIGABRT)");
    expect(readFileSync(out.path, "utf8")).toBe(log);
    expect(result.content[1]).toMatchObject({ type: "resource_link", uri: `file://${out.path}` });
  });

  it("says which store refused what: a revoked key, a key without the role, a deleted service account", async () => {
    const { env } = credentials();
    const revoked = stores(() => ({ status: 401, json: { errors: [{ status: "401", code: "NOT_AUTHORIZED", title: "Authentication credentials are missing or invalid.", detail: "Provide a properly configured and signed bearer token." }] } }));
    expect((await (await connected(env, revoked.fetch)).call("list_app_store_reviews")).error).toMatchObject({
      kind: "auth",
      store: "app_store",
      message: "Authentication credentials are missing or invalid.: Provide a properly configured and signed bearer token.",
    });
    const noRole = stores((a) => (a.url.pathname === "/v1/apps" ? { json: APPS } : { status: 403, json: { errors: [{ status: "403", code: "FORBIDDEN_ERROR", title: "This request is forbidden for security reasons", detail: "The API key in use does not allow this request" }] } }));
    const forbidden = (await (await connected(env, noRole.fetch)).call("list_testflight_feedback")).error;
    expect(forbidden).toMatchObject({ kind: "forbidden", store: "app_store", remedy: expect.stringContaining("Developer") });
    const gone = stores((a) => (isToken(a) ? { status: 400, json: { error: "invalid_grant", error_description: "Invalid JWT Signature." } } : { json: {} }));
    const play = (await (await connected(env, gone.fetch)).call("list_play_reviews")).error;
    expect(play).toMatchObject({ kind: "auth", store: "play" });
  });
});
