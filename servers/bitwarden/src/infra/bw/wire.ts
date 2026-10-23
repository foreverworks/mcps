import { z } from "zod";

import type { Collection, Field, Login, LoginDraft, NoteDraft, Organization, VaultStatus } from "../../domain/schema.js";

/**
 * The CLI's JSON, the parts this server reads. Loose objects: the CLI adds
 * fields between releases, and an unknown field is not a failure.
 */

const uri = z.looseObject({ uri: z.string().nullable().optional() });
const field = z.looseObject({ name: z.string().nullable().optional(), value: z.string().nullable().optional(), type: z.number() });

export const itemWire = z.looseObject({
  id: z.string(),
  type: z.number(),
  name: z.string(),
  organizationId: z.string().nullable().optional(),
  collectionIds: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  fields: z.array(field).nullable().optional(),
  login: z
    .looseObject({
      username: z.string().nullable().optional(),
      password: z.string().nullable().optional(),
      totp: z.string().nullable().optional(),
      uris: z.array(uri).nullable().optional(),
      passwordRevisionDate: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  revisionDate: z.string(),
  passwordHistory: z
    .array(z.looseObject({ password: z.string().nullable().optional(), lastUsedDate: z.string().nullable().optional() }))
    .nullable()
    .optional(),
});
export type ItemWire = z.infer<typeof itemWire>;

export const statusWire = z.looseObject({
  status: z.enum(["unauthenticated", "locked", "unlocked"]),
  userEmail: z.string().nullable().optional(),
  serverUrl: z.string().nullable().optional(),
  lastSync: z.string().nullable().optional(),
});

export const collectionWire = z.looseObject({ id: z.string(), name: z.string(), organizationId: z.string() });
export const organizationWire = z.looseObject({ id: z.string(), name: z.string() });

/** Bitwarden's field types: 0 text, 1 hidden, 2 boolean, 3 linked. */
const HIDDEN = 1;
/** Bitwarden's item types: a login, and a secure note (created and read, never edited, here). */
export const LOGIN_TYPE = 1;
export const SECURE_NOTE_TYPE = 2;

/** The one kind of secure note Bitwarden has ("generic"). */
const GENERIC_NOTE = 0;

const fieldPayload = (f: Field) => ({ name: f.name, value: f.value, type: f.hidden ? HIDDEN : 0 });

const fieldOf = (f: z.infer<typeof field>): Field => ({ name: f.name ?? "", value: f.value ?? null, hidden: f.type === HIDDEN });

export const loginOf = (item: ItemWire): Login => ({
  id: item.id,
  kind: item.type === SECURE_NOTE_TYPE ? "note" : "login",
  name: item.name,
  organizationId: item.organizationId ?? null,
  collectionIds: item.collectionIds ?? [],
  notes: item.notes ?? null,
  username: item.login?.username ?? null,
  password: item.login?.password ?? null,
  totp: item.login?.totp ?? null,
  uris: (item.login?.uris ?? []).flatMap((u) => (u.uri ? [{ uri: u.uri }] : [])),
  fields: (item.fields ?? []).map(fieldOf),
  revisionDate: item.revisionDate,
  passwordRevisionDate: item.login?.passwordRevisionDate ?? null,
  previousPasswords: (item.passwordHistory ?? [])
    .flatMap((h) => (h.password ? [{ password: h.password, until: h.lastUsedDate ?? null }] : []))
    .sort((a, b) => (b.until ?? "").localeCompare(a.until ?? "")),
});

export const statusOf = (s: z.infer<typeof statusWire>): VaultStatus => ({
  status: s.status,
  userEmail: s.userEmail ?? null,
  serverUrl: s.serverUrl ?? null,
  lastSync: s.lastSync ?? null,
});

export const collectionOf = (c: z.infer<typeof collectionWire>): Collection => ({ id: c.id, name: c.name, organizationId: c.organizationId });
export const organizationOf = (o: z.infer<typeof organizationWire>): Organization => ({ id: o.id, name: o.name });

/**
 * The item JSON `bw create item` and `bw edit item` take. An edit starts from
 * the item as read (`base`), so fields this server does not model (password
 * history, favourites, the reprompt flag) survive it.
 */
export const itemPayload = (draft: LoginDraft, base: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...base,
  type: LOGIN_TYPE,
  name: draft.name,
  organizationId: draft.organizationId,
  collectionIds: draft.collectionIds,
  notes: draft.notes,
  fields: draft.fields.map(fieldPayload),
  login: {
    ...(typeof base["login"] === "object" && base["login"] !== null ? base["login"] : {}),
    username: draft.username,
    password: draft.password,
    totp: draft.totp,
    uris: draft.uris.map((u) => ({ uri: u.uri, match: null })),
  },
});

/** The item JSON `bw create item` takes for a secure note. */
export const notePayload = (draft: NoteDraft): Record<string, unknown> => ({
  type: SECURE_NOTE_TYPE,
  name: draft.name,
  organizationId: draft.organizationId,
  collectionIds: draft.collectionIds,
  notes: draft.notes,
  fields: draft.fields.map(fieldPayload),
  secureNote: { type: GENERIC_NOTE },
});
