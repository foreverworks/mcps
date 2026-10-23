import { fail, inputError } from "./errors.js";
import { folded } from "./messages.js";

/**
 * A filing's number and its state at ANAF. Pure.
 *
 * ANAF knows a filed declaration by its index de încărcare: the number its
 * receipt (RECIPISA) prints as "Index încărcare: N" and inside its
 * registration number, INTERNT-N-<year>. formularespv-pf's "index de
 * depunere" is another number (an index de depunere has eight digits, an
 * index de încărcare ten), which the status service does not know.
 */
export type FilingRef = {
  /** The index de încărcare, or a number to look up first (an index de depunere). */
  readonly index: string;
  /** The year of a registration number, when the reference was one. */
  readonly year: number | undefined;
};

const REGISTRATION = /INTERNT-(\d{4,12})-(\d{4})/i;

/** "1200000002" or "INTERNT-1200000002-2026" (a trailing "/12-10-2026" or " din 12.10.2026" is allowed and ignored). */
export const filingRefOf = (text: string): FilingRef => {
  const trimmed = text.trim();
  const registration = new RegExp(`^${REGISTRATION.source}(?:\\s*(?:/|din\\b).*)?$`, "i").exec(trimmed);
  if (registration !== null) return { index: registration[1] ?? "", year: Number(registration[2]) };
  if (/^\d{4,12}$/.test(trimmed)) return { index: trimmed, year: undefined };
  return fail(inputError(`"${text}" is neither an index (its digits) nor a registration number (INTERNT-<index>-<year>)`));
};

/** The registration number a text carries (a RECIPISA row's details, a status row), as a reference. */
export const registrationIn = (text: string): (FilingRef & { readonly number: string }) | undefined => {
  const m = REGISTRATION.exec(text);
  return m === null ? undefined : { index: m[1] ?? "", year: Number(m[2]), number: `INTERNT-${m[1] ?? ""}-${m[2] ?? ""}` };
};

/** The tax id the status service takes: a CNP (13 digits) or a CUI (2 to 10), without "RO" or spaces. */
export const taxIdOf = (text: string): string => {
  const id = text.replace(/\s+/g, "").replace(/^RO/i, "");
  return /^(\d{13}|[1-9]\d{1,9})$/.test(id) ? id : fail(inputError(`"${text}" is not a CNP (13 digits) or a CUI (2 to 10 digits)`));
};

/**
 * The four states ANAF's status page names ("Stare document"), in its own
 * words, read 2026-10-22 from stare.anaf.ro/StareD112:
 * "In prelucrare.", "Fişierul depus nu este un document valid.",
 * "Documentul are erori de validare.", "Documentul este valid.".
 */
export type FilingState = "processing" | "not_registered" | "validation_errors" | "valid" | "unknown";

export const stateOf = (said: string): FilingState => {
  const text = folded(said);
  if (text.startsWith("in prelucrare")) return "processing";
  if (text.includes("nu este un document valid")) return "not_registered";
  if (text.includes("erori de validare")) return "validation_errors";
  if (text.includes("este valid")) return "valid";
  return "unknown";
};

/** What each state means, from the page's own explanations. */
export const MEANING: Readonly<Record<FilingState, string>> = {
  processing: "ANAF's servers are still processing the file; look again in a few minutes",
  not_registered:
    "the file did not meet the minimum to be checked (an unknown form, no signature or one without the right to file for this tax id, no period, no XML): it was NOT registered; correct it and file again",
  validation_errors: "registered, but ANAF's checks found errors, which the receipt lists: correct them and file again",
  valid: "ANAF's checks passed; the data goes on to the institutions it is for",
  unknown: "a state this server does not know; state is ANAF's own words",
};

/** "16.07.2026" as "2026-07-16"; anything else undefined. */
export const isoDateOf = (text: string): string | undefined => {
  const m = /^(\d{2})[.-](\d{2})[.-](\d{4})$/.exec(text.trim());
  return m === null ? (/^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ? text.trim() : undefined) : `${m[3]}-${m[2]}-${m[1]}`;
};
