/**
 * The vault adapter's session handling, against a fake CLI that keeps the one
 * rule of the real one that matters here: `bw unlock` stores the vault's key
 * in data.json encrypted under a NEW session key, so the key every earlier
 * unlock handed out stops opening it. `bw status` with such a key answers
 * "locked" (exit 0), and every other command fails with "Vault is locked."
 * Checked against the pinned CLI and Vaultwarden (scripts/integration.ts).
 */
import { describe, expect, it } from "vitest";

import { asAppError } from "../src/domain/errors.js";
import { serialized, type BwResult, type RunBw } from "../src/infra/bw/run.js";
import { makeBwVault } from "../src/infra/bwVault.js";
import { checkHealth } from "../src/app/usecases/health.js";
import type { Deps } from "../src/app/ports.js";

const ok = (stdout: string): BwResult => ({ code: 0, stdout, stderr: "" });
const LOCKED: BwResult = { code: 1, stdout: "", stderr: "Vault is locked." };

/** A CLI with one data.json. Each call takes a few milliseconds, so calls that arrive together interleave as the real ones do. */
const fakeCli = (options: { loggedIn?: boolean; masterPassword?: string; items?: Record<string, Record<string, unknown>> } = {}) => {
  const items = { ...options.items };
  const edits: Record<string, unknown>[] = [];
  let loggedIn = options.loggedIn ?? false;
  let openWith: string | undefined;
  let keys = 0;
  const calls: string[] = [];
  const run: RunBw = async (args, opts = {}) => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    calls.push(args.slice(0, 2).join(" "));
    const session = opts.env?.["BW_SESSION"];
    const opens = session !== undefined && session === openWith;
    switch (args[0]) {
      case "status":
        return ok(JSON.stringify({ status: !loggedIn ? "unauthenticated" : opens ? "unlocked" : "locked", userEmail: "agents@example.test", serverUrl: null, lastSync: null }));
      case "config":
        return ok("Saved setting `config`.");
      case "login":
        loggedIn = true;
        return ok("You are logged in!");
      case "unlock":
        if (opts.env?.["BW_MASTER_PASSWORD"] !== (options.masterPassword ?? "correct horse")) return { code: 1, stdout: "", stderr: "Invalid master password." };
        openWith = `session-key-${++keys}`;
        return ok(openWith);
      case "sync":
        return opens ? ok("Syncing complete.") : LOCKED;
      case "list":
        return opens ? ok("[]") : LOCKED;
      case "get": {
        const item = items[args[2] ?? ""];
        return !opens ? LOCKED : item === undefined ? { code: 1, stdout: "", stderr: "Not found." } : ok(JSON.stringify(item));
      }
      case "edit": {
        if (!opens) return LOCKED;
        const sent = JSON.parse(Buffer.from(opts.input ?? "", "base64").toString("utf8")) as Record<string, unknown>;
        edits.push(sent);
        items[args[2] ?? ""] = sent;
        return ok(JSON.stringify(sent));
      }
      default:
        return { code: 1, stdout: "", stderr: `unexpected ${args.join(" ")}` };
    }
  };
  /** Another `bw unlock` on the same data.json, as a second process (or a person at a shell) would run it. */
  const unlockElsewhere = () => {
    openWith = `elsewhere-${++keys}`;
  };
  return { run, calls, edits, unlockElsewhere, unlocks: () => calls.filter((c) => c.startsWith("unlock")).length };
};

const vaultOn = (cli: ReturnType<typeof fakeCli>, masterPassword = "correct horse") =>
  makeBwVault({
    // As composition.ts wires it: one CLI call at a time.
    run: serialized(cli.run),
    credentials: async () => ({ clientId: "user.client-id", clientSecret: "client-secret", masterPassword }),
    serverUrl: undefined,
    now: () => 0,
  });

const depsOf = (vault: ReturnType<typeof vaultOn>) => ({ vault }) as unknown as Deps;
const outcome = async <T>(p: Promise<T>) => p.then((value) => ({ value }), (thrown: unknown) => ({ error: asAppError(thrown) }));

