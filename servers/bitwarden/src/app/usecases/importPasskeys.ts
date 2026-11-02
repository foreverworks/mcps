import { reportProgress, type FileSource } from "@foreverworks/mcp-kit";

import { cliError, fail, inputError } from "../../domain/errors.js";
import { heldIn, unusable } from "../../domain/passkey.js";
import { readExport, type ImportedLogin, type Skipped } from "../../domain/passkey/exportFile.js";
import { fromBase64Url, rawCredentialId, sameBytes, webauthnId } from "../../domain/passkey/ids.js";
import type { Passkey } from "../../domain/schema.js";
import type { Deps } from "../ports.js";
import { placeFor } from "./place.js";

const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true });

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(UTF8_STRICT.decode(bytes));
  } catch {
    return fail(inputError("the file is not JSON: import takes a Bitwarden export in its .json format (not encrypted), or one exported item"));
  }
};

/** A passkey already somewhere: the vault, or an earlier login of the same file. */
type Known = { readonly rpId: string; readonly id: Uint8Array; readonly where: string };

const knownAs = (known: readonly Known[], passkey: Passkey): Known | undefined => {
  const id = rawCredentialId(passkey.credentialId);
  return id === undefined ? undefined : known.find((k) => k.rpId === passkey.rpId && sameBytes(k.id, id));
};

const knownOf = (passkey: Passkey, where: string): Known[] => {
  const id = rawCredentialId(passkey.credentialId);
  return id === undefined ? [] : [{ rpId: passkey.rpId, id, where }];
};

/**
 * The logins of a Bitwarden JSON export that carry passkeys, each made a new
 * login here with its username, password, 2FA key, URLs, notes and custom
 * fields and the passkeys it carries. A passkey the vault already holds (the
 * same site and credential id) is skipped, and so is one whose key cannot sign
 * here; a login left with none is not made. Each new login is read back and
 * its passkeys compared with what was sent. The answer names what was
 * imported and what was skipped, with the file's SHA-256 and size, never a key.
 */
export const importPasskeys = async (deps: Deps, args: { readonly file: FileSource; readonly collection?: string }) => {
  const file = await deps.readExport(args.file);
  const reading = readExport(parseJson(file.bytes));
  if ("refused" in reading) return fail(inputError(reading.refused));
  const place = await placeFor(deps, args.collection);
  await deps.vault.sync({ force: true });
  const known: Known[] = heldIn(await deps.vault.listLogins({})).flatMap(({ login, passkey }) => knownOf(passkey, `the vault, in ${login.name}`));

  const skipped: Skipped[] = [...reading.skipped];
  const toMake: ImportedLogin[] = [];
  for (const login of reading.logins) {
    const fresh = login.passkeys.filter((passkey) => {
      const key = fromBase64Url(passkey.keyValue);
      const why =
        unusable(passkey) ??
        (key !== undefined && deps.passkeyCrypto.isP256Key(key) ? undefined : "its key is not a P-256 private key in PKCS#8") ??
        (() => {
          const there = knownAs(known, passkey);
          return there === undefined ? undefined : `already in ${there.where}`;
        })();
      if (why !== undefined) {
        skipped.push({ item: login.name, rpId: passkey.rpId, ...(passkey.userName ? { userName: passkey.userName } : {}), reason: why });
        return false;
      }
      known.push(...knownOf(passkey, `this file, in ${login.name}`));
      return true;
    });
    if (fresh.length > 0) toMake.push({ ...login, passkeys: fresh });
  }

  const imported = [];
  for (const login of toMake) {
    reportProgress(imported.length, toMake.length, `${imported.length} of ${toMake.length} logins imported`);
    const created = await deps.vault.createLogin({
      name: login.name,
      ...place,
      notes: login.notes,
      username: login.username,
      password: login.password,
      totp: login.totp,
      uris: login.uris,
      fields: login.fields,
      passkeys: login.passkeys,
    });
    const wrong = login.passkeys.filter(
      (sent) =>
        !created.passkeys.some(
          (p) =>
            p.credentialId === sent.credentialId &&
            p.keyValue === sent.keyValue &&
            p.rpId === sent.rpId &&
            p.counter === sent.counter &&
            p.discoverable === sent.discoverable &&
            p.userHandle === sent.userHandle,
        ),
    );
    if (wrong.length > 0) {
      return fail(
        cliError(
          `${created.name} (${created.id}) was made, but the vault read back ${wrong.length} of its passkeys differently; ` +
            `${imported.length} logins were imported before it and none after; check it in the web vault`,
        ),
      );
    }
    imported.push({
      itemId: created.id,
      itemName: created.name,
      passkeys: login.passkeys.map((p) => ({ credentialId: webauthnId(p.credentialId)!, rpId: p.rpId, userName: p.userName, discoverable: p.discoverable })),
      ...(login.fieldsLeftOut > 0 ? { fieldsLeftOut: login.fieldsLeftOut } : {}),
    });
  }
  reportProgress(imported.length, toMake.length, `${imported.length} logins imported`);
  return {
    file: { name: file.name, sha256: file.sha256, size: file.size },
    imported,
    skipped,
    passkeysImported: imported.reduce((n, i) => n + i.passkeys.length, 0),
  };
};
