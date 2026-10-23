/**
 * Which grant an account holds, and what it may do with it. Pure.
 *
 * Every mailbox can hold two grants on the same OAuth client:
 *   modify    this server's own, gmail.modify: read, drafts, send, labels, trash;
 *             plus gmail.settings.basic for filters, which gmail.modify does not cover.
 *   readonly  gmail.readonly, optional, which another program (a mail sync that
 *             must never be able to write) may share. This server falls back to it
 *             for reading when it has no grant of its own, and then refuses every write.
 */
export type GrantRole = "modify" | "readonly";

import { SCOPE_ROOT as SCOPE } from "../../domain/scopes.js";

export { splitScopes } from "../../domain/scopes.js";
export const GMAIL_MODIFY = `${SCOPE}gmail.modify`;
/** Filters (and the other basic settings). gmail.modify does not reach them, so the modify grant asks for both. */
export const GMAIL_SETTINGS_BASIC = `${SCOPE}gmail.settings.basic`;
/** Full access, including permanent delete. Never requested; recognised so a check does not misjudge it. */
export const GMAIL_FULL = "https://mail.google.com/";

/** A Gmail scope that can change the mailbox. Metadata and readonly cannot. */
const WRITING = new Set([
  GMAIL_MODIFY,
  GMAIL_FULL,
  GMAIL_SETTINGS_BASIC,
  `${SCOPE}gmail.compose`,
  `${SCOPE}gmail.send`,
  `${SCOPE}gmail.insert`,
  `${SCOPE}gmail.labels`,
  `${SCOPE}gmail.settings.sharing`,
]);

/** Every write tool here needs modify: drafts, send, labels and trash all live under it. */
export const canWrite = (granted: readonly string[]): boolean => granted.includes(GMAIL_MODIFY) || granted.includes(GMAIL_FULL);

/**
 * Creating or deleting a filter. Not part of canWrite: a modify grant consented
 * before the filter tools existed lacks it, and everything else still works.
 */
export const canEditFilters = (granted: readonly string[]): boolean =>
  granted.includes(GMAIL_SETTINGS_BASIC) || granted.includes(GMAIL_FULL);

export const writingScopes = (granted: readonly string[]): readonly string[] => granted.filter((s) => WRITING.has(s));

/**
 * What each role must hold, beyond agreeing with its own credentials file.
 * The readonly rule is least privilege made checkable: a shared read-only grant
 * widening silently is exactly the drift a scheduled check is for.
 */
export const roleProblems = (role: GrantRole, granted: readonly string[]): readonly string[] => {
  if (role === "modify") {
    return canWrite(granted) ? [] : ["this is the server's own write grant but it does not carry gmail.modify, so every write tool refuses"];
  }
  const extra = writingScopes(granted);
  return extra.length
    ? [`the read-only grant carries write scope (${extra.join(", ")}); it should hold gmail.readonly alone`]
    : [];
};
