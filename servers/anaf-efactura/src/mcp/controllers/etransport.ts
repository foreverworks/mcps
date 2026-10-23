import { z } from "zod";

import { listEtransport } from "../../app/usecases/etransport.js";
import { fileTransport, transportStatusOf } from "../../app/usecases/transports.js";
import { filingInput, resolvedFilingArgs, resolveFiling, toFilingArgs } from "../transportArgs.js";
import { testFlag } from "../uploadArgs.js";
import { MAX_DAYS } from "../../domain/window.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

export const registerEtransport: Registrar = (server, deps) => {
  server.registerTool(
    "etransport_list",
    {
      title: "List e-Transport messages",
      description:
        `List e-Transport declarations from the last N days (at most ${MAX_DAYS}): UIT code, declarant, trading ` +
        "partner, carrier, vehicle, and refused=true with ANAF's messages for a declaration it rejected. A notice " +
        "field means ANAF refused or had nothing. Separate from e-Factura: it needs the ETRANSPORT role on the same grant.",
      inputSchema: {
        zile: z.number().int().default(MAX_DAYS).describe(`Lookback in days, 1 to ${MAX_DAYS}.`),
        cif: z.string().default("").describe("Defaults to the CIF in app.json."),
        test: z.boolean().default(false).describe("Query ANAF's test environment instead of production."),
      },
    },
    handled((args: { zile: number; cif: string; test: boolean }) => listEtransport(deps, args)),
  );

  server.registerTool(
    "etransport_file",
    {
      title: "File an e-Transport declaration",
      description:
        "File an e-Transport declaration XML (ANAF's schema v2) with ANAF: a new transport (notificare), its " +
        "correction (notificare with corectie), a deletion (stergere), a receiver's confirmation (confirmare) or a " +
        "vehicle change (modifVehicul), whichever the file holds. The XML as xml: { path } for a file, or " +
        "{ content_base64, sha256 } from a script. Goes to ANAF's TEST environment unless test is explicitly false. " +
        "A money tool (a fiscal declaration): the client asks the user to approve each call, on a line read out of " +
        "the file (operation, UIT, route, vehicle, goods value in RON, environment). The declarant's code and any " +
        "UIT must pass their check digits. Returns accepted, the uploadId etransport_status takes and the UIT, or " +
        "accepted=false with ANAF's reasons; the UIT counts only once etransport_status says ok. The same bytes are " +
        "not filed in production twice unless refile is true. Needs the ETRANSPORT role on the grant.",
      inputSchema: filingInput(deps.files.readInput),
    },
    handled(async (args: Record<string, unknown>) =>
      fileTransport(deps, toFilingArgs(resolvedFilingArgs.parse(await resolveFiling(deps.files.readInput, deps.readDeclaration, args)))),
    ),
  );

  server.registerTool(
    "etransport_status",
    {
      title: "Check an e-Transport filing",
      description:
        "How an e-Transport declaration filed with etransport_file was processed, by its uploadId: state ok (the " +
        "UIT is valid from now), processing, or failed with ANAF's reasons. Ask the environment it was filed in: " +
        "test unless test is false.",
      inputSchema: {
        id_incarcare: z.string().describe("The uploadId etransport_file returned: digits."),
        test: testFlag,
      },
    },
    handled((args: { id_incarcare: string; test: boolean }) => transportStatusOf(deps, { idIncarcare: args.id_incarcare, test: args.test })),
  );
};
