/**
 * setup end to end, over the real composition: a scripted person at the
 * terminal, a browser that follows the consent URL to setup's loopback
 * listener, and Google's token endpoint and tokeninfo answered by a stubbed
 * fetch. What is proven: the client file is picked up from Downloads, checked
 * and moved into the state directory 0600; each consent learns the account's
 * address and lands where the product reads it; a server started with only
 * HOME set then finds every mailbox and grant; and an approval as the wrong
 * account saves nothing.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRegistries } from "../../src/composition.js";
import type { Terminal } from "../../src/setup/app/ports.js";
import { runSetup } from "../../src/setup/app/setup.js";
import { buildSetup } from "../../src/setup/composition.js";
import { listenOnLoopback } from "../../src/setup/infra/loopback.js";

const WAIT = Symbol("wait");

/** A person who answers from a script: WAIT lets setup's watcher or listener answer instead of typing. */
const scripted = (answers: (string | typeof WAIT)[]) => {
  const said: string[] = [];
  const next = (question: string) => {
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`no scripted answer for "${question}"`);
    said.push(`? ${question}`);
    return answer;
  };
  const terminal: Terminal = {
    say: (text) => void said.push(text),
    ask: async (question, fallback) => {
      const answer = next(question);
      if (answer === WAIT) throw new Error(`"${question}" cannot wait`);
      return answer || fallback || "";
    },
    askOrWait: async (question, wait) => {
      const answer = next(question);
      return answer === WAIT ? { found: await wait(new AbortController().signal) } : { typed: answer };
    },
  };
  return { terminal, said, left: () => answers.length };
};

/** Google's token endpoint and tokeninfo; `approver` is whoever approves each consent, in turn. */
const stubGoogle = (approvers: string[]) => {
  const tokens = new Map<string, string>();
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      const scope = `${form.get("code")} https://www.googleapis.com/auth/userinfo.email`;
      const at = `at-${tokens.size}`;
      tokens.set(at, approvers.shift() ?? "nobody@example.com");
      return Response.json({ access_token: at, expires_in: 3599, scope, refresh_token: `rt-${at}` });
    }
    if (url.origin + url.pathname === "https://oauth2.googleapis.com/tokeninfo") {
      const at = url.searchParams.get("access_token") ?? "";
      return Response.json({ aud: "c", email: tokens.get(at), email_verified: "true", expires_in: "3599" });
    }
    return Response.json({ error: { code: 404, message: `unexpected ${url.href}` } }, { status: 404 });
  });
};

/** The browser: an authorization URL is followed to its loopback redirect, with every scope it asked for granted (the code carries them). */
const browser = (opened: string[]) => async (url: string) => {
  opened.push(url);
  if (!url.startsWith("https://accounts.google.com/")) return true;
  const q = new URL(url).searchParams;
  const back = new URL(q.get("redirect_uri") ?? "");
  back.searchParams.set("state", q.get("state") ?? "");
  back.searchParams.set("code", (q.get("scope") ?? "").split(" ").filter((s) => !s.endsWith("userinfo.email")).join(" "));
  await new Promise<void>((resolve, reject) => get(back, (res) => res.resume().on("end", resolve)).on("error", reject));
  return true;
};

const CLIENT = { installed: { client_id: "c", project_id: "my-project-1", client_secret: "s", redirect_uris: ["http://localhost"] } };

