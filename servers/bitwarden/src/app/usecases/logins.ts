import type { FileSource } from "@foreverworks/mcp-kit";

import { fail, inputError, unavailable } from "../../domain/errors.js";
import { DEFAULT_RULES, generatePassword, passwordFromFile, type PasswordRules } from "../../domain/password.js";
import { countIn, rangeOf } from "../../domain/pwned.js";
import type { Collection, Login, LoginDraft } from "../../domain/schema.js";
import { newKeyProblem, parseTotp, sameKey, totpAt } from "../../domain/totp.js";
import { detailOf, hostOf, summaryOf } from "../../domain/views.js";
import type { Deps } from "../ports.js";
import { placeFor } from "./place.js";

const draftOf = (login: Login): LoginDraft => ({
  name: login.name,
  organizationId: login.organizationId,
  collectionIds: login.collectionIds,
  notes: login.notes,
  username: login.username,
  password: login.password,
  totp: login.totp,
  uris: login.uris,
  fields: login.fields,
});

/**
 * A password the caller already has: typed into the call, or read from a file
 * by the kit's input-file reader, so a long secret is never retyped. At most
 * one of the two; `undefined` when neither is given.
 */
const givenPassword = async (deps: Deps, args: { readonly password?: string; readonly passwordFile?: FileSource }): Promise<string | undefined> => {
  if (args.password !== undefined && args.passwordFile !== undefined) return fail(inputError("pass password or password_file, not both"));
  if (args.passwordFile === undefined) return args.password;
  const read = passwordFromFile((await deps.readInput(args.passwordFile)).bytes);
  return "password" in read ? read.password : fail(inputError(read.refused));
};

const checkTotp = (totp: string | undefined): void => {
  const problem = totp === undefined || totp === "" ? undefined : newKeyProblem(totp);
  if (problem !== undefined) fail(inputError(`totp_secret is refused: ${problem}`));
};

/**
 * The current code from the key as STORED (read back from the vault), for the
 * site's "enter a code to turn on 2FA" step: the site accepting it proves the
 * key was stored exactly.
 */
const codeFrom = (deps: Deps, login: Login) => {
  const spec = login.totp ? parseTotp(login.totp) : undefined;
  return spec === undefined ? undefined : totpAt(spec, deps.now(), deps.hmac);
};

/** The name of the hidden field an authenticator key is kept in when another replaces it. */
const replacedKeyField = (nowMs: number): string => `totp replaced ${new Date(nowMs).toISOString().slice(0, 10)}`;

/** A secure note has no password or key; what a person keeps in one is in its custom fields. */
const loginOnly = (item: Login, what: string): Login =>
  item.kind === "login" ? item : fail(inputError(`${item.name} is a secure note, which has no ${what}: get_login names its fields, get_field reads one`));

/**
 * A custom field's value, hidden ones included, from a login or a secure note:
 * a secret that is not a password (a licence key, an API token) where a person
 * put it. Handed out on the same terms as get_password: to type or pipe, never
 * to write down. Matched by name, ignoring case and surrounding spaces.
 */
export const getField = async (deps: Deps, id: string, field: string) => {
  await deps.vault.sync();
  const item = await deps.vault.getLogin(id);
  const wanted = field.trim().toLowerCase();
  const matches = item.fields.filter((f) => f.name.trim().toLowerCase() === wanted);
  const names = item.fields.map((f) => f.name).join(", ") || "none";
  if (matches.length === 0) return fail(inputError(`${item.name} has no field named ${field}; its fields: ${names}`));
  if (matches.length > 1) return fail(inputError(`${item.name} has ${matches.length} fields named ${field}; rename one in the web vault`));
  const found = matches[0]!;
  return { id: item.id, kind: item.kind, name: item.name, field: found.name, hidden: found.hidden, value: found.value };
};

export const findLogins = async (deps: Deps, args: { readonly search?: string; readonly url?: string; readonly limit: number }) => {
  await deps.vault.sync();
  const [logins, collections] = await Promise.all([deps.vault.listLogins(args), deps.vault.collections()]);
  return { count: logins.length, logins: logins.slice(0, args.limit).map((l) => summaryOf(l, collections)) };
};

