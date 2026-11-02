import { cliError, excluded, fail, inputError, noCredential, notFound, several, unsupported } from "../../domain/errors.js";
import {
  candidatesFor,
  cannotHold,
  counterAfterUse,
  excludedBy,
  heldIn,
  homeFor,
  matchesWords,
  newPasskey,
  passkeyInfo,
  type Held,
} from "../../domain/passkey.js";
import { attestationObject, authenticatorData, ES256, signedData } from "../../domain/passkey/authData.js";
import { fromBase64Url, guidBytes, rawCredentialId, sameBytes, toBase64Url, webauthnId } from "../../domain/passkey/ids.js";
import type { Collection, Login, Passkey } from "../../domain/schema.js";
import type { Deps } from "../ports.js";
import { collectionNamed, placeFor } from "./place.js";

/**
 * A vault that answers WebAuthn requests as a hardware authenticator would:
 * it gets the RP ID, the client data's hash and the ids a site named, and
 * answers authenticator data with a signature, or an attestation object for a
 * new passkey. The caller (a browser, or a program in its place) builds the
 * client data and checks the RP ID against the page's origin; this server
 * never sees the page. A private key is read from the vault, used and dropped
 * within one call, and is never in an answer, an error or a log line.
 */

const UTF8 = new TextEncoder();

/** A host name, as an RP ID is: lower-case labels of letters, digits and hyphens. */
const RP_ID = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

const checkRpId = (rpId: string): void => {
  if (!RP_ID.test(rpId)) fail(inputError(`rp_id ${rpId.slice(0, 80)} is not a host name (example.com, login.example.com)`));
};

const bytesOf = (text: string, what: string): Uint8Array => fromBase64Url(text) ?? fail(inputError(`${what} is not base64url (WebAuthn's JSON form, no padding)`));

const hashOf = (text: string): Uint8Array => {
  const bytes = bytesOf(text, "client_data_hash");
  return bytes.length === 32 ? bytes : fail(inputError(`client_data_hash is the client data's SHA-256, 32 bytes; this one is ${bytes.length}`));
};

const idsOf = (ids: readonly string[], what: string): Uint8Array[] =>
  ids.map((id, i) => {
    const bytes = bytesOf(id, `${what}[${i}]`);
    return bytes.length > 0 ? bytes : fail(inputError(`${what}[${i}] is empty`));
  });

/** The id of the collection this account files its own items into, when it names one the account has. */
const ownCollectionId = (deps: Deps, collections: readonly Collection[]): string | undefined =>
  deps.defaultCollection === undefined ? undefined : collectionNamed(collections, deps.defaultCollection)?.id;

const infoOf = (deps: Deps, collections: readonly Collection[]) => (held: Held) => passkeyInfo(held, collections, ownCollectionId(deps, collections));

const byRpThenUser = (a: Held, b: Held): number =>
  a.passkey.rpId.localeCompare(b.passkey.rpId) || (a.passkey.userName ?? "").localeCompare(b.passkey.userName ?? "") || a.login.id.localeCompare(b.login.id);

export const listPasskeys = async (deps: Deps, args: { readonly rpId?: string; readonly search?: string; readonly limit: number }) => {
  await deps.vault.sync();
  const [logins, collections] = await Promise.all([deps.vault.listLogins({}), deps.vault.collections()]);
  const found = heldIn(logins)
    .filter((h) => (args.rpId === undefined || h.passkey.rpId === args.rpId) && (args.search === undefined || matchesWords(h, args.search)))
    .sort(byRpThenUser);
  return { count: found.length, passkeys: found.slice(0, args.limit).map(infoOf(deps, collections)) };
};

/** How many passkeys the vault holds, for health. */
export const countPasskeys = (logins: readonly Login[]): number => heldIn(logins).length;

export type PasskeyUser = { readonly id: string; readonly name: string; readonly displayName: string };

export type NewPasskey = {
  readonly rpId: string;
  readonly rpName?: string;
  readonly user: PasskeyUser;
  readonly clientDataHash: string;
  readonly excludeCredentials: readonly string[];
  /** COSE algorithm ids the site accepts, in its order; empty means the specification's default, which includes ES256. */
  readonly algorithms: readonly number[];
  readonly residentKey: boolean;
  readonly userVerified: boolean;
  readonly itemId?: string;
  readonly collection?: string;
};

