import type { Collection, Login } from "./schema.js";

/**
 * What a login looks like to the caller when it did not ask for a secret: no
 * password, no authenticator key, no hidden field's value. A secret leaves this
 * server only through `get_password`, `get_field` and `totp`, which name what
 * they return (and a current code, never the key, right after a key is stored).
 */
export const summaryOf = (login: Login, collections: readonly Collection[]) => ({
  id: login.id,
  kind: login.kind,
  name: login.name,
  username: login.username,
  urls: login.uris.map((u) => u.uri),
  hasPassword: login.password !== null && login.password !== "",
  hasTotp: login.totp !== null && login.totp !== "",
  collections: login.collectionIds.map((id) => collections.find((c) => c.id === id)?.name ?? id),
  revisionDate: login.revisionDate,
});

/** The summary plus the notes and the non-secret custom fields. Hidden fields show their names only. */
export const detailOf = (login: Login, collections: readonly Collection[]) => ({
  ...summaryOf(login, collections),
  notes: login.notes,
  fields: login.fields.map((f) => (f.hidden ? { name: f.name, hidden: true } : { name: f.name, value: f.value })),
  passwordRevisionDate: login.passwordRevisionDate,
});

/** The host a URL names, lower case, or `undefined` for text that is not a URL (Bitwarden stores both). */
export const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
};
