import { describe, expect, it } from "vitest";

import { chargedOf, legsOf } from "../src/domain/receipt/payments.js";
import { headline, toReceipt as receiptIn } from "../src/domain/receipt.js";
import type { RawDetails } from "../src/domain/schema.js";
import { cardLeg, cardOnly, details, line, product, SEP_08_1539, TIME_ZONE } from "./fixtures.js";

const toReceipt = (orderId: number, d: RawDetails) => receiptIn(orderId, d, TIME_ZONE);

describe("payment legs", () => {
  it("takes each leg's amount from its sentence on a split order", () => {
    const legs = legsOf(details().paymentMethodsBreakdown ?? [], 123456);
    expect(chargedOf(legs)).toEqual({ card: 122956, glovoCredit: 500, cash: 0, other: 0 });
  });

  it("gives a card-only order's silent leg the whole total", () => {
    expect(chargedOf(legsOf([cardLeg()], 5370)).card).toBe(5370);
  });

  it("gives the one silent leg the remainder when another leg states its amount", () => {
    const legs = legsOf([cardLeg(), { type: "GLOVO_CREDIT", text: "5,00 RON was paid with Glovo credits" }], 5370);
    expect(chargedOf(legs)).toMatchObject({ card: 4870, glovoCredit: 500 });
  });

  it("leaves two silent legs unknown rather than guessing the split", () => {
    const legs = legsOf([cardLeg(), { type: "OTHER", text: "Paid with Apple Pay" }], 5370);
    expect(chargedOf(legs).card).toBeUndefined();
  });

  it("counts Apple Pay as a card and cash as not", () => {
    expect(chargedOf(legsOf([{ type: "OTHER", provider: "", text: "Paid with Apple Pay" }], 6000))).toMatchObject({ card: 6000, cash: 0 });
    expect(chargedOf(legsOf([{ type: "OTHER", provider: "", text: "Paid with Cash" }], 8640))).toMatchObject({ card: 0, cash: 8640 });
    expect(chargedOf(legsOf([{ type: "OTHER", text: "Plătit cu Numerar" }], 8640))).toMatchObject({ card: 0, cash: 8640 });
  });

  it("reads the Romanian wording too", () => {
    const legs = legsOf(
      [
        cardLeg("307,47 RON a fost debitat de pe cardul tău cu terminația 9876"),
        { type: "GLOVO_CREDIT", text: "5,00 RON a fost plătit cu credite Glovo" },
      ],
      31247,
    );
    expect(chargedOf(legs)).toMatchObject({ card: 30747, glovoCredit: 500 });
    expect(legs[0]?.last4).toBe("9876");
  });

  it("charges nothing when a cancelled order has no legs", () => {
    expect(chargedOf(legsOf([], undefined))).toEqual({ card: 0, glovoCredit: 0, cash: 0, other: 0 });
  });
});

