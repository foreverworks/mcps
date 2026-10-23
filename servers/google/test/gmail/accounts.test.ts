/**
 * The registry is pure string-and-path work, so every rule it enforces is
 * provable without a credential — which is the point of keeping it here rather
 * than inside the composition root.
 */
import { describe, expect, it } from "vitest";

import { parsePairs, resolveAccounts } from "../../src/gmail/infra/accounts.js";

describe("parsePairs", () => {
  it("reads label=path pairs in order, keeping an absolute path intact", () => {
    expect(parsePairs("personal=/a/creds.json, work=/srv/grants/work/credentials.json", "X")).toEqual([
      ["personal", "/a/creds.json"],
      ["work", "/srv/grants/work/credentials.json"],
    ]);
  });

  it("rejects an entry that is not label=value", () => {
    expect(() => parsePairs("/just/a/path", "X")).toThrow();
  });

  it("rejects a label that could collide with the all-accounts marker or a path", () => {
    expect(() => parsePairs("*=/a/creds.json", "X")).toThrow();
    expect(() => parsePairs("Work Mail=/a/creds.json", "X")).toThrow();
  });

  it("refuses a duplicate label", () => {
    expect(() => parsePairs("work=/a,work=/b", "X")).toThrow();
  });
});

describe("resolveAccounts", () => {
  it("gives each account its own state dir", () => {
    const r = resolveAccounts({ GMAIL_ACCOUNTS: "personal=/a,work=/b", GMAIL_STATE_DIR: "/state" });
    const [personal, work] = r.accounts;
    expect(personal).toEqual({
      label: "personal",
      readonly: "/a",
      paths: { stateDir: "/state/personal", attachmentsDir: "/state/personal/attachments" },
    });
    // Separate state dirs are not cosmetic: the token cache lives there, and
    // two mailboxes sharing one would hand the wrong access token to a call.
    expect(work?.paths.stateDir).not.toBe(personal?.paths.stateDir);
  });

  it("pairs each account's read-only grant with its own modify grant and its address", () => {
    const r = resolveAccounts({
      GMAIL_ACCOUNTS: "personal=/ro/p,work=/ro/w",
      GMAIL_MODIFY_ACCOUNTS: "personal=/rw/p,work=/rw/w",
      GMAIL_ADDRESSES: "personal=me@example.com,work=me@work.example",
      GMAIL_STATE_DIR: "/s",
    });
    expect(r.accounts.map((a) => [a.label, a.readonly, a.modify, a.address])).toEqual([
      ["personal", "/ro/p", "/rw/p", "me@example.com"],
      ["work", "/ro/w", "/rw/w", "me@work.example"],
    ]);
  });

  it("registers an account that has only a modify grant", () => {
    const r = resolveAccounts({ GMAIL_ACCOUNTS: "personal=/ro/p", GMAIL_MODIFY_ACCOUNTS: "third=/rw/t" });
    expect(r.accounts.map((a) => a.label)).toEqual(["personal", "third"]);
    expect(r.accounts[1]).toMatchObject({ modify: "/rw/t" });
    expect(r.accounts[1]?.readonly).toBeUndefined();
  });

  it("defaults to the first registered account", () => {
    const r = resolveAccounts({ GMAIL_ACCOUNTS: "personal=/a,work=/b", GMAIL_STATE_DIR: "/s" });
    expect(r.defaultLabel).toBe("personal");
  });

  it("honours an explicit default", () => {
    const r = resolveAccounts({
      GMAIL_ACCOUNTS: "personal=/a,work=/b",
      GMAIL_DEFAULT_ACCOUNT: "work",
      GMAIL_STATE_DIR: "/s",
    });
    expect(r.defaultLabel).toBe("work");
  });

  it("refuses a default that is not registered, rather than silently picking one", () => {
    expect(() =>
      resolveAccounts({ GMAIL_ACCOUNTS: "personal=/a", GMAIL_DEFAULT_ACCOUNT: "work" }),
    ).toThrow();
  });

  it("refuses a duplicate label", () => {
    expect(() => resolveAccounts({ GMAIL_ACCOUNTS: "work=/a,work=/b" })).toThrow();
  });

  it("is empty, not an error, with nothing configured: a tool then names the variables", () => {
    expect(resolveAccounts({})).toEqual({ accounts: [], defaultLabel: "", addresses: new Map() });
  });

  it("keeps every state dir under the server's own state directory by default", () => {
    const r = resolveAccounts({ GMAIL_MODIFY_ACCOUNTS: "work=/rw/w", GOOGLE_STATE_DIR: "/srv/google" });
    expect(r.accounts[0]?.paths).toEqual({ stateDir: "/srv/google/gmail/state/work", attachmentsDir: "/srv/google/gmail/state/work/attachments" });
  });

  it("puts attachments in GMAIL_ATTACHMENTS_DIR, one folder per account", () => {
    const r = resolveAccounts({ GMAIL_MODIFY_ACCOUNTS: "work=/rw/w", GMAIL_STATE_DIR: "/s", GMAIL_ATTACHMENTS_DIR: "/out" });
    expect(r.accounts[0]?.paths.attachmentsDir).toBe("/out/work");
  });

  it("knows an address for a label that is not a mailbox, for consent", () => {
    const r = resolveAccounts({ GMAIL_ADDRESSES: "cal=ana@example.com" });
    expect(r.accounts).toEqual([]);
    expect(r.addresses.get("cal")).toBe("ana@example.com");
  });
});