const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "home-"));
  mkdirSync(join(dir, "Downloads"));
  return dir;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setup", () => {
  it("goes from nothing to grants a server with no variables finds", async () => {
    const dir = home();
    const env = { HOME: dir };
    const download = join(dir, "Downloads", "client_secret_c.apps.googleusercontent.com.json");
    writeFileSync(download, JSON.stringify(CLIENT));
    stubGoogle(["ana@example.com", "ana@example.com"]);
    const person = scripted(["gmail, calendar", "personal", "my-project-1", "", "", "", "", WAIT, WAIT, WAIT]);
    const opened: string[] = [];
    const ports = { ...buildSetup(env, buildRegistries(env), person.terminal), open: browser(opened), gcloud: async () => undefined };

    expect(await runSetup(ports)).toBe(0);
    expect(person.left()).toBe(0);

    const state = join(dir, ".local/state/mcps/google");
    expect(statSync(join(state, "oauth-client.json")).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(state, "oauth-client.json"), "utf8"))).toEqual(CLIENT);
    expect(existsSync(download)).toBe(false);
    const gmail = JSON.parse(readFileSync(join(state, "gmail/personal/credentials.json"), "utf8"));
    expect(gmail).toMatchObject({ account: "ana@example.com", client_id: "c", refresh_token: "rt-at-0" });
    expect(JSON.parse(readFileSync(join(state, "calendar/personal/credentials.json"), "utf8"))).toMatchObject({ account: "ana@example.com" });

    expect(opened[0]).toBe("https://console.cloud.google.com/projectcreate");
    expect(opened).toContain("https://console.cloud.google.com/apis/enableflow?apiid=gmail.googleapis.com,calendar-json.googleapis.com&project=my-project-1");
    const consents = opened.filter((u) => u.startsWith("https://accounts.google.com/"));
    expect(consents).toHaveLength(2);
    expect(new URL(consents[0] ?? "").searchParams.get("login_hint")).toBeNull();
    expect(new URL(consents[1] ?? "").searchParams.get("login_hint")).toBe("ana@example.com");
    expect(new URL(consents[0] ?? "").searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const output = person.said.join("\n");
    expect(output).toContain("claude mcp add google -e GOOGLE_TOOLSETS=gmail,calendar -- npx -y @foreverworks/mcp-google");
    expect(output).toContain("https://www.googleapis.com/auth/calendar.events.freebusy");

    const server = buildRegistries({ HOME: dir });
    expect(server.gmail.labels).toEqual(["personal"]);
    expect(server.gmail.addressOf("personal")).toBe("ana@example.com");
    expect(server.calendar.labels).toEqual(["personal"]);
    expect(server.config()).toMatchObject({ oauthClient: { from: "setup" }, mailboxes: { from: "grants" } });
  });

  it("saves nothing when a second consent of an account is approved as someone else, and says so", async () => {
    const dir = home();
    const env = { HOME: dir };
    const state = join(dir, ".local/state/mcps/google");
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "oauth-client.json"), JSON.stringify(CLIENT));
    stubGoogle(["ana@example.com", "bob@example.com"]);
    const person = scripted(["gmail, calendar", "work", "", "n", WAIT, WAIT, "n"]);
    const ports = { ...buildSetup(env, buildRegistries(env), person.terminal), open: browser([]), gcloud: async () => undefined };

    expect(await runSetup(ports)).toBe(1);
    expect(existsSync(join(state, "gmail/work/credentials.json"))).toBe(true);
    expect(existsSync(join(state, "calendar/work/credentials.json"))).toBe(false);
    expect(person.said.join("\n")).toContain("approved as bob@example.com, not ana@example.com; nothing was saved");
  });

  it("keeps a grant that exists unless the person asks to replace it", async () => {
    const dir = home();
    const env = { HOME: dir };
    const state = join(dir, ".local/state/mcps/google");
    mkdirSync(join(state, "calendar/work"), { recursive: true });
    writeFileSync(join(state, "oauth-client.json"), JSON.stringify(CLIENT));
    writeFileSync(join(state, "calendar/work/credentials.json"), JSON.stringify({ refresh_token: "old", client_id: "c", client_secret: "s", account: "ana@work.example" }));
    const person = scripted(["calendar", "work", "", "n", "n"]);
    const ports = { ...buildSetup(env, buildRegistries(env), person.terminal), open: browser([]), gcloud: async () => undefined };

    expect(await runSetup(ports)).toBe(0);
    expect(JSON.parse(readFileSync(join(state, "calendar/work/credentials.json"), "utf8")).refresh_token).toBe("old");
    expect(person.said.join("\n")).toContain("Every grant you chose already exists.");
  });
});

describe("the loopback listener", () => {
  it("answers only the redirect, on 127.0.0.1, and hands over its URL", async () => {
    const loopback = await listenOnLoopback();
    const status = (path: string) =>
      new Promise<number>((resolve, reject) => get(new URL(path, loopback.redirectUri), (res) => res.resume().on("end", () => resolve(res.statusCode ?? 0))).on("error", reject));
    expect(loopback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(await status("/favicon.ico")).toBe(404);
    expect(await status("/?state=s&code=c")).toBe(200);
    expect(await loopback.arrived(new AbortController().signal)).toBe(`${loopback.redirectUri}?state=s&code=c`);
    await loopback.close();
  });

  it("stops waiting when told to", async () => {
    const loopback = await listenOnLoopback();
    const stop = new AbortController();
    const waiting = loopback.arrived(stop.signal);
    stop.abort();
    await expect(waiting).rejects.toBeDefined();
    await loopback.close();
  });
});
