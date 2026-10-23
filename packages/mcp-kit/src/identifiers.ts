/**
 * Identifiers a person types and a model copies, checked by their own check
 * digits, so a transposed digit fails before a document is issued to the wrong
 * company or money is sent to the wrong account. Pure functions; a server wires
 * them into its argument schemas and its domain rules.
 */

export type Checked = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

const ok = (value: string): Checked => ({ ok: true, value });
const no = (reason: string): Checked => ({ ok: false, reason });

/** The weighted sum of `digits` against `key`, digit by digit from the left. */
const weighted = (digits: string, key: string): number =>
  [...digits].reduce((sum, d, i) => sum + Number(d) * Number(key[i]), 0);

/**
 * A Romanian fiscal code (CIF / CUI), with or without the `RO` VAT prefix: 2 to
 * 10 digits, the last a control digit computed with the key 753217532 over the
 * others, right-aligned. `value` is the digits alone.
 */
export const romanianCif = (text: string): Checked => {
  const digits = text.trim().toUpperCase().replace(/^RO/, "").trim();
  if (!/^[1-9][0-9]{1,9}$/.test(digits)) return no(`"${text}" is not a Romanian fiscal code: 2 to 10 digits, optionally after RO`);
  const body = digits.slice(0, -1).padStart(9, "0");
  const control = ((weighted(body, "753217532") * 10) % 11) % 10;
  return control === Number(digits.at(-1)) ? ok(digits) : no(`"${text}" fails its control digit (a digit is wrong or two are swapped)`);
};

/**
 * A Romanian personal numeric code (CNP): 13 digits, the last a control digit
 * computed with the key 279146358279 (a remainder of 10 counts as 1).
 */
export const cnp = (text: string): Checked => {
  const digits = text.trim();
  if (!/^[1-9][0-9]{12}$/.test(digits)) return no("a CNP is 13 digits");
  const remainder = weighted(digits.slice(0, 12), "279146358279") % 11;
  const control = remainder === 10 ? 1 : remainder;
  return control === Number(digits[12]) ? ok(digits) : no("the CNP fails its control digit");
};

/** The remainder of a long decimal string modulo 97, a few digits at a time. */
const mod97 = (numeric: string): number => [...numeric].reduce((rest, d) => (rest * 10 + Number(d)) % 97, 0);

/**
 * An IBAN (ISO 13616): a country code, two check digits and up to 30 letters or
 * digits, whose rearrangement is 1 modulo 97. Spaces are ignored; `value` is
 * the IBAN without them, in capitals.
 */
export const iban = (text: string): Checked => {
  const compact = text.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(compact)) return no(`"${text}" is not shaped like an IBAN`);
  const numeric = [...`${compact.slice(4)}${compact.slice(0, 4)}`].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join("");
  return mod97(numeric) === 1 ? ok(compact) : no(`"${text}" fails its IBAN check digits (a character is wrong or two are swapped)`);
};
