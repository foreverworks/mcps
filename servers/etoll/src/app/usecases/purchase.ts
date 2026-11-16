import { offerLink } from "@foreverworks/mcp-kit";

import { bucharestToday, localDateOf } from "../../domain/dates.js";
import { asAppError, drift, fail, inputError, notFound, ORDER_NOT_DELETABLE, orderLeftOpen, PRICE_CHANGED, refused } from "../../domain/errors.js";
import { CURRENCY, priceOf, sameAmount, shownAmount } from "../../domain/money.js";
import { collectAll } from "../../domain/paging.js";
import {
  billingOptions,
  checkoutTotalOf,
  chooseBilling,
  defaultStart,
  findVehicle,
  isOrdersToll,
  isPaymentUrl,
  liveQuote,
  orderLine,
  orderRequest,
  orderState,
  PAYMENT_HOST,
  type PaymentRequest,
  paymentRequest,
  QUOTE_TTL_S,
  quoteOptions,
  quoteRequest,
  quoteView,
  type StoredOrder,
  storedOrderOf,
  type StoredQuote,
} from "../../domain/purchase.js";
import { isoOf } from "../../domain/session.js";
import { tollView, vehicleView } from "../../domain/views.js";
import type { Deps } from "../ports.js";

const ORDER_TOLLS_PAGE = 50;

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * What a vignette would cost, for one vehicle from a start date: one option
 * per duration, each kept here with a quote_id for QUOTE_TTL_S. Nothing is
 * ordered; the start defaults to the first day eToll says a new vignette may
 * cover (the day after the current one ends), else today.
 */
export const quoteVignette = async (deps: Deps, args: { readonly vehicle: string; readonly startDate?: string | undefined }) => {
  const today = bucharestToday(deps.now());
  const { items } = await collectAll(deps.etoll.vehicles);
  const vehicle = findVehicle(items, args.vehicle);
  const startDate = args.startDate ?? defaultStart(vehicle, today);
  if (startDate < today) return fail(inputError(`start_date ${startDate} is in the past; a vignette starts today (${today}) at the earliest`));
  const options = quoteOptions(vehicle, startDate, await deps.etoll.quote(quoteRequest(vehicle.id, startDate)));
  if (options.length === 0) return fail(refused("NO_QUOTE", `eToll offered no vignette for ${vehicle.plateNumber ?? vehicle.id} from ${startDate}`));
  const createdAtEpoch = deps.now();
  const quotes: StoredQuote[] = options.map((o) => ({ ...o, id: `q_${hex(deps.random(8))}`, createdAtEpoch }));
  await deps.store.saveQuotes(quotes);
  return {
    ok: true as const,
    vehicle: vehicleView(vehicle, today),
    start_date: startDate,
    options: quotes.map(quoteView),
    expires_at: isoOf(createdAtEpoch + QUOTE_TTL_S),
    next: "show the user the options with their prices; to buy one, call place_order with its quote_id (the user confirms the line it shows, then pays by card on the page it hands over)",
  };
};

/**
 * Everything an order needs, from the stored quote and the account: who it
 * is billed to, the e-mail the receipt goes to, and the one line the user
 * confirms. The policy computes the line with this before asking; the order
 * computes it again with this, so both come from the same rules.
 */
export const prepareOrder = async (deps: Deps, args: { readonly quoteId: string; readonly billingId?: string | undefined }) => {
  const quote = liveQuote(await deps.store.quote(args.quoteId), args.quoteId, deps.now());
  const [details, profile] = await Promise.all([deps.etoll.billingDetails(), deps.etoll.profile()]);
  const billing = chooseBilling(billingOptions(details), args.billingId);
  const email = profile.email ?? fail(drift("profiles/current has no e-mail, which the payment needs for the receipt"));
  return { quote, billing, email, line: orderLine(quote, billing) };
};

const priceChanged = (was: string, now: string | undefined): never =>
  fail(
    refused(
      PRICE_CHANGED,
      now === undefined
        ? `eToll no longer offers this option at ${shownAmount(was)} ${CURRENCY}`
        : `eToll's price moved from ${shownAmount(was)} to ${shownAmount(now)} ${CURRENCY} since the quote`,
    ),
  );

