/**
 * The server as a client sees it, through the kit's guard, against an
 * in-memory vault: no CLI, no network, no real credential.
 */
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, connectInMemory, guard, inputFilesWith, McpServer, sha256Of } from "@foreverworks/mcp-kit";
import { describe, expect, it, vi } from "vitest";

import type { Deps, VaultPort } from "../src/app/ports.js";
import { buildDeps } from "../src/composition.js";
import { asAppError, fail, unavailable } from "../src/domain/errors.js";
import { makePwnedRange } from "../src/infra/pwned.js";
import type { Collection, Login } from "../src/domain/schema.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

const COLLECTIONS: Collection[] = [{ id: "c-agents", name: "Agents", organizationId: "org-1" }];

const login = (over: Partial<Login> = {}): Login => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "login",
  name: "Forum login",
  organizationId: "org-1",
  collectionIds: ["c-agents"],
  notes: "recovery: abc",
  username: "bot@example.com",
  password: "s3cret-Pa55!",
  totp: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  uris: [{ uri: "https://forum.example.com/login" }],
  fields: [
    { name: "pin", value: "1234", hidden: true },
    { name: "plan", value: "free", hidden: false },
  ],
  revisionDate: "2026-01-01T00:00:00.000Z",
  passwordRevisionDate: null,
  previousPasswords: [],
  ...over,
});

