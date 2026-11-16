/**
 * The pure rules, without a server: amounts, Bucharest days, cursor paging,
 * what a tool shows, and the purchase's rules (which vehicle, which billing
 * entry, the confirmation line, the payment host, an order's state).
 */
import { describe, expect, it } from "vitest";

import { bucharestStamp, edges, localDateOf, windowOf } from "../src/domain/dates.js";
import { asAppError } from "../src/domain/errors.js";
import { amountText, priceOf, shownAmount, sumAmounts } from "../src/domain/money.js";
import { collectAll, MAX_PAGES, nextCursorOf } from "../src/domain/paging.js";
import {
  type Billing,
  billingOptions,
  chooseBilling,
  defaultStart,
  findVehicle,
  isOrdersToll,
  isPaymentUrl,
  liveQuote,
  orderLine,
  orderState,
  orderToll,
  plateKey,
  QUOTE_TTL_S,
  quoteRequest,
  type StoredOrder,
  type StoredQuote,
} from "../src/domain/purchase.js";
import type { VehicleWire } from "../src/domain/schema.js";
import { kindOf, tollView, vehicleView } from "../src/domain/views.js";
import { failureFor } from "../src/infra/http.js";
import { jsonText } from "../src/infra/json.js";

const kindOfThrown = (run: () => unknown): string | undefined => {
  try {
    run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown)?.kind;
  }
};

describe("amounts", () => {
  it("are eToll's numbers as exact text, never floats", () => {
    expect(amountText(139.41, "x")).toBe("139.41");
    expect(kindOfThrown(() => amountText(0.1 + 0.2, "x"))).toBe("drift");
    expect(amountText("28.80", "x")).toBe("28.80");
    expect(amountText(null, "x")).toBeUndefined();
    expect(kindOfThrown(() => amountText(1e21, "x"))).toBe("drift");
    expect(kindOfThrown(() => amountText("12,50", "x"))).toBe("drift");
  });

  it("make a price only with a total, and add up without rounding", () => {
    expect(priceOf({ totalPrice: 139.41, vat: 24.2 }, "p")).toEqual({ total: "139.41", vat: "24.2", vatPercent: null, withoutVat: null, currency: "RON" });
    expect(kindOfThrown(() => priceOf({ vat: 1 }, "p"))).toBe("drift");
    expect(sumAmounts(["0.1", "0.2"])).toBe("0.3");
    expect(shownAmount("150")).toBe("150.00");
    expect(shownAmount("28.8")).toBe("28.80");
    expect(shownAmount("1.234")).toBe("1.234");
  });

  it("go into a JSON body as the same digits", () => {
    expect(jsonText({ a: { jsonNumber: "139.41" }, b: [1, "x", null, { jsonNumber: "0.30" }], c: undefined })).toBe('{"a":139.41,"b":[1,"x",null,0.30]}');
    expect(kindOfThrown(() => jsonText({ jsonNumber: "1e3" }))).toBe("drift");
  });
});

describe("Bucharest days", () => {
  it("stamp an instant with the offset of its season", () => {
    expect(bucharestStamp(Date.parse("2026-01-15T10:00:00Z"))).toBe("2026-01-15T12:00:00.000+02:00");
    expect(bucharestStamp(Date.parse("2026-07-15T10:00:00.250Z"))).toBe("2026-07-15T13:00:00.250+03:00");
  });

  it("bound a window by the first and last instant of its days, across a change of offset", () => {
    expect(edges({ from: "2026-03-29", to: "2026-03-29" })).toEqual({ from: "2026-03-29T00:00:00.000+02:00", to: "2026-03-29T23:59:59.999+03:00" });
    expect(windowOf(undefined, "2026-11-15", 0)).toEqual({ from: "2025-11-15", to: "2026-11-15" });
    expect(kindOfThrown(() => windowOf("2026-12-01", "2026-11-01", 0))).toBe("input");
  });

  it("read a moment eToll sent as its Bucharest day", () => {
    expect(localDateOf("2026-12-31T23:59:59")).toBe("2026-12-31");
    expect(localDateOf("2026-12-31T22:30:00Z")).toBe("2027-01-01");
    expect(localDateOf("soon")).toBeUndefined();
  });
});