/** What the vault read back differs from what was sent, or `undefined` when it holds the passkey exactly. */
const storedDifferently = (saved: Login, sent: Passkey): string | undefined => {
  const stored = saved.passkeys.find((p) => p.credentialId === sent.credentialId);
  if (stored === undefined) return "has no such passkey";
  const fields = (["keyValue", "rpId", "userHandle", "userName", "counter", "discoverable", "keyAlgorithm", "keyCurve"] as const).filter((f) => stored[f] !== sent[f]);
  return fields.length === 0 ? undefined : `holds it with a different ${fields.join(", ")}`;
};

/**
 * A new passkey (authenticatorMakeCredential): an ES256 key pair made here,
 * the private half stored in the vault in Bitwarden's own shape, the answer an
 * attestation of format "none". It goes into the login named by `itemId`, else
 * the one login that already stands for this account on this site (homeFor),
 * else a new login named after the site.
 */
export const createPasskey = async (deps: Deps, args: NewPasskey) => {
  checkRpId(args.rpId);
  hashOf(args.clientDataHash); // Format "none" signs nothing, so the hash is only checked.
  const handle = bytesOf(args.user.id, "user.id");
  if (handle.length === 0 || handle.length > 64) fail(inputError(`user.id is 1 to 64 bytes (WebAuthn's user handle); this one is ${handle.length}`));
  const exclude = idsOf(args.excludeCredentials, "exclude_credentials");
  if (args.algorithms.length > 0 && !args.algorithms.includes(ES256)) {
    fail(unsupported(`the site accepts COSE algorithms ${args.algorithms.join(", ")}, and this vault makes ES256 (-7) keys only`));
  }
  await deps.vault.sync();
  const logins = await deps.vault.listLogins({});
  const clash = excludedBy(heldIn(logins), args.rpId, exclude);
  if (clash !== undefined) {
    fail(excluded(`the site already holds this vault's passkey${clash.passkey.userName ? ` for ${clash.passkey.userName}` : ""} (in ${clash.login.name})`));
  }
  const userHandle = toBase64Url(handle);
  const named = args.itemId === undefined ? undefined : await deps.vault.getLogin(args.itemId);
  if (named !== undefined) {
    const why = cannotHold(named, args.rpId, userHandle);
    if (why !== undefined) fail(inputError(why));
  }
  const home = named ?? homeFor(logins, args.rpId, args.user.name);

  const pair = deps.passkeyCrypto.newKeyPair();
  const credentialId = deps.newCredentialId();
  const passkey = newPasskey({
    credentialId,
    keyValue: toBase64Url(pair.pkcs8),
    rpId: args.rpId,
    rpName: args.rpName?.trim() || null,
    userHandle,
    userName: args.user.name,
    userDisplayName: args.user.displayName,
    discoverable: args.residentKey,
    now: deps.now(),
  });
  const saved =
    home === undefined
      ? await deps.vault.createLogin({
          name: args.rpName?.trim() || args.rpId,
          ...(await placeFor(deps, args.collection)),
          notes: null,
          username: args.user.name || null,
          password: null,
          totp: null,
          uris: [{ uri: `https://${args.rpId}` }],
          fields: [],
          passkeys: [passkey],
        })
      : await deps.vault.setPasskeys(home.id, [passkey]);
  const differs = storedDifferently(saved, passkey);
  if (differs !== undefined) {
    return fail(cliError(`the passkey was sent to ${saved.name} (${saved.id}), but the vault read back a login that ${differs}; check it in the web vault before registering again`));
  }

  const rawId = guidBytes(passkey.credentialId);
  const authData = authenticatorData({
    rpIdHash: deps.passkeyCrypto.sha256(UTF8.encode(args.rpId)),
    userVerified: args.userVerified,
    counter: passkey.counter,
    attested: { credentialId: rawId, x: pair.x, y: pair.y },
  });
  return {
    credentialId: toBase64Url(rawId),
    attestationObject: toBase64Url(attestationObject(authData)),
    authenticatorData: toBase64Url(authData),
    publicKey: toBase64Url(pair.spki),
    publicKeyAlgorithm: ES256,
    discoverable: passkey.discoverable,
    rpId: passkey.rpId,
    userName: passkey.userName,
    item: { id: saved.id, name: saved.name, created: home === undefined },
  };
};

export type Assertion = {
  readonly rpId: string;
  readonly clientDataHash: string;
  readonly allowCredentials: readonly string[];
  readonly credentialId?: string;
  readonly userVerified: boolean;
};