export const getLogin = async (deps: Deps, id: string) => {
  await deps.vault.sync();
  const [login, collections] = await Promise.all([deps.vault.getLogin(id), deps.vault.collections()]);
  return detailOf(login, collections);
};

/**
 * The one call that hands a password out: the current one, or with `previous`
 * the one it replaced (Bitwarden keeps it in the item's history), for when a
 * site refused a rotation that is already stored.
 */
export const getPassword = async (deps: Deps, id: string, previous = false) => {
  await deps.vault.sync();
  const login = loginOnly(await deps.vault.getLogin(id), "a password");
  const head = { id: login.id, name: login.name, username: login.username, urls: login.uris.map((u) => u.uri) };
  if (!previous) return { ...head, password: login.password };
  const before = login.previousPasswords[0];
  if (before === undefined) return fail(inputError(`${login.name} has no previous password recorded`));
  return { ...head, password: before.password, previous: true, replacedAt: before.until };
};

/**
 * Whether a login's password is in Have I Been Pwned's list of breached
 * passwords, and how often it was seen there. Only five hex characters of its
 * SHA-1 leave the server; the answer carries the count, never the password or
 * its hash. With `previous`, the password the current one replaced.
 */
export const checkExposed = async (deps: Deps, id: string, previous = false) => {
  await deps.vault.sync();
  const login = loginOnly(await deps.vault.getLogin(id), "password");
  const password = previous ? login.previousPasswords[0]?.password : login.password;
  if (password === undefined || password === null || password === "") {
    return fail(inputError(previous ? `${login.name} has no previous password recorded` : `${login.name} has no password`));
  }
  const { prefix, suffix } = rangeOf(deps.sha1(password));
  const count = countIn(await deps.pwnedRange(prefix), suffix);
  if (count === undefined) return fail(unavailable("Have I Been Pwned's answer is not a list of ranges"));
  return { id: login.id, name: login.name, username: login.username, ...(previous ? { previous: true as const } : {}), exposed: count > 0, count };
};

export const currentTotp = async (deps: Deps, id: string) => {
  await deps.vault.sync();
  const login = loginOnly(await deps.vault.getLogin(id), "an authenticator key");
  if (login.totp === null || login.totp === "") return fail(inputError(`${login.name} has no authenticator key; update_login sets one`));
  const spec = parseTotp(login.totp);
  if (spec === undefined) return fail(inputError(`${login.name}'s authenticator key is not a TOTP key this server reads (Steam codes are not)`));
  return { id: login.id, name: login.name, ...totpAt(spec, deps.now(), deps.hmac) };
};

export type NewLogin = {
  readonly name: string;
  readonly url?: string;
  readonly username?: string;
  /** A password the caller already has (an account made elsewhere); absent, with no file, means generate one. */
  readonly password?: string;
  /** The same, from a file. */
  readonly passwordFile?: FileSource;
  readonly generate?: PasswordRules;
  readonly notes?: string;
  readonly totpSecret?: string;
  readonly collection?: string;
};

const collectionsSummary = (login: Login, collections: readonly Collection[]) => summaryOf(login, collections);

export const createLogin = async (deps: Deps, args: NewLogin) => {
  checkTotp(args.totpSecret);
  if (args.url !== undefined && hostOf(args.url) === undefined) fail(inputError(`url ${args.url} is not a URL`));
  const given = await givenPassword(deps, args);
  const place = await placeFor(deps, args.collection);
  const created = await deps.vault.createLogin({
    name: args.name,
    ...place,
    notes: args.notes ?? null,
    username: args.username ?? null,
    password: given ?? generatePassword(args.generate ?? DEFAULT_RULES, deps.randomInt),
    totp: args.totpSecret ?? null,
    uris: args.url === undefined ? [] : [{ uri: args.url }],
    fields: [],
  });
  const code = args.totpSecret ? codeFrom(deps, created) : undefined;
  return {
    ...collectionsSummary(created, await deps.vault.collections()),
    passwordGenerated: given === undefined,
    ...(given === undefined ? {} : { passwordLength: [...given].length }),
    ...(code === undefined ? {} : { totp: code }),
  };
};

