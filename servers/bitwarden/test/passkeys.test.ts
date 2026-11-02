/**
 * The passkey tools as a client sees them, through the kit's guard, against
 * the in-memory vault with the server's real cryptography. Every registration
 * and every signature is checked by an independent WebAuthn verifier
 * (@simplewebauthn/server), as a site would check it. Keys are made in the
 * test; none is written anywhere but the in-memory vault.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sha256Of } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { isGuid } from "../src/domain/passkey/ids.js";
import type { Login, Passkey } from "../src/domain/schema.js";
import { connected, INBOX, login } from "./support.js";
import { b64u, bitwardenMade, clientData as clientDataAt, exportOf, user, verifyCreate, verifyGet, type Credential } from "./webauthn.js";

const ORIGIN = "https://example.com";
const RP = "example.com";
const clientData = (type: "webauthn.create" | "webauthn.get", origin = ORIGIN) => clientDataAt(type, origin);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Call = (name: string, args?: Record<string, unknown>) => Promise<any>;

/** Register on example.com through the tool, and check the answer as the site would. */
const register = async (call: Call, name: string, more: Record<string, unknown> = {}) => {
  const data = clientData("webauthn.create");
  const made = await call("create_passkey", { rp_id: RP, rp_name: "Example", user: user(name), client_data_hash: data.hash, algorithms: [-7, -257], user_verified: true, ...more });
  expect(made.error).toBeUndefined();
  const checked = await verifyCreate(made, data, true);
  expect(checked.verified).toBe(true);
  return { made, info: checked.registrationInfo! };
};

/** Sign in through the tool, and check the signature as the site would with the key it registered. */
const signIn = async (call: Call, args: Record<string, unknown>, credential: Credential, requireUserVerification = false) => {
  const data = clientData("webauthn.get");
  const signed = await call("assert_passkey", { rp_id: RP, client_data_hash: data.hash, ...args });
  expect(signed.error).toBeUndefined();
  const checked = await verifyGet(signed, data, credential, requireUserVerification);
  expect(checked.verified).toBe(true);
  return { signed, info: checked.authenticationInfo };
};

const allPasskeys = (items: Map<string, Login>): Passkey[] => [...items.values()].flatMap((l) => l.passkeys);

/** No result may carry a private key: every stored keyValue is looked for in every answer. */
const noKeyIn = (items: Map<string, Login>, answers: unknown[]): void => {
  const text = JSON.stringify(answers);
  for (const p of allPasskeys(items)) expect(text).not.toContain(p.keyValue);
};

/** A stored passkey from an exported one. */
const storedFrom = (entry: Awaited<ReturnType<typeof bitwardenMade>>["entry"]): Passkey => ({ ...entry, counter: Number(entry.counter), discoverable: entry.discoverable === "true" });

