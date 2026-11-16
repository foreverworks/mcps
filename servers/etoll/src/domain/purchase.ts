import { drift, fail, inputError, notFound, refused } from "./errors.js";
import { CURRENCY, type Price, priceOf, shownAmount, sumAmounts } from "./money.js";
import type { BillingDetailsWire, CheckoutWire, OrganisationWire, PersonWire, QuoteWire, TollWire, VehicleWire } from "./schema.js";
import { durationLabel, eligiblePeriods } from "./views.js";
import { dayStartStamp, localDateOf } from "./dates.js";

/**
 * Buying a vignette, as the portal's own checkout does it (read from its
 * client, TollRO.wasm, 2026-11-15):
 *
 * 1. POST quotes `{vehicleId, validFrom, type: 0}` answers one option per
 *    duration, each with its price and the period it covers;
 * 2. POST orders `{type: "TOLL", source: "WEB", toll}` with the chosen
 *    option as a toll (the vehicle as eToll listed it, the period, the
 *    duration, the price) answers the order id, its tolls and when it
 *    expires unpaid;
 * 3. POST orders/{id}/payment `{email, entity, language: "RO", source: "WEB"}`
 *    answers the card payment page, which the portal only accepts on
 *    euplatesc.ro;
 * 4. DELETE orders/{id} drops an order that is still unpaid.
 *
 * `type` 0 is the portal's enum for a vignette, which it sends as a number.
 * This module holds the rules; nothing here talks to eToll. Pure.
 */

export const VIGNETTE = 0;

/** How long a quote answered by quote_vignette may be ordered. A price can change; a new quote is cheap. */
export const QUOTE_TTL_S = 30 * 60;

/** The only host the portal hands a payment to (its `PaymentAllowedHosts`). */
export const PAYMENT_HOST = "euplatesc.ro";

/** A plate number as a person may type it: "b 123 abc", "B-123-ABC" and "B123ABC" are one plate. */
export const plateKey = (plate: string): string => plate.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The vehicle a tool means: by eToll's id, or by plate number. */
export const findVehicle = (vehicles: readonly VehicleWire[], ref: string): VehicleWire => {
  const byId = vehicles.find((v) => v.id === ref);
  if (byId !== undefined) return byId;
  const key = plateKey(ref);
  const [match, ...others] = vehicles.filter((v) => typeof v.plateNumber === "string" && plateKey(v.plateNumber) === key);
  if (match !== undefined && others.length === 0) return match;
  if (match !== undefined) return fail(inputError(`${others.length + 1} vehicles have the plate ${ref} (different countries); pass the vehicle's id from list_vehicles`));
  return fail(notFound(`no vehicle "${ref}" in this eToll account; list_vehicles shows the ones it has, and a new one is added on portal.etoll.ro`));
};

/**
 * The first day a new vignette can start: today or later, in the first of
 * eToll's eligible periods not yet over; today when it computed none.
 */
export const defaultStart = (vehicle: VehicleWire, today: string): string => {
  const starts = eligiblePeriods(vehicle, today).map((p) => (p.from === null || p.from < today ? today : p.from));
  return starts.sort()[0] ?? today;
};

/**
 * The request a quote is: the portal's QuoteRequest for a vignette, its start
 * at midnight Bucharest time WITH the offset; eToll answers 400
 * INVALID_REQUEST to a time without one (seen live 2026-11-15). For today it
 * answers a vignette that starts now.
 */
export const quoteRequest = (vehicleId: string, startDate: string): QuoteRequest => ({ vehicleId, validFrom: dayStartStamp(startDate), type: VIGNETTE });

export type QuoteRequest = { readonly vehicleId: string; readonly validFrom: string; readonly type: typeof VIGNETTE };

/** A quote kept until it is ordered, so place_order takes an id and nothing a model could alter. */
export type StoredQuote = {
  readonly id: string;
  readonly createdAtEpoch: number;
  /** The vehicle as eToll listed it: the portal sends it back whole in the order. */
  readonly vehicle: Readonly<Record<string, unknown>>;
  readonly vehicleId: string;
  readonly plate: string | null;
  readonly country: string | null;
  readonly category: string | null;
  readonly startDate: string;
  readonly duration: string;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly price: Price;
};

export type QuoteOption = Omit<StoredQuote, "id" | "createdAtEpoch">;

/** Every option a quote answered, each with its exact price; an option without a duration or a total is drift. */
export const quoteOptions = (vehicle: VehicleWire, startDate: string, quotes: readonly QuoteWire[]): readonly QuoteOption[] =>
  quotes.map((q, i) => {
    const duration = q.duration ?? fail(drift(`quotes: option ${i} has no duration`));
    return {
      vehicle,
      vehicleId: vehicle.id,
      plate: vehicle.plateNumber ?? null,
      country: vehicle.countryCode ?? null,
      category: vehicle.category ?? null,
      startDate,
      duration,
      validFrom: q.validFrom ?? quoteRequest(vehicle.id, startDate).validFrom,
      validUntil: q.validUntil ?? null,
      price: priceOf(q.price, `quotes: the ${duration} option's price`),
    };
  });

