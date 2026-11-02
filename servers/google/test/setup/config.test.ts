/**
 * Configuration without variables: what setup saves under the state directory
 * is found by a server started with nothing set, and every variable that is
 * set still wins, which is how a deployment that lists its paths keeps working.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runHealthCheck } from "../../src/cli/health.js";
import { buildRegistries } from "../../src/composition.js";
import { resolveAccounts } from "../../src/gmail/infra/accounts.js";
import { oauthClientOf, stateDirFrom } from "../../src/infra/locations.js";

const grant = (path: string, account: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ refresh_token: "rt", client_id: "c", client_secret: "s", account }));
};

describe("the OAuth client", () => {
  it("is GOOGLE_OAUTH_CLIENT_FILE when set, else setup's file when it exists, else none", () => {
    const state = "/srv/google";
    expect(oauthClientOf({ GOOGLE_STATE_DIR: state, GOOGLE_OAUTH_CLIENT_FILE: "/etc/client.json" }, () => true)).toEqual({ path: "/etc/client.json", from: "GOOGLE_OAUTH_CLIENT_FILE" });
    expect(oauthClientOf({ GOOGLE_STATE_DIR: state }, (p) => p === "/srv/google/oauth-client.json")).toEqual({ path: "/srv/google/oauth-client.json", from: "setup" });
    expect(oauthClientOf({ GOOGLE_STATE_DIR: state }, () => false)).toBeUndefined();
  });
});

describe("stateDirFrom", () => {
  it("names the setting that decided the state directory", () => {
    expect(stateDirFrom({ GOOGLE_STATE_DIR: "/s", STATE_DIRECTORY: "/v" })).toBe("GOOGLE_STATE_DIR");
    expect(stateDirFrom({ STATE_DIRECTORY: "/v", XDG_STATE_HOME: "/x" })).toBe("STATE_DIRECTORY");
    expect(stateDirFrom({ XDG_STATE_HOME: "/x" })).toBe("XDG_STATE_HOME");
    expect(stateDirFrom({ APPDATA: "/a" }, "win32")).toBe("APPDATA");
    expect(stateDirFrom({ APPDATA: "/a" }, "linux")).toBe("the home directory");
  });
});

describe("Gmail's mailboxes", () => {
  it("are the grants under <state>/gmail without GMAIL_MODIFY_ACCOUNTS, each with the address it recorded", () => {
    const state = mkdtempSync(join(tmpdir(), "gmail-"));
    grant(join(state, "gmail/work/credentials.json"), "ana@work.example");
    grant(join(state, "gmail/personal/credentials.json"), "ana@example.com");
    mkdirSync(join(state, "gmail/state/work"), { recursive: true });
    const r = resolveAccounts({ GOOGLE_STATE_DIR: state });
    expect(r.accounts.map((a) => [a.label, a.modify])).toEqual([
      ["personal", join(state, "gmail/personal/credentials.json")],
      ["work", join(state, "gmail/work/credentials.json")],
    ]);
    expect(r.addresses).toEqual(new Map([["personal", "ana@example.com"], ["work", "ana@work.example"]]));
    expect(r.addressFrom.get("work")).toBe(join(state, "gmail/work/credentials.json"));
    expect(r.grantRoot).toBe(join(state, "gmail"));
  });

  it("let GMAIL_ADDRESSES win over a recorded address", () => {
    const state = mkdtempSync(join(tmpdir(), "gmail-"));
    grant(join(state, "gmail/work/credentials.json"), "ana@work.example");
    const r = resolveAccounts({ GOOGLE_STATE_DIR: state, GMAIL_ADDRESSES: "work=ana@other.example" });
    expect(r.addresses.get("work")).toBe("ana@other.example");
    expect(r.addressFrom.get("work")).toBe("GMAIL_ADDRESSES");
  });

  it("are GMAIL_MODIFY_ACCOUNTS' alone when it is set: nothing on disk is added", () => {
    const state = mkdtempSync(join(tmpdir(), "gmail-"));
    grant(join(state, "gmail/stray/credentials.json"), "someone@example.com");
    const r = resolveAccounts({ GOOGLE_STATE_DIR: state, GMAIL_MODIFY_ACCOUNTS: "work=/grants/work.json" });
    expect(r.accounts.map((a) => a.label)).toEqual(["work"]);
    expect(r.grantRoot).toBeUndefined();
    expect(r.addresses.size).toBe(0);
  });

  it("appear in a running registry as soon as a grant is written, with no restart", () => {
    const state = mkdtempSync(join(tmpdir(), "gmail-"));
    const registries = buildRegistries({ GOOGLE_STATE_DIR: state });
    expect(registries.gmail.labels).toEqual([]);
    expect(registries.gmail.modifyPathOf("work")).toBe(join(state, "gmail/work/credentials.json"));
    grant(join(state, "gmail/work/credentials.json"), "ana@work.example");
    expect(registries.gmail.labels).toEqual(["work"]);
    expect(registries.gmail.addressOf("work")).toBe("ana@work.example");
  });
});

describe("health's config section", () => {
  it("says where each setting came from", () => {
    const state = mkdtempSync(join(tmpdir(), "config-"));
    grant(join(state, "calendar/work/credentials.json"), "ana@work.example");
    writeFileSync(join(state, "oauth-client.json"), JSON.stringify({ installed: { client_id: "c", client_secret: "s" } }));
    const report = buildRegistries({ GOOGLE_STATE_DIR: state, GMAIL_ADDRESSES: "personal=ana@example.com" }).config();
    expect(report).toEqual({
      stateDir: { path: state, from: "GOOGLE_STATE_DIR" },
      oauthClient: { path: join(state, "oauth-client.json"), from: "setup" },
      mailboxes: { from: "grants", folder: join(state, "gmail") },
      accounts: {
        personal: { address: "ana@example.com", from: "GMAIL_ADDRESSES" },
        work: { address: "ana@work.example", from: join(state, "calendar/work/credentials.json") },
      },
    });
  });
});

describe("the shell's health check", () => {
  it("passes a server with nothing set up: every product says so, and the CONFIG lines say where each setting would come from", async () => {
    const state = mkdtempSync(join(tmpdir(), "health-"));
    const lines: string[] = [];
    const code = await runHealthCheck(undefined, (l) => void lines.push(l), { GOOGLE_STATE_DIR: state });
    expect(code).toBe(0);
    expect(lines[0]).toBe(`CONFIG: state ${state} (from GOOGLE_STATE_DIR)`);
    expect(lines.some((l) => l.startsWith("CONFIG: oauth client none"))).toBe(true);
    expect(lines.filter((l) => !l.startsWith("CONFIG:")).every((l) => /^[A-Z]+: ok /.test(l))).toBe(true);
    expect(lines).toContain("DRIVE: ok Drive has no grant yet (begin_consent, product drive)");
  });
});
