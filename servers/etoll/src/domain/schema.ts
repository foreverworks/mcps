import { z } from "zod";

/**
 * eToll's wire shapes, the parts this server reads, as zod loose objects:
 * eToll adds fields between releases and an unknown one is not a failure.
 * Every field is optional except the ids a tool hands back for another tool
 * to take; a missing one of those, or a field of the wrong type, is `drift`.
 *
 * Where each shape comes from:
 * - the error body, the public status page (components, incidents,
 *   schedules) and the 401 without a token: live answers, read 2026-11-15;
 * - everything behind the sign-in (profiles, vehicles, tolls, invoices,
 *   notifications, billing details, quotes, orders, payment): modelled from
 *   the portal's own client (its `TollRO.Models` types and the calls its
 *   services make). The portal serialises with Newtonsoft and its own
 *   property names, which are these. Read live on 2026-11-15: the profiles,
 *   billing details with a person, a vehicle with its eligibility, a quote
 *   (its periods zoned, `quantity` null), an order and its payment page, a
 *   paid vignette, its invoice and the invoice's PDF, and an empty page of
 *   notifications. Not yet: a notification's own fields, a bridge pass, and
 *   an organisation (scripts/smoke.ts is the check).
 *
 * Amounts are doubles in the portal's client, so they arrive as JSON
 * numbers; money.ts turns each into exact text or refuses it as drift.
 */

const text = z.string().nullable().optional();
const flag = z.boolean().nullable().optional();
const count = z.number().nullable().optional();
/** An amount as eToll sends it: a number, or (should it change) a numeric string. */
const amount = z.union([z.number(), z.string()]).nullable().optional();

export const priceWire = z.looseObject({ totalPrice: amount, vat: amount, vatPercentage: amount, priceWithoutVat: amount });
export type PriceWire = z.infer<typeof priceWire>;

const intervalWire = z.looseObject({ start: text, end: text });

export const eligibilityWire = z.looseObject({
  eligibleIntervals: z.array(intervalWire).nullable().optional(),
  expirationDateCurrentVignette: text,
});

/** A vehicle as GET vehicles?computeVignetteEligibility=true lists it (VehicleWithEligibility). */
export const vehicleWire = z.looseObject({
  id: z.string().min(1),
  plateNumber: text,
  countryCode: text,
  country: text,
  countryType: text,
  category: text,
  vehicleType: text,
  vin: text,
  emissionStandard: text,
  registrationSerial: text,
  favorite: flag,
  isValid: flag,
  temporaryPlate: flag,
  vignetteEligibility: eligibilityWire.nullable().optional(),
});
export type VehicleWire = z.infer<typeof vehicleWire>;

export const vehiclesPageWire = z.looseObject({ vehicles: z.array(vehicleWire).nullable().optional(), nextCursor: text });

/** The vehicle a toll is for, as a toll repeats it: no id needed. */
const tollVehicleWire = z.looseObject({ id: text, plateNumber: text, countryCode: text, category: text, vin: text });

/**
 * A toll: a vignette, a bridge pass or a route ticket. `type` is the
 * portal's enum, which Newtonsoft writes as its number (0 vignette, 1 bridge,
 * 2 route, 3 per km) unless the API names it.
 */
export const tollWire = z.looseObject({
  id: z.string().min(1),
  type: z.union([z.string(), z.number()]).nullable().optional(),
  status: text,
  duration: text,
  validFrom: text,
  validUntil: text,
  price: priceWire.nullable().optional(),
  vehicle: tollVehicleWire.nullable().optional(),
  bridgeType: text,
  routeDescription: text,
  refundable: flag,
  paymentReference: text,
  vignetteIssueDate: text,
  orderId: text,
  issuance: z.looseObject({ serialNo: text, externalId: text }).nullable().optional(),
});
export type TollWire = z.infer<typeof tollWire>;

/**
 * A toll in the answer to POST orders: not issued yet, so its id, status and
 * orderId are null (seen live 2026-11-15); `issuance.externalId` is the one
 * mark it carries.
 */
export const orderedTollWire = tollWire.extend({ id: text });
export type OrderedTollWire = z.infer<typeof orderedTollWire>;

export const tollsPageWire = z.looseObject({ tolls: z.array(tollWire).nullable().optional(), nextCursor: text, errors: z.array(z.string()).nullable().optional() });

export const invoiceWire = z.looseObject({
  id: z.string().min(1),
  externalNumber: z.union([z.number(), z.string()]).nullable().optional(),
  externalNumberStr: text,
  externalSeries: text,
  paymentMethod: text,
  paymentDate: text,
  buyerName: text,
  total: priceWire.nullable().optional(),
  types: z.array(z.string()).nullable().optional(),
});
export type InvoiceWire = z.infer<typeof invoiceWire>;

