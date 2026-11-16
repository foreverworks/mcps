import { cancelOrder, getOrder, placeOrder, quoteVignette } from "../../app/usecases/purchase.js";
import { id, startDate, vehicle } from "../args.js";
import type { Registrar } from "./types.js";

/** place_order's arguments, shared with the policy's line and resolve. */
export const placeInput = {
  quote_id: id("The option to buy: a quote_id from quote_vignette, at most 30 minutes old."),
  billing_id: id("Who the invoice is made out to, when the account has more than one billing entry (the refusal lists them). Default: the only one.").optional(),
};

/** The line the user confirmed, which the policy's `resolve` writes into the arguments over anything a client sent. */
const confirmedLineOf = (args: object): string | undefined => {
  const line: unknown = (args as { readonly order_line?: unknown }).order_line;
  return typeof line === "string" ? line : undefined;
};

export const registerPurchase: Registrar = (server, deps, handled) => {
  server.registerTool(
    "quote_vignette",
    {
      title: "Quote vignette",
      description:
        "What a rovinietă costs for one vehicle from a start date: one option per duration (1 day to 12 months), each with its exact price in RON and the period it covers, " +
        "and a quote_id that place_order takes. Buys nothing. The start defaults to the first day eToll allows (the day after the current vignette ends).",
      inputSchema: {
        vehicle,
        start_date: startDate,
      },
    },
    handled((args) => quoteVignette(deps, { vehicle: args.vehicle, startDate: args.start_date })),
  );

  server.registerTool(
    "place_order",
    {
      title: "Place order",
      description:
        "Order the quoted vignette and hand over eToll's card payment page on euplatesc.ro; the USER pays there, nothing is paid here. The user confirms one line first " +
        "(vehicle, duration, dates, price, who is billed). Refused if the price moved since the quote. Then get_order shows whether it was paid.",
      inputSchema: placeInput,
    },
    handled((args) =>
      placeOrder(deps, {
        quoteId: args.quote_id,
        billingId: args.billing_id,
        confirmedLine: confirmedLineOf(args),
      }),
    ),
  );

  server.registerTool(
    "get_order",
    {
      title: "Get order",
      description: "An order placed by place_order: pending (not paid yet, with its payment page), paid, expired or cancelled, and its vignettes.",
      inputSchema: { order_id: id("The order_id place_order answered.") },
    },
    handled((args) => getOrder(deps, { orderId: args.order_id })),
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel order",
      description:
        "Drop an unpaid order (one place_order made, or one eToll names as already open for the same vignette). Safe to call twice. A paid order is refused: refunds go through eToll. An order eToll will not delete is refused with ORDER_NOT_DELETABLE, since it may be paid.",
      inputSchema: { order_id: id("The order's id.") },
    },
    handled((args) => cancelOrder(deps, { orderId: args.order_id })),
  );
};
