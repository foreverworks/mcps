import { join } from "node:path";

import { z } from "zod";

import { type StoredFile, storedFile } from "./storedFile.js";

/**
 * The one begun authorization-code flow (RFC 6749 4.1), between the call that
 * sends a person to the authorize page and the one that takes the address the
 * browser landed on: the `state` that address must carry, the redirect URI
 * the code is bound to, and when it began, so a server can refuse a stale one.
 * With PKCE (RFC 7636) it holds the verifier too, which is what makes a code
 * read from the address bar useless to anyone else.
 *
 * A file, `<stateDir>/<name>.json` (0600), rather than memory, because the
 * HTTP service is stateless per request and may restart between the two
 * calls. One at a time: beginning again replaces it, which is what a person
 * retrying from a fresh tab wants. Writes and clears take `<name>.lock`.
 */
export type PendingAuthorization = {
  readonly state: string;
  readonly redirectUri: string;
  readonly createdAtEpoch: number;
};

export type PendingPkceAuthorization = PendingAuthorization & { readonly verifier: string };

const plainOnDisk = z.object({ state: z.string().min(1), redirect_uri: z.string().min(1), created_at_epoch: z.number() });
const pkceOnDisk = plainOnDisk.extend({ verifier: z.string().min(1) });

const plainFrom = (d: z.infer<typeof plainOnDisk>): PendingAuthorization => ({ state: d.state, redirectUri: d.redirect_uri, createdAtEpoch: d.created_at_epoch });
const plainTo = (p: PendingAuthorization): z.infer<typeof plainOnDisk> => ({ state: p.state, redirect_uri: p.redirectUri, created_at_epoch: p.createdAtEpoch });

/** A begun authorization without PKCE: a confidential client whose code is bound to its secret. */
export const pendingAuthorizationFile = (stateDir: string, name: string): StoredFile<PendingAuthorization> =>
  storedFile(join(stateDir, `${name}.json`), { schema: plainOnDisk, fromDisk: plainFrom, toDisk: plainTo, lock: `${name}.lock` });

/** A begun authorization with PKCE: a public client, whose verifier is the only thing binding the code to it. */
export const pendingPkceAuthorizationFile = (stateDir: string, name: string): StoredFile<PendingPkceAuthorization> =>
  storedFile(join(stateDir, `${name}.json`), {
    schema: pkceOnDisk,
    fromDisk: (d) => ({ ...plainFrom(d), verifier: d.verifier }),
    toDisk: (p) => ({ ...plainTo(p), verifier: p.verifier }),
    lock: `${name}.lock`,
  });
