import { type HttpRequest, issuesText } from "@foreverworks/mcp-kit";

import type { EtollPort } from "../app/ports.js";
import { asAppError, drift, fail, orderLeftOpen, statusOf } from "../domain/errors.js";
import { nextCursorOf } from "../domain/paging.js";
import {
  billingDetailsWire,
  checkoutWire,
  invoicePageWire,
  notificationsWire,
  notificationSummaryWire,
  orderIdWire,
  paymentWire,
  profilesWire,
  quoteAnswerWire,
  tollsPageWire,
  tollWire,
  vehiclesPageWire,
} from "../domain/schema.js";
import { jsonText } from "./json.js";
import { parseOrDrift } from "./wire.js";

/**
 * eToll's endpoints, the only module that names them. All under `/api`, as
 * the portal's own screens call them (read from its client, 2026-11-15):
 *
 * - profiles (the current one is marked), profiles/current/billingDetails;
 * - vehicles?vehicleType=CAR&computeVignetteEligibility=true, by cursor;
 * - tolls (filtered by status and plate, by cursor), tolls/{id};
 * - invoices?from&to (instants), by page number; invoices/{id}/pdf;
 * - notifications, notifications/summary;
 * - quotes, orders, orders/{id}/payment, DELETE orders/{id}.
 */
export const makeEtollApi = (http: HttpRequest, origin: string): EtollPort => {
  const base = `${origin}/api`;
  const id = (value: string): string => encodeURIComponent(value);

  // Written by jsonText, not the kit's `json`: amounts go out as the exact digits quoted.
  const jsonPost = (request: unknown) => ({ method: "POST" as const, body: { contentType: "application/json; charset=UTF-8", data: jsonText(request) } });

  // The portal answers 200 to a delete, 404 to an order it does not know, and 400
  // (ORDER_INVALID_STATE) to one it will not delete: one already cancelled, and
  // as far as can be told from outside, one paid or expired too.
  const deleteOrder = async (orderId: string): Promise<"deleted" | "gone" | "refused"> => {
    try {
      await http(`${base}/orders/${id(orderId)}`, { method: "DELETE" });
      return "deleted";
    } catch (thrown) {
      const status = statusOf(asAppError(thrown));
      if (status === 404) return "gone";
      if (status === 400) return "refused";
      throw thrown;
    }
  };

  return {
    profile: async () => {
      const profiles = parseOrDrift(profilesWire, await http(`${base}/profiles`), "profiles");
      const [only, ...others] = profiles;
      return profiles.find((profile) => profile.isCurrent === true) ?? (others.length === 0 ? only : undefined) ?? fail(drift("profiles: none is marked current"));
    },
    vehicles: async (cursor) => {
      const page = parseOrDrift(vehiclesPageWire, await http(`${base}/vehicles`, { query: { vehicleType: "CAR", computeVignetteEligibility: true, size: 50, cursor } }), "vehicles");
      const items = page.vehicles ?? [];
      return { items, nextCursor: nextCursorOf(items, page.nextCursor ?? undefined) };
    },
    tolls: async (filter, cursor, size) => {
      const page = parseOrDrift(tollsPageWire, await http(`${base}/tolls`, { query: { status: filter.status, plateNumber: filter.plate, size, cursor } }), "tolls");
      const items = page.tolls ?? [];
      return { items, nextCursor: nextCursorOf(items, page.nextCursor ?? undefined) };
    },
    toll: async (tollId) => parseOrDrift(tollWire, await http(`${base}/tolls/${id(tollId)}`), `tolls/${tollId}`),
    invoices: async (window, page, size) =>
      parseOrDrift(invoicePageWire, await http(`${base}/invoices`, { query: { from: window.from, to: window.to, page, size } }), "invoices"),
    invoicePdf: (invoiceId) => http<Uint8Array>(`${base}/invoices/${id(invoiceId)}/pdf`, { as: "bytes", headers: { accept: "application/pdf" } }),
    notifications: async () => {
      const answer = parseOrDrift(notificationsWire, await http(`${base}/notifications`), "notifications");
      return Array.isArray(answer) ? answer : (answer.notifications ?? answer.content ?? []);
    },
    unreadNotifications: async () => parseOrDrift(notificationSummaryWire, await http(`${base}/notifications/summary`), "notifications/summary").count ?? undefined,
    billingDetails: async () => parseOrDrift(billingDetailsWire, await http(`${base}/profiles/current/billingDetails`), "billingDetails"),
    // A quote creates nothing: it is a POST only because it has a body, so it may be sent again.
    quote: async (request) => parseOrDrift(quoteAnswerWire, await http(`${base}/quotes`, { ...jsonPost(request), idempotent: true }), "quotes").quotes ?? [],
    // An order eToll made but this server cannot read is deleted before the drift is told: no one else could find it to cancel.
    createOrder: async (request) => {
      const answer = await http(`${base}/orders`, jsonPost(request));
      const checkout = checkoutWire.safeParse(answer);
      if (checkout.success) return checkout.data;
      const made = orderIdWire.safeParse(answer);
      if (!made.success) return fail(drift(`orders: ${issuesText(checkout.error)}`));
      const orderId = made.data.orderId;
      const deleted = await deleteOrder(orderId).then(
        (outcome) => outcome !== "refused",
        () => false,
      );
      return fail(
        deleted
          ? drift(`orders: ${issuesText(checkout.error)}; the order it made (${orderId}) was deleted, nothing was bought`)
          : orderLeftOpen(`orders: ${issuesText(checkout.error)}`, orderId),
      );
    },
    pay: async (orderId, request) => parseOrDrift(paymentWire, await http(`${base}/orders/${id(orderId)}/payment`, jsonPost(request)), `orders/${orderId}/payment`),
    deleteOrder,
  };
};
