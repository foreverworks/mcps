import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { detailField, localDate, stateField } from "../fields.js";
import type { Registrar } from "../tools.js";

export const registerReceipts: Registrar = (server, deps, tools, handled) => {
  const { copy } = tools;

  server.registerTool(
    "get_receipt",
    {
      title: "Get receipt",
      description: copy.getReceipt,
      inputSchema: { order_id: z.number().int().describe("From list_orders.") },
    },
    handled((args: { order_id: number }) => tools.getReceipt(deps, args.order_id)),
  );

  server.registerTool(
    "get_receipts",
    {
      title: "Get receipts",
      description: copy.getReceipts,
      inputSchema: {
        since: localDate(deps.timeZone, copy.firstDate),
        until: localDate(deps.timeZone, copy.lastDate),
        state: stateField(copy.state),
        detail: detailField(copy.detail),
      },
    },
    handled((args: { since: string; until: string; state?: string | undefined; detail: "full" | "headline" }) =>
      tools.useCases.getReceipts(deps, compact(args)),
    ),
  );
};
