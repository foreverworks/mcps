/**
 * Consent through the server, end to end over the real composition: every
 * root a temp dir, Google's token endpoint and tokeninfo answered by a stubbed
 * fetch. What is proven: the URL carries a PKCE challenge the exchange then
 * answers, each product's grant lands in the file that product reads (0600),
 * the product uses it on its next call with no restart, and a consent approved
 * as the wrong account, or with a box unticked, writes nothing.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectInMemory, inCall, type LinkForPerson, McpServer } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRegistries, type Registries } from "../../src/composition.js";
import { beginConsent, completeConsent } from "../../src/consent/app/consent.js";
import { asAppError } from "../../src/consent/domain/errors.js";
import { registerAll } from "../../src/mcp/register.js";

const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const GMAIL_SETTINGS = "https://www.googleapis.com/auth/gmail.settings.basic";
const EMAIL = "https://www.googleapis.com/auth/userinfo.email";

type Google = { email: string; scope?: string; refreshToken?: string };

/** The token endpoint and tokeninfo, as Google answers them; `google` says how the user approved. */
const stubGoogle = (google: Google) => {
  const exchanges: URLSearchParams[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      exchanges.push(form);
      return Response.json({
        access_token: `at-${form.get("code")}`,
        expires_in: 3599,
        scope: google.scope,
        ...(google.refreshToken === undefined ? { refresh_token: "rt-new" } : google.refreshToken ? { refresh_token: google.refreshToken } : {}),
      });
    }
    if (url.origin + url.pathname === "https://oauth2.googleapis.com/tokeninfo") {
      return Response.json({ aud: "test-client", email: google.email, email_verified: "true", scope: google.scope, expires_in: "3599" });
    }
    return Response.json({ error: { code: 404, message: `unexpected ${url.href}` } }, { status: 404 });
  });
  return exchanges;
};

const setup = (extra: NodeJS.ProcessEnv = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "consent-"));
  const client = { client_id: "test-client", client_secret: "test-secret", token_uri: "https://oauth2.googleapis.com/token" };
  mkdirSync(join(dir, "gmail"), { recursive: true });
  for (const label of ["personal", "work"]) {
    writeFileSync(join(dir, "gmail", `ro-${label}.json`), JSON.stringify({ ...client, refresh_token: `ro-${label}` }));
  }
  writeFileSync(join(dir, "rclone.conf"), `[gdrive]\ntype = drive\nclient_id = drive-client\nclient_secret = drive-secret\ntoken = {"refresh_token":"rclone-rt"}\n`);
  const env: NodeJS.ProcessEnv = {
    GMAIL_ACCOUNTS: `personal=${join(dir, "gmail/ro-personal.json")},work=${join(dir, "gmail/ro-work.json")}`,
    GMAIL_MODIFY_ACCOUNTS: `personal=${join(dir, "gmail/modify/personal/credentials.json")},work=${join(dir, "gmail/modify/work/credentials.json")}`,
    GMAIL_ADDRESSES: "personal=ana@example.com,work=ana@work.example",
    GMAIL_STATE_DIR: join(dir, "gmail/state"),
    CALENDAR_ROOT: join(dir, "calendar"),
    GOOGLE_EDITORS_ROOT: join(dir, "editors"),
    GOOGLE_EDITORS_DRIVE_ACCOUNT: "work",
    DRIVE_RCLONE_CONF: join(dir, "rclone.conf"),
    DRIVE_STATE_DIR: join(dir, "drive/state"),
    GOOGLE_STATE_DIR: join(dir, "google"),
    ...extra,
  };
  return { dir, registries: buildRegistries(env) };
};

const failureOf = async (p: Promise<unknown>) => asAppError(await p.then(() => undefined, (e: unknown) => e));

/** The URL the browser is sent to after approving, carrying the begun consent's state. */
const redirectFor = (url: string, code = "c0de") => `http://localhost:8123/?state=${new URL(url).searchParams.get("state")}&code=${code}&scope=x`;

