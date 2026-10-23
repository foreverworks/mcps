import { romanianCif } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/**
 * The tax code ANAF's API wants, which is not the one on an invoice.
 *
 * An invoice carries the VAT ID (`RO92345672`); every FCTEL endpoint wants the
 * bare CIF (`92345672`) and answers a prefixed one with an empty result set
 * rather than an error, which is the worst way to be wrong. Normalising here
 * means neither the caller nor the adapter has to remember. The control digit
 * is checked too (the kit's romanianCif), so a transposed digit fails here
 * instead of reading, or filing for, another company.
 */
export const normaliseCif = (value: string): string => {
  // Separators and leading zeros are how a code gets written, not part of it.
  const compact = value.replace(/[\s.-]/g, "").toUpperCase().replace(/^(RO)?0+(?=\d)/, "$1");
  const checked = romanianCif(compact);
  return checked.ok ? checked.value : fail(inputError(checked.reason));
};
