/**
 * SPV's alert e-mail, "Documente noi SPV" from Portal.ANAF@anaf.ro: "Ați
 * primit următoarele documente în Spațiul Privat Virtual (SPV) ANAF:", then
 * one line per document posted, "- CIF <masked>: <details>", the details word
 * for word as the row's in SPV's message list, often ending ", prelucrata la
 * DD-MM-YYYY".
 *
 * SPV drops most rows about two months after posting them, and an act posted
 * there counts as communicated on the day it was made available (art. 47
 * alin. (15) of the Fiscal Procedure Code); for a row SPV no longer shows,
 * these alerts are the lasting record of when it was posted. Pure.
 */

/** The alerts, in Gmail's query syntax. */
export const ALERT_QUERY = 'from:Portal.ANAF@anaf.ro subject:"Documente noi SPV"';

export type AlertLine = {
  /** The line's text after "CIF <masked>:", as SPV's list shows the row's details. */
  readonly details: string;
  /** What the document is: the details up to "pentru CIF/CNP/id ..." or ", prelucrata la". */
  readonly document: string;
  /** A declaration form's code the document names (D256 for an ex officio tax decision). */
  readonly form: string | undefined;
  /** "prelucrata la DD-MM-YYYY", as YYYY-MM-DD: the day ANAF processed it. */
  readonly processedOn: string | undefined;
};

const LINE = /^\s*-\s*CIF\s+[0-9X*]+\s*:\s*(.+?)\s*$/i;

/** One line of an alert, or undefined for the greeting and the footer. */
export const alertLine = (line: string): AlertLine | undefined => {
  const details = LINE.exec(line)?.[1];
  if (details === undefined) return undefined;
  const processed = /prelucrata\s+la\s+(\d{2})-(\d{2})-(\d{4})/i.exec(details);
  const document = (details.split(/\s+pentru\s+(?:CIF|CNP|id)\b|,\s*prelucrata\s+la\b/i)[0] ?? details).trim();
  return {
    details,
    document,
    form: /\bD\d{3}\b/.exec(document)?.[0],
    processedOn: processed === null ? undefined : `${processed[3]}-${processed[2]}-${processed[1]}`,
  };
};
