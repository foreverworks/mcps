/**
 * A mailbox password Porkbun generates goes to the outbox, never into the
 * answer. The password here is invented.
 */
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";
const GENERATED = "Invented-Generated-Pa55!";
const outbox = () => mkdtempSync(join(tmpdir(), "porkbun-outbox-"));

/** What /email/setupMailbox and /email/createMailbox answer (the shape of Porkbun's mock), with a generated password. */
const answer = (extra: Record<string, unknown> = {}) => ({
  status: "SUCCESS",
  domain: "example.com",
  mailbox: { id: 8095474, address: "hello@example.com", status: "ACTIVE", trial: true, expires: "2027-10-08 12:00:00", quota: "10G", autoRenews: true, renewalPrice: 0 },
  password: GENERATED,
  passwordGenerated: true,
  clientSettings: { imap: "imap.porkbun.com:993" },
  ...extra,
});

/** Porkbun with no cap and these mailbox answers. */
const porkbun = (mailbox: unknown) =>
  stubFetch((url) =>
    json(
      url.endsWith("/account/apiSettings")
        ? { status: "SUCCESS", spendLimit: { source: "none", limit: null, spent: 0, remaining: null }, topupLimit: { source: "none", limit: null, added: 0 } }
        : mailbox,
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a generated mailbox password", () => {
  it.each([
    ["setup_mailbox", { domain: "example.com", address: "hello" }],
    ["create_mailbox", { domain: "example.com", address: "hello", cost_cents: 3600 }],
  ])("%s saves it in the outbox, owner and group only, and answers with where", async (tool, args) => {
    const dir = outbox();
    porkbun(answer());
    const { call, asked } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });
    const result = await call(tool, args);
    const path = join(dir, "hello@example.com.password");
    expect(result.text).not.toContain(GENERATED);
    expect(result.value).toMatchObject({ status: "SUCCESS", mailbox: { address: "hello@example.com" }, passwordGenerated: true, password: { saved: path, mode: "0640" } });
    expect(readFileSync(path, "utf8")).toBe(`${GENERATED}\n`);
    expect(statSync(path).mode & 0o777).toBe(0o640);
    expect(asked[0]).toContain("Porkbun generates its password, saved in this server's outbox");
  });

  it("is not linked in the result, so no client opens it on its own", async () => {
    const dir = outbox();
    porkbun(answer());
    const { client } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });
    const result = (await client.callTool({ name: "setup_mailbox", arguments: { domain: "example.com", address: "hello" } })) as { content: readonly Record<string, unknown>[] };
    expect(result.content.map((c) => c["type"])).toEqual(["text"]);
  });

  it("without an outbox, refuses before anything is bought or set up", async () => {
    const sent = porkbun(answer());
    const { call } = await connect(keyFiles());
    const result = await call("create_mailbox", { domain: "example.com", address: "hello", cost_cents: 3600 });
    expect(result.value).toMatchObject({ error: { kind: "config", variable: "PORKBUN_OUTBOX_DIR", message: expect.stringContaining("create_mailbox was not sent") } });
    // The monthly caps are read first (a read); the purchase itself is never sent.
    expect(sent.map((s) => s.url)).toEqual([`${API}/account/apiSettings`]);
  });

  it("is not needed when the call gives the password, or for a dry run", async () => {
    const sent = porkbun({ status: "SUCCESS", domain: "example.com", passwordGenerated: false });
    const { call } = await connect(keyFiles());
    const given = await call("setup_mailbox", { domain: "example.com", address: "hello", password: "Invented-Given-Pa55!" });
    expect(given.value).toEqual({ status: "SUCCESS", domain: "example.com", passwordGenerated: false });
    const dry = await call("setup_mailbox", { domain: "example.com", address: "hello", dry_run: true });
    expect(dry.isError).toBe(false);
    expect(sent.map((s) => s.url)).toEqual([`${API}/email/setupMailbox/example.com`, `${API}/email/setupMailbox/example.com`]);
  });

  it("names the file after the address in the call when Porkbun's answer has none", async () => {
    const dir = outbox();
    porkbun(answer({ mailbox: undefined }));
    const { call } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: dir });
    await call("setup_mailbox", { domain: "Example.com", address: "Info" });
    expect(readdirSync(dir)).toEqual(["info@example.com.password"]);
  });
});