/** GET invoices: a page by number (Spring's), not by cursor. */
export const invoicePageWire = z.looseObject({
  invoices: z.array(invoiceWire).nullable().optional(),
  page: z.looseObject({ number: count, size: count, totalElements: count, totalPages: count, first: flag, last: flag }).nullable().optional(),
  countIsLowerBound: flag,
});
export type InvoicePageWire = z.infer<typeof invoicePageWire>;

export const notificationWire = z.looseObject({
  id: text,
  createdAt: text,
  description: text,
  isActive: flag,
  status: text,
  type: text,
  vehiclePlateNumber: text,
});
export type NotificationWire = z.infer<typeof notificationWire>;

/** GET notifications: a list, or (should it be paged) a list inside an object. */
export const notificationsWire = z.union([
  z.array(notificationWire),
  z.looseObject({ notifications: z.array(notificationWire).nullable().optional(), content: z.array(notificationWire).nullable().optional() }),
]);

export const notificationSummaryWire = z.looseObject({ count: count });

export const profileWire = z.looseObject({ id: text, name: text, email: text, isCurrent: flag });
export type ProfileWire = z.infer<typeof profileWire>;
/** GET profiles answers every profile of the account; GET profiles/current is 405 (seen live 2026-11-15). */
export const profilesWire = z.array(profileWire);

/** Who an order is billed to: the portal sends the whole entry back, as it got it. */
export const personWire = z.looseObject({ id: z.string().min(1), firstName: text, lastName: text });
export const organisationWire = z.looseObject({ id: z.string().min(1), name: text, vatNumber: text, registrationNo: text });
export type PersonWire = z.infer<typeof personWire>;
export type OrganisationWire = z.infer<typeof organisationWire>;

export const billingDetailsWire = z.looseObject({
  persons: z.array(personWire).nullable().optional(),
  organisations: z.array(organisationWire).nullable().optional(),
});
export type BillingDetailsWire = z.infer<typeof billingDetailsWire>;

/** One option POST quotes answers: a duration, its price and the period it would cover. */
export const quoteWire = z.looseObject({ duration: text, price: priceWire.nullable().optional(), validFrom: text, validUntil: text });
export type QuoteWire = z.infer<typeof quoteWire>;

export const quoteAnswerWire = z.looseObject({ quotes: z.array(quoteWire).nullable().optional() });

/** POST orders: the order and the tolls it holds, with the moment it expires unpaid. */
export const orderIdWire = z.looseObject({ orderId: z.string().min(1) });
export const checkoutWire = orderIdWire.extend({
  tolls: z.array(orderedTollWire).nullable().optional(),
  orderExpirationDate: text,
});
export type CheckoutWire = z.infer<typeof checkoutWire>;

/** POST orders/{id}/payment: where the card is paid; `status` NOT_PAID, the page on secure3.euplatesc.ro (seen live 2026-11-15). */
export const paymentWire = z.looseObject({ id: text, paymentUrl: z.string().min(1), status: text });
export type PaymentWire = z.infer<typeof paymentWire>;

/**
 * An error body. Two shapes are in use: the portal's own (`message` is a
 * code such as PENDING_ORDER_SAME_PRODUCT, `parameter` its argument,
 * `alertDetails` the sentence in English and Romanian), and the gateway's
 * (`issues` with an `issueCode`, as a request without a token gets).
 */
export const errorBodyWire = z.looseObject({
  status: count,
  error: text,
  message: text,
  parameter: z.unknown().optional(),
  alertDetails: z.looseObject({ eng: text, ro: text }).nullable().optional(),
  issues: z.array(z.looseObject({ issueCode: z.union([z.number(), z.string()]).nullable().optional(), message: text, description: text })).nullable().optional(),
});
export type ErrorBodyWire = z.infer<typeof errorBodyWire>;

/** CNAIR's status page (JSON:API): a status as a word in Romanian and a number. */
const statusWire = z.looseObject({ human: text, value: count });
const stampWire = z.looseObject({ string: text });

export const componentsWire = z.looseObject({
  data: z.array(z.looseObject({ id: text, attributes: z.looseObject({ name: text, enabled: flag, order: count, status: statusWire.nullable().optional(), updated: stampWire.nullable().optional() }) })),
});
export const incidentsWire = z.looseObject({
  data: z.array(z.looseObject({ id: text, attributes: z.looseObject({ name: text, message: text, status: statusWire.nullable().optional(), occurred: stampWire.nullable().optional(), updated: stampWire.nullable().optional() }) })),
});
export const schedulesWire = z.looseObject({
  data: z.array(z.looseObject({ id: text, attributes: z.looseObject({ name: text, message: text, status: statusWire.nullable().optional(), scheduled: stampWire.nullable().optional(), completed: stampWire.nullable().optional() }) })),
});
export type ComponentsWire = z.infer<typeof componentsWire>;
export type IncidentsWire = z.infer<typeof incidentsWire>;
export type SchedulesWire = z.infer<typeof schedulesWire>;
