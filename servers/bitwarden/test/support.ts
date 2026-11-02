/**
 * What the server tests share: an in-memory vault that behaves as the CLI
 * does where it matters (an edit keeps what it is not told to change), and a
 * client connected to the server through the kit's guard.
 */
import { createHash, createHmac } from "node:crypto";

import { connectInMemory, guard, inputFilesWith, McpServer } from "@foreverworks/mcp-kit";

import type { Deps, VaultPort } from "../src/app/ports.js";
import { fail, notFound } from "../src/domain/errors.js";
import type { Collection, Login } from "../src/domain/schema.js";
import { makePasskeyCrypto } from "../src/infra/passkeyCrypto.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

export const COLLECTIONS: Collection[] = [
  { id: "c-agents", name: "Agents", organizationId: "org-1" },
  { id: "c-shared", name: "Shared", organizationId: "org-1" },
  { id: "c-team", name: "Team", organizationId: "org-2" },
];

export const login = (over: Partial<Login> = {}): Login => ({
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
  passkeys: [],
  ...over,
});

/** A secure note as a person files one: the secret in a hidden custom field, the notes pointing at it. */
export const note = (): Login =>
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

/** A vault in memory that records what it was asked to store, every move, and every sync it was asked for. */
export const fakeVault = () => {
  const items = new Map<string, Login>([
    [login().id, login()],
    [note().id, note()],
  ]);
  const syncs: (boolean | undefined)[] = [];
  const moves: { id: string; collectionIds: readonly string[] }[] = [];
  let next = 1;
  const vault: VaultPort = {
    status: async () => ({ status: "unlocked", userEmail: "agents@example.test", serverUrl: null, lastSync: "2026-01-01T00:00:00.000Z" }),
    sync: async (options) => {
      syncs.push(options?.force);
    },
    listLogins: async (filter) =>
      [...items.values()].filter((l) => !filter.search || l.name.toLowerCase().includes(filter.search.toLowerCase())),
    getLogin: async (id) => items.get(id) ?? fail(notFound(`no item ${id}`)),
    createLogin: async (draft) => {
      const created: Login = {
        ...draft,
        id: `00000000-0000-4000-8000-00000000000${next++}`,
        kind: "login" as const,
        revisionDate: "now",
        passwordRevisionDate: null,
        previousPasswords: [],
        passkeys: draft.passkeys ?? [],
      };
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
      // As the CLI does with a payload built from the item as read: its passkeys stay.
      const edited = { ...draft, id, kind: "login" as const, revisionDate: "later", passwordRevisionDate: null, previousPasswords: history, passkeys: before?.passkeys ?? [] };
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
        passkeys: [],
      };
      items.set(created.id, created);
      return created;
    },
    setPasskeys: async (id, passkeys) => {
      const before = items.get(id) ?? fail(notFound(`no item ${id}`));
      const edited = { ...before, passkeys: [...passkeys], revisionDate: "passkeys" };
      items.set(id, edited);
      return edited;
    },
    // As the CLI does: the item's collections become the ones sent, and an item outside any organization is refused.
    moveItem: async (id, collectionIds) => {
      const before = items.get(id) ?? fail(notFound(`no item ${id}`));
      if (before.organizationId === null) throw new Error("Item does not belong to an organization. Consider moving it first.");
      moves.push({ id, collectionIds: [...collectionIds] });
      items.set(id, { ...before, collectionIds: [...collectionIds], revisionDate: "moved" });
    },
    collections: async () => COLLECTIONS,
    organizations: async () => [
      { id: "org-1", name: "Example Org" },
      { id: "org-2", name: "Other Org" },
    ],
  };
  return { vault, items, syncs, moves };
};

/** The reader's one root; a fixed path, so the snapshot is the same on every machine. */
export const INBOX = "/srv/bitwarden-inbox";

/** "s3cret-Pa55!" hashes to 6AB9E...; the range answer holds its suffix, seen 42 times, and decoys (padding, count 0). */
export const SECRET_SHA1 = createHash("sha1").update("s3cret-Pa55!").digest("hex").toUpperCase();
export const RANGE = [`${"0".repeat(35)}:0`, `${SECRET_SHA1.slice(5)}:42`, `${"F".repeat(35)}:3`].join("\r\n");

export const connected = async (inbox = INBOX, change: (vault: VaultPort) => VaultPort = (v) => v, range: (prefix: string) => Promise<string> = async () => RANGE) => {
  const { vault: plain, items, syncs, moves } = fakeVault();
  const vault = change(plain);
  const ranges: string[] = [];
  let n = 0;
  let ids = 0;
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
    passkeyCrypto: makePasskeyCrypto(),
    newCredentialId: () => `aaaaaaaa-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    readExport: inputFilesWith([inbox]),
  };
  const server = new McpServer({ name: "bitwarden", version: "test" });
  registerAll(guard(server, { service: "bitwarden", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  return { call, items, client, syncs, ranges, moves };
};