/** The quote, asked again: it must still cost what the user confirmed. */
const confirmPrice = async (deps: Deps, quote: StoredQuote): Promise<void> => {
  const fresh = (await deps.etoll.quote(quoteRequest(quote.vehicleId, quote.startDate))).find((q) => q.duration === quote.duration);
  const freshTotal = fresh === undefined ? undefined : priceOf(fresh.price, `quotes: the ${quote.duration} option's price`).total;
  if (freshTotal === undefined || !sameAmount(freshTotal, quote.price.total)) return priceChanged(quote.price.total, freshTotal);
};

/**
 * Deletes an order this server made and notes it cancelled. An order eToll
 * will not delete is a failure here, never "gone": the order was made moments
 * ago, so a refusal means it is still there.
 */
const dropOrder = async (deps: Deps, orderId: string): Promise<void> => {
  if ((await deps.etoll.deleteOrder(orderId)) === "refused") return fail(refused(ORDER_NOT_DELETABLE, `eToll would not delete order ${orderId}`));
  const noted = await deps.store.order(orderId);
  if (noted !== undefined) await deps.store.saveOrder({ ...noted, cancelled: true });
};

/**
 * Ends place_order after eToll made the order and a later step failed: the
 * order is dropped and the failure says so, or, when it cannot be dropped, the
 * failure names the order as still open and how to clear it. No failure after
 * the order exists leaves it open without saying so.
 */