export type LoginChange = {
  readonly id: string;
  readonly name?: string;
  readonly url?: string;
  readonly username?: string;
  readonly password?: string;
  readonly passwordFile?: FileSource;
  readonly rotate?: PasswordRules;
  readonly notes?: string;
  /** Added after the current notes on a new line, instead of replacing them. */
  readonly appendNotes?: string;
  readonly totpSecret?: string;
  /** Required to replace (or clear) a DIFFERENT key the login already has; the old one is kept in a hidden field. */
  readonly replaceTotp?: boolean;
};

const notesAfter = (current: string | null, args: LoginChange): string | null => {
  if (args.notes !== undefined && args.appendNotes !== undefined) return fail(inputError("pass notes (replaces them) or append_notes, not both"));
  if (args.appendNotes !== undefined) return current ? `${current}\n${args.appendNotes}` : args.appendNotes;
  return args.notes ?? current;
};

/** The key after the change, and the fields with the replaced key kept, when one is replaced. */
const totpAfter = (current: LoginDraft, args: LoginChange, nowMs: number): Pick<LoginDraft, "totp" | "fields"> => {
  if (args.totpSecret === undefined) return { totp: current.totp, fields: current.fields };
  const old = current.totp ?? "";
  if (old === "") return { totp: args.totpSecret, fields: current.fields };
  if (sameKey(old, args.totpSecret)) return { totp: current.totp, fields: current.fields };
  if (args.replaceTotp !== true) {
    return fail(inputError("this login already has a different authenticator key; pass replace_totp: true to replace it (the old key is kept in a hidden field)"));
  }
  return { totp: args.totpSecret, fields: [...current.fields, { name: replacedKeyField(nowMs), value: old, hidden: true }] };
};

/** Changes what is named and keeps the rest; Bitwarden keeps the replaced password in the item's history. */
export const updateLogin = async (deps: Deps, args: LoginChange) => {
  checkTotp(args.totpSecret);
  if (args.url !== undefined && hostOf(args.url) === undefined) fail(inputError(`url ${args.url} is not a URL`));
  const given = await givenPassword(deps, args);
  if (given !== undefined && args.rotate !== undefined) fail(inputError("pass a password (password or password_file) or rotate_password, not both"));
  if (args.replaceTotp === true && args.totpSecret === undefined) fail(inputError("replace_totp goes with the new totp_secret"));
  const current = draftOf(loginOnly(await deps.vault.getLogin(args.id), "login fields to change (this server edits logins only)"));
  const password = args.rotate !== undefined ? generatePassword(args.rotate, deps.randomInt) : (given ?? current.password);
  const notes = notesAfter(current.notes, args);
  const key = totpAfter(current, args, deps.now());
  const edited = await deps.vault.editLogin(args.id, {
    ...current,
    name: args.name ?? current.name,
    username: args.username ?? current.username,
    password,
    notes,
    ...key,
    uris: args.url === undefined ? current.uris : [{ uri: args.url }, ...current.uris.filter((u) => u.uri !== args.url)],
  });
  const changed = password !== current.password;
  const code = args.totpSecret ? codeFrom(deps, edited) : undefined;
  return {
    ...collectionsSummary(edited, await deps.vault.collections()),
    passwordChanged: changed,
    ...(changed && current.password ? { previousPassword: "kept in the item's history: get_password with previous: true reads it" } : {}),
    ...(given === undefined ? {} : { passwordLength: [...given].length }),
    ...(code === undefined ? {} : { totp: code }),
  };
};

/** The one call that pulls the vault whatever the 30 s gate; every read syncs through the gate by itself. */
export const syncVault = async (deps: Deps) => {
  await deps.vault.sync({ force: true });
  const status = await deps.vault.status();
  return { lastSync: status.lastSync };
};
