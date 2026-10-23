import { companyListing, parseAsOf, parseCifs } from "../../domain/company.js";
import type { Deps } from "../ports.js";

/**
 * Companies from ANAF's VAT registry, as of a date (today in Bucharest by
 * default): identity, registered office, and the statuses an invoice depends
 * on. A past date answers "what was true then", which is what checking an
 * old invoice needs.
 */
export const lookupCompanies = async (deps: Deps, args: { readonly cifs: readonly string[]; readonly date: string }) => {
  const cifs = parseCifs(args.cifs);
  const asOf = parseAsOf(args.date, deps.now());
  return { asOf, ...companyListing(await deps.anaf.companies(cifs, asOf), cifs) };
};