describe("cursor paging", () => {
  it("ends at a page without a cursor or an empty one, and says when it was cut short", async () => {
    expect(nextCursorOf([1], "c")).toBe("c");
    expect(nextCursorOf([], "c")).toBeUndefined();
    expect(nextCursorOf([1], "")).toBeUndefined();
    const pages = [{ items: [1, 2], nextCursor: "a" }, { items: [3], nextCursor: undefined }];
    expect(await collectAll(async (c) => pages[c === undefined ? 0 : 1]!)).toEqual({ items: [1, 2, 3], truncated: false });
    let asked = 0;
    const endless = await collectAll(async () => ({ items: [asked++], nextCursor: "again" }));
    expect(endless).toMatchObject({ truncated: true });
    expect(asked).toBe(MAX_PAGES);
  });
});

const VEHICLE: VehicleWire = {
  id: "veh-1",
  plateNumber: "B123ABC",
  countryCode: "RO",
  category: "A",
  vignetteEligibility: { eligibleIntervals: [{ start: "2026-11-26T00:00:00", end: "2027-01-14T23:59:59" }], expirationDateCurrentVignette: "2026-11-25T23:59:59" },
};

describe("views", () => {
  it("count a vignette's days left between Bucharest days, and say when it has ended", () => {
    expect(vehicleView(VEHICLE, "2026-11-15").vignette).toEqual({ valid_until: "2026-11-25", days_left: 10, active: true });
    expect(vehicleView(VEHICLE, "2026-11-26").vignette).toMatchObject({ days_left: -1, active: false });
    expect(vehicleView({ id: "v2" }, "2026-11-15")).toMatchObject({ vignette: null, eligible: null, eligible_periods: null });
    expect(tollView({ id: "t", validUntil: "2026-11-10T23:59:59" }, "2026-11-15").days_left).toBeNull();
  });

  it("name a toll's kind from the portal's number or name", () => {
    expect([kindOf(0), kindOf(1), kindOf("2"), kindOf("VIGNETTE"), kindOf(null)]).toEqual(["vignette", "bridge", "route", "vignette", null]);
  });
});

const QUOTE: StoredQuote = {
  id: "q_1",
  createdAtEpoch: 1_000,
  vehicle: { id: "veh-1", plateNumber: "B123ABC" },
  vehicleId: "veh-1",
  plate: "B123ABC",
  country: "RO",
  category: "A",
  startDate: "2026-11-26",
  duration: "TWELVE_MONTHS",
  validFrom: "2026-11-26T00:00:00",
  validUntil: "2027-11-25T23:59:59",
  price: { total: "139.41", vat: "24.2", vatPercent: "21", withoutVat: "115.21", currency: "RON" },
};

const ANA: Billing = { id: "bp-1", kind: "person", name: "Ana Popescu", entry: { id: "bp-1", firstName: "Ana", lastName: "Popescu" } };

