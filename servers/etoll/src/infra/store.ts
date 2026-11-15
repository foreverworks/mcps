import { join } from "node:path";

import { readJsonFile, withFileLock, writeJsonFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Clock, StorePort } from "../app/ports.js";
import { QUOTE_TTL_S, type StoredOrder, type StoredQuote } from "../domain/purchase.js";

/**
 * Quotes and orders in the state dir, quotes.json and orders.json (0600),
 * each written whole under one lock.
 *
 * A quote is kept so place_order takes an id, not a price and a vehicle a
 * model could alter; it is dropped once past QUOTE_TTL_S. An order is kept
 * because eToll has no endpoint that reads an order back: get_order and
 * cancel_order find its vignettes among the plate's tolls through what was
 * stored when it was placed.
 * The newest ORDERS_KEPT stay; an order that old has long been paid or has
 * expired.
 */
export const ORDERS_KEPT = 200;

const amount = z.string();
const price = z.object({ total: amount, vat: amount.nullable(), vatPercent: amount.nullable(), withoutVat: amount.nullable(), currency: z.literal("RON") });

const quote = z.object({
  id: z.string(),
  createdAtEpoch: z.number(),
  vehicle: z.record(z.string(), z.unknown()),
  vehicleId: z.string(),
  plate: z.string().nullable(),
  country: z.string().nullable(),
  category: z.string().nullable(),
  startDate: z.string(),
  duration: z.string(),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
  price,
}) satisfies z.ZodType<StoredQuote>;

const order = z.object({
  orderId: z.string(),
  quoteId: z.string(),
  placedAtEpoch: z.number(),
  issuances: z.array(z.string()),
  plate: z.string().nullable(),
  country: z.string().nullable(),
  duration: z.string(),
  startDate: z.string(),
  total: amount,
  expiresAt: z.string().nullable(),
  paymentUrl: z.string().nullable(),
  cancelled: z.boolean(),
}) satisfies z.ZodType<StoredOrder>;

/** The entries of a file that parse; one that does not (an older shape, a hand edit) is skipped, not fatal. */
const entriesOf = async <T>(path: string, schema: z.ZodType<T>): Promise<T[]> => {
  const raw = await readJsonFile<unknown>(path);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: unknown) => {
    const parsed = schema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
};

export const makeStore = (stateDir: string, now: Clock): StorePort => {
  const quotesPath = join(stateDir, "quotes.json");
  const ordersPath = join(stateDir, "orders.json");
  const locked = <T>(fn: () => Promise<T>): Promise<T> => withFileLock(stateDir, "store.lock", fn);
  const live = (q: StoredQuote): boolean => now() <= q.createdAtEpoch + QUOTE_TTL_S;

  return {
    saveQuotes: (quotes) =>
      locked(async () => {
        const kept = (await entriesOf(quotesPath, quote)).filter(live);
        await writeJsonFile(quotesPath, [...kept, ...quotes]);
      }),
    // A quote past its TTL is still answered, so the caller can say "too old" rather than "unknown".
    quote: async (id) => (await entriesOf(quotesPath, quote)).find((q) => q.id === id),
    saveOrder: (next) =>
      locked(async () => {
        const others = (await entriesOf(ordersPath, order)).filter((o) => o.orderId !== next.orderId);
        await writeJsonFile(ordersPath, [...others, next].slice(-ORDERS_KEPT));
      }),
    order: async (id) => (await entriesOf(ordersPath, order)).find((o) => o.orderId === id),
  };
};