/** The passkeys that can answer, after a sync if none can before one (Bitwarden's apps sync then too). */
const candidates = async (deps: Deps, request: Parameters<typeof candidatesFor>[1]) => {
  await deps.vault.sync();
  const found = candidatesFor(heldIn(await deps.vault.listLogins({})), request);
  if (found.length > 0) return found;
  await deps.vault.sync({ force: true });
  return candidatesFor(heldIn(await deps.vault.listLogins({})), request);
};

/**
 * A sign-in (authenticatorGetAssertion): authenticator data and an ES256
 * signature over it and the client data's hash. A counter above 0 is advanced
 * and stored first, from a fresh sync; a counter of 0 stays 0 and nothing is
 * written (domain/passkey.ts, counterAfterUse).
 */
export const assertPasskey = async (deps: Deps, args: Assertion) => {
  checkRpId(args.rpId);
  const hash = hashOf(args.clientDataHash);
  const allowCredentials = idsOf(args.allowCredentials, "allow_credentials");
  const credentialId = args.credentialId === undefined ? undefined : bytesOf(args.credentialId, "credential_id");
  const request = { rpId: args.rpId, allowCredentials, ...(credentialId === undefined ? {} : { credentialId }) };
  const found = await candidates(deps, request);
  if (found.length === 0) {
    const what = credentialId !== undefined ? "the passkey credential_id names" : allowCredentials.length > 0 ? "any passkey the site named" : "a passkey";
    return fail(noCredential(`the vault holds ${what} for ${args.rpId} nowhere it can sign from`));
  }
  if (found.length > 1) {
    const info = infoOf(deps, await deps.vault.collections());
    return fail(several(`${found.length} passkeys in the vault can sign in to ${args.rpId}; name one with credential_id`, found.map(info)));
  }
  const { login, passkey } = found[0]!;
  const key = fromBase64Url(passkey.keyValue)!;
  if (!deps.passkeyCrypto.isP256Key(key)) return fail(unsupported(`the passkey in ${login.name} does not hold a P-256 private key, so it cannot sign`));

  let counter = passkey.counter;
  if (counter > 0) {
    await deps.vault.sync({ force: true });
    const fresh = await deps.vault.getLogin(login.id);
    const current = fresh.passkeys.find((p) => p.credentialId === passkey.credentialId) ?? fail(noCredential(`the passkey left ${login.name} while this call ran`));
    counter = counterAfterUse(current.counter);
    const saved = await deps.vault.setPasskeys(login.id, fresh.passkeys.map((p) => (p.credentialId === current.credentialId ? { ...p, counter } : p)));
    if (saved.passkeys.find((p) => p.credentialId === current.credentialId)?.counter !== counter) {
      return fail(cliError(`the vault did not keep the passkey's new counter in ${login.name}; nothing was signed`));
    }
  }
  const authData = authenticatorData({ rpIdHash: deps.passkeyCrypto.sha256(UTF8.encode(passkey.rpId)), userVerified: args.userVerified, counter });
  const signature = deps.passkeyCrypto.sign(key, signedData(authData, hash));
  return {
    credentialId: webauthnId(passkey.credentialId)!,
    authenticatorData: toBase64Url(authData),
    signature: toBase64Url(signature),
    userHandle: passkey.userHandle,
    counter,
    userName: passkey.userName,
    userDisplayName: passkey.userDisplayName,
    item: { id: login.id, name: login.name },
  };
};

/** One passkey out of its login; the login and everything else in it stay. */
export const deletePasskey = async (deps: Deps, args: { readonly itemId: string; readonly credentialId: string }) => {
  const raw = bytesOf(args.credentialId, "credential_id");
  await deps.vault.sync();
  const login = await deps.vault.getLogin(args.itemId);
  const gone = login.passkeys.find((p) => {
    const stored = rawCredentialId(p.credentialId);
    return stored !== undefined && sameBytes(stored, raw);
  });
  if (gone === undefined) return fail(notFound(`${login.name} holds no passkey ${args.credentialId}; list_passkeys gives each passkey with its item`));
  const saved = await deps.vault.setPasskeys(login.id, login.passkeys.filter((p) => p !== gone));
  if (saved.passkeys.some((p) => p.credentialId === gone.credentialId)) {
    return fail(cliError(`${login.name} still holds the passkey after the edit; check it in the web vault`));
  }
  return {
    item: { id: saved.id, name: saved.name },
    deleted: { credentialId: args.credentialId, rpId: gone.rpId, userName: gone.userName },
    passkeysLeft: saved.passkeys.length,
  };
};