export const quoteView = (q: StoredQuote) => ({
  quote_id: q.id,
  duration: durationLabel(q.duration),
  duration_code: q.duration,
  valid_from: localDateOf(q.validFrom) ?? q.startDate,
  valid_until: localDateOf(q.validUntil) ?? null,
  price: { total: q.price.total, vat: q.price.vat, vat_percent: q.price.vatPercent, without_vat: q.price.withoutVat, currency: q.price.currency },
});

/** A stored quote that may still be ordered, or the reason it may not. */
export const liveQuote = (q: StoredQuote | undefined, id: string, nowEpoch: number): StoredQuote => {
  if (q === undefined) return fail(notFound(`no quote "${id}"; quote_vignette answers the quote_id to order`));
  if (nowEpoch > q.createdAtEpoch + QUOTE_TTL_S) return fail(inputError(`quote ${id} is more than ${QUOTE_TTL_S / 60} minutes old; call quote_vignette again for a current price`));
  return q;
};

/** A number written into the JSON body as these exact digits (infra/json.ts), never through a float. */
export type JsonNumber = { readonly jsonNumber: string };

const num = (amount: string | null): JsonNumber | null => (amount === null ? null : { jsonNumber: amount });

/** The toll the order carries, as the portal's checkout builds it from the chosen option. */
export type OrderToll = {
  readonly type: typeof VIGNETTE;
  readonly vehicle: Readonly<Record<string, unknown>>;
  readonly validFrom: string;
  readonly validUntil: string | null;
  readonly duration: string;
  readonly price: {
    readonly totalPrice: JsonNumber | null;
    readonly vat: JsonNumber | null;
    readonly vatPercentage: JsonNumber | null;
    readonly priceWithoutVat: JsonNumber | null;
  };
};

export type OrderRequest = { readonly type: "TOLL"; readonly source: "WEB"; readonly toll: OrderToll };

export const orderToll = (q: StoredQuote): OrderToll => ({
  type: VIGNETTE,
  vehicle: q.vehicle,
  validFrom: q.validFrom,
  validUntil: q.validUntil,
  duration: q.duration,
  price: { totalPrice: num(q.price.total), vat: num(q.price.vat), vatPercentage: num(q.price.vatPercent), priceWithoutVat: num(q.price.withoutVat) },
});

export const orderRequest = (q: StoredQuote): OrderRequest => ({ type: "TOLL", source: "WEB", toll: orderToll(q) });

/** Who an order may be billed to: a person or a company on the account's billing details. */
export type Billing = {
  readonly id: string;
  readonly kind: "person" | "organisation";
  readonly name: string;
  readonly entry: PersonWire | OrganisationWire;
};

const personName = (p: PersonWire): string => [p.firstName, p.lastName].filter((s) => typeof s === "string" && s.trim() !== "").join(" ") || p.id;

export const billingOptions = (details: BillingDetailsWire): readonly Billing[] => [
  ...(details.persons ?? []).map((p): Billing => ({ id: p.id, kind: "person", name: personName(p), entry: p })),
  ...(details.organisations ?? []).map((o): Billing => ({ id: o.id, kind: "organisation", name: [o.name ?? o.id, o.vatNumber ? `(${o.vatNumber})` : ""].join(" ").trim(), entry: o })),
];

/** The billing entry an order uses: the one named, or the account's only one. */
export const chooseBilling = (options: readonly Billing[], id: string | undefined): Billing => {
  if (id !== undefined) {
    return options.find((b) => b.id === id) ?? fail(notFound(`no billing entry "${id}" on this account; it has: ${options.map((b) => `${b.id} (${b.name})`).join(", ") || "none"}`));
  }
  const [only, ...others] = options;
  if (only !== undefined && others.length === 0) return only;
  if (only === undefined) return fail(refused("NO_BILLING_DETAILS", "the account has no billing details (a person or a company to invoice); add them once on portal.etoll.ro"));
  return fail(inputError(`the account bills to more than one entry; pass billing_id, one of: ${options.map((b) => `${b.id} (${b.kind} ${b.name})`).join(", ")}`));
};

/**
 * The payment request: the profile's e-mail, the billing entry, Romanian.
 * eToll answers 400 "Language cannot be null." without a language and
 * INVALID_REQUEST to "ro"; "RO" is taken (tried live 2026-11-15).
 */
export type PaymentRequest = {
  readonly email: string;
  readonly entity:
    | { readonly person: PersonWire | OrganisationWire; readonly organisation: null; readonly name: string }
    | { readonly person: null; readonly organisation: PersonWire | OrganisationWire; readonly name: string };
  readonly language: "RO";
  readonly source: "WEB";
};

export const paymentRequest = (email: string, billing: Billing): PaymentRequest => ({
  email,
  entity: billing.kind === "person" ? { person: billing.entry, organisation: null, name: billing.name } : { person: null, organisation: billing.entry, name: billing.name },
  language: "RO",
  source: "WEB",
});