describe("create_passkey and assert_passkey", () => {
  it("registers a passkey a verifier accepts, stored in Bitwarden's own shape, and signs in with it", async () => {
    const { call, items } = await connected();
    const { made, info } = await register(call, "agent@example.com");
    expect(made).toMatchObject({ publicKeyAlgorithm: -7, discoverable: true, rpId: RP, item: { name: "Example", created: true } });
    expect(info.aaguid).toBe("d548826e-79b4-db40-a3d8-11116f7e8349");
    expect(info.credentialBackedUp).toBe(true);
    expect(info.userVerified).toBe(true);
    expect(info.fmt).toBe("none");

    const stored = items.get(made.item.id)!;
    expect(stored).toMatchObject({ username: "agent@example.com", uris: [{ uri: ORIGIN }], collectionIds: ["c-agents"] });
    const passkey = stored.passkeys[0]!;
    expect(isGuid(passkey.credentialId)).toBe(true);
    expect(passkey).toMatchObject({ keyType: "public-key", keyAlgorithm: "ECDSA", keyCurve: "P-256", counter: 0, discoverable: true, rpId: RP, rpName: "Example" });
    expect(passkey.userHandle).toBe(user("agent@example.com").id);
    expect(Buffer.from(passkey.keyValue, "base64url")).toHaveLength(138); // PKCS#8 of a P-256 key with its public key, as WebCrypto exports it
    expect(made.credentialId).toBe(b64u(Buffer.from(passkey.credentialId.replace(/-/g, ""), "hex")));

    const before = stored.revisionDate;
    const discoverable = await signIn(call, {}, info.credential);
    expect(discoverable.signed).toMatchObject({ credentialId: made.credentialId, userHandle: passkey.userHandle, counter: 0, userName: "agent@example.com" });
    expect(discoverable.info.userVerified).toBe(false);
    const listed = await signIn(call, { allow_credentials: [made.credentialId], user_verified: true }, info.credential, true);
    expect(listed.info.userVerified).toBe(true);
    expect(listed.info.newCounter).toBe(0);
    expect(items.get(made.item.id)!.revisionDate).toBe(before); // a counter of 0 writes nothing
    noKeyIn(items, [made, discoverable.signed, listed.signed]);
  });

  it("puts the passkey in the login already saved for the account on the site", async () => {
    const { call, items } = await connected();
    const forum = login();
    const data = clientData("webauthn.create", "https://forum.example.com");
    const made = await call("create_passkey", { rp_id: "forum.example.com", user: user("bot@example.com"), client_data_hash: data.hash });
    expect(made.item).toEqual({ id: forum.id, name: forum.name, created: false });
    expect(items.get(forum.id)).toMatchObject({ password: forum.password, totp: forum.totp, passkeys: [{ rpId: "forum.example.com" }] });
  });

  it("refuses a login that holds another account's passkey, and replaces one for the same account", async () => {
    const { call } = await connected();
    const { made } = await register(call, "bot@example.com");
    const other = await call("create_passkey", { rp_id: RP, user: user("someone@example.com"), client_data_hash: clientData("webauthn.create").hash, item_id: made.item.id });
    expect(other.error).toMatchObject({ kind: "input", message: expect.stringContaining("already holds a passkey") });
    const again = await call("create_passkey", { rp_id: RP, user: user("bot@example.com"), client_data_hash: clientData("webauthn.create").hash, item_id: made.item.id });
    expect(again.item).toMatchObject({ id: made.item.id, created: false });
    const listed = await call("list_passkeys", { rp_id: RP });
    expect(listed.passkeys.map((p: { credentialId: string }) => p.credentialId)).toEqual([again.credentialId]);
  });

  it("refuses a registration the site excluded, and a site that takes no ES256 key, storing nothing", async () => {
    const { call, items } = await connected();
    const { made } = await register(call, "bot@example.com");
    const count = allPasskeys(items).length;
    const excluded = await call("create_passkey", { rp_id: RP, user: user("bot@example.com"), client_data_hash: clientData("webauthn.create").hash, exclude_credentials: [made.credentialId] });
    expect(excluded.error.kind).toBe("excluded");
    const rsa = await call("create_passkey", { rp_id: RP, user: user("new@example.com"), client_data_hash: clientData("webauthn.create").hash, algorithms: [-257] });
    expect(rsa.error.kind).toBe("unsupported");
    expect(allPasskeys(items)).toHaveLength(count);
  });

  it("answers several with the candidates when a discoverable sign-in matches more than one, then signs the one named", async () => {
    const { call, items } = await connected();
    const first = await register(call, "one@example.com");
    const second = await register(call, "two@example.com");
    const several = await call("assert_passkey", { rp_id: RP, client_data_hash: clientData("webauthn.get").hash });
    expect(several.error.kind).toBe("several");
    expect(several.error.candidates.map((c: { userName: string }) => c.userName).sort()).toEqual(["one@example.com", "two@example.com"]);
    noKeyIn(items, [several]);
    const picked = await signIn(call, { credential_id: second.made.credentialId }, second.info.credential);
    expect(picked.signed.userName).toBe("two@example.com");
    expect(first.made.credentialId).not.toBe(second.made.credentialId);
  });

  it("answers no_credential for a site the vault has no passkey for, and for a non-discoverable one asked without its id", async () => {
    const { call } = await connected();
    await register(call, "bot@example.com", { resident_key: false });
    const elsewhere = await call("assert_passkey", { rp_id: "other.example", client_data_hash: clientData("webauthn.get").hash });
    expect(elsewhere.error.kind).toBe("no_credential");
    const hidden = await call("assert_passkey", { rp_id: RP, client_data_hash: clientData("webauthn.get").hash });
    expect(hidden.error.kind).toBe("no_credential");
  });

  it("advances a counter above 0 and stores it before signing", async () => {
    const { call, items } = await connected();
    const made = await bitwardenMade(RP, "counted@example.com", { counter: "5" });
    const holder = login({ id: "22222222-2222-4222-8222-222222222222", name: "Counted", username: "counted@example.com", uris: [{ uri: ORIGIN }], passkeys: [] });
    items.set(holder.id, { ...holder, passkeys: [storedFrom(made.entry)] });
    const { signed, info } = await signIn(call, { allow_credentials: [made.credential.id] }, made.credential);
    expect(signed.counter).toBe(6);
    expect(info.newCounter).toBe(6);
    expect(items.get(holder.id)!.passkeys[0]!.counter).toBe(6);
  });

  it("refuses arguments that cannot be a WebAuthn request before touching the vault", async () => {
    const { call, syncs } = await connected();
    expect((await call("assert_passkey", { rp_id: RP, client_data_hash: "short" })).error.kind).toBe("input");
    expect((await call("assert_passkey", { rp_id: "https://example.com", client_data_hash: clientData("webauthn.get").hash })).error.kind).toBe("input");
    expect((await call("create_passkey", { rp_id: RP, user: { id: "", name: "x" }, client_data_hash: clientData("webauthn.create").hash })).error.kind).toBe("input");
    expect(syncs).toEqual([]);
  });
});