const consent = async (registries: Registries, product: "gmail" | "calendar" | "editors" | "drive" | "tasks" | "contacts" | "meet", account: string) => {
  const begun = await beginConsent(registries.consent, { product, account });
  return { begun, done: await completeConsent(registries.consent, { redirectUrl: redirectFor(begun.url) }) };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("begin_consent", () => {
  it("asks on the account's client, as its address, for the product's scopes and the address, offline, with a PKCE challenge", async () => {
    const { dir, registries } = setup();
    const begun = await beginConsent(registries.consent, { product: "gmail", account: "personal" });
    const q = new URL(begun.url).searchParams;
    expect(begun.url.startsWith("https://accounts.google.com/o/oauth2/auth?")).toBe(true);
    expect(Object.fromEntries(q)).toMatchObject({
      client_id: "test-client",
      redirect_uri: "http://localhost:8123/",
      scope: `${GMAIL_MODIFY} ${GMAIL_SETTINGS} ${EMAIL}`,
      login_hint: "ana@example.com",
      access_type: "offline",
      prompt: "consent",
      response_type: "code",
      code_challenge_method: "S256",
    });
    expect(Date.parse(begun.expires_at) - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(statSync(join(dir, "google/consent-pending.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "google/consent-pending.json"), "utf8")).toContain("test-secret");
  });

  it("offers its URL for the client to show the user, saying as whom to approve and what to bring back", async () => {
    const { registries } = setup();
    const offered: LinkForPerson[] = [];
    const begun = await inCall({ offer: (link) => void offered.push(link) }, () => beginConsent(registries.consent, { product: "gmail", account: "personal" }));
    expect(offered).toEqual([{ url: begun.url, message: expect.stringContaining("ana@example.com"), next: expect.stringContaining("complete_consent") }]);
    expect(offered[0]?.next).toContain("http://localhost:8123/");
    expect(offered[0]?.next).toContain(begun.expires_at);
  });

  it("refuses an account with no known address, and a label that could walk out of a root", async () => {
    const { registries } = setup();
    expect(await failureOf(beginConsent(registries.consent, { product: "calendar", account: "stranger" }))).toMatchObject({ kind: "config", message: expect.stringMatching(/no address is known/) });
    expect(await failureOf(beginConsent(registries.consent, { product: "editors", account: "../x" }))).toMatchObject({ kind: "input" });
  });

  it("asks Drive's own grant only for the account Docs, Sheets and Slides run on it, on the rclone remote's client", async () => {
    const { registries } = setup();
    expect(await failureOf(beginConsent(registries.consent, { product: "drive", account: "personal" }))).toMatchObject({ kind: "input" });
    const begun = await beginConsent(registries.consent, { product: "drive", account: "work" });
    expect(new URL(begun.url).searchParams.get("client_id")).toBe("drive-client");
  });
});

describe("begin_consent with a configured client", () => {
  const clientFile = (dir: string): string => {
    const path = join(dir, "client_secret.json");
    // The shape Google Cloud's console downloads for a Desktop app client.
    writeFileSync(path, JSON.stringify({ installed: { client_id: "console-client", client_secret: "console-secret", token_uri: "https://oauth2.googleapis.com/token" } }));
    return path;
  };

  it("asks on GOOGLE_OAUTH_CLIENT_FILE's client for an account that has no grant yet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "consent-client-"));
    const { registries } = setup({ GOOGLE_OAUTH_CLIENT_FILE: clientFile(dir), GMAIL_ADDRESSES: "cal=ana@example.com" });
    const begun = await beginConsent(registries.consent, { product: "calendar", account: "cal" });
    expect(new URL(begun.url).searchParams.get("client_id")).toBe("console-client");
    expect(begun.address).toBe("ana@example.com");
  });

  it("names the variable when no client is known at all", async () => {
    const { registries } = setup({ GMAIL_ADDRESSES: "cal=ana@example.com" });
    expect(await failureOf(beginConsent(registries.consent, { product: "calendar", account: "cal" }))).toMatchObject({
      kind: "config",
      message: expect.stringMatching(/GOOGLE_OAUTH_CLIENT_FILE/),
    });
  });

  it("lets any account consent Drive when no editors label runs on it", async () => {
    const { registries } = setup({ GOOGLE_EDITORS_DRIVE_ACCOUNT: "" });
    const begun = await beginConsent(registries.consent, { product: "drive", account: "personal" });
    expect(begun.address).toBe("ana@example.com");
  });
});

describe("complete_consent", () => {
  it("exchanges with the verifier behind the challenge, saves gmail's modify grant 0600, and returns no token", async () => {
    const { dir, registries } = setup();
    const exchanges = stubGoogle({ email: "Ana@Example.com", scope: `${GMAIL_MODIFY} ${GMAIL_SETTINGS} ${EMAIL}` });
    const begun = await beginConsent(registries.consent, { product: "gmail", account: "personal" });
    const done = await completeConsent(registries.consent, { redirectUrl: redirectFor(begun.url, "abc") });

    const verifier = exchanges[0]?.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(new URL(begun.url).searchParams.get("code_challenge"));
    expect(Object.fromEntries(exchanges[0] ?? [])).toMatchObject({ grant_type: "authorization_code", code: "abc", redirect_uri: "http://localhost:8123/", client_id: "test-client" });
    const path = join(dir, "gmail/modify/personal/credentials.json");
    expect(done).toEqual({ product: "gmail", account: "personal", address: "ana@example.com", scopes: [GMAIL_MODIFY, GMAIL_SETTINGS, EMAIL], saved: true, path });
    expect(JSON.stringify(done)).not.toMatch(/rt-new|at-abc/);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      refresh_token: "rt-new",
      client_id: "test-client",
      client_secret: "test-secret",
      token_uri: "https://oauth2.googleapis.com/token",
      scopes: [GMAIL_MODIFY, GMAIL_SETTINGS, EMAIL],
      account: "ana@example.com",
    });
  });

  it("switches a mailbox reading on its read-only grant to the new modify grant at once", async () => {
    const { registries } = setup();
    expect(registries.gmail.get("work").grant.role).toBe("readonly");
    stubGoogle({ email: "ana@work.example", scope: `${GMAIL_MODIFY} ${GMAIL_SETTINGS} ${EMAIL}` });
    await consent(registries, "gmail", "work");
    expect(registries.gmail.get("work").grant.role).toBe("modify");
  });

  it("serves a calendar account it has never seen, with no restart", async () => {
    const { dir, registries } = setup();
    expect(registries.calendar.labels).toEqual([]);
    const scope = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy " + EMAIL;
    stubGoogle({ email: "ana@example.com", scope });
    await consent(registries, "calendar", "personal");
    expect(registries.calendar.labels).toEqual(["personal"]);
    expect(registries.calendar.get("personal").address).toBe("ana@example.com");
    expect(existsSync(join(dir, "calendar/personal/credentials.json"))).toBe(true);
  });

  it("gives Tasks, Contacts and Meet each its own grant under GOOGLE_STATE_DIR, served at once", async () => {
    const { dir, registries } = setup();
    const scopes = {
      tasks: "https://www.googleapis.com/auth/tasks",
      contacts: "https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/directory.readonly",
      meet: "https://www.googleapis.com/auth/meetings.space.readonly",
    } as const;
    for (const product of ["tasks", "contacts", "meet"] as const) {
      expect(registries[product].labels).toEqual([]);
      stubGoogle({ email: "ana@work.example", scope: `${scopes[product]} ${EMAIL}` });
      const { done } = await consent(registries, product, "work");
      expect(done).toMatchObject({ product, account: "work", saved: true, path: join(dir, "google", product, "work/credentials.json") });
      expect(registries[product].labels).toEqual(["work"]);
      expect(registries[product].specOf("work")?.address).toBe("ana@work.example");
    }
  });

  it("asks contacts for the directory too, and saves a grant without it: a personal account has none", async () => {
    const { registries } = setup();
    const begun = await beginConsent(registries.consent, { product: "contacts", account: "personal" });
    const asked = new URL(begun.url).searchParams.get("scope")?.split(" ") ?? [];
    expect(asked).toEqual(expect.arrayContaining(["https://www.googleapis.com/auth/contacts.readonly", "https://www.googleapis.com/auth/contacts.other.readonly", "https://www.googleapis.com/auth/directory.readonly"]));
    expect(begun.optional).toEqual(["https://www.googleapis.com/auth/directory.readonly"]);
    stubGoogle({ email: "ana@example.com", scope: `https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly ${EMAIL}` });
    const done = await completeConsent(registries.consent, { redirectUrl: redirectFor(begun.url) });
    expect(done).toMatchObject({ saved: true });
    const unticked = await beginConsent(registries.consent, { product: "contacts", account: "personal" });
    stubGoogle({ email: "ana@example.com", scope: `https://www.googleapis.com/auth/contacts.readonly ${EMAIL}` });
    expect(await failureOf(completeConsent(registries.consent, { redirectUrl: redirectFor(unticked.url) }))).toMatchObject({ code: "insufficient_scope" });
  });

  it("gives Docs, Sheets and Slides a grant they pick up on the next call", async () => {
    const { registries } = setup();
    expect(await failureOf(Promise.resolve().then(() => registries.docs.get("personal")))).toMatchObject({ kind: "config" });
    const scope = ["documents", "spreadsheets", "presentations", "drive.file"].map((s) => `https://www.googleapis.com/auth/${s}`).join(" ");
    stubGoogle({ email: "ana@example.com", scope: `${scope} ${EMAIL}` });
    await consent(registries, "editors", "personal");
    expect(registries.docs.get("personal").account).toBe("personal");
  });

  it("gives Drive its own grant, used from then on instead of the rclone remote's", async () => {
    const { dir, registries } = setup();
    expect(registries.drive.grant().source).toBe("rclone");
    stubGoogle({ email: "ana@work.example", scope: `https://www.googleapis.com/auth/drive ${EMAIL}` });
    const { done } = await consent(registries, "drive", "work");
    expect(done.path).toBe(join(dir, "google/drive/credentials.json"));
    expect(JSON.parse(readFileSync(done.path, "utf8"))).toMatchObject({ client_id: "drive-client", refresh_token: "rt-new" });
    expect(registries.drive.grant()).toEqual({ source: "credentials", detail: join(dir, "google/drive/credentials.json") });
  });

  it("writes nothing when the user approved as the wrong account", async () => {
    const { dir, registries } = setup();
    stubGoogle({ email: "ana@example.com", scope: `${GMAIL_MODIFY} ${GMAIL_SETTINGS} ${EMAIL}` });
    const begun = await beginConsent(registries.consent, { product: "gmail", account: "work" });
    expect(await failureOf(completeConsent(registries.consent, { redirectUrl: redirectFor(begun.url) }))).toMatchObject({
      kind: "auth",
      code: "wrong_account",
      permanent: true,
      message: expect.stringMatching(/approved as ana@example.com, not ana@work.example/),
    });
    expect(existsSync(join(dir, "gmail/modify/work/credentials.json"))).toBe(false);
  });

  it("writes nothing when a box was left unticked, or Google gave no refresh token", async () => {
    const { dir, registries } = setup();
    stubGoogle({ email: "ana@example.com", scope: EMAIL });
    const first = await beginConsent(registries.consent, { product: "gmail", account: "personal" });
    expect(await failureOf(completeConsent(registries.consent, { redirectUrl: redirectFor(first.url) }))).toMatchObject({ code: "insufficient_scope" });
    stubGoogle({ email: "ana@example.com", scope: `${GMAIL_MODIFY} ${GMAIL_SETTINGS} ${EMAIL}`, refreshToken: "" });
    const second = await beginConsent(registries.consent, { product: "gmail", account: "personal" });
    expect(await failureOf(completeConsent(registries.consent, { redirectUrl: redirectFor(second.url) }))).toMatchObject({ code: "no_refresh_token" });
    expect(existsSync(join(dir, "gmail/modify/personal/credentials.json"))).toBe(false);
  });

  it("is single use, expires after 15 minutes, and knows a refusal", async () => {
    const { registries } = setup();
    stubGoogle({ email: "ana@example.com", scope: `${GMAIL_MODIFY} ${GMAIL_SETTINGS} ${EMAIL}` });
    const { begun } = await consent(registries, "gmail", "personal");
    expect(await failureOf(completeConsent(registries.consent, { redirectUrl: redirectFor(begun.url) }))).toMatchObject({ kind: "input" });

    vi.useFakeTimers({ toFake: ["Date"] });
    const late = await beginConsent(registries.consent, { product: "gmail", account: "personal" });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(await failureOf(completeConsent(registries.consent, { redirectUrl: redirectFor(late.url) }))).toMatchObject({
      kind: "input",
      message: expect.stringMatching(/expired/),
    });
    vi.useRealTimers();

    const refused = await beginConsent(registries.consent, { product: "gmail", account: "personal" });
    const state = new URL(refused.url).searchParams.get("state");
    expect(await failureOf(completeConsent(registries.consent, { redirectUrl: `http://localhost:8123/?error=access_denied&state=${state}` }))).toMatchObject({
      kind: "input",
      message: expect.stringMatching(/access_denied/),
    });
  });
});

describe("over MCP", () => {
  it("serves begin_consent and complete_consent, and never puts a token in a result", async () => {
    const { registries } = setup();
    stubGoogle({ email: "ana@example.com", scope: `${GMAIL_MODIFY} ${GMAIL_SETTINGS} ${EMAIL}` });
    const server = new McpServer({ name: "google", version: "test" });
    registerAll(server, registries);
    const client = await connectInMemory(server);
    const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? "";

    const begun = JSON.parse(text(await client.callTool({ name: "begin_consent", arguments: { product: "gmail", account: "personal", grant: "modify" } })));
    const done = text(await client.callTool({ name: "complete_consent", arguments: { redirect_url: redirectFor(begun.url) } }));
    expect(JSON.parse(done)).toMatchObject({ product: "gmail", account: "personal", saved: true });
    expect(done).not.toMatch(/rt-new|at-c0de|test-secret/);
  });
});