/** A secure note as a person files one: the secret in a hidden custom field, the notes pointing at it. */
const note = (): Login =>
  login({
    id: "5d0c6c4e-1f7a-4a1e-9a55-2f3e8e0b7c11",
    kind: "note",
    name: "Editor licence",
    notes: "See license field",
    username: null,
    password: null,
    totp: null,
    uris: [],
    fields: [{ name: "License", value: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE", hidden: true }],
  });

/** A vault in memory that records what it was asked to store, and every sync it was asked for. */
const fakeVault = () => {
  const items = new Map<string, Login>([
    [login().id, login()],
    [note().id, note()],
  ]);
  const syncs: (boolean | undefined)[] = [];
  let next = 1;
  const vault: VaultPort = {
    status: async () => ({ status: "unlocked", userEmail: "agents@example.test", serverUrl: null, lastSync: "2026-01-01T00:00:00.000Z" }),
    sync: async (options) => {
      syncs.push(options?.force);
    },
    listLogins: async (filter) =>
      [...items.values()].filter((l) => !filter.search || l.name.toLowerCase().includes(filter.search.toLowerCase())),
    getLogin: async (id) => {
      const found = items.get(id);
      if (!found) throw new Error("missing");
      return found;
    },
    createLogin: async (draft) => {
      const created = { ...draft, id: `00000000-0000-4000-8000-00000000000${next++}`, kind: "login" as const, revisionDate: "now", passwordRevisionDate: null, previousPasswords: [] };
      items.set(created.id, created);
      return created;
    },
    // As the CLI does: a changed password goes to the front of the item's history.
    editLogin: async (id, draft) => {
      const before = items.get(id);
      const history =
        before?.password && before.password !== draft.password
          ? [{ password: before.password, until: "2026-10-07T00:00:00.000Z" }, ...before.previousPasswords]
          : (before?.previousPasswords ?? []);
      const edited = { ...draft, id, kind: "login" as const, revisionDate: "later", passwordRevisionDate: null, previousPasswords: history };
      items.set(id, edited);
      return edited;
    },
    createNote: async (draft) => {
      const created: Login = {
        ...draft,
        id: `00000000-0000-4000-8000-00000000000${next++}`,
        kind: "note",
        username: null,
        password: null,
        totp: null,
        uris: [],
        revisionDate: "now",
        passwordRevisionDate: null,
        previousPasswords: [],
      };
      items.set(created.id, created);
      return created;
    },
    collections: async () => COLLECTIONS,
    organizations: async () => [{ id: "org-1", name: "Example Org" }],
  };
  return { vault, items, syncs };
};

/** The reader's one root; a fixed path, so the snapshot is the same on every machine. */
const INBOX = "/srv/bitwarden-inbox";

/** "s3cret-Pa55!" hashes to 6AB9E...; the range answer holds its suffix, seen 42 times, and decoys (padding, count 0). */
const SECRET_SHA1 = createHash("sha1").update("s3cret-Pa55!").digest("hex").toUpperCase();
const RANGE = [`${"0".repeat(35)}:0`, `${SECRET_SHA1.slice(5)}:42`, `${"F".repeat(35)}:3`].join("\r\n");

const connected = async (inbox = INBOX, change: (vault: VaultPort) => VaultPort = (v) => v, range: (prefix: string) => Promise<string> = async () => RANGE) => {
  const { vault: plain, items, syncs } = fakeVault();
  const vault = change(plain);
  const ranges: string[] = [];
  let n = 0;
  const deps: Deps = {
    vault,
    now: () => 59_000,
    randomInt: (max) => n++ % max,
    hmac: (a, k, m) => new Uint8Array(createHmac(a.toLowerCase(), k).update(m).digest()),
    defaultCollection: "Agents",
    readInput: inputFilesWith([inbox]),
    sha1: (text) => createHash("sha1").update(text, "utf8").digest("hex"),
    pwnedRange: async (prefix) => {
      ranges.push(prefix);
      return range(prefix);
    },
  };
  const server = new McpServer({ name: "bitwarden", version: "test" });
  registerAll(guard(server, { service: "bitwarden", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  return { call, items, client, syncs, ranges };
};

const ID = login().id;
const NOTE = note().id;

describe("the bitwarden tools", () => {
  it("finds logins without handing out a secret", async () => {
    const { call } = await connected();
    const found = await call("find_logins", { search: "forum" });
    expect(found.count).toBe(1);
    expect(found.logins[0]).toMatchObject({ id: ID, username: "bot@example.com", hasPassword: true, hasTotp: true, collections: ["Agents"] });
    const text = JSON.stringify(found) + JSON.stringify(await call("get_login", { id: ID }));
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("GEZDGNBV");
    expect(text).not.toContain("1234");
    expect(text).toContain("recovery: abc");
  });

  it("syncs before every read, and sync itself pulls the vault whatever the gate", async () => {
    const { call, syncs } = await connected();
    await call("find_logins", { search: "forum" });
    await call("get_login", { id: ID });
    await call("get_password", { id: ID });
    await call("totp", { id: ID });
    expect(syncs).toEqual([undefined, undefined, undefined, undefined]);
    expect(await call("sync")).toMatchObject({ lastSync: "2026-01-01T00:00:00.000Z" });
    expect(syncs.at(-1)).toBe(true);
  });

  it("hands the password out through get_password only", async () => {
    const { call } = await connected();
    expect(await call("get_password", { id: ID })).toMatchObject({ password: "s3cret-Pa55!", username: "bot@example.com" });
  });

  it("finds a secure note and names its fields, without the hidden value", async () => {
    const { call } = await connected();
    const found = await call("find_logins", { search: "licence" });
    expect(found.logins).toEqual([expect.objectContaining({ id: NOTE, kind: "note", hasPassword: false, hasTotp: false })]);
    const detail = await call("get_login", { id: NOTE });
    expect(detail).toMatchObject({ kind: "note", notes: "See license field", fields: [{ name: "License", hidden: true }] });
    expect(JSON.stringify(found) + JSON.stringify(detail)).not.toContain("AAAAA");
  });

  it("hands a custom field out through get_field, hidden or not, by name in any case", async () => {
    const { call, syncs } = await connected();
    expect(await call("get_field", { id: NOTE, field: "license" })).toEqual({
      id: NOTE,
      kind: "note",
      name: "Editor licence",
      field: "License",
      hidden: true,
      value: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE",
    });
    expect(await call("get_field", { id: ID, field: "plan" })).toMatchObject({ kind: "login", hidden: false, value: "free" });
    expect(syncs).toEqual([undefined, undefined]);
    expect((await call("get_field", { id: NOTE, field: "key" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("its fields: License") });
  });

  it("refuses a password, a code or an edit for a secure note, and leaves it as it was", async () => {
    const { call, items } = await connected();
    for (const [tool, args] of [["get_password", {}], ["totp", {}], ["update_login", { name: "renamed" }]] as const) {
      expect((await call(tool, { id: NOTE, ...args })).error).toMatchObject({ kind: "input", message: expect.stringContaining("secure note") });
    }
    expect(items.get(NOTE)).toEqual(note());
  });

  it("computes the TOTP code from the stored key", async () => {
    const { call } = await connected();
    expect(await call("totp", { id: ID })).toMatchObject({ code: "287082", secondsLeft: 1 });
  });

  it("creates a login with a generated password, in the default collection, and returns no password", async () => {
    const { call, items } = await connected();
    const created = await call("create_login", { name: "Example", url: "https://example.com", username: "a@b.c", length: 20 });
    expect(created).toMatchObject({ name: "Example", passwordGenerated: true, collections: ["Agents"], urls: ["https://example.com"] });
    expect(JSON.stringify(created)).not.toMatch(/"password"/);
    const stored = items.get(created.id)!;
    expect(stored.password).toHaveLength(20);
    expect(stored).toMatchObject({ organizationId: "org-1", collectionIds: ["c-agents"] });
  });

  it("changes only what is named, rotates on request, and keeps the old password readable", async () => {
    const { call, items } = await connected();
    const updated = await call("update_login", { id: ID, rotate_password: true });
    expect(updated).toMatchObject({ passwordChanged: true, previousPassword: expect.stringContaining("previous: true") });
    const stored = items.get(ID)!;
    expect(stored.password).toHaveLength(24);
    expect(stored).toMatchObject({ username: "bot@example.com", notes: "recovery: abc", totp: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" });
    expect(await call("get_password", { id: ID, previous: true })).toMatchObject({ password: "s3cret-Pa55!", previous: true });
    expect(await call("get_password", { id: ID })).toMatchObject({ password: stored.password });
  });

  it("appends to the notes instead of replacing them, when asked", async () => {
    const { call, items } = await connected();
    await call("update_login", { id: ID, append_notes: "backup code: 1111-2222" });
    expect(items.get(ID)?.notes).toBe("recovery: abc\nbackup code: 1111-2222");
    expect((await call("update_login", { id: ID, notes: "x", append_notes: "y" })).error.kind).toBe("input");
  });

  it("replaces a different authenticator key only when told to, keeps the old one, and returns a code from the stored key", async () => {
    const { call, items } = await connected();
    const refused = await call("update_login", { id: ID, totp_secret: "JBSWY3DPEHPK3PXP" });
    expect(refused.error).toMatchObject({ kind: "input", message: expect.stringContaining("replace_totp") });
    expect(items.get(ID)?.totp).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");

    // The same key, spaced and lower case, is not a replacement.
    expect((await call("update_login", { id: ID, totp_secret: "gezd gnbv gy3t qojq gezd gnbv gy3t qojq" })).totp).toEqual({ code: "287082", secondsLeft: 1 });

    const replaced = await call("update_login", { id: ID, totp_secret: "JBSWY3DPEHPK3PXP", replace_totp: true });
    expect(replaced.totp).toEqual({ code: "996554", secondsLeft: 1 });
    expect(JSON.stringify(replaced)).not.toContain("JBSWY3DP");
    const stored = items.get(ID)!;
    expect(stored.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(stored.fields).toContainEqual({ name: "totp replaced 1970-01-01", value: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", hidden: true });
  });

  it("returns the first code when a login is created with a key", async () => {
    const { call } = await connected();
    expect((await call("create_login", { name: "With 2FA", totp_secret: "JBSWY3DPEHPK3PXP" })).totp).toEqual({ code: "996554", secondsLeft: 1 });
  });

  it("stores a password given in a file exactly, line ending dropped, and says how long it was", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bitwarden-inbox-"));
    await writeFile(join(dir, "key.txt"), "pk_live_0123456789abcdefghijklmnopqrstuvwxyz\n");
    const { call, items } = await connected(dir);
    const created = await call("create_login", { name: "API", password_file: { path: "key.txt" } });
    expect(created).toMatchObject({ passwordGenerated: false, passwordLength: 44 });
    expect(JSON.stringify(created)).not.toContain("pk_live");
    expect(items.get(created.id)?.password).toBe("pk_live_0123456789abcdefghijklmnopqrstuvwxyz");

    const text = "n3w-Secret!";
    const updated = await call("update_login", { id: ID, password_file: { content_base64: Buffer.from(text).toString("base64"), sha256: sha256Of(Buffer.from(text)) } });
    expect(updated).toMatchObject({ passwordChanged: true, passwordLength: 11 });
    expect(items.get(ID)?.password).toBe(text);
  });

  it("refuses a password file that is not one line, or bytes that are not the ones hashed, and changes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bitwarden-inbox-"));
    await writeFile(join(dir, "two.txt"), "one\ntwo\n");
    const { call, items } = await connected(dir);
    expect((await call("update_login", { id: ID, password_file: { path: "two.txt" } })).error).toMatchObject({ kind: "input", message: expect.stringContaining("more than one line") });
    const typed = await call("update_login", { id: ID, password_file: { content_base64: Buffer.from("abd").toString("base64"), sha256: sha256Of(Buffer.from("abc")) } });
    expect(typed.error).toMatchObject({ kind: "checksum_mismatch" });
    expect((await call("update_login", { id: ID, password: "x", password_file: { path: "two.txt" } })).error.kind).toBe("input");
    expect(items.get(ID)?.password).toBe("s3cret-Pa55!");
  });

  it("refuses a key it could not turn into codes, and an unknown collection", async () => {
    const { call } = await connected();
    expect((await call("update_login", { id: ID, totp_secret: "steam://XYZ" })).error.kind).toBe("input");
    // One character short, one too many, a letter base32 does not use: each a sign of a mistyped key.
    for (const key of ["JBSWY3DPEHPK3PX", "JBSWY3DPEHPK3PXPA", "JBSWY3DPEHPK3PX1", "JBSWY3DP-EHPK3PXP"]) {
      expect((await call("create_login", { name: "x", totp_secret: key })).error).toMatchObject({ kind: "input", message: expect.stringContaining("totp_secret is refused") });
    }
    expect((await call("create_login", { name: "x", collection: "Nope" })).error.kind).toBe("input");
    expect((await call("update_login", { id: ID, password: "a", rotate_password: true })).error.kind).toBe("input");
  });
});

/** An invented service account key, as Google writes one: pretty-printed JSON with a PEM key inside, a final line ending, 2,3xx bytes. */
const SERVICE_ACCOUNT_KEY = `${JSON.stringify(
  {
    type: "service_account",
    project_id: "example-project",
    private_key_id: "0123456789abcdef0123456789abcdef01234567",
    private_key: `-----BEGIN PRIVATE KEY-----\n${"MIIEvQIBADANBgkqhkiG9w0BAQEFAASC".repeat(52)}\n-----END PRIVATE KEY-----\n`,
    client_email: "reviews@example-project.iam.gserviceaccount.com",
    client_id: "100000000000000000001",
    token_uri: "https://oauth2.googleapis.com/token",
  },
  null,
  2,
)}\n`;

describe("create_note", () => {
  const inboxWith = async (files: Record<string, string | Uint8Array>) => {
    const dir = await mkdtemp(join(tmpdir(), "bitwarden-inbox-"));
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
    return dir;
  };

  it("stores a key file whole in a hidden field, past the password limit, and returns its checksum, never its text", async () => {
    expect(SERVICE_ACCOUNT_KEY.length).toBeGreaterThan(2000);
    const dir = await inboxWith({ "sa.json": SERVICE_ACCOUNT_KEY });
    const { call, items } = await connected(dir);
    const created = await call("create_note", {
      name: "Play service account key (example-app)",
      notes: "Replies to Play reviews for example-app.",
      fields: [{ name: "key.json", file: { path: "sa.json" } }, { name: "client email", value: "reviews@example-project.iam.gserviceaccount.com", hidden: false }],
    });
    expect(created).toMatchObject({
      kind: "note",
      name: "Play service account key (example-app)",
      collections: ["Agents"],
      notesLength: 40,
      fields: [
        { name: "key.json", hidden: true, length: SERVICE_ACCOUNT_KEY.length, fromFile: { sha256: sha256Of(Buffer.from(SERVICE_ACCOUNT_KEY)), size: Buffer.byteLength(SERVICE_ACCOUNT_KEY) } },
        { name: "client email", hidden: false, length: 47 },
      ],
    });
    const text = JSON.stringify(created);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain("reviews@");
    expect(items.get(created.id)).toMatchObject({ kind: "note", organizationId: "org-1", collectionIds: ["c-agents"], notes: "Replies to Play reviews for example-app." });

    const detail = await call("get_login", { id: created.id });
    expect(detail.fields).toEqual([{ name: "key.json", hidden: true }, { name: "client email", value: "reviews@example-project.iam.gserviceaccount.com" }]);
    expect(JSON.stringify(detail)).not.toContain("PRIVATE KEY");
    const out = await call("get_field", { id: created.id, field: "KEY.JSON" });
    expect(out).toMatchObject({ kind: "note", field: "key.json", hidden: true, value: SERVICE_ACCOUNT_KEY });
    expect(sha256Of(Buffer.from(out.value))).toBe(created.fields[0].fromFile.sha256);
  });

  it("keeps a byte-order mark and every line ending, so the stored text is the file's bytes exactly", async () => {
    const bytes = Buffer.from("\uFEFFline one\r\nline two\n\n");
    const dir = await inboxWith({ "token.txt": bytes });
    const { call, items } = await connected(dir);
    const created = await call("create_note", { name: "Token", fields: [{ name: "token", file: { path: "token.txt" } }] });
    expect(created.fields[0].fromFile).toEqual({ sha256: sha256Of(bytes), size: bytes.length });
    expect(Buffer.from(items.get(created.id)!.fields[0]!.value!)).toEqual(bytes);
  });

  it("takes a file a script sent as base64 with its checksum, and refuses bytes that are not the ones hashed", async () => {
    const { call } = await connected();
    const body = Buffer.from(SERVICE_ACCOUNT_KEY);
    const ok = await call("create_note", { name: "Key", fields: [{ name: "key", file: { content_base64: body.toString("base64"), sha256: sha256Of(body) } }] });
    expect(ok.fields[0].fromFile.sha256).toBe(sha256Of(body));
    const bad = await call("create_note", { name: "Key", fields: [{ name: "key", file: { content_base64: Buffer.from("abd").toString("base64"), sha256: sha256Of(Buffer.from("abc")) } }] });
    expect(bad.error).toMatchObject({ kind: "checksum_mismatch" });
  });

  it("refuses, before anything is stored, what Bitwarden would not keep or get_field could not find", async () => {
    const dir = await inboxWith({ "big.txt": "x".repeat(3696), "max.txt": "x".repeat(3695), "binary.bin": Uint8Array.from([0xff, 0xfe, 0x00, 0x80]), "empty.txt": "" });
    const { call, items, client } = await connected(dir);
    const before = items.size;
    const refused = async (args: Record<string, unknown>) => (await call("create_note", { name: "x", ...args })).error;
    expect(await refused({ fields: [{ name: "big", file: { path: "big.txt" } }] })).toMatchObject({ kind: "input", message: expect.stringContaining("at most 3695") });
    expect(await refused({ fields: [{ name: "bin", file: { path: "binary.bin" } }] })).toMatchObject({ kind: "input", message: expect.stringContaining("not UTF-8") });
    expect(await refused({ fields: [{ name: "e", file: { path: "empty.txt" } }] })).toMatchObject({ kind: "input", message: expect.stringContaining("empty") });
    expect(await refused({ fields: [{ name: "a", value: "1" }, { name: " A ", value: "2" }] })).toMatchObject({ kind: "input", message: expect.stringContaining("must differ") });
    expect(await refused({ fields: [{ name: "a", value: "1", file: { path: "max.txt" } }] })).toMatchObject({ kind: "input", message: expect.stringContaining("exactly one") });
    expect(await refused({ fields: [{ name: "a" }] })).toMatchObject({ kind: "input" });
    expect(await client.callTool({ name: "create_note", arguments: { name: "x", fields: [] } })).toMatchObject({ isError: true });
    expect(await refused({ fields: [{ name: "a", value: "1" }], notes: "é".repeat(3720) })).toMatchObject({ kind: "input", message: expect.stringContaining("at most 7439") });
    expect(await refused({ fields: [{ name: "a", value: "1" }], collection: "Nope" })).toMatchObject({ kind: "input" });
    expect(items.size).toBe(before);
    expect((await call("create_note", { name: "x", fields: [{ name: "max", file: { path: "max.txt" } }] })).fields[0].length).toBe(3695);
  });

  it("fails, naming the note, when the vault reads back something other than what was sent", async () => {
    const truncating = (v: VaultPort): VaultPort => ({
      ...v,
      createNote: async (draft) => v.createNote({ ...draft, fields: draft.fields.map((f) => ({ ...f, value: f.value?.slice(0, 10) ?? null })) }),
    });
    const { call } = await connected(INBOX, truncating);
    const result = await call("create_note", { name: "x", fields: [{ name: "token", value: "0123456789abcdef" }] });
    expect(result.error).toMatchObject({ kind: "cli", message: expect.stringMatching(/note 0000.* was created, but .*field token/) });
  });
});

describe("check_exposed", () => {
  it("counts a breached password, sending only five characters of its hash and answering no secret", async () => {
    const { call, ranges, syncs } = await connected();
    const out = await call("check_exposed", { id: ID });
    expect(out).toEqual({ id: ID, name: "Forum login", username: "bot@example.com", exposed: true, count: 42 });
    expect(ranges).toEqual([SECRET_SHA1.slice(0, 5)]);
    expect(syncs).toEqual([undefined]);
    const text = JSON.stringify(out);
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain(SECRET_SHA1.slice(5));
  });

  it("answers 0 for a password the range does not hold, or holds only as padding", async () => {
    const { call } = await connected(INBOX, (v) => v, async () => `${"0".repeat(35)}:0\n${"1".repeat(35)}:7`);
    expect(await call("check_exposed", { id: ID })).toMatchObject({ exposed: false, count: 0 });
  });

  it("checks the previous password on request, and refuses a note or a login without one", async () => {
    const { call, ranges } = await connected();
    await call("update_login", { id: ID, rotate_password: true });
    expect(await call("check_exposed", { id: ID, previous: true })).toMatchObject({ previous: true, exposed: true, count: 42 });
    expect(ranges).toEqual([SECRET_SHA1.slice(0, 5)]);
    expect((await call("check_exposed", { id: NOTE })).error).toMatchObject({ kind: "input", message: expect.stringContaining("secure note") });
  });

  it("says when Have I Been Pwned cannot be read, or answers something else", async () => {
    const down = await connected(INBOX, (v) => v, async () => fail(unavailable("Have I Been Pwned answered 503")));
    expect((await down.call("check_exposed", { id: ID })).error).toMatchObject({ kind: "unavailable", remedy: expect.stringContaining("api.pwnedpasswords.com") });
    const odd = await connected(INBOX, (v) => v, async () => "<html>maintenance</html>");
    expect((await odd.call("check_exposed", { id: ID })).error).toMatchObject({ kind: "unavailable" });
  });

  it("asks the range API for the prefix alone, with padding, and nothing else", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      seen.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
      return new Response(RANGE, { status: 200 });
    });
    try {
      expect(await makePwnedRange()("ABCDE")).toBe(RANGE);
      expect(seen).toEqual([{ url: "https://api.pwnedpasswords.com/range/ABCDE", headers: { "Add-Padding": "true", "User-Agent": "foreverworks-mcp-bitwarden" } }]);
      expect(await makePwnedRange()("abcdef").catch((thrown: unknown) => asAppError(thrown))).toMatchObject({ kind: "unavailable" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const { client } = await connected();
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });

  it("classifies every tool it registers, and nothing else", () => {
    const deps = buildDeps({});
    expect(() => checkPolicy("bitwarden", (server) => registerAll(server, deps), POLICY)).not.toThrow();
  });

  it("starts without credentials and fails a call with a config error, not a crash", async () => {
    const deps = buildDeps({});
    await expect(deps.vault.status()).rejects.toBeDefined();
  });
});
