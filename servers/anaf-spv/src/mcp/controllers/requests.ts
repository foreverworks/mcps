import { z } from "zod";

import { listDocumentTypes, requestDocument } from "../../app/usecases/requests.js";
import type { Registrar } from "./types.js";

const cif = z.string().trim().min(1).optional().describe("The tax id to request for, one of `identities`; default the form's first (the account holder).");

export const registerRequests: Registrar = (server, deps, handled) => {
  server.registerTool(
    "list_document_types",
    {
      title: "Document types",
      description:
        "What SPV lets this account request (\"Solicitări\"), read from the live form: the identities it may request for, and for one of them every " +
        "document type with the fields it requires or accepts (year, month, registration_number, pui). Among a person's: Obligatii de plata (the " +
        "statement of what is owed), Nota obligatiilor de plata, Istoric declaratii PF, Duplicat declaratie unica (year), Duplicat Recipisa " +
        "(registration_number), Venituri Formular Banca, Interogari Banci, certificates. For a person's CNP, the types SPV makes only for a company " +
        "(Notificare, and any it has refused that way before) are left out of types and listed under cui_only.",
      inputSchema: { cif },
    },
    handled((args) => listDocumentTypes(deps, { cif: args.cif })),
  );

  server.registerTool(
    "request_document",
    {
      title: "Request a document",
      description:
        "Ask SPV for a document, as its \"Solicitări\" form does. SPV registers the request (the answer carries its request_id) and posts the document " +
        "as a RASPUNS SOLICITARE message a minute or two later: call await_reply with the id. The type must be one list_document_types offers this " +
        "identity, with the fields it requires; a field the type does not take is refused before anything is sent. Free, and changes nothing at ANAF.",
      inputSchema: {
        type: z.string().trim().min(1).describe("The document type, as list_document_types names it (case and diacritics ignored)."),
        cif,
        year: z.number().int().min(2000).max(2100).optional().describe("The reporting year, for the types that take one (Duplicat declaratie unica: 2025 = the return filed in 2025)."),
        month: z.number().int().min(1).max(12).optional().describe("The reporting month, for the types that take one."),
        registration_number: z.string().trim().min(1).optional().describe("A filing's registration number, for Duplicat Recipisa (e.g. INTERNT-123456789-2026)."),
        pui: z.string().trim().min(1).optional().describe("The PUI, for the Fisa Rol types."),
        month_from: z.number().int().min(1).max(12).optional().describe("The first month, for the types that take a range (Neconcordante D394)."),
        month_to: z.number().int().min(1).max(12).optional().describe("The last month of that range."),
      },
    },
    handled((args) =>
      requestDocument(deps, {
        type: args.type,
        cif: args.cif,
        year: args.year,
        month: args.month,
        registrationNumber: args.registration_number,
        pui: args.pui,
        monthFrom: args.month_from,
        monthTo: args.month_to,
      }),
    ),
  );
};