/**
 * The one line a person confirms before an order is placed, computed from the
 * same stored quote and billing entry the order is made from. The guard puts
 * the server's name before it and cuts the whole at 300 characters.
 */
export const orderLine = (q: StoredQuote, billing: Billing): string => {
  const vehicle = `${q.plate ?? q.vehicleId}${q.country ? ` (${q.country})` : ""}`;
  const until = localDateOf(q.validUntil);
  const line =
    `Buy rovinietă ${durationLabel(q.duration) ?? q.duration}${q.category ? `, category ${q.category}` : ""}, for ${vehicle}, ` +
    `valid from ${localDateOf(q.validFrom) ?? q.startDate}${until ? ` to ${until}` : ""}, ${shownAmount(q.price.total)} ${CURRENCY}, ` +
    `billed to ${billing.name}, paid by card on ${PAYMENT_HOST}`;
  return line.replace(/\s+/g, " ").slice(0, 290);
};

/** Whether a payment page is one the portal itself would open: https on euplatesc.ro, on its default port, with no user name or password in it. */
export const isPaymentUrl = (url: string): boolean => {
  const u = URL.parse(url);
  return (
    u !== null &&
    u.protocol === "https:" &&
    u.port === "" &&
    u.username === "" &&
    u.password === "" &&
    (u.hostname === PAYMENT_HOST || u.hostname.endsWith(`.${PAYMENT_HOST}`))
  );
};

/** An order placed by this server, kept so get_order and cancel_order can find its vignettes. */
export type StoredOrder = {
  readonly orderId: string;
  readonly quoteId: string;
  readonly placedAtEpoch: number;
  /** The `issuance.externalId` of each toll the order answer held: they have no id until paid. */
  readonly issuances: readonly string[];
  readonly plate: string | null;
  readonly country: string | null;
  readonly duration: string;
  readonly startDate: string;
  readonly total: string;
  readonly expiresAt: string | null;
  /** Null from the moment the order exists until eToll hands over its payment page. */
  readonly paymentUrl: string | null;
  readonly cancelled: boolean;
};

/**
 * Whether a listed toll is one of the order's. An unpaid order's tolls are not
 * listed at all, so a match is a toll the payment issued: its orderId, else
 * the externalId the order answer gave it. A paid vignette carried both
 * (seen live 2026-11-15).
 */
export const isOrdersToll = (toll: Pick<TollWire, "orderId" | "issuance">, order: Pick<StoredOrder, "orderId" | "issuances">): boolean =>
  toll.orderId === order.orderId || (typeof toll.issuance?.externalId === "string" && order.issuances.includes(toll.issuance.externalId));

/** The record of an order eToll just made, before its payment page exists. */
export const storedOrderOf = (checkout: CheckoutWire, quote: StoredQuote, nowEpoch: number): StoredOrder => ({
  orderId: checkout.orderId,
  quoteId: quote.id,
  placedAtEpoch: nowEpoch,
  issuances: (checkout.tolls ?? []).flatMap((t) => (t.issuance?.externalId ? [t.issuance.externalId] : [])),
  plate: quote.plate,
  country: quote.country,
  duration: quote.duration,
  startDate: quote.startDate,
  total: quote.price.total,
  expiresAt: checkout.orderExpirationDate ?? null,
  paymentUrl: null,
  cancelled: false,
});

/** What the order's vignettes add up to, exactly; undefined when eToll priced none of them. */
export const checkoutTotalOf = (checkout: CheckoutWire): string | undefined => {
  const priced = (checkout.tolls ?? []).filter((t) => t.price?.totalPrice !== null && t.price?.totalPrice !== undefined);
  return priced.length === 0 ? undefined : sumAmounts(priced.map((t, i) => priceOf(t.price, `the order's vignette ${i}`).total));
};

export type OrderState = "pending" | "paid" | "expired" | "cancelled" | "refunded" | "unknown";

/**
 * An order's state from its vignettes' statuses: every one ACTIVE (or
 * CONSUMED, used up) is paid; none listed yet, or any still DRAFT or PENDING,
 * is pending until the order's expiry has passed.
 */
export const orderState = (statuses: readonly (string | null)[], order: StoredOrder, nowMs: number): OrderState => {
  const s = statuses.map((x) => (x ?? "").toUpperCase());
  if (order.cancelled || (s.length > 0 && s.every((x) => x === "CANCELLED"))) return "cancelled";
  if (s.length > 0 && s.every((x) => x === "ACTIVE" || x === "CONSUMED" || x === "EXPIRED")) return "paid";
  if (s.some((x) => x === "REFUNDED")) return "refunded";
  if (s.length === 0 || s.some((x) => x === "PENDING" || x === "DRAFT")) {
    const expires = order.expiresAt === null ? Number.NaN : Date.parse(order.expiresAt);
    return Number.isFinite(expires) && nowMs > expires ? "expired" : "pending";
  }
  return "unknown";
};
