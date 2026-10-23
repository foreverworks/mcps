import { CONSENT_DAYS } from "./dates.js";
import { fail, inputError } from "./errors.js";

/**
 * A label is a key in sessions.json, which other programs may read and use as
 * an identifier of their own (an importer's connection name, a file name). New
 * labels are held to what survives that unchanged: lower-case letters, digits,
 * `_` and `-`.
 */
const LABEL = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export const parseLabel = (value: string): string => {
  const label = value.trim();
  if (!LABEL.test(label))
    fail(inputError(`label "${value}" must be 1-63 characters of a-z, 0-9, _ and -, starting with a letter or digit`));
  return label;
};

/**
 * The label a consent is stored under when the caller names none: the bank
 * and its country, as a label may spell them (`Example Bank`, `DE` is
 * `example_bank_de`).
 */
export const derivedLabel = (bankName: string, country: string): string => {
  const bank = bankName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return parseLabel(`${bank === "" ? "bank" : bank.slice(0, 55)}_${country.trim().toLowerCase()}`);
};

export type ConsentRequest = {
  readonly aspspName: string;
  readonly aspspCountry: string;
  readonly psuType: string;
  readonly validUntil: string;
};

const MAX_SUMMARY = 300;
const MAX_NAME = 80;

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();
const clip = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 3)}...`);

/**
 * The one line a user confirms before a consent is started, when the server
 * asks (MCP_CONFIRM=elicit): which bank, which country, whose accounts, and
 * until when. Only what the arguments say, so it describes exactly what would
 * be sent. The end date is computed from the moment the call runs, so it is
 * stated for a confirmation given today; a later one moves it by the delay. The
 * bank name is clipped before anything else, so an absurd one cannot push the
 * date out of the line.
 */
export const consentSummary = (request: ConsentRequest): string =>
  clip(
    oneLine(
      `Bank consent (PSD2, read-only: balances and transactions) with ${clip(oneLine(request.aspspName), MAX_NAME)} ` +
        `(${request.aspspCountry.toUpperCase()}), ${request.psuType} accounts, every account the bank offers, ` +
        `valid ${CONSENT_DAYS} days: until ${request.validUntil.slice(0, 10)} if confirmed today`,
    ),
    MAX_SUMMARY,
  );
