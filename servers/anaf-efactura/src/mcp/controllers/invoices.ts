import { z } from "zod";

import { downloadInvoice, listInvoices, listInvoicesWindow } from "../../app/usecases/invoices.js";
import { MAX_DAYS } from "../../domain/window.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

const cif = z
  .string()
  .default("")
  .describe("Defaults to the CIF in app.json. With or without the RO prefix; both are accepted.");

const test = z.boolean().default(false).describe("Query ANAF's test environment instead of production.");

export const registerInvoices: Registrar = (server, deps) => {
  server.registerTool(
    "list_invoices",
    {
      title: "List e-Factura messages",
      description:
        `List e-Factura messages from the last N days (ANAF allows at most ${MAX_DAYS}). Each message has a ` +
        "kind (sent, received, error, buyerMessage), an id that download_invoice takes, a zoneless local " +
        "timestamp, and details: the upload id, issuer CIF and beneficiary CIF lifted out of ANAF's prose. " +
        "A notice field means ANAF refused rather than returned nothing.",
      inputSchema: {
        zile: z.number().int().default(MAX_DAYS).describe(`Lookback in days, 1 to ${MAX_DAYS}.`),
        cif,
        test,
      },
    },
    handled((args: { zile: number; cif: string; test: boolean }) => listInvoices(deps, args)),
  );

  server.registerTool(
    "list_invoices_window",
    {
      title: "List e-Factura messages over a date window",
      description:
        `List messages over an inclusive YYYY-MM-DD window, paginated, in the same shape as list_invoices ` +
        `plus page counters. The window may span at most ${MAX_DAYS} days and is read as UTC. filtru narrows ` +
        "by type: E errors, T sent, P received, R awaiting a response.",
      inputSchema: {
        start_date: z.string().describe("YYYY-MM-DD, inclusive."),
        end_date: z.string().describe("YYYY-MM-DD, inclusive."),
        cif,
        page: z.number().int().min(1).default(1),
        filtru: z.enum(["", "E", "T", "P", "R"]).default("").describe("Empty means every type."),
        test,
      },
    },
    handled((args: { start_date: string; end_date: string; cif: string; page: number; filtru: string; test: boolean }) =>
      listInvoicesWindow(deps, {
        startDate: args.start_date,
        endDate: args.end_date,
        cif: args.cif,
        page: args.page,
        filtru: args.filtru,
        test: args.test,
      }),
    ),
  );

  server.registerTool(
    "download_invoice",
    {
      title: "Download a signed invoice archive",
      description:
        "Download the signed ZIP for a message id from list_invoices and save it to the downloads outbox (a name " +
        "holding another file gets a number, never overwritten). The " +
        "archive is checked first: it must open with every entry matching its checksum and hold the document " +
        "with ANAF's seal (semnatura_*.xml), and the seal is checked against the document. Returns the path, " +
        "bytes, sha256 and md5 of the archive, each entry's name, bytes and sha256, the seal's verdict, and what the " +
        "invoice says.",
      inputSchema: {
        message_id: z.string().describe("The id field from list_invoices (digits), not requestId."),
        save_dir: z
          .string()
          .default("")
          .describe("A folder INSIDE the downloads outbox (e.g. \"2026-09\"); empty means the outbox itself. A path outside it is refused."),
        test,
      },
    },
    handled((args: { message_id: string; save_dir: string; test: boolean }) =>
      downloadInvoice(deps, { messageId: args.message_id, saveDir: args.save_dir, test: args.test }),
    ),
  );
};
