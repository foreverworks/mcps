import type { Field, Passkey, Uri } from "../schema.js";

/**
 * Bitwarden's JSON export, read for the logins that carry passkeys. Pure.
 *
 * The format is Bitwarden's own (bitwarden/clients,
 * libs/common/src/models/export: cipher.export.ts, login.export.ts and
 * fido2-credential.export.ts, at the tag cli-v2026.10.0): an object with
 * `encrypted: false` and `items`, each login keeping its passkeys in
 * `login.fido2Credentials`, with the counter and `discoverable` written as
 * text. Also taken: one exported item on its own, and an array of items, so a
 * single login copied out of an export imports the same way.
 */

/** The largest export this server reads: a vault of several thousand logins fits. */
export const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

/** A login to import, with the passkeys it carries; its folder, organization and collections stay behind. */
export type ImportedLogin = {
  readonly name: string;
  readonly notes: string | null;
  readonly username: string | null;
  readonly password: string | null;
  readonly totp: string | null;
  readonly uris: readonly Uri[];
  readonly fields: readonly Field[];
  readonly passkeys: readonly Passkey[];
  /** Custom fields not carried (Bitwarden's linked fields point at other fields of their own item). */
  readonly fieldsLeftOut: number;
};

export type Skipped = { readonly item: string; readonly rpId?: string; readonly userName?: string; readonly reason: string };

export type ExportReading = { readonly logins: readonly ImportedLogin[]; readonly skipped: readonly Skipped[] } | { readonly refused: string };

const LOGIN = 1;
const FIELD_TEXT = 0;
const FIELD_HIDDEN = 1;
const FIELD_BOOLEAN = 2;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Bitwarden writes the counter as text ("0"); a number is taken too. */
const counterOf = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,10}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : undefined;
};

/** Bitwarden writes `discoverable` as "true" or "false"; a boolean is taken too. */
const flagOf = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : undefined;

/** One exported passkey as a stored one, or why it cannot be. Never names the key. */
export const passkeyFromExport = (raw: unknown): Passkey | { readonly refused: string } => {
  if (!isObject(raw)) return { refused: "a passkey entry is not an object" };
  const credentialId = text(raw["credentialId"]);
  const keyValue = text(raw["keyValue"]);
  const rpId = text(raw["rpId"]);
  const counter = counterOf(raw["counter"] ?? "0");
  const discoverable = flagOf(raw["discoverable"] ?? "false");
  if (credentialId === null || credentialId === "") return { refused: "it has no credentialId" };
  if (keyValue === null || keyValue === "") return { refused: "it has no key (keyValue)" };
  if (rpId === null || rpId.trim() === "") return { refused: "it names no site (rpId)" };
  if (counter === undefined) return { refused: "its counter is not a whole number" };
  if (discoverable === undefined) return { refused: 'its discoverable flag is not "true" or "false"' };
  const created = text(raw["creationDate"]);
  return {
    credentialId,
    keyType: text(raw["keyType"]) ?? "",
    keyAlgorithm: text(raw["keyAlgorithm"]) ?? "",
    keyCurve: text(raw["keyCurve"]) ?? "",
    keyValue,
    rpId,
    rpName: text(raw["rpName"]),
    userHandle: text(raw["userHandle"]),
    userName: text(raw["userName"]),
    userDisplayName: text(raw["userDisplayName"]),
    counter,
    discoverable,
    creationDate: created !== null && !Number.isNaN(Date.parse(created)) ? new Date(created).toISOString() : null,
  };
};

const fieldsOf = (raw: unknown): { readonly fields: Field[]; readonly leftOut: number } => {
  const list = Array.isArray(raw) ? raw.filter(isObject) : [];
  const fields = list.flatMap((f): Field[] =>
    f["type"] === FIELD_TEXT || f["type"] === FIELD_HIDDEN || f["type"] === FIELD_BOOLEAN
      ? [{ name: text(f["name"]) ?? "", value: text(f["value"]), hidden: f["type"] === FIELD_HIDDEN }]
      : [],
  );
  return { fields, leftOut: list.length - fields.length };
};

/** The items of an export, a single exported item, or an array of items; or why the file is none of these. */
const itemsOf = (json: unknown): readonly unknown[] | { readonly refused: string } => {
  if (Array.isArray(json)) return json;
  if (!isObject(json)) return { refused: "the file is not a Bitwarden JSON export (not a JSON object)" };
  if (json["encrypted"] === true) {
    return { refused: "this export is encrypted; export the vault again from Bitwarden as .json (not encrypted), import it, then delete the file" };
  }
  if (Array.isArray(json["items"])) return json["items"];
  if (isObject(json["login"])) return [json];
  return { refused: "the file is not a Bitwarden JSON export: it has no items and is not one exported item" };
};

/**
 * The logins of an export that carry at least one passkey, each with every
 * passkey it carries; an entry that cannot be a passkey is listed in
 * `skipped` with the reason, and so is a login whose passkeys all were.
 */
export const readExport = (json: unknown): ExportReading => {
  const items = itemsOf(json);
  if ("refused" in items) return items;
  const logins: ImportedLogin[] = [];
  const skipped: Skipped[] = [];
  for (const item of items) {
    if (!isObject(item) || item["type"] !== LOGIN || !isObject(item["login"])) continue;
    const login = item["login"];
    const name = text(item["name"]) ?? "";
    const entries = Array.isArray(login["fido2Credentials"]) ? login["fido2Credentials"] : [];
    if (entries.length === 0) continue;
    const passkeys: Passkey[] = [];
    for (const entry of entries) {
      const read = passkeyFromExport(entry);
      if ("refused" in read) {
        const rpId = isObject(entry) ? text(entry["rpId"]) : null;
        const userName = isObject(entry) ? text(entry["userName"]) : null;
        skipped.push({ item: name, ...(rpId ? { rpId } : {}), ...(userName ? { userName } : {}), reason: read.refused });
      } else passkeys.push(read);
    }
    if (passkeys.length === 0) continue;
    const uris = (Array.isArray(login["uris"]) ? login["uris"] : []).flatMap((u): Uri[] => {
      const uri = isObject(u) ? text(u["uri"]) : null;
      return uri ? [{ uri }] : [];
    });
    const { fields, leftOut } = fieldsOf(item["fields"]);
    logins.push({
      name: name || passkeys[0]!.rpName || passkeys[0]!.rpId,
      notes: text(item["notes"]),
      username: text(login["username"]) ?? passkeys[0]!.userName,
      password: text(login["password"]),
      totp: text(login["totp"]),
      uris,
      fields,
      passkeys,
      fieldsLeftOut: leftOut,
    });
  }
  return { logins, skipped };
};
