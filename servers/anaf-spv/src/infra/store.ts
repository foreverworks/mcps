import { join } from "node:path";

import { readJsonFile, withFileLock, writeJsonFile } from "@foreverworks/mcp-kit";
import { rm } from "node:fs/promises";

import type { ContactEntry, ContactLedgerPort, CuiOnlyPort, DeclarationEntry, DeclarationLedgerPort, LedgerPort, SessionStore, SyncedEntry } from "../app/ports.js";
import { folded } from "../domain/messages.js";
import type { CuiOnly } from "../domain/requests.js";
import type { Cookies, PendingLogin, Session } from "../domain/session.js";
import { makeSerial } from "./serial.js";

/**
 * The state dir (docs/configuration.md): `session.json` (the cookies that ARE
 * the session), `pending.json` (a sign-in waiting for its code),
 * `synced.json` (what sync_messages has saved), `contact.json` (what the
 * contact form was sent), `cui-only.json` (the request types SPV makes only
 * for a company), `declarations.json` (the filing PDFs made and filed) and
 * formularespv-pf's own `forms-session.json` and `forms-pending.json`. All 0600: a session is as good as the password for
 * as long as SPV honours it.
 *
 * A file that does not read as what it should be is treated as absent: a
 * session is then signed in again, a ledger rebuilt (the files it listed are
 * still in the outbox, and saving the same bytes again finds them there).
 */

const isCookies = (v: unknown): v is Cookies => typeof v === "object" && v !== null && Object.values(v).every((x) => typeof x === "string");

const asSession = (v: unknown): Session | undefined => {
  const s = v as Partial<Session> | undefined;
  return s !== undefined && isCookies(s.cookies) && typeof s.username === "string" && typeof s.signedInAtMs === "number" && typeof s.lastOkAtMs === "number"
    ? { cookies: s.cookies, username: s.username, signedInAtMs: s.signedInAtMs, lastOkAtMs: s.lastOkAtMs }
    : undefined;
};

const asPending = (v: unknown): PendingLogin | undefined => {
  const p = v as Partial<PendingLogin> | undefined;
  return p !== undefined && isCookies(p.cookies) && typeof p.username === "string" && typeof p.startedAtMs === "number"
    ? { cookies: p.cookies, username: p.username, startedAtMs: p.startedAtMs }
    : undefined;
};

/** A site's session files: `session.json` and `pending.json` for SPV, `<prefix>-session.json` and `<prefix>-pending.json` for another site. */
export const makeSessionStore = (stateDir: string, prefix = ""): SessionStore => {
  const sessionFile = join(stateDir, `${prefix}session.json`);
  const pendingFile = join(stateDir, `${prefix}pending.json`);
  return {
    read: async () => asSession(await readJsonFile<unknown>(sessionFile)),
    write: (session) => writeJsonFile(sessionFile, session),
    clear: () => rm(sessionFile, { force: true }),
    readPending: async () => asPending(await readJsonFile<unknown>(pendingFile)),
    writePending: (pending) => writeJsonFile(pendingFile, pending),
    clearPending: () => rm(pendingFile, { force: true }),
  };
};

const asLedger = (v: unknown): Readonly<Record<string, SyncedEntry>> => {
  if (typeof v !== "object" || v === null) return {};
  return Object.fromEntries(
    Object.entries(v as Record<string, Partial<SyncedEntry>>).filter(
      (e): e is [string, SyncedEntry] => typeof e[1].path === "string" && typeof e[1].sha256 === "string" && typeof e[1].savedAtMs === "number",
    ),
  );
};

/** synced.json, read-modify-written under a lock so two processes syncing at once both land. */
export const makeLedger = (stateDir: string): LedgerPort => {
  const file = join(stateDir, "synced.json");
  return {
    read: async () => asLedger(await readJsonFile<unknown>(file)),
    record: (entries) =>
      withFileLock(stateDir, "synced.lock", async () => {
        const current = asLedger(await readJsonFile<unknown>(file));
        await writeJsonFile(file, { ...current, ...entries }, { pretty: false });
      }),
  };
};

const asContactEntry = (v: unknown): ContactEntry | undefined => {
  const e = v as { outcome?: unknown; atMs?: unknown; registrationNumber?: unknown; registeredOn?: unknown } | undefined;
  if (e === undefined || typeof e.atMs !== "number") return undefined;
  if (e.outcome === "pending" || e.outcome === "not_registered") return { outcome: e.outcome, atMs: e.atMs };
  if (e.outcome === "registered" && typeof e.registrationNumber === "string" && typeof e.registeredOn === "string") {
    return { outcome: "registered", atMs: e.atMs, registrationNumber: e.registrationNumber, registeredOn: e.registeredOn };
  }
  return undefined;
};