describe("the purchase", () => {
  it("finds a vehicle by id or by plate however it is typed, and refuses an ambiguous plate", () => {
    expect(plateKey(" b-123 abc ")).toBe("B123ABC");
    expect(findVehicle([VEHICLE], "veh-1").id).toBe("veh-1");
    expect(findVehicle([VEHICLE], "b 123 abc").id).toBe("veh-1");
    expect(kindOfThrown(() => findVehicle([VEHICLE], "CJ01XYZ"))).toBe("not_found");
    expect(kindOfThrown(() => findVehicle([VEHICLE, { ...VEHICLE, id: "veh-2", countryCode: "MD" }], "B123ABC"))).toBe("input");
  });

  it("starts a new vignette on the first day eToll allows, or today", () => {
    expect(defaultStart(VEHICLE, "2026-11-15")).toBe("2026-11-26");
    expect(defaultStart(VEHICLE, "2026-12-01")).toBe("2026-12-01");
    expect(defaultStart({ id: "v" }, "2026-11-15")).toBe("2026-11-15");
  });

  it("skips an eligible period already over, as eToll lists one after a vignette bought today", () => {
    const boughtToday: VehicleWire = {
      id: "v",
      vignetteEligibility: {
        eligibleIntervals: [
          { start: "2026-11-14T00:00:00.000+02:00", end: "2026-11-14T23:59:59.999+02:00" },
          { start: "2026-11-16T00:00:00.000+02:00", end: "2026-12-14T23:59:59.999+02:00" },
        ],
        expirationDateCurrentVignette: "2026-11-15T23:59:59.999+02:00",
      },
    };
    expect(defaultStart(boughtToday, "2026-11-15")).toBe("2026-11-16");
    expect(vehicleView(boughtToday, "2026-11-15")).toMatchObject({ eligible: true, eligible_periods: [{ from: "2026-11-16", to: "2026-12-14" }] });
    expect(vehicleView(boughtToday, "2026-12-15")).toMatchObject({ eligible: false, eligible_periods: [] });
  });

  it("asks a quote from midnight in Bucharest with that day's offset, which eToll requires", () => {
    expect(quoteRequest("veh-1", "2026-11-26")).toEqual({ vehicleId: "veh-1", validFrom: "2026-11-26T00:00:00.000+02:00", type: 0 });
    expect(quoteRequest("veh-1", "2026-07-01").validFrom).toBe("2026-07-01T00:00:00.000+03:00");
    expect(quoteRequest("veh-1", "2026-03-29").validFrom).toBe("2026-03-29T00:00:00.000+02:00");
  });

  it("keeps a quote orderable for its TTL only", () => {
    expect(liveQuote(QUOTE, "q_1", 1_000 + QUOTE_TTL_S)).toBe(QUOTE);
    expect(kindOfThrown(() => liveQuote(QUOTE, "q_1", 1_001 + QUOTE_TTL_S))).toBe("input");
    expect(kindOfThrown(() => liveQuote(undefined, "q_x", 0))).toBe("not_found");
  });

  it("writes the order's toll with every amount as exact digits", () => {
    expect(jsonText(orderToll(QUOTE))).toBe(
      '{"type":0,"vehicle":{"id":"veh-1","plateNumber":"B123ABC"},"validFrom":"2026-11-26T00:00:00","validUntil":"2027-11-25T23:59:59","duration":"TWELVE_MONTHS",' +
        '"price":{"totalPrice":139.41,"vat":24.2,"vatPercentage":21,"priceWithoutVat":115.21}}',
    );
  });

  it("says in one line what is bought, for which car and period, at what price, billed to whom", () => {
    const line = orderLine(QUOTE, ANA);
    expect(line).toBe("Buy rovinietă 12 months, category A, for B123ABC (RO), valid from 2026-11-26 to 2027-11-25, 139.41 RON, billed to Ana Popescu, paid by card on euplatesc.ro");
    expect(orderLine(QUOTE, { ...ANA, name: "x".repeat(400) }).length).toBeLessThanOrEqual(290);
  });

  it("bills the only entry, or the one named, and lists them when it cannot choose", () => {
    const options = billingOptions({ persons: [{ id: "bp-1", firstName: "Ana", lastName: "Popescu" }], organisations: [{ id: "bo-1", name: "EXEMPLU S.R.L.", vatNumber: "RO12345678" }] });
    expect(options.map((b) => b.name)).toEqual(["Ana Popescu", "EXEMPLU S.R.L. (RO12345678)"]);
    expect(chooseBilling(options, "bo-1").kind).toBe("organisation");
    expect(chooseBilling(options.slice(0, 1), undefined).id).toBe("bp-1");
    expect(kindOfThrown(() => chooseBilling(options, undefined))).toBe("input");
    expect(kindOfThrown(() => chooseBilling([], undefined))).toBe("refused");
    expect(kindOfThrown(() => chooseBilling(options, "bp-9"))).toBe("not_found");
  });

  it("hands a payment only to https on euplatesc.ro", () => {
    expect(isPaymentUrl("https://secure.euplatesc.ro/tdsprocess/tranzactd.php")).toBe(true);
    expect(isPaymentUrl("https://euplatesc.ro/x")).toBe(true);
    expect(isPaymentUrl("http://secure.euplatesc.ro/x")).toBe(false);
    expect(isPaymentUrl("https://euplatesc.ro.example.com/x")).toBe(false);
    expect(isPaymentUrl("https://noteuplatesc.ro/x")).toBe(false);
    expect(isPaymentUrl("not a url")).toBe(false);
    expect(isPaymentUrl("https://secure.euplatesc.ro:8443/x")).toBe(false);
    const withUser = new URL("https://secure.euplatesc.ro/x");
    withUser.username = "user";
    withUser.password = "pw";
    expect(isPaymentUrl(withUser.href)).toBe(false);
    expect(isPaymentUrl("https://SECURE.EUPLATESC.RO/x")).toBe(true);
  });

  it("reads an order's state from its vignettes and its expiry", () => {
    const order: StoredOrder = {
      orderId: "o",
      quoteId: "q",
      placedAtEpoch: 0,
      issuances: ["iss"],
      plate: null,
      country: null,
      duration: "ONE_DAY",
      startDate: "2026-11-26",
      total: "1",
      expiresAt: "2026-11-15T10:30:00Z",
      paymentUrl: null,
      cancelled: false,
    };
    const before = Date.parse("2026-11-15T10:00:00Z");
    const after = Date.parse("2026-11-15T11:00:00Z");
    expect(orderState(["PENDING"], order, before)).toBe("pending");
    expect(orderState(["PENDING"], order, after)).toBe("expired");
    expect(orderState(["ACTIVE"], order, after)).toBe("paid");
    expect(orderState(["CANCELLED"], order, before)).toBe("cancelled");
    expect(orderState(["PENDING"], { ...order, cancelled: true }, before)).toBe("cancelled");
    expect(orderState(["REFUNDED"], order, before)).toBe("refunded");
    expect(orderState([], order, before)).toBe("pending");
  });

  it("knows an order's toll by its orderId, else by the externalId the order answer gave it", () => {
    const order = { orderId: "o-1", issuances: ["iss-1"] };
    expect(isOrdersToll({ orderId: "o-1", issuance: null }, order)).toBe(true);
    expect(isOrdersToll({ orderId: null, issuance: { externalId: "iss-1" } }, order)).toBe(true);
    expect(isOrdersToll({ orderId: "o-2", issuance: { externalId: "iss-2" } }, order)).toBe(false);
    expect(isOrdersToll({ orderId: null, issuance: { externalId: null } }, { orderId: "o-1", issuances: [] })).toBe(false);
  });
});

