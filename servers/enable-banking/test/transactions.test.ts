/**
 * Money, and the two rules that decide whether a statement is usable.
 *
 * Every assertion here is about a value NOT changing. That is the whole point:
 * the failure mode of money in JavaScript is silent, so the tests have to be
 * about exactness rather than about plausibility.
 */
import { describe, expect, it } from "vitest";

import type { RawTransaction } from "../src/domain/schema.js";
import { counterparty, directionOf, parseAmountText, remittanceText, transaction } from "../src/domain/transactions.js";

/** A row with the three fields the schema requires, and whatever a test adds. */
const row = (over: Partial<RawTransaction> = {}): RawTransaction => ({
  transaction_amount: { amount: "1.00", currency: "RON" },
  credit_debit_indicator: "CRDT",
  status: "BOOK",
  ...over,
});

describe("amounts never pass through a float", () => {
  it("keeps a value a double could not hold", () => {
    // Number("9007199254740993.01") is 9007199254740992. The string is exact.
    const out = parseAmountText("9007199254740993.01", "credit");
    expect(out).toEqual({ ok: true, value: "9007199254740993.01" });
  });

  it("keeps trailing zeros and scale, which a number would drop", () => {
    // "10.00" and "10" are the same quantity and different facts: one of them
    // tells you the bank reports two decimals.
    expect(parseAmountText("10.00", "credit")?.value).toBe("10.00");
    expect(parseAmountText("0.010", "credit")?.value).toBe("0.010");
  });

  it("signs by moving a character, not by multiplying by -1", () => {
    expect(parseAmountText("123.45", "debit")?.value).toBe("-123.45");
    expect(parseAmountText("123.45", "credit")?.value).toBe("123.45");
  });

  it("does not produce negative zero", () => {
    // -0 serialises as "0" in JSON but compares oddly everywhere else, and a
    // zero-value entry is neither money in nor money out.
    expect(parseAmountText("0", "debit")?.value).toBe("0");
    expect(parseAmountText("0.00", "debit")?.value).toBe("0.00");
  });

  it("does not double-negate a value that already carries a sign", () => {
    expect(parseAmountText("-50.00", "debit")?.value).toBe("-50.00");
    expect(parseAmountText("-50.00", "credit")?.value).toBe("50.00");
  });

  it("flags a JSON number instead of presenting it as exact", () => {
    // Precision is gone before this code runs: JSON.parse already made it a
    // double. The only honest thing left is to say so.
    const out = parseAmountText(123.45, "debit");
    expect(out?.ok).toBe(false);
    expect(out?.ok === false && out.reason).toContain("float");
    expect(out?.value).toBe("-123.45");
  });

  it("passes an unrecognised figure through untouched rather than guessing", () => {
    const out = parseAmountText("1,234.56", "credit");
    expect(out).toMatchObject({ ok: false, value: "1,234.56" });
  });

  it("treats absent and blank as no amount, not as zero", () => {
    expect(parseAmountText(undefined, "credit")).toBeUndefined();
    expect(parseAmountText("   ", "credit")).toBeUndefined();
  });
});

describe("directionOf", () => {
  it("reads DBIT as money leaving and anything else as money arriving", () => {
    expect(directionOf("DBIT")).toBe("debit");
    expect(directionOf("dbit")).toBe("debit");
    expect(directionOf("CRDT")).toBe("credit");
  });
});

describe("counterparty", () => {
  const both = row({
    creditor: { name: "Shop SRL" },
    creditor_account: { iban: "RO49SHOP" },
    debtor: { name: "Account Holder" },
    debtor_account: { iban: "RO49MINE" },
  });

  it("takes the other side of the transfer, which depends on direction", () => {
    // On a debit this account IS the debtor. Reading debtor_account as the
    // counterparty hands back the account's own IBAN, and a reconciliation
    // then matches a statement against itself.
    expect(counterparty(both, "debit")).toEqual({ name: "Shop SRL", iban: "RO49SHOP" });
    expect(counterparty(both, "credit")).toEqual({ name: "Account Holder", iban: "RO49MINE" });
  });

  it("falls back to the other-identification slot some banks use instead of iban", () => {
    expect(
      counterparty(row({ creditor_account: { other: { identification: "0123456789", scheme_name: "BBAN" } } }), "debit").iban,
    ).toBe("0123456789");
  });

  it("reads a null the bank sent as absent, never as the word null", () => {
    // Some banks send explicit nulls (account_id.other, account_servicer).
    expect(counterparty(row({ creditor: null, creditor_account: { iban: null, other: null } }), "debit")).toEqual({
      name: undefined,
      iban: undefined,
    });
  });
});

describe("remittanceText", () => {
  it("joins the lines a bank split arbitrarily", () => {
    // The identifiers a reconciliation needs straddle the bank's own line
    // breaks, so a search over the lines as sent finds nothing.
    expect(remittanceText(["INVOICE FCT", "0042 PAYMENT"])).toBe("INVOICE FCT 0042 PAYMENT");
  });

  it("is undefined rather than an empty string when there is nothing to say", () => {
    expect(remittanceText([])).toBeUndefined();
    expect(remittanceText(["  ", ""])).toBeUndefined();
    expect(remittanceText(undefined)).toBeUndefined();
    expect(remittanceText(null)).toBeUndefined();
  });
});

describe("transaction", () => {
  it("maps a whole row without arithmetic anywhere in it", () => {
    const out = transaction({
      entry_reference: "E1",
      credit_debit_indicator: "DBIT",
      transaction_amount: { amount: "42.50", currency: "RON" },
      status: "BOOK",
      booking_date: "2026-01-15",
      value_date: "2026-01-16",
      creditor: { name: "Shop SRL" },
      creditor_account: { iban: "RO49SHOP" },
      remittance_information: ["CARD PAYMENT"],
    });
    expect(out).toEqual({
      reference: "E1",
      direction: "debit",
      amount: "-42.50",
      currency: "RON",
      status: "BOOK",
      bookingDate: "2026-01-15",
      valueDate: "2026-01-16",
      counterpartyName: "Shop SRL",
      counterpartyIban: "RO49SHOP",
      remittance: "CARD PAYMENT",
      bankCode: undefined,
      merchantCategoryCode: undefined,
    });
  });

  it("carries no amountWarning on an ordinary row", () => {
    // A key that is always present stops being read, so it appears only when
    // the figure could not be taken at face value.
    expect(transaction(row())).not.toHaveProperty("amountWarning");
    expect(transaction(row({ transaction_amount: { amount: 1.0, currency: "RON" } }))).toHaveProperty("amountWarning");
  });

  it("falls back to transaction_id when the bank sends no entry reference", () => {
    expect(transaction(row({ transaction_id: "T9" })).reference).toBe("T9");
    expect(transaction(row({ entry_reference: null, transaction_id: "T9" })).reference).toBe("T9");
  });

  it("survives a row with nothing but what the schema requires", () => {
    expect(() => transaction(row())).not.toThrow();
    expect(transaction(row({ transaction_amount: { amount: " ", currency: "RON" } })).amount).toBeUndefined();
  });
});
