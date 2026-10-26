import type { McpServer, OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { checkHealth } from "../app/usecases/health.js";
import { checkExposed, createLogin, currentTotp, findLogins, getField, getLogin, getPassword, syncVault, updateLogin } from "../app/usecases/logins.js";
import { moveItem } from "../app/usecases/move.js";
import { createNote } from "../app/usecases/notes.js";
import { MAX_FIELD_BYTES, MAX_NOTES_BYTES } from "../domain/note.js";
import { MAX_GIVEN_LENGTH, MAX_LENGTH, MIN_LENGTH } from "../domain/password.js";
import { handled } from "./envelope.js";

const id = z.string().trim().describe("The item id, from find_logins.");
const url = z.string().trim().min(1).max(2000).describe("The site's URL, e.g. https://github.com/login; its host is what find_logins' url matches.");
const username = z.string().max(500).describe("The login name or email the site knows the account by.");
const password = z
  .string()
  .min(1)
  .max(MAX_GIVEN_LENGTH)
  .describe(
    "A password the account already has, exactly as you were given it. Leave it out to have a strong one generated here; " +
      "a secret that is already in a file goes as password_file instead, so it is never retyped.",
  );
const length = z.number().int().min(MIN_LENGTH).max(MAX_LENGTH).describe("Length of a generated password. Default 24.");
const symbols = z.boolean().describe("Whether a generated password contains symbols (!@#$%^&*-_=+). Default true; turn off for sites that refuse them.");
const notes = z.string().max(10_000).describe("Free text kept with the login: recovery codes, security answers, what the account is for.");
const totpSecret = z
  .string()
  .trim()
  .max(2000)
  .describe(
    "The site's authenticator key: the base32 secret shown under the 2FA QR code, or the otpauth://totp/ URI it encodes. " +
      "Store it BEFORE confirming 2FA on the site, then confirm with the code this call returns: the site accepting it proves the key was stored exactly.",
  );

const rulesOf = (a: { readonly length?: number | undefined; readonly symbols?: boolean | undefined }) =>
  a.length === undefined && a.symbols === undefined ? undefined : { length: a.length ?? 24, symbols: a.symbols ?? true };

const fileSource = (f: { path?: string | undefined; content_base64?: string | undefined; sha256?: string | undefined }) => ({
  path: f.path,
  contentBase64: f.content_base64,
  sha256: f.sha256,
});

/** check_exposed's answer: whose password, and how often Have I Been Pwned saw it. */
const EXPOSED_OUTPUT = z.strictObject({
  id: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  previous: z.literal(true).optional(),
  exposed: z.boolean(),
  count: z.number().int().min(0).describe("How many times the password was seen in breaches; 0 when it was not"),
});

/** move_item's answer: which item, and its collections after and before. */
const MOVE_OUTPUT = z.strictObject({
  id: z.string(),
  kind: z.enum(["login", "note"]),
  name: z.string(),
  collections: z.array(z.string()).describe("The item's collections now, by name"),
  previousCollections: z.array(z.string()).describe("Its collections before the call, by name"),
  moved: z.boolean().describe("false when the item was already in exactly that collection, and nothing was sent"),
});

/** The whole tool surface. Every result leaves the secrets out except get_password's, get_field's and totp's code. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  const fileInput = () =>
    z.object({
      path: z.string().optional().describe(`A path: ${deps.readInput.where}. Links are refused.`),
      content_base64: z.string().optional().describe("The bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256."),
      sha256: z.string().optional().describe("Hex SHA-256 of the source file, as sha256sum prints it. Required with content_base64, checked with path."),
    });
  const passwordFile = fileInput().describe(
    "A password the account already has, from a file holding just it (one line; a final line ending is dropped): a downloaded key " +
      `or a generated credential, which is safer read than retyped. Delete the file once the login is saved. ${deps.readInput.help}`,
  );
  const noteField = z.object({
    name: z.string().trim().min(1).max(200).describe("The field's name, which get_field asks for, e.g. 'service account key (JSON)'. Names in one note must differ."),
    value: z
      .string()
      .min(1)
      .max(MAX_FIELD_BYTES)
      .optional()
      .describe("The value, typed exactly as you were given it. A secret that is already in a file goes as file instead, so it is never retyped."),
    file: fileInput()
      .optional()
      .describe(
        "The value from a file, taken whole and exactly: every line, a final line ending included (a JSON key file, a PEM key, a token). " +
          `UTF-8 text up to ${MAX_FIELD_BYTES} bytes. Delete the file once the note is saved. ${deps.readInput.help}`,
      ),
    hidden: z.boolean().default(true).describe("A hidden field is a secret: get_login names it without its value. Default true; false for a plain detail such as a project id."),
  });
  const defaultPlace =
    deps.defaultCollection === undefined ? "the account's own vault, outside any collection" : `the collection ${deps.defaultCollection}`;

  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Check that the vault is reachable and unlocked, and say as whom: the account, the server, when it last synced, how many " +
        "logins it holds, and the organizations and collections it can file into. Run this before concluding the MCP is broken.",
      inputSchema: {},
    },
    handled(() => checkHealth(deps)),
  );

  server.registerTool(
    "find_logins",
    {
      title: "Find logins",
      description:
        "Search the vault's logins and secure notes (`kind` says which). `search` matches name, username and URL; `url` finds " +
        "the logins saved for a site (its host, as Bitwarden's autofill matches). Returns ids, names, usernames and URLs, and " +
        "whether each has a password and an authenticator key, never the secrets themselves. Syncs first, so an item just " +
        "added in the web vault shows up.",
      inputSchema: {
        search: z.string().trim().max(200).optional().describe("Words in the name, username or URL."),
        url: url.optional(),
        limit: z.number().int().min(1).max(100).default(20).describe("Return at most this many; `count` says how many matched."),
      },
    },
    handled((a) => findLogins(deps, { ...(a.search ? { search: a.search } : {}), ...(a.url ? { url: a.url } : {}), limit: a.limit })),
  );

  server.registerTool(
    "get_login",
    {
      title: "Get login",
      description:
        "One login or secure note in full except its secrets: name, username, URLs, collections, notes, custom fields (hidden " +
        "ones by name only) and when the password last changed.",
      inputSchema: { id },
    },
    handled((a) => getLogin(deps, a.id)),
  );

  server.registerTool(
    "get_password",
    {
      title: "Get password",
      description:
        "The login's password, with its username and URLs, for typing into the site. Use it only for that: never write it into " +
        "a file, a commit, a message, a log or a reply. With `previous`, the password the current one replaced, from the item's " +
        "history: for when a site refused a rotation that is already stored.",
      inputSchema: {
        id,
        previous: z.boolean().default(false).describe("Return the password before the current one instead."),
      },
    },
    handled((a) => getPassword(deps, a.id, a.previous)),
  );

  server.registerTool(
    "get_field",
    {
      title: "Get field",
      description:
        "One custom field's value, hidden ones included, from a login or a secure note: a secret that is not a password, such " +
        "as a licence key or an API token, kept where a person put it. get_login names an item's fields. Use it only to type " +
        "or pipe the value where it goes: never write it into a file, a commit, a message, a log or a reply.",
      inputSchema: {
        id,
        field: z.string().trim().min(1).max(200).describe("The field's name as get_login lists it (case does not matter)."),
      },
    },
    handled((a) => getField(deps, a.id, a.field)),
  );

  server.registerTool(
    "totp",
    {
      title: "Current 2FA code",
      description:
        "The login's current authenticator (TOTP) code and how many seconds it stays valid, computed from the key stored on " +
        "the login. If fewer than 5 seconds are left, wait and call again.",
      inputSchema: { id },
    },
    handled((a) => currentTotp(deps, a.id)),
  );

  server.registerTool(
    "check_exposed",
    {
      title: "Check a password against breaches",
      description:
        "Whether a login's password appears in Have I Been Pwned's list of passwords seen in data breaches, and how many " +
        "times. Only the first five hex characters of the password's SHA-1 leave this server (k-anonymity); the password " +
        "and its full hash never do, and the answer is a count. A count above 0 means the password is known to attackers: " +
        "rotate it (update_login with rotate_password, then change it on the site). With previous, the password the current " +
        "one replaced.",
      inputSchema: {
        id,
        previous: z.boolean().default(false).describe("Check the password before the current one instead."),
      },
      outputSchema: EXPOSED_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof EXPOSED_OUTPUT>> => checkExposed(deps, a.id, a.previous)),
  );

  server.registerTool(
    "create_login",
    {
      title: "Create login",
      description:
        "Save a new login. Without `password` or `password_file` a strong one is generated here and stored; nothing returns it, " +
        "so call get_password when you type it into the signup form. Create the login BEFORE submitting a signup, so the " +
        `password is never lost. Filed into ${defaultPlace} unless \`collection\` names another.`,
      inputSchema: {
        name: z.string().trim().min(1).max(200).describe("What the account is, e.g. 'GitHub (example-bot)'."),
        url: url.optional(),
        username: username.optional(),
        password: password.optional(),
        password_file: passwordFile.optional(),
        length: length.optional(),
        symbols: symbols.optional(),
        notes: notes.optional(),
        totp_secret: totpSecret.optional(),
        collection: z.string().trim().max(200).optional().describe(`A collection name from health. Default: ${defaultPlace}.`),
      },
    },
    handled((a) => {
      const generate = rulesOf(a);
      return createLogin(deps, {
        name: a.name,
        ...(a.url === undefined ? {} : { url: a.url }),
        ...(a.username === undefined ? {} : { username: a.username }),
        ...(a.password === undefined ? {} : { password: a.password }),
        ...(a.password_file === undefined ? {} : { passwordFile: fileSource(a.password_file) }),
        ...(generate === undefined ? {} : { generate }),
        ...(a.notes === undefined ? {} : { notes: a.notes }),
        ...(a.totp_secret === undefined ? {} : { totpSecret: a.totp_secret }),
        ...(a.collection === undefined ? {} : { collection: a.collection }),
      });
    }),
  );

  server.registerTool(
    "update_login",
    {
      title: "Update login",
      description:
        "Change a login: only what is named changes. `rotate_password` generates a new password and stores it at once; change it " +
        "on the site right after, with get_password, and if the site refuses, get_password with previous: true still has the old " +
        "one. `url` becomes the first URL and the others stay. `append_notes` adds to the notes (recovery codes, answers) where " +
        "`notes` replaces them. Set `totp_secret` when you turn on 2FA at a site, before confirming it there: the result carries " +
        "the current code from the stored key. A different key already on the login is replaced only with `replace_totp`, and " +
        "kept in a hidden field.",
      inputSchema: {
        id,
        name: z.string().trim().min(1).max(200).optional().describe("A new name."),
        url: url.optional(),
        username: username.optional(),
        password: password.optional(),
        password_file: passwordFile.optional(),
        rotate_password: z.boolean().optional().describe("Generate a new password (with `length` and `symbols`)."),
        length: length.optional(),
        symbols: symbols.optional(),
        notes: notes.optional().describe("Replaces the notes."),
        append_notes: z.string().min(1).max(10_000).optional().describe("Added after the current notes on a new line; nothing is lost."),
        totp_secret: totpSecret.optional(),
        replace_totp: z.boolean().optional().describe("Replace a DIFFERENT authenticator key the login already has (or clear it with an empty totp_secret)."),
      },
    },
    handled((a) => {
      const rotate = a.rotate_password === true ? (rulesOf(a) ?? { length: 24, symbols: true }) : undefined;
      return updateLogin(deps, {
        id: a.id,
        ...(a.name === undefined ? {} : { name: a.name }),
        ...(a.url === undefined ? {} : { url: a.url }),
        ...(a.username === undefined ? {} : { username: a.username }),
        ...(a.password === undefined ? {} : { password: a.password }),
        ...(a.password_file === undefined ? {} : { passwordFile: fileSource(a.password_file) }),
        ...(rotate === undefined ? {} : { rotate }),
        ...(a.notes === undefined ? {} : { notes: a.notes }),
        ...(a.append_notes === undefined ? {} : { appendNotes: a.append_notes }),
        ...(a.totp_secret === undefined ? {} : { totpSecret: a.totp_secret }),
        ...(a.replace_totp === undefined ? {} : { replaceTotp: a.replace_totp }),
      });
    }),
  );

  server.registerTool(
    "create_note",
    {
      title: "Create secure note",
      description:
        "Save a secret that is not a login as a new secure note: a service account's key file, an API token, a licence key. " +
        "Each secret goes in a field of its own, hidden by default, typed (value) or read from a file (file), with no password " +
        "length limit: up to what Bitwarden stores in a field. Nothing returns the secret: the result names each field with its " +
        "length, and a file's SHA-256 and size (compare them with the source's). get_field hands a value out; get_login names " +
        `the fields. Filed into ${defaultPlace} unless \`collection\` names another. If a call fails without saying whether the ` +
        "note was saved, find_logins by its name before trying again.",
      inputSchema: {
        name: z.string().trim().min(1).max(200).describe("What the secret is, e.g. 'Play service account key (example-app)'."),
        fields: z.array(noteField).min(1).max(20).describe("The secrets, one field each, and any plain details beside them."),
        notes: z
          .string()
          .max(MAX_NOTES_BYTES)
          .optional()
          .describe("Plain text anyone reading the note sees (get_login shows it): what the secret is for, where it is used. Never the secret itself."),
        collection: z.string().trim().max(200).optional().describe(`A collection name from health. Default: ${defaultPlace}.`),
      },
    },
    handled((a) =>
      createNote(deps, {
        name: a.name,
        fields: a.fields.map((f) => ({
          name: f.name,
          hidden: f.hidden,
          ...(f.value === undefined ? {} : { value: f.value }),
          ...(f.file === undefined ? {} : { file: fileSource(f.file) }),
        })),
        ...(a.notes === undefined ? {} : { notes: a.notes }),
        ...(a.collection === undefined ? {} : { collection: a.collection }),
      }),
    ),
  );

  server.registerTool(
    "move_item",
    {
      title: "Move item",
      description:
        "Put a login or secure note in one collection: its collections become exactly the one named. Only between the " +
        "collections of the item's own organization; an item in the account's own vault, or a collection of another " +
        "organization, is refused with what to do instead. An item already in exactly that collection is left as it is " +
        "(moved: false). After a move the vault is synced and the item read back, so the answer, its collections before and " +
        "after, is what Bitwarden holds. Returns no secret. Nothing is deleted or copied.",
      inputSchema: {
        id,
        collection: z.string().trim().min(1).max(200).describe("The collection to put it in: its name as health lists it (case does not matter), or its id."),
      },
      outputSchema: MOVE_OUTPUT,
    },
    handled((a): Promise<OutputOf<typeof MOVE_OUTPUT>> => moveItem(deps, a.id, a.collection)),
  );

  server.registerTool(
    "sync",
    {
      title: "Sync",
      description: "Pull the vault from Bitwarden now. Reads already sync every 30 seconds; this is for right after someone changed something in the web vault.",
      inputSchema: {},
    },
    handled(() => syncVault(deps)),
  );
};
