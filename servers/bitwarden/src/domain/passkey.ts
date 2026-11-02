import { hostOf } from "./views.js";
import { fromBase64Url, isGuid, rawCredentialId, sameBytes, webauthnId } from "./passkey/ids.js";
import type { Collection, Login, Passkey } from "./schema.js";

/**
 * The rules of a vault that answers WebAuthn requests the way Bitwarden's own
 * authenticator does, so a passkey moves between this server and Bitwarden's
 * apps either way. Pure.
 *
 * Source for each rule: bitwarden/clients,
 * libs/common/src/platform/services/fido2/fido2-authenticator.service.ts at
 * the tag cli-v2026.10.0 (b449ac1d255784380d75ef026343198891286be7).
 */

/** Bitwarden's key description for every passkey it makes (createKeyView). */
export const KEY_TYPE = "public-key";
export const KEY_ALGORITHM = "ECDSA";
export const KEY_CURVE = "P-256";

/** A passkey and the login that holds it. */
export type Held = { readonly login: Login; readonly passkey: Passkey };

/** Why a stored passkey cannot sign here, or `undefined` when it can. Its key itself is checked by the caller's crypto. */
export const unusable = (passkey: Passkey): string | undefined => {
  if (passkey.keyType !== KEY_TYPE || passkey.keyAlgorithm !== KEY_ALGORITHM || passkey.keyCurve !== KEY_CURVE) {
    return `its key is ${passkey.keyAlgorithm} ${passkey.keyCurve}, and only ECDSA P-256 (ES256) passkeys sign here, as in Bitwarden's apps`;
  }
  if (rawCredentialId(passkey.credentialId) === undefined) return "its credential id is neither a GUID nor b64. and base64url";
  if (passkey.rpId.trim() === "") return "it names no site (rpId)";
  if (fromBase64Url(passkey.keyValue) === undefined) return "its key is not base64url";
  return undefined;
};

/** Every passkey of these logins, each with its login. */
export const heldIn = (logins: readonly Login[]): Held[] =>
  logins.flatMap((login) => (login.kind === "login" ? login.passkeys.map((passkey) => ({ login, passkey })) : []));

const isListed = (passkey: Passkey, ids: readonly Uint8Array[]): boolean => {
  const raw = rawCredentialId(passkey.credentialId);
  return raw !== undefined && ids.some((id) => sameBytes(id, raw));
};

/**
 * The passkeys that could answer a sign-in (findCredential): with an allow
 * list, those it names for this RP ID; without one (a discoverable request),
 * every discoverable passkey for the RP ID. With `credentialId`, only that
 * one of them: the caller's pick after an answer listed several.
 */
export const candidatesFor = (
  held: readonly Held[],
  request: { readonly rpId: string; readonly allowCredentials: readonly Uint8Array[]; readonly credentialId?: Uint8Array },
): Held[] => {
  const forSite = held.filter(({ passkey }) => passkey.rpId === request.rpId && unusable(passkey) === undefined);
  const allowed =
    request.allowCredentials.length > 0 ? forSite.filter(({ passkey }) => isListed(passkey, request.allowCredentials)) : forSite.filter(({ passkey }) => passkey.discoverable);
  return request.credentialId === undefined ? allowed : allowed.filter(({ passkey }) => isListed(passkey, [request.credentialId!]));
};

/**
 * A passkey for this RP ID that the request's exclude list names, if any: a
 * registration must then fail (WebAuthn's InvalidStateError), as the site
 * already holds a passkey of this vault for the account. Bitwarden's apps
 * compare GUID ids in the account's own vault only; this compares every id,
 * in every collection the account reads, which is what the specification asks.
 */
export const excludedBy = (held: readonly Held[], rpId: string, exclude: readonly Uint8Array[]): Held | undefined =>
  exclude.length === 0 ? undefined : held.find(({ passkey }) => passkey.rpId === rpId && isListed(passkey, exclude));

/**
 * The counter after a sign-in (getAssertion): a counter above 0 goes up by one
 * and is stored before the signature is made; a counter of 0, which is what
 * Bitwarden's apps give every passkey they make, stays 0, so a sign-in with
 * one changes nothing in the vault. A site then sees 0 every time, which
 * WebAuthn reads as "this authenticator keeps no counter".
 */
export const counterAfterUse = (counter: number): number => (counter > 0 ? counter + 1 : 0);