describe("eToll's refusals", () => {
  it("keep the portal's code, its English sentence, and the open order it names", () => {
    const body = { status: 409, message: "PENDING_ORDER_SAME_PRODUCT", parameter: "ord-9", alertDetails: { eng: "You already have a pending order.", ro: "x" } };
    expect(failureFor({ kind: "rejected", status: 409, reason: "PENDING_ORDER_SAME_PRODUCT", message: "eToll rejected POST", body })).toMatchObject({
      kind: "refused",
      code: "PENDING_ORDER_SAME_PRODUCT",
      pendingOrderId: "ord-9",
      message: expect.stringContaining("You already have a pending order."),
    });
    expect(failureFor({ kind: "rejected", status: 422, reason: "PLATE_NUMBER_FORMAT_INVALID", message: "m", body: { message: "PLATE_NUMBER_FORMAT_INVALID" } })).toMatchObject({ kind: "refused", code: "PLATE_NUMBER_FORMAT_INVALID" });
    expect(failureFor({ kind: "rejected", status: 400, reason: undefined, message: "m", body: "bad" })).toMatchObject({ kind: "input" });
    expect(failureFor({ kind: "rejected", status: 404, reason: "ORDER_NOT_FOUND", message: "m" })).toMatchObject({ kind: "not_found" });
    expect(failureFor({ kind: "rejected", status: 401, reason: undefined, message: "m" })).toMatchObject({ kind: "needs_login", reason: "refused" });
    expect(failureFor({ kind: "outcome_unknown", status: 502, message: "m" })).toMatchObject({ kind: "outcome_unknown" });
    expect(failureFor({ kind: "rejected", status: 503, reason: "MAINTENANCE", message: "m" })).toMatchObject({ kind: "api", status: 503 });
  });
});
