/**
 * The security code SPV e-mails at every sign-in, and how a new one is told
 * from the ones already in the mailbox. Pure.
 *
 * The mail comes from Autentificare.SpatiuPrivat@anaf.ro
 * with the subject "Cod de siguranta" and the whole body
 * "Cod de siguranta: 246810, expira dupa 300 secunde.", within a second of the
 * password being accepted. Gmail threads every such mail into one
 * conversation, so a search shows one thread whose snippet is the NEWEST code.
 */

/** The sender and subject, which every mail source is told to search for. */
export const CODE_SENDER = "Autentificare.SpatiuPrivat@anaf.ro";
export const CODE_SUBJECT = "Cod de siguranta";

/** How long SPV honours a code, as its mail and its login page both say. */
export const CODE_LIFETIME_MS = 300_000;

/** The phrase and the digits, with or without diacritics, in a body, a snippet or a whole JSON answer. */
const CODE = /Cod\s+de\s+siguran(?:t|ț|ţ)(?:a|ă)\s*:?\s*(\d{4,10})\b/giu;

/** Every code in a text, in the order they appear, each once. */
export const codesIn = (text: string): readonly string[] => {
  const found: string[] = [];
  for (const m of text.matchAll(CODE)) {
    const code = m[1];
    if (code !== undefined && !found.includes(code)) found.push(code);
  }
  return found;
};

/**
 * The code to use: the first one in `now` that was not in `before`. A mail
 * search lists the newest first, so when two new codes appear (someone signing
 * in by hand at the same moment) this takes the newer; if that one is not ours
 * SPV refuses it and the next login asks again.
 */
export const firstNewCode = (now: readonly string[], before: ReadonlySet<string>): string | undefined => now.find((code) => !before.has(code));

/** Only the digits of a code a person typed: spaces and dashes are dropped, anything else refused. */
export const typedCode = (text: string): string | undefined => {
  const digits = text.replace(/[\s-]/g, "");
  return /^\d{4,10}$/.test(digits) ? digits : undefined;
};