describe("the CLI session", () => {
  it("is unlocked once for calls that arrive together on a fresh process, and every one of them succeeds", async () => {
    // After a restart, a health check and a totp call can arrive within the same seconds. If each unlocked, the
    // second unlock would turn the first one's key stale under its next command ("the vault is locked after unlocking").
    const cli = fakeCli({ loggedIn: true });
    const vault = vaultOn(cli);
    const deps = depsOf(vault);
    const results = await Promise.all([
      outcome(checkHealth(deps)),
      outcome(vault.sync().then(() => vault.listLogins({}))),
      outcome(checkHealth(deps)),
      outcome(vault.status()),
    ]);
    for (const r of results) expect(r).not.toHaveProperty("error");
    expect(cli.unlocks()).toBe(1);
  });

  it("logs in and unlocks once on a first start, for every call waiting on it", async () => {
    const cli = fakeCli({ loggedIn: false });
    const vault = vaultOn(cli);
    const results = await Promise.all([outcome(checkHealth(depsOf(vault))), outcome(vault.listLogins({})), outcome(vault.status())]);
    for (const r of results) expect(r).not.toHaveProperty("error");
    expect(cli.calls.filter((c) => c.startsWith("login"))).toHaveLength(1);
    expect(cli.unlocks()).toBe(1);
  });

  it("replaces a key the CLI no longer opens once, and the calls that found it stale all go on with the new one", async () => {
    const cli = fakeCli({ loggedIn: true });
    const vault = vaultOn(cli);
    await vault.listLogins({});
    cli.unlockElsewhere();
    const results = await Promise.all([outcome(vault.listLogins({})), outcome(vault.collections()), outcome(vault.sync({ force: true })), outcome(vault.status())]);
    for (const r of results) expect(r).not.toHaveProperty("error");
    expect(cli.unlocks()).toBe(2);
  });

  it("answers status with a fresh key when the one it holds went stale, rather than calling the vault locked", async () => {
    const cli = fakeCli({ loggedIn: true });
    const vault = vaultOn(cli);
    expect((await vault.status()).status).toBe("unlocked");
    cli.unlockElsewhere();
    expect((await vault.status()).status).toBe("unlocked");
    expect(cli.unlocks()).toBe(2);
  });

  it("fails every waiting call with the CLI's refusal when the unlock is refused, and tries again on the next call", async () => {
    const cli = fakeCli({ loggedIn: true, masterPassword: "the new one" });
    const vault = vaultOn(cli);
    const results = await Promise.all([outcome(vault.status()), outcome(vault.listLogins({}))]);
    for (const r of results) expect(r).toMatchObject({ error: { kind: "auth", message: "bw unlock: Invalid master password." } });
    expect(cli.unlocks()).toBe(1);
    await outcome(vault.status());
    expect(cli.unlocks()).toBe(2);
  });
});

describe("editing an item", () => {
  const NOTE_ID = "5d0c6c4e-1f7a-4a1e-9a55-2f3e8e0b7c11";
  const LOGIN_ID = "11111111-1111-4111-8111-111111111111";
  const stored = {
    note: {
      id: NOTE_ID,
      type: 2,
      name: "Editor licence",
      notes: "See license field",
      organizationId: "org-1",
      collectionIds: ["c-agents"],
      favorite: true,
      secureNote: { type: 0 },
      // A hidden, a linked and a boolean field: every type comes back as it was read.
      fields: [
        { name: "License", value: "AAAAA-BBBBB", type: 1 },
        { name: "same", value: null, type: 3, linkedId: 100 },
        { name: "paid", value: "true", type: 2 },
      ],
      revisionDate: "2026-01-01T00:00:00.000Z",
    },
    login: { id: LOGIN_ID, type: 1, name: "Forum", notes: null, login: { username: "bot", password: "pw" }, revisionDate: "2026-01-01T00:00:00.000Z" },
  };

  it("renames a secure note and replaces its notes, sending back the item as read with only those two changed", async () => {
    const cli = fakeCli({ loggedIn: true, items: { [NOTE_ID]: stored.note, [LOGIN_ID]: stored.login } });
    const edited = await vaultOn(cli).editNote(NOTE_ID, { name: "TO DELETE: Editor licence", notes: "cancelled" });
    expect(cli.edits).toEqual([{ ...stored.note, name: "TO DELETE: Editor licence", notes: "cancelled" }]);
    expect(edited).toMatchObject({ kind: "note", name: "TO DELETE: Editor licence", notes: "cancelled", fields: [{ name: "License", hidden: true }, { name: "same" }, { name: "paid" }] });
  });

  it("keeps a login's edit for logins and a note's for notes", async () => {
    const cli = fakeCli({ loggedIn: true, items: { [NOTE_ID]: stored.note, [LOGIN_ID]: stored.login } });
    const vault = vaultOn(cli);
    const note = await outcome(vault.editLogin(NOTE_ID, { name: "x", organizationId: null, collectionIds: [], notes: null, username: null, password: null, totp: null, uris: [], fields: [] }));
    expect(note).toMatchObject({ error: { kind: "input", message: expect.stringContaining("is a secure note") } });
    expect(await outcome(vault.editNote(LOGIN_ID, { name: "x", notes: null }))).toMatchObject({ error: { kind: "input", message: expect.stringContaining("is a login") } });
    expect(await outcome(vault.editNote("11111111-1111-4111-8111-aaaaaaaaaaaa", { name: "x", notes: null }))).toMatchObject({ error: { kind: "not_found" } });
    expect(cli.edits).toEqual([]);
  });
});