describe("list_passkeys, delete_passkey and health", () => {
  it("lists every passkey without its key, says which were shared, and counts them in health", async () => {
    const { call, items } = await connected();
    await register(call, "bot@example.com");
    const lent = await bitwardenMade("shop.example", "owner@example.com");
    const shared = login({ id: "33333333-3333-4333-8333-333333333333", name: "Shop", collectionIds: ["c-shared"], passkeys: [] });
    items.set(shared.id, { ...shared, passkeys: [storedFrom(lent.entry)] });
    const listed = await call("list_passkeys");
    expect(listed.count).toBe(2);
    expect(listed.passkeys).toEqual([
      expect.objectContaining({ rpId: RP, userName: "bot@example.com", shared: false, collections: ["Agents"] }),
      expect.objectContaining({ rpId: "shop.example", credentialId: lent.credential.id, itemId: shared.id, shared: true, collections: ["Shared"], createdAt: "2026-03-04T05:06:07.000Z" }),
    ]);
    expect((await call("list_passkeys", { search: "owner" })).count).toBe(1);
    expect((await call("list_passkeys", { rp_id: "nowhere.example" })).count).toBe(0);
    const health = await call("health");
    expect(health.passkeys).toBe(2);
    noKeyIn(items, [listed, health, await call("find_logins", {})]);
  });

  it("removes one passkey and keeps its login", async () => {
    const { call, items } = await connected();
    const forum = login();
    const made = await call("create_passkey", { rp_id: "forum.example.com", user: user("bot@example.com"), client_data_hash: clientData("webauthn.create").hash });
    const deleted = await call("delete_passkey", { item_id: forum.id, credential_id: made.credentialId });
    expect(deleted).toEqual({ item: { id: forum.id, name: forum.name }, deleted: { credentialId: made.credentialId, rpId: "forum.example.com", userName: "bot@example.com" }, passkeysLeft: 0 });
    expect(items.get(forum.id)).toMatchObject({ password: forum.password, passkeys: [] });
    expect((await call("delete_passkey", { item_id: forum.id, credential_id: made.credentialId })).error.kind).toBe("not_found");
  });
});

describe("import_passkeys", () => {
  it("imports the passkeys Bitwarden's apps made, from an export in the inbox, and each signs here", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bw-import-"));
    const a = await bitwardenMade(RP, "user0@example.com");
    const b = await bitwardenMade("other.example", "user1@example.com", { credentialId: `b64.${b64u(Buffer.from("an id from another provider"))}` });
    const rsa = await bitwardenMade(RP, "user2@example.com", { keyAlgorithm: "RSASSA-PKCS1-v1_5", keyCurve: "" });
    const bytes = Buffer.from(JSON.stringify(exportOf(ORIGIN, [[a.entry], [b.entry], [rsa.entry]])));
    await writeFile(join(dir, "export.json"), bytes);
    const { call, items } = await connected(dir);

    const result = await call("import_passkeys", { file: { path: "export.json" } });
    expect(result.file).toEqual({ name: "export.json", sha256: sha256Of(bytes), size: bytes.length });
    expect(result.passkeysImported).toBe(2);
    expect(result.imported.map((i: { itemName: string }) => i.itemName)).toEqual(["Example 0", "Example 1"]);
    expect(result.skipped).toEqual([{ item: "Example 2", rpId: RP, userName: "user2@example.com", reason: expect.stringContaining("ECDSA P-256") }]);
    const made = items.get(result.imported[0].itemId)!;
    expect(made).toMatchObject({ username: "user0@example.com", password: "pw-0", notes: "imported", fields: [{ name: "pin", value: "4321", hidden: true }], collectionIds: ["c-agents"] });
    expect(made.passkeys[0]).toMatchObject({ credentialId: a.entry.credentialId, keyValue: a.entry.keyValue, counter: 0, discoverable: true });
    noKeyIn(items, [result]);

    await signIn(call, {}, a.credential);
    const other = await call("assert_passkey", { rp_id: "other.example", client_data_hash: clientData("webauthn.get").hash });
    expect(other.credentialId).toBe(b64u(Buffer.from("an id from another provider")));

    const again = await call("import_passkeys", { file: { content_base64: bytes.toString("base64"), sha256: sha256Of(bytes), filename: "export.json" } });
    expect(again.passkeysImported).toBe(0);
    expect(again.skipped.filter((s: { reason: string }) => s.reason.startsWith("already in the vault"))).toHaveLength(2);
  });

  it("refuses an encrypted export and a file that is not JSON, importing nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bw-import-"));
    await writeFile(join(dir, "locked.json"), JSON.stringify({ encrypted: true, passwordProtected: true, data: "2.abc" }));
    await writeFile(join(dir, "notes.txt"), "not json");
    const { call, items } = await connected(dir);
    const count = items.size;
    expect((await call("import_passkeys", { file: { path: "locked.json" } })).error).toMatchObject({ kind: "input", message: expect.stringContaining("encrypted") });
    expect((await call("import_passkeys", { file: { path: "notes.txt" } })).error).toMatchObject({ kind: "input", message: expect.stringContaining("not JSON") });
    expect(items.size).toBe(count);
  });

  it("reads only from the inbox", async () => {
    const { call } = await connected();
    const outside = await call("import_passkeys", { file: { path: "/etc/passwd" } });
    expect(outside.error.kind).toBe("input");
    expect(INBOX).toBe("/srv/bitwarden-inbox");
  });
});
