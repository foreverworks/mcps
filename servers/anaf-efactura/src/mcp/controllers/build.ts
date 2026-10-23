import type { OutputOf } from "@foreverworks/mcp-kit";

import { buildInvoice } from "../../app/usecases/build.js";
import { type BuildArgs, buildInput, toDraft } from "../buildArgs.js";
import { handled } from "../envelope.js";
import { BUILD_OUTPUT } from "../outputs.js";
import type { Registrar } from "./types.js";

export const registerBuild: Registrar = (server, deps) => {
  server.registerTool(
    "build_invoice",
    {
      title: "Build a CIUS-RO invoice",
      description:
        "Write a Romanian e-Factura invoice (UBL 2.1, CIUS-RO) from fields: seller and buyer, lines with their net " +
        "price, quantity and VAT category, the currency, the payment terms. Totals are computed exactly (each line " +
        "rounded to 2 decimals, VAT once per category and rate), and the draft is checked first: CIF, CNP and IBAN " +
        "check digits, the county and Bucharest sector, the VAT rules per category, CIUS-RO's lengths, every problem " +
        "named at once. The file goes to the outbox; the answer gives its path, sha256 and totals. Nothing is sent " +
        "to ANAF: next, validate_invoice with xml: { path }, then upload_invoice with the same path to file it. An " +
        "invoice in another currency needs vat_exchange_rate (RON per unit), so its VAT is stated in RON too.",
      inputSchema: buildInput,
      outputSchema: BUILD_OUTPUT,
    },
    handled(
      (args: BuildArgs): Promise<OutputOf<typeof BUILD_OUTPUT>> =>
        buildInvoice(deps, { draft: toDraft(args), fileName: args.file_name, saveDir: args.save_dir }),
    ),
  );
};
