import { z } from "zod";

import { lookupCompanies } from "../../app/usecases/companies.js";
import { MAX_CIFS } from "../../domain/company.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

export const registerCompanies: Registrar = (server, deps) => {
  server.registerTool(
    "lookup_company",
    {
      title: "Look up Romanian companies",
      description:
        "Look up companies in ANAF's public VAT registry by CIF: name, trade register number, registered " +
        "office, CAEN code, and the statuses an invoice depends on (vatPayer with its current period, " +
        "vatOnCollection, splitVat, inactive, and eFacturaRegistry for the RO e-Factura registry). " +
        "notFound lists the CIFs ANAF does not know. A status ANAF did not report is absent, not false. " +
        "Needs no grant.",
      inputSchema: {
        cifs: z.array(z.string()).min(1).max(MAX_CIFS).describe(`1 to ${MAX_CIFS} CIFs, with or without the RO prefix.`),
        date: z.string().default("").describe("YYYY-MM-DD: the statuses as they stood that day. Empty means today in Bucharest."),
      },
    },
    handled((args: { cifs: string[]; date: string }) => lookupCompanies(deps, args)),
  );
};
