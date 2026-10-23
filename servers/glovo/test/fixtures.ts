/**
 * Synthetic Glovo payloads, shaped like the real ones but with invented
 * stores, products, ids and amounts. The real ones carry a home
 * address and door notes, so none is ever copied into this tree.
 */
import type { RawDetails, RawListRow, RawPaymentLeg, RawPriceLine, RawProduct } from "../src/domain/schema.js";

/** The zone the fixtures' local dates are in: a summer instant there is UTC+3. */
export const TIME_ZONE = "Europe/Bucharest";

/** 2026-09-08 15:39 in TIME_ZONE, in epoch ms as Glovo sends it. */
export const SEP_08_1539 = Date.parse("2026-09-08T12:39:00Z");
export const DAY_MS = 86_400_000;

export const line = (type: string, description: string, amount: string, over: Partial<RawPriceLine> = {}): RawPriceLine => ({
  type,
  description,
  amount,
  finalAmount: null,
  note: null,
  amountPrefix: null,
  ...over,
});

export const product = (over: Partial<RawProduct> = {}): RawProduct => ({
  name: "Test Burger Menu",
  quantity: "2x",
  price: "63,80 RON",
  originalPrice: null,
  promotionDescription: null,
  customizationsDescription: "",
  notice: null,
  packaging: null,
  displayStyle: "DEFAULT",
  freeProduct: false,
  ...over,
});

export const cardLeg = (text = "Was charged on your card ending in 1234"): RawPaymentLeg => ({
  type: "CREDIT_CARD",
  provider: "Visa",
  text,
  amount: null,
});

/**
 * A split order: 1.234,56 RON total, of which 5,00 RON came from Glovo credits.
 * The address, door note and a phone number sit in `points` exactly where the
 * real payload keeps them, so a test can prove none of them leaks.
 */
export const details = (over: Partial<RawDetails> & Record<string, unknown> = {}): RawDetails =>
  ({
    id: 1001,
    code: "1001",
    storeId: 77,
    storeName: "Test Kitchen",
    vertical: "FOOD",
    refunded: false,
    creationTime: null,
    scheduledTime: null,
    currentStatus: { type: "DeliveredStatus", creationTime: SEP_08_1539 },
    headerNotice: null,
    pricingBreakdown: {
      lines: [
        line("DELIVERY", "Prime Delivery", "No cost"),
        line("PRODUCTS", "Products", "1.220,00 RON"),
        line("COURIER_TIP", "Courier tip", "14,56 RON"),
        line("TOTAL", "Total", "1.234,56 RON"),
      ],
    },
    paymentMethodsBreakdown: [
      cardLeg("1.229,56 RON was charged on your card ending in 1234."),
      { type: "GLOVO_CREDIT", provider: "GLOVO_CREDIT", text: "5,00 RON was paid with Glovo credits", amount: null },
    ],
    boughtProducts: [product(), product({ name: "Test Fries", quantity: "1x", price: "1.156,20 RON" })],
    points: [
      { type: "PICKUP", address: { label: "Strada Exemplu 1" } },
      { type: "DELIVERY", address: { label: "Strada Secreta 9" }, details: "etaj 4, call 0700000000" },
    ],
    ...over,
  }) as RawDetails;

/** A card-only order: the leg states no amount, so it paid the whole total. */
export const cardOnly = (id: number, total: string, atMs: number, over: Partial<RawDetails> = {}): RawDetails =>
  details({
    id,
    code: String(id),
    currentStatus: { type: "DeliveredStatus", creationTime: atMs },
    pricingBreakdown: { lines: [line("PRODUCTS", "Products", total), line("TOTAL", "Total", total)] },
    paymentMethodsBreakdown: [cardLeg()],
    boughtProducts: [product({ quantity: "1x", price: total })],
    ...over,
  });

export const row = (orderId: number, over: Partial<RawListRow> = {}): RawListRow => ({
  orderId,
  orderUrn: `glv:purchase:${orderId}`,
  content: { title: "Test Kitchen", body: [{ type: "TEXT", data: "2 x Test Burger Menu" }] },
  footer: { left: { type: "TEXT", data: "1.234,56 RON" } },
  layoutType: "INACTIVE_ORDER",
  ...over,
});