/** The site a login's URLs name matches the RP ID: the same host, or a host under it. */
const forSite = (login: Login, rpId: string): boolean =>
  login.uris.some((u) => {
    const host = hostOf(u.uri);
    return host !== undefined && (host === rpId || host.endsWith(`.${rpId}`));
  });

/**
 * Where a new passkey goes when the caller names no item: the one login that
 * already stands for this account on this site (its URL's host is the RP ID
 * or under it, its username is the user's name, it holds no passkey), so the
 * password, the 2FA key and the passkey of one identity stay one item. None,
 * or more than one: `undefined`, and the passkey gets a login of its own.
 */
export const homeFor = (logins: readonly Login[], rpId: string, userName: string): Login | undefined => {
  const wanted = userName.trim().toLowerCase();
  if (wanted === "") return undefined;
  const fits = logins.filter(
    (l) => l.kind === "login" && l.passkeys.length === 0 && (l.username ?? "").trim().toLowerCase() === wanted && forSite(l, rpId),
  );
  return fits.length === 1 ? fits[0] : undefined;
};

/**
 * Why a named login cannot take a new passkey, or `undefined` when it can.
 * Bitwarden's apps keep one passkey per login and save a new one only into a
 * login without one, or over one for the same account (the same RP ID and
 * user handle), which the new one then replaces.
 */
export const cannotHold = (login: Login, rpId: string, userHandle: string): string | undefined => {
  if (login.kind !== "login") return `${login.name} is a secure note; a passkey goes in a login`;
  const other = login.passkeys.find((p) => p.rpId !== rpId || p.userHandle !== userHandle);
  return other === undefined
    ? undefined
    : `${login.name} already holds a passkey for ${other.rpId}${other.userName ? ` as ${other.userName}` : ""}; a login keeps one passkey, as in Bitwarden's apps, so leave item_id out to make a new login`;
};

/** A new passkey record, in exactly the shape Bitwarden's authenticator writes (createKeyView). */
export const newPasskey = (args: {
  readonly credentialId: string;
  readonly keyValue: string;
  readonly rpId: string;
  readonly rpName: string | null;
  readonly userHandle: string;
  readonly userName: string;
  readonly userDisplayName: string;
  readonly discoverable: boolean;
  readonly now: number;
}): Passkey => {
  if (!isGuid(args.credentialId)) throw new RangeError("a new passkey's credential id is a GUID, as Bitwarden makes them");
  return {
    credentialId: args.credentialId.toLowerCase(),
    keyType: KEY_TYPE,
    keyAlgorithm: KEY_ALGORITHM,
    keyCurve: KEY_CURVE,
    keyValue: args.keyValue,
    rpId: args.rpId,
    rpName: args.rpName,
    userHandle: args.userHandle,
    userName: args.userName,
    userDisplayName: args.userDisplayName,
    counter: 0,
    discoverable: args.discoverable,
    creationDate: new Date(args.now).toISOString(),
  };
};

/**
 * Whether a person lent the item to this account rather than the account
 * keeping it as its own: it sits in a collection, and that collection is not
 * the one this account files its own items into (`defaultCollection`).
 */
export const isShared = (login: Login, defaultCollectionId: string | undefined): boolean =>
  login.organizationId !== null && !login.collectionIds.every((id) => id === defaultCollectionId);

/** A passkey as a caller sees it: everything but the key. */
export const passkeyInfo = (held: Held, collections: readonly Collection[], defaultCollectionId: string | undefined) => ({
  credentialId: webauthnId(held.passkey.credentialId) ?? null,
  rpId: held.passkey.rpId,
  rpName: held.passkey.rpName,
  userName: held.passkey.userName,
  userDisplayName: held.passkey.userDisplayName,
  userHandle: held.passkey.userHandle,
  counter: held.passkey.counter,
  discoverable: held.passkey.discoverable,
  createdAt: held.passkey.creationDate,
  itemId: held.login.id,
  itemName: held.login.name,
  collections: held.login.collectionIds.map((id) => collections.find((c) => c.id === id)?.name ?? id),
  shared: isShared(held.login, defaultCollectionId),
});

export type PasskeyInfo = ReturnType<typeof passkeyInfo>;

/** Whether a passkey matches words a person typed: in its site, its site's name, its account names, its login's name. */
export const matchesWords = (held: Held, search: string): boolean => {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [held.passkey.rpId, held.passkey.rpName, held.passkey.userName, held.passkey.userDisplayName, held.login.name]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  return words.every((w) => text.includes(w));
};