const failAfterOrder = async (deps: Deps, orderId: string, thrown: unknown): Promise<never> => {
  const failure = asAppError(thrown) ?? drift(`placing order ${orderId} failed: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  const dropped = await dropOrder(deps, orderId).then(
    () => true,
    () => false,
  );
  return fail(dropped ? { ...failure, message: `${failure.message}; the order was cancelled and nothing was paid` } : orderLeftOpen(failure.message, orderId));
};

/**
 * Creates the order and, from the moment it exists, either hands back its
 * payment page or drops it: it is noted in the state dir at once, its total
 * must be there and be the confirmed one, and the payment page must be on
 * euplatesc.ro.
 */
const checkoutAndPay = async (deps: Deps, quote: StoredQuote, request: PaymentRequest): Promise<StoredOrder & { readonly paymentUrl: string }> => {
  const checkout = await deps.etoll.createOrder(orderRequest(quote));
  try {
    const order = storedOrderOf(checkout, quote, deps.now());
    await deps.store.saveOrder(order);
    const total = checkoutTotalOf(checkout) ?? fail(drift(`orders: the order eToll made carries no total to check against the confirmed ${shownAmount(quote.price.total)} ${CURRENCY}`));
    if (!sameAmount(total, quote.price.total)) priceChanged(quote.price.total, total);
    const payment = await deps.etoll.pay(order.orderId, request);
    if (!isPaymentUrl(payment.paymentUrl)) fail(drift(`eToll handed over a payment page that is not https on ${PAYMENT_HOST}`));
    const withPage = { ...order, paymentUrl: payment.paymentUrl };
    await deps.store.saveOrder(withPage);
    return withPage;
  } catch (thrown) {
    return failAfterOrder(deps, checkout.orderId, thrown);
  }
};

/**
 * Places the order and hands over the card payment page; nothing is paid
 * here. In order: the quote is asked again and must still cost what was
 * confirmed; the order is created and its total must be that same amount
 * (else it is dropped); the payment page is asked for and must be on
 * euplatesc.ro (else the order is dropped). The order is noted in the state
 * dir as soon as it exists, so get_order and cancel_order know it even if a
 * later step fails.
 */
export const placeOrder = async (deps: Deps, args: { readonly quoteId: string; readonly billingId?: string | undefined; readonly confirmedLine?: string | undefined }) => {
  const { quote, billing, email, line } = await prepareOrder(deps, args);
  if (args.confirmedLine !== undefined && args.confirmedLine !== line) {
    return fail(refused(PRICE_CHANGED, `the order no longer reads as the user confirmed it; it now reads: ${line}`));
  }
  await confirmPrice(deps, quote);
  const order = await checkoutAndPay(deps, quote, paymentRequest(email, billing));

  const expires = localDateOf(order.expiresAt) === undefined ? "" : ` before ${order.expiresAt}`;
  offerLink({
    url: order.paymentUrl,
    message: `Pay ${shownAmount(quote.price.total)} ${CURRENCY} by card on ${PAYMENT_HOST} for the rovinietă of ${quote.plate ?? quote.vehicleId}${expires}. Nothing has been paid yet.`,
    next: `the user has the card payment page open; once they say they paid, call get_order with order_id ${order.orderId} to see the vignette active`,
  });
  return {
    ok: true as const,
    order_id: order.orderId,
    payment_url: order.paymentUrl,
    total: quote.price.total,
    currency: CURRENCY,
    billed_to: billing.name,
    expires_at: order.expiresAt,
    next: `nothing is paid yet: the USER opens payment_url and pays by card on ${PAYMENT_HOST}; then get_order shows the vignette active. An unpaid order expires by itself; cancel_order drops it sooner`,
  };
};

const NEXT: Readonly<Record<ReturnType<typeof orderState>, string>> = {
  pending: "not paid yet: the user pays at payment_url; an unpaid order expires by itself, and cancel_order drops it sooner",
  paid: "paid: the vignette is in list_tolls and list_vehicles, and the invoice in list_invoices",
  expired: "the order expired unpaid; nothing was charged. quote_vignette and place_order again to buy",
  cancelled: "the order was cancelled; nothing was charged",
  refunded: "eToll refunded this vignette",
  unknown: "eToll reports a state this server does not know; the vignettes' statuses are below",
};

/** An order this server placed, read back through the plate's vignettes (eToll has no endpoint for an order itself). */
export const getOrder = async (deps: Deps, args: { readonly orderId: string }) => {
  const order = (await deps.store.order(args.orderId)) ?? fail(notFound(`no order "${args.orderId}" placed by this server; list_tolls shows every vignette on the account`));
  const today = bucharestToday(deps.now());
  const { items } = await collectAll((cursor) => deps.etoll.tolls({ plate: order.plate ?? undefined }, cursor, ORDER_TOLLS_PAGE));
  const found = items.filter((t) => isOrdersToll(t, order));
  const state = orderState(
    found.map((t) => t.status ?? null),
    order,
    deps.now() * 1000,
  );
  return {
    ok: true as const,
    order_id: order.orderId,
    state,
    plate: order.plate,
    duration: order.duration,
    start_date: order.startDate,
    total: order.total,
    currency: CURRENCY,
    expires_at: order.expiresAt,
    ...(state === "pending" && order.paymentUrl !== null ? { payment_url: order.paymentUrl } : {}),
    vignettes: found.map((t) => tollView(t, today)),
    next: NEXT[state],
  };
};

/**
 * Drops an unpaid order. Safe to call twice: an order eToll no longer has is
 * the outcome wanted. An order this server placed and sees paid is refused:
 * a paid vignette is refunded through eToll, not cancelled. Any other id (an
 * order opened on the portal, which PENDING_ORDER_SAME_PRODUCT names) is
 * passed to eToll as it is.
 */
export const cancelOrder = async (deps: Deps, args: { readonly orderId: string }) => {
  const stored = await deps.store.order(args.orderId);
  if (stored !== undefined && !stored.cancelled) {
    const seen = await getOrder(deps, args);
    if (seen.state === "paid") return fail(refused("ORDER_PAID", `order ${args.orderId} is paid; a paid vignette is refunded through eToll's support, not cancelled here`));
  }
  const outcome = await deps.etoll.deleteOrder(args.orderId);
  // A refusal is "already gone" only for an order this server cancelled before:
  // for any other it may be paid, with its vignette not listed yet.
  if (outcome === "refused" && stored?.cancelled !== true) {
    return fail(refused(ORDER_NOT_DELETABLE, `eToll would not delete order ${args.orderId}: it may be paid (its vignette is listed once eToll issues it), or have expired unpaid`));
  }
  if (stored !== undefined) await deps.store.saveOrder({ ...stored, cancelled: true });
  return { ok: true as const, order_id: args.orderId, cancelled: true as const, already_gone: outcome !== "deleted" };
};
