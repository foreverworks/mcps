/**
 * The passkey tools against a real Bitwarden-compatible server: the BUILT
 * server over stdio, the pinned Bitwarden CLI, a throwaway account on a local
 * Vaultwarden, and every registration and signature checked by an independent
 * WebAuthn verifier (@simplewebauthn/server). A second CLI, logged in on its
 * own, reads back what was stored, as Bitwarden's apps would, and signs with
 * it the way their authenticator does. Keys are made in this run and printed
 * nowhere.
 *
 * The CLI talks to a server over HTTPS only, so Vaultwarden gets a
 * certificate from a throwaway authority, which the server and the CLI trust
 * through NODE_EXTRA_CA_CERTS:
 *
 *   mkdir -p ~/vaultwarden-it && cd ~/vaultwarden-it
 *   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ca.key -out ca.pem -days 30 -subj "/CN=test CA"
 *   openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout key.pem -out server.csr -subj "/CN=127.0.0.1"
 *   printf "subjectAltName=IP:127.0.0.1\n" > ext.cnf
 *   openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out cert.pem -days 30 -extfile ext.cnf
 *   docker run -d --rm --name vaultwarden-it -v "$PWD:/ssl:ro" -e 'ROCKET_TLS={certs="/ssl/cert.pem",key="/ssl/key.pem"}' \
 *     -e SIGNUPS_ALLOWED=true -e I_REALLY_WANT_VOLATILE_STORAGE=true -e ROCKET_PORT=443 -e DOMAIN=https://127.0.0.1:8580 \
 *     -e LOGIN_RATELIMIT_MAX_BURST=1000 -e LOGIN_RATELIMIT_SECONDS=1 -p 127.0.0.1:8580:443 vaultwarden/server:latest
 *
 *   npm run build -w @foreverworks/mcp-bitwarden
 *   cd servers/bitwarden
 *   BITWARDEN_SERVER=https://127.0.0.1:8580 NODE_EXTRA_CA_CERTS=~/vaultwarden-it/ca.pem npx tsx scripts/integration.ts
 *
 * DOMAIN must be the address the CLI reaches the server at: the CLI takes its
 * API and identity URLs from the server's own configuration. Each run makes a
 * new account, so it can run again against the same server. The raised login
 * limit is for runs back to back: Vaultwarden allows 10 sign-ins a minute from
 * one address by default, refilled at one a minute, and every run makes an
 * account and signs in with it; once the limit refuses one, each CLI call that
 * renews its token is refused too ("Error refreshing access token").
 */
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, sha256Of, StdioClientTransport } from "@foreverworks/mcp-kit";

import { b64u, bitwardenMade, bitwardenSigns, clientData, exportOf, guidId, user, verifyCreate, verifyGet, type Credential } from "../test/webauthn.js";
import { makeTestAccount } from "./integration/account.js";
import { makeReader } from "./integration/cli.js";

const ORIGIN = "https://example.com";
const RP = "example.com";
const GUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

let checks = 0;
const ok = (what: string): void => {
  checks++;
  console.log(`ok ${checks} - ${what}`);
};

