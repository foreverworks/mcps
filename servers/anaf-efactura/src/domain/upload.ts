import { fail, inputError } from "./errors.js";

/**
 * The XML dialects ANAF's `/upload` accepts.
 *
 * UBL is what an ordinary Romanian sales invoice is; CII is the alternative
 * cross-border syntax; CN and RASP are the credit-note and response documents.
 */
export const STANDARDS = ["UBL", "CII", "CN", "RASP"] as const;

export type Standard = (typeof STANDARDS)[number];

export const parseStandard = (value: string): Standard => {
  const upper = value.toUpperCase();
  if (!(STANDARDS as readonly string[]).includes(upper))
    fail(inputError(`standard must be one of ${STANDARDS.join(", ")}, got "${value}"`));
  return upper as Standard;
};

export type UploadFlags = {
  /** The buyer is foreign and has no Romanian CUI. */
  readonly extern: boolean;
  /** Self-billing: we are issuing the invoice on the supplier's behalf. */
  readonly autofactura: boolean;
  /** Issued under an enforcement procedure. */
  readonly executare: boolean;
};

/**
 * ANAF reads these as the literal string `DA`, and reads their ABSENCE as no.
 * Sending `NU` is not the same as omitting the parameter for `autofactura`, so
 * the false case has to drop the key rather than spell it out.
 */
export const flagParams = (flags: UploadFlags): Record<string, string> => ({
  ...(flags.extern ? { extern: "DA" } : {}),
  ...(flags.autofactura ? { autofactura: "DA" } : {}),
  ...(flags.executare ? { executare: "DA" } : {}),
});
