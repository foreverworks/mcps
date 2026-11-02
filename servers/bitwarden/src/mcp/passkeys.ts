import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { importPasskeys } from "../app/usecases/importPasskeys.js";
import { assertPasskey, createPasskey, deletePasskey, listPasskeys } from "../app/usecases/passkeys.js";
import { handled } from "./envelope.js";

const rpId = z.string().trim().toLowerCase().min(1).max(253).describe("The RP ID: the site's domain the passkey is bound to, e.g. example.com or login.example.com.");
const b64u = (what: string) => z.string().trim().max(4096).describe(what);
const clientDataHash = b64u("SHA-256 of the client data JSON the browser (or the program in its place) built for this request, base64url (43 characters).");
const credentialIds = (what: string) => z.array(b64u("A credential id, base64url as WebAuthn's JSON carries it.")).max(64).describe(what);
const userVerified = z
  .boolean()
  .default(false)
  .describe(
    "Whether the user was verified for this request, which sets the UV flag. True only when the caller verified them: an agent signing in as its own " +
      "identity, or a person who approved the request.",
  );
const itemId = z.string().trim().describe("The login's item id, from list_passkeys or find_logins.");

/** The passkey tools: this vault as a WebAuthn authenticator, and the passkeys it holds. */
export const registerPasskeys = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "list_passkeys",
    {
      title: "List passkeys",
      description:
        "The passkeys the vault holds, each with its site (rpId and name), account (userName, userDisplayName, userHandle), credential id " +
        "(base64url), counter, whether it is discoverable, when it was made, its login (itemId, itemName), the login's collections, and " +
        "whether a person shared it with this account rather than the account keeping it as its own. Never a key. Syncs first.",
      inputSchema: {
        rp_id: rpId.optional().describe("Only the passkeys for this RP ID, e.g. example.com."),
        search: z.string().trim().max(200).optional().describe("Words in the site, its name, the account's names or the login's name."),
        limit: z.number().int().min(1).max(1000).default(200).describe("Return at most this many; `count` says how many matched."),
      },
    },
    handled((a) => listPasskeys(deps, { ...(a.rp_id ? { rpId: a.rp_id } : {}), ...(a.search ? { search: a.search } : {}), limit: a.limit })),
  );

  server.registerTool(
    "create_passkey",
    {
      title: "Create passkey",
      description:
        "Register a new passkey, as an authenticator does for WebAuthn's navigator.credentials.create(): an ES256 (P-256) key pair is made " +
        "here, the private key stored in the vault exactly as Bitwarden's own apps store a passkey (so they can sign with it too), and the " +
        "answer is what a browser needs to finish the registration: the credential id, the attestation object (format none), the " +
        "authenticator data and the public key (SPKI). The private key is never in the answer. It goes into the login item_id names, else " +
        "into the one login already saved for this site with this username and no passkey, else into a new login named after the site " +
        "(filed like create_login). Refused as excluded when the site's exclude list names a passkey the vault holds, and as unsupported when " +
        "the site accepts no ES256 key. Use it for an agent's own identity; a person's own passkeys belong on their own devices.",
      inputSchema: {
        rp_id: rpId,
        rp_name: z.string().trim().max(200).optional().describe("The site's name as the request gives it (rp.name)."),
        user: z
          .object({
            id: b64u("The site's id for the account (user.id), base64url, 1 to 64 bytes."),
            name: z.string().max(500).describe("The account's name at the site (user.name), usually its email or username."),
            display_name: z.string().max(500).default("").describe("The account's display name (user.displayName)."),
          })
          .describe("The account, as the request's `user`."),
        client_data_hash: clientDataHash.describe(
          "SHA-256 of the client data JSON for this request, base64url. An attestation of format none signs nothing, so it is only checked.",
        ),
        exclude_credentials: credentialIds("The request's excludeCredentials ids: passkeys the site already holds for this account.").default([]),
        algorithms: z
          .array(z.number().int())
          .max(16)
          .default([])
          .describe("The COSE algorithm ids in the request's pubKeyCredParams, e.g. [-7, -257]. Empty means the default, which includes ES256 (-7)."),
        resident_key: z.boolean().default(true).describe("Whether the passkey is discoverable (a resident key), as the request's authenticatorSelection asks."),
        user_verified: userVerified,
        item_id: itemId.optional().describe("The login to put it in: one without a passkey, or whose passkey is for the same account on this site (it is replaced)."),
        collection: z.string().trim().max(200).optional().describe("For a new login: a collection name from health."),
      },
    },
    handled((a) =>
      createPasskey(deps, {
        rpId: a.rp_id,
        ...(a.rp_name ? { rpName: a.rp_name } : {}),
        user: { id: a.user.id, name: a.user.name, displayName: a.user.display_name },
        clientDataHash: a.client_data_hash,
        excludeCredentials: a.exclude_credentials,
        algorithms: a.algorithms,
        residentKey: a.resident_key,
        userVerified: a.user_verified,
        ...(a.item_id ? { itemId: a.item_id } : {}),
        ...(a.collection ? { collection: a.collection } : {}),
      }),
    ),
  );

  server.registerTool(
    "assert_passkey",
    {
      title: "Sign in with a passkey",
      description:
        "Sign a WebAuthn sign-in, as an authenticator does for navigator.credentials.get(): authenticator data and an ES256 signature over it " +
        "and the client data's hash, with the vault's passkey for the site, plus the credential id and user handle a browser returns. With " +
        "allow_credentials, only a passkey those ids name; without (a discoverable request), any discoverable passkey for the RP ID. When " +
        "several can answer, the call is refused as several with the candidates: call again with credential_id. No passkey for the site " +
        "is refused as no_credential. Hand the result only to the page that asked; the key never leaves this server.",
      inputSchema: {
        rp_id: rpId,
        client_data_hash: clientDataHash,
        allow_credentials: credentialIds("The request's allowCredentials ids; empty for a discoverable request.").default([]),
        credential_id: b64u("The passkey to sign with, from an earlier answer's candidates or list_passkeys.").optional(),
        user_verified: userVerified,
      },
    },
    handled((a) =>
      assertPasskey(deps, {
        rpId: a.rp_id,
        clientDataHash: a.client_data_hash,
        allowCredentials: a.allow_credentials,
        ...(a.credential_id ? { credentialId: a.credential_id } : {}),
        userVerified: a.user_verified,
      }),
    ),
  );

  server.registerTool(
    "import_passkeys",
    {
      title: "Import passkeys",
      description:
        "Import the logins that carry passkeys from a Bitwarden JSON export (not encrypted), or from one exported item: each becomes a new " +
        "login here with its username, password, 2FA key, URLs, notes, custom fields and passkeys, filed like create_login. A passkey the " +
        "vault already holds is skipped, and so is one this server cannot sign with (only ES256 P-256 keys sign, as in Bitwarden's apps). " +
        "The answer lists what was imported and what was skipped with the reason, and the file's SHA-256 and size: compare them with the " +
        "source, then delete the file, which holds private keys.",
      inputSchema: {
        file: z
          .object({
            path: z.string().optional().describe(`A path: ${deps.readExport.where}. Links are refused.`),
            content_base64: z.string().optional().describe("The bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256."),
            sha256: z.string().optional().describe("Hex SHA-256 of the source file, as sha256sum prints it. Required with content_base64, checked with path."),
            filename: z.string().max(255).optional().describe("The file's name, for the answer."),
          })
          .describe(`The export. ${deps.readExport.help}`),
        collection: z.string().trim().max(200).optional().describe("A collection name from health, for every imported login. Default: as create_login."),
      },
      annotations: { destructiveHint: false },
    },
    handled((a) =>
      importPasskeys(deps, {
        file: { path: a.file.path, contentBase64: a.file.content_base64, sha256: a.file.sha256, name: a.file.filename },
        ...(a.collection ? { collection: a.collection } : {}),
      }),
    ),
  );

  server.registerTool(
    "delete_passkey",
    {
      title: "Delete passkey",
      description:
        "Remove one passkey from its login. The login and everything else in it (username, password, 2FA key) stay. The site keeps its " +
        "copy of the public key, so remove the passkey there too if it should stop being offered. Not undone by anything here.",
      inputSchema: {
        item_id: itemId,
        credential_id: b64u("The passkey's credential id, base64url, as list_passkeys gives it."),
      },
      annotations: { destructiveHint: true },
    },
    handled((a) => deletePasskey(deps, { itemId: a.item_id, credentialId: a.credential_id })),
  );
};
