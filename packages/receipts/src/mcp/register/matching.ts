import { z } from "zod";

import { detailField, localDate } from "../fields.js";
import type { Registrar } from "../tools.js";

export const registerMatching: Registrar = (server, deps, tools, handled) => {
  server.registerTool(
    "match_card_charges",
    {
      title: "Match card charges",
      description: tools.copy.matchCardCharges,
      inputSchema: {
        charges: z
          .array(
            z.object({
              id: z.string().describe("Your id for the row, e.g. the ledger's transaction id. Echoed back."),
              date: localDate(deps.timeZone, "Booking date"),
              amount: z
                .string()
                .regex(/^\s*-?\d{1,15}(?:[.,]\d{1,2})?\s*$/)
                .describe(
                  "Decimal with its sign, as booked: a debit is negative ('-42.50' or '-42,50'). A positive amount is a credit, " +
                    "such as a refund: it is listed under credits and pairs with no order.",
                ),
              currency: z.string().regex(/^[A-Za-z]{3}$/).describe("ISO 4217 code as booked, e.g. 'EUR'."),
            }),
          )
          .min(1)
          .max(500),
        detail: detailField(tools.copy.detail),
      },
    },
    handled((args: { charges: { id: string; date: string; amount: string; currency: string }[]; detail: "full" | "headline" }) =>
      tools.useCases.matchCardCharges(deps, args),
    ),
  );
};