describe("toReceipt", () => {
  it("reports the card leg as charged, with the card's last four digits", () => {
    const r = toReceipt(1001, details());
    expect(r.total).toBe("1234.56");
    expect(r.currency).toBe("RON");
    expect(r.charged).toEqual({ card: "1229.56", glovoCredit: "5.00" });
    expect(r.cardLast4).toBe("1234");
    expect(r.payments).toEqual([
      { method: "card", provider: "Visa", label: "1.229,56 RON was charged on your card ending in 1234.", amount: "1229.56" },
      { method: "glovo_credit", provider: "GLOVO_CREDIT", label: "5,00 RON was paid with Glovo credits", amount: "5.00" },
    ]);
  });

  it("dates the order by its delivery, in the configured zone, since Glovo keeps no order-placed time", () => {
    const r = toReceipt(1001, details());
    expect([r.state, r.deliveredAt, r.localDate, r.localTime]).toEqual(["delivered", "2026-09-08T12:39:00.000Z", "2026-09-08", "15:39"]);
    expect("canceledAt" in r).toBe(false);
  });

  it("passes the price lines through verbatim, 'No cost' as zero and a discount with its tag", () => {
    const r = toReceipt(
      1,
      details({
        pricingBreakdown: {
          lines: [
            line("DELIVERY", "Delivery", "No cost"),
            line("PRODUCTS", "Products", "214,00 RON"),
            line("DISCOUNT", "Promotion", "-64,20 RON", { amountPrefix: { type: "LABEL", data: { text: "-30%" } } }),
            line("TOTAL", "Total", "149,80 RON"),
          ],
        },
      }),
    );
    expect(r.priceLines).toEqual([
      { kind: "DELIVERY", label: "Delivery", amount: "0.00" },
      { kind: "PRODUCTS", label: "Products", amount: "214.00" },
      { kind: "DISCOUNT", label: "Promotion", amount: "-64.20", tag: "-30%" },
      { kind: "TOTAL", label: "Total", amount: "149.80" },
    ]);
  });

  it("itemises quantity, line price, original price, promotion, options and deposit", () => {
    const promoted = product({
      name: "Test Soda",
      quantity: "12x",
      price: "28,80 RON",
      originalPrice: "36,00 RON",
      promotionDescription: "-20%",
      customizationsDescription: "Deposit",
      packaging: "Deposit included (0,50 RON/unit)",
    });
    const r = toReceipt(1, details({ boughtProducts: [product(), promoted] }));
    expect(r.items[0]).toEqual({ name: "Test Burger Menu", qty: 2, price: "63.80" });
    expect(r.items[1]).toEqual({
      name: "Test Soda",
      qty: 12,
      price: "28.80",
      originalPrice: "36.00",
      promotion: "-20%",
      options: "Deposit",
      packaging: "Deposit included (0,50 RON/unit)",
    });
  });

  it("keeps a negative line price verbatim: Glovo prints some, and they are display, not arithmetic", () => {
    const r = toReceipt(1, details({ boughtProducts: [product({ price: "-4,90 RON", originalPrice: "36,00 RON" })] }));
    expect(r.items[0]).toMatchObject({ price: "-4.90", originalPrice: "36.00" });
  });

  it("marks lines a picker removed or replaced, in English or Romanian", () => {
    const r = toReceipt(
      1,
      details({
        boughtProducts: [
          product({ name: "Chips 80g", notice: "Not available — you weren’t charged", displayStyle: "STRIKETHROUGH" }),
          product({ name: "Chips 50g", notice: "Instead of Chips 80g" }),
          product({ name: "Juice", notice: "Indisponibil — nu ai fost taxat", displayStyle: "STRIKETHROUGH" }),
          product({ name: "Water", notice: "În loc de Juice" }),
          product(),
        ],
      }),
    );
    expect(r.items.map((i) => [i.adjustment, i.replaces])).toEqual([
      ["removed", undefined],
      ["replacement", "Chips 80g"],
      ["removed", undefined],
      ["replacement", "Juice"],
      [undefined, undefined],
    ]);
    expect(headline(r).itemCount).toBe(3);
  });

  it("reports a cancelled order: no price on its lines, nothing charged, Glovo's reason as a notice", () => {
    const r = toReceipt(
      2,
      details({
        currentStatus: { type: "CanceledStatus", creationTime: SEP_08_1539 },
        headerNotice: { style: "DANGER", text: "<b>The store couldn't process your order.</b>" },
        pricingBreakdown: { lines: [line("DELIVERY", "Delivery", "No cost")] },
        paymentMethodsBreakdown: [],
        boughtProducts: [product({ price: null })],
      }),
    );
    expect(r).toMatchObject({ state: "canceled", canceledAt: "2026-09-08T12:39:00.000Z", total: undefined });
    expect(r.charged).toEqual({ card: "0.00", glovoCredit: "0.00" });
    expect(r.items[0]?.price).toBeUndefined();
    expect(r.notices).toEqual(["The store couldn't process your order."]);
  });

  it("marks an order in progress as estimated and its leg as pending", () => {
    const r = toReceipt(
      3,
      cardOnly(3, "117,03 RON", SEP_08_1539, {
        currentStatus: { type: "ProgressStatus", creationTime: SEP_08_1539 },
        paymentMethodsBreakdown: [cardLeg("Will be charged on your card ending in 1234")],
      }),
    );
    expect(r).toMatchObject({ state: "in_progress", estimated: true, total: "117.03" });
    expect(r.payments[0]).toMatchObject({ pending: true, amount: "117.03" });
  });

  it("carries refunded and a scheduled time only when there are some", () => {
    const r = toReceipt(1, details({ refunded: true, scheduledTime: SEP_08_1539 - 3_600_000 }));
    expect(r).toMatchObject({ refunded: true, scheduledFor: "2026-09-08T11:39:00.000Z" });
    const plain = toReceipt(1, details());
    expect("refunded" in plain || "scheduledFor" in plain).toBe(false);
  });

  it("never lets the address, door note or phone number out", () => {
    const text = JSON.stringify(toReceipt(1001, details()));
    for (const secret of ["Exemplu", "Secreta", "etaj", "0700000000"]) expect(text).not.toContain(secret);
  });

  it("degrades a payload with nothing in it rather than throwing, and a missing total is missing", () => {
    const r = toReceipt(9, {});
    expect(r).toMatchObject({ orderId: 9, state: "unknown", items: [], total: undefined, localDate: undefined });
    expect(r.charged).toEqual({ card: "0.00", glovoCredit: "0.00" });
  });
});
