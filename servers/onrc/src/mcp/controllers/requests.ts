import { getRequest, listCalculationNotes, listInvoices, listRequests } from "../../app/usecases/requests.js";
import { filingId, listing } from "../args.js";
import type { Registrar } from "./types.js";

export const registerRequests: Registrar = (server, deps, handled) => {
  server.registerTool(
    "list_requests",
    {
      title: "List filings",
      description:
        '"Cererile mele": the filings made from this portal account (a mențiune, an înmatriculare, a certificat constatator), newest first, with the portal number, ' +
        "the trade register number, the status (WORKING: still at the office), the company and whether a calculation note or an invoice exists. The id is what get_request takes.",
      inputSchema: listing,
    },
    handled((args) => listRequests(deps, args)),
  );

  server.registerTool(
    "get_request",
    {
      title: "Get filing",
      description:
        "One filing: its status in the office's words, the two terms (resolutionDue: by when the registrar decides; releaseDue: when the documents are released), " +
        "whether files are ready to download, and the documents in its file (the signed application, resolutions, certificates once issued).",
      inputSchema: { id: filingId },
    },
    handled((args) => getRequest(deps, { id: args.id })),
  );

  server.registerTool(
    "list_calculation_notes",
    {
      title: "List calculation notes",
      description: '"Notele mele de calcul": the fee notes the office issued for the filings, with amount, status and the date to pay by. A filing with no fee has none.',
      inputSchema: listing,
    },
    handled((args) => listCalculationNotes(deps, args)),
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List invoices",
      description: '"Facturile mele": the invoices the office issued for paid fees, with total, what was paid and what is outstanding.',
      inputSchema: listing,
    },
    handled((args) => listInvoices(deps, args)),
  );
};