const asContacts = (v: unknown): Readonly<Record<string, ContactEntry>> =>
  typeof v !== "object" || v === null
    ? {}
    : Object.fromEntries(Object.entries(v).flatMap(([k, e]) => {
        const entry = asContactEntry(e);
        return entry === undefined ? [] : [[k, entry] as const];
      }));

/** contact.json: what the contact form was sent, so the same message is not sent twice by a retry. */
export const makeContactLedger = (stateDir: string): ContactLedgerPort => {
  const file = join(stateDir, "contact.json");
  return {
    read: async () => asContacts(await readJsonFile<unknown>(file)),
    record: (fingerprint, entry) =>
      withFileLock(stateDir, "contact.lock", async () => {
        const current = asContacts(await readJsonFile<unknown>(file));
        await writeJsonFile(file, { ...current, [fingerprint]: entry }, { pretty: false });
      }),
  };
};

const asCuiOnly = (v: unknown): Readonly<Record<string, CuiOnly>> =>
  typeof v !== "object" || v === null
    ? {}
    : Object.fromEntries(
        Object.entries(v as Record<string, { type?: unknown; learnedAtMs?: unknown; spvSaid?: unknown }>).flatMap(([k, e]) =>
          typeof e.type === "string" && typeof e.learnedAtMs === "number" && typeof e.spvSaid === "string"
            ? [[k, { type: e.type, source: "learned" as const, learnedAtMs: e.learnedAtMs, spvSaid: e.spvSaid }] as const]
            : [],
        ),
      );

/** cui-only.json: the types SPV refused for a CNP because it makes them only for a company. */
export const makeCuiOnly = (stateDir: string, now: () => number): CuiOnlyPort => {
  const file = join(stateDir, "cui-only.json");
  return {
    read: async () => asCuiOnly(await readJsonFile<unknown>(file)),
    learn: (type, spvSaid) =>
      withFileLock(stateDir, "cui-only.lock", async () => {
        const current = asCuiOnly(await readJsonFile<unknown>(file));
        await writeJsonFile(file, { ...current, [folded(type)]: { type, learnedAtMs: now(), spvSaid } });
      }),
  };
};

const isDeclarationEntry = (v: unknown): v is DeclarationEntry => {
  const e = v as Partial<DeclarationEntry> | undefined;
  return e !== undefined && typeof e.form === "string" && typeof e.year === "number" && typeof e.xmlSha256 === "string" && typeof e.pdfSha256 === "string" && typeof e.pdfBytes === "number" && typeof e.pdfName === "string" && typeof e.validatedAtMs === "number";
};

const asDeclarations = (v: unknown): Readonly<Record<string, DeclarationEntry>> =>
  typeof v !== "object" || v === null ? {} : Object.fromEntries(Object.entries(v).filter((e): e is [string, DeclarationEntry] => isDeclarationEntry(e[1])));

/** declarations.json: every filing PDF this server made from a valid XML, by its SHA-256, and what became of it. */
export const makeDeclarationLedger = (stateDir: string): DeclarationLedgerPort => {
  const file = join(stateDir, "declarations.json");
  return {
    read: async () => asDeclarations(await readJsonFile<unknown>(file)),
    record: (entry) =>
      withFileLock(stateDir, "declarations.lock", async () => {
        const current = asDeclarations(await readJsonFile<unknown>(file));
        await writeJsonFile(file, { ...current, [entry.pdfSha256]: entry });
      }),
  };
};

/** Runs one function at a time on the state dir's session. */
export type Exclusive = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * One holder at a time: in this process (a promise chain) and across
 * processes on the same state dir (a lock file named `name`). The lock is
 * renewed while held, so a holder that takes minutes keeps it; a waiter gives
 * up after about `waitMs`.
 */
const lockOn = (stateDir: string, name: string, waitMs: number): Exclusive => {
  const serial = makeSerial();
  return (fn) => serial(() => withFileLock(stateDir, name, fn, { staleMs: 60_000, retries: Math.ceil(waitMs / 1_000), minTimeoutMs: 250, maxTimeoutMs: 1_000 }));
};

/**
 * One sign-in at a time, so two callers that both find the session dead make
 * SPV send one code, not two. It covers formularespv-pf's sign-in too: both
 * sites e-mail their codes from the same address, so two sign-ins at once
 * could each take the other's code. A sign-in waits at most a few minutes for
 * its mail.
 */
export const makeExclusive = (stateDir: string): Exclusive => lockOn(stateDir, "login.lock", 200_000);

/** One operation at a time on formularespv-pf's session. */
export const makeFormsLock = (stateDir: string): Exclusive => lockOn(stateDir, "forms.lock", 600_000);

/**
 * One portal operation at a time on the session: SPV keeps one rendered
 * message list per session and a download link is a row's position in it, so
 * another listing between a listing and its download shifts the rows under
 * it. A sync of fifty documents holds it for a few
 * minutes; a waiter gives up after ten.
 */
export const makePortalLock = (stateDir: string): Exclusive => lockOn(stateDir, "portal.lock", 600_000);