const secretFile = async (dir: string, name: string, value: string): Promise<string> => {
  const path = join(dir, name);
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = any;

const main = async (): Promise<void> => {
  const server = process.env["BITWARDEN_SERVER"]?.replace(/\/$/, "");
  if (!server) throw new Error("set BITWARDEN_SERVER to a throwaway Vaultwarden (see this file's header)");
  const account = await makeTestAccount(server);
  ok(`a throwaway account on ${server}, with its API key`);

  const secrets = await mkdtemp(join(tmpdir(), "bw-it-secrets-"));
  const inbox = await mkdtemp(join(tmpdir(), "bw-it-inbox-"));
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    BITWARDEN_SERVER: server,
    BITWARDEN_STATE_DIR: await mkdtemp(join(tmpdir(), "bw-it-state-")),
    BITWARDEN_CLIENT_ID_FILE: await secretFile(secrets, "client-id", account.clientId),
    BITWARDEN_CLIENT_SECRET_FILE: await secretFile(secrets, "client-secret", account.clientSecret),
    BITWARDEN_MASTER_PASSWORD_FILE: await secretFile(secrets, "master-password", account.masterPassword),
    MCP_FILE_ROOTS: inbox,
    ...(process.env["NODE_EXTRA_CA_CERTS"] ? { NODE_EXTRA_CA_CERTS: process.env["NODE_EXTRA_CA_CERTS"] } : {}),
  };
  const client = new Client({ name: "integration", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dirname, "..", "dist", "index.js")], env }));
  const answers: unknown[] = [];
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Answer> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    const answer = JSON.parse(result.content[0]?.text ?? "{}");
    answers.push(answer);
    return answer;
  };
  const reader = await makeReader(server, account);

  const { tools } = await client.listTools();
  for (const name of ["list_passkeys", "create_passkey", "assert_passkey", "import_passkeys", "delete_passkey"]) assert.ok(tools.some((t) => t.name === name), name);
  ok("the built server lists the five passkey tools");
  const health = await call("health");
  assert.equal(health.ok, true, JSON.stringify(health.error));
  assert.equal(health.passkeys, 0);
  ok(`health: unlocked as the new account, 0 passkeys`);

  // A registration into a new login, read back by the other client as Bitwarden's apps would.
  const reg = clientData("webauthn.create", ORIGIN);
  const made = await call("create_passkey", { rp_id: RP, rp_name: "Example", user: user("agent@example.com"), client_data_hash: reg.hash, algorithms: [-7, -257], user_verified: true });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const registered = await verifyCreate(made, reg, true);
  assert.ok(registered.verified);
  assert.equal(registered.registrationInfo!.aaguid, "d548826e-79b4-db40-a3d8-11116f7e8349");
  assert.equal(registered.registrationInfo!.credentialBackedUp, true);
  ok("create_passkey: a new login, and the verifier accepts the attestation (format none, Bitwarden's AAGUID, backed up, UV)");
  const agent: Credential = registered.registrationInfo!.credential;

  const stored = await reader.item(made.item.id);
  const login = stored["login"] as { username: string; fido2Credentials: Record<string, unknown>[] };
  const fido = login.fido2Credentials[0]!;
  assert.equal(login.fido2Credentials.length, 1);
  assert.match(String(fido["credentialId"]), GUID);
  assert.equal(guidId(String(fido["credentialId"])), made.credentialId);
  assert.deepEqual(
    { keyType: fido["keyType"], keyAlgorithm: fido["keyAlgorithm"], keyCurve: fido["keyCurve"], rpId: fido["rpId"], counter: fido["counter"], discoverable: fido["discoverable"], userName: fido["userName"] },
    { keyType: "public-key", keyAlgorithm: "ECDSA", keyCurve: "P-256", rpId: RP, counter: "0", discoverable: "true", userName: "agent@example.com" },
  );
  assert.equal(fido["userHandle"], user("agent@example.com").id);
  assert.ok(!Number.isNaN(Date.parse(String(fido["creationDate"]))));
  assert.equal(login.username, "agent@example.com");
  ok("the pinned CLI kept fido2Credentials through `bw create item`: a GUID id, ECDSA P-256, counter \"0\", discoverable \"true\", as Bitwarden's apps write them");

  const theirs = clientData("webauthn.get", ORIGIN);
  const bySigned = await bitwardenSigns(fido as Parameters<typeof bitwardenSigns>[0], theirs.hash);
  assert.ok((await verifyGet(bySigned, theirs, agent, false)).verified);
  ok("signed from the stored key the way Bitwarden's authenticator signs (WebCrypto PKCS#8 import): the verifier accepts it");

  const get = clientData("webauthn.get", ORIGIN);
  const signed = await call("assert_passkey", { rp_id: RP, client_data_hash: get.hash });
  assert.equal(signed.error, undefined, JSON.stringify(signed.error));
  const verified = await verifyGet(signed, get, agent, false);
  assert.ok(verified.verified);
  assert.equal(signed.userHandle, user("agent@example.com").id);
  ok("assert_passkey, discoverable: the verifier accepts the signature; the user handle is the account's");
  const listedGet = clientData("webauthn.get", ORIGIN);
  const listed = await call("assert_passkey", { rp_id: RP, client_data_hash: listedGet.hash, allow_credentials: [made.credentialId], user_verified: true });
  const listedCheck = await verifyGet(listed, listedGet, agent, true);
  assert.ok(listedCheck.verified && listedCheck.authenticationInfo.userVerified);
  ok("assert_passkey with an allow list and user verification: accepted, UV set");

  // A login made first with create_login takes the passkey for its account, and keeps it through update_login.
  const forum = await call("create_login", { name: "Forum", url: "https://forum.example.com/login", username: "bot@example.com" });
  const forumReg = clientData("webauthn.create", "https://forum.example.com");
  const forumMade = await call("create_passkey", { rp_id: "forum.example.com", user: user("bot@example.com"), client_data_hash: forumReg.hash });
  assert.deepEqual(forumMade.item, { id: forum.id, name: "Forum", created: false });
  assert.ok((await verifyCreate(forumMade, forumReg, false)).verified);
  ok("create_passkey into the login already saved for the account (through `bw edit item`)");
  const rotated = await call("update_login", { id: forum.id, rotate_password: true, append_notes: "rotated by the integration run" });
  assert.equal(rotated.passwordChanged, true);
  const afterEdit = (await reader.item(forum.id))["login"] as { fido2Credentials: unknown[] };
  assert.equal(afterEdit.fido2Credentials.length, 1);
  const forumGet = clientData("webauthn.get", "https://forum.example.com");
  const forumSigned = await call("assert_passkey", { rp_id: "forum.example.com", client_data_hash: forumGet.hash });
  assert.ok((await verifyGet(forumSigned, forumGet, (await verifyCreate(forumMade, forumReg, false)).registrationInfo!.credential, false)).verified);
  ok("update_login (`bw edit item`) kept the passkey, and it still signs");

  // Two passkeys for one site: a discoverable sign-in asks which.
  const second = await call("create_passkey", { rp_id: RP, user: user("other@example.com"), client_data_hash: clientData("webauthn.create", ORIGIN).hash });
  const several = await call("assert_passkey", { rp_id: RP, client_data_hash: clientData("webauthn.get", ORIGIN).hash });
  assert.equal(several.error?.kind, "several");
  assert.deepEqual(several.error.candidates.map((c: { userName: string }) => c.userName).sort(), ["agent@example.com", "other@example.com"]);
  const picked = await call("assert_passkey", { rp_id: RP, client_data_hash: clientData("webauthn.get", ORIGIN).hash, credential_id: second.credentialId });
  assert.equal(picked.userName, "other@example.com");
  ok("two passkeys for the site: several with both candidates, then the one named signs");
  const excluded = await call("create_passkey", { rp_id: RP, user: user("agent@example.com"), client_data_hash: clientData("webauthn.create", ORIGIN).hash, exclude_credentials: [made.credentialId] });
  assert.equal(excluded.error?.kind, "excluded");
  const none = await call("assert_passkey", { rp_id: "nowhere.example", client_data_hash: clientData("webauthn.get", "https://nowhere.example").hash });
  assert.equal(none.error?.kind, "no_credential");
  ok("excluded on a registration the site excluded; no_credential for a site with none");

  // Import: passkeys Bitwarden's apps made (one with a counter), from a file in the inbox, then again as an attachment.
  const a = await bitwardenMade("shop.example", "user0@example.com");
  const b = await bitwardenMade("shop.example", "user1@example.com", { counter: "3", discoverable: "false" });
  const bytes = Buffer.from(JSON.stringify(exportOf("https://shop.example", [[a.entry], [b.entry]])));
  await writeFile(join(inbox, "export.json"), bytes, { mode: 0o600 });
  const imported = await call("import_passkeys", { file: { path: "export.json" } });
  assert.equal(imported.error, undefined, JSON.stringify(imported.error));
  assert.deepEqual(imported.file, { name: "export.json", sha256: sha256Of(bytes), size: bytes.length });
  assert.equal(imported.passkeysImported, 2);
  const importedItem = await reader.item(imported.imported[1].itemId);
  const importedFido = (importedItem["login"] as { fido2Credentials: Record<string, unknown>[] }).fido2Credentials[0]!;
  assert.deepEqual([importedFido["credentialId"], importedFido["counter"], importedFido["discoverable"]], [b.entry.credentialId, "3", "false"]);
  assert.equal(importedFido["keyValue"], b.entry.keyValue);
  ok("import_passkeys: two logins, their passkeys stored exactly as exported (counter \"3\", discoverable \"false\")");
  const again = await call("import_passkeys", { file: { content_base64: bytes.toString("base64"), sha256: sha256Of(bytes), filename: "export.json" } });
  assert.equal(again.passkeysImported, 0);
  assert.equal(again.skipped.length, 2);
  ok("the same file again, as an attachment with its SHA-256: both skipped as already in the vault");

  const shopGet = clientData("webauthn.get", "https://shop.example");
  const shopSigned = await call("assert_passkey", { rp_id: "shop.example", client_data_hash: shopGet.hash, allow_credentials: [b.credential.id] });
  const shopCheck = await verifyGet(shopSigned, shopGet, b.credential, false);
  assert.ok(shopCheck.verified);
  assert.equal(shopCheck.authenticationInfo.newCounter, 4);
  const counted = await reader.item(imported.imported[1].itemId);
  assert.equal((counted["login"] as { fido2Credentials: Record<string, unknown>[] }).fido2Credentials[0]!["counter"], "4");
  ok("an imported passkey signs; its counter 3 went to 4 in the vault before the signature, as Bitwarden's authenticator does");

  const listedAll = await call("list_passkeys");
  assert.equal(listedAll.count, 5);
  assert.equal((await call("health")).passkeys, 5);
  ok("list_passkeys and health: 5 passkeys");

  const deleted = await call("delete_passkey", { item_id: forum.id, credential_id: forumMade.credentialId });
  assert.equal(deleted.passkeysLeft, 0);
  const left = await reader.item(forum.id);
  assert.equal((left["login"] as { fido2Credentials?: unknown[] | null }).fido2Credentials?.length ?? 0, 0);
  assert.equal((left["login"] as { username: string }).username, "bot@example.com");
  ok("delete_passkey: the passkey is gone, the login stays");

  const keys = [a.entry.keyValue, b.entry.keyValue, String(fido["keyValue"])];
  const text = JSON.stringify(answers);
  assert.ok(keys.every((k) => !text.includes(k)));
  assert.ok(!text.includes(b64u(Buffer.from(account.masterPassword))) && !text.includes(account.masterPassword));
  ok(`no private key in any of the ${answers.length} answers`);

  await client.close();
  console.log(`\n${checks} checks passed`);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
