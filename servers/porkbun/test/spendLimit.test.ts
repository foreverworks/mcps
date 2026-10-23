/**
 * The account's monthly API caps, read before a call that charges now: a
 * charge over what is left is refused with the figures and nothing is sent;
 * one within them goes to Porkbun as it was given. Invented figures only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHARGED_NOW, chargeOf } from "../src/domain/charges.js";
import { policyFor } from "../src/mcp/policy.js";
import { buildDeps } from "../src/composition.js";
import { connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What GET /account/apiSettings answers (the shape of Porkbun's /mock/account/apiSettings), with these caps. */
const settings = (spendLimit: Record<string, unknown>, topupLimit: Record<string, unknown> = { limit: 10000, source: "default", added: 0 }) => ({
  status: "SUCCESS",
  settings: { monthlySpendLimit: 0, lowBalanceAlert: 0, autoTopup: false, topupThreshold: 0, topupAmount: 0 },
  monthlySpend: typeof spendLimit["spent"] === "number" ? spendLimit["spent"] : 0,
  spendLimit,
  topupLimit,
});

/** Porkbun with these settings; anything else answers SUCCESS. */
const porkbun = (answer: unknown) => stubFetch((url) => (url.endsWith("/account/apiSettings") ? json(answer) : json({ status: "SUCCESS" })));

describe("a purchase over what is left of the monthly API spend limit", () => {
  it("is refused with Porkbun's code and the exact figures, and nothing but the settings read is sent", async () => {
    const sent = porkbun(settings({ limit: 10000, source: "default", spent: 9500, remaining: 500 }));
    const { call } = await connect(keyFiles());
    const result = await call("register_domain", { domain: "example.com", cost_cents: 1108 });
    expect(result.isError).toBe(true);
    expect(result.value).toEqual({
      error: {
        kind: "over_limit",
        code: "MONTHLY_SPEND_LIMIT_EXCEEDED",
        cap: "spend",
        message:
          "register_domain would charge $11.08, more than the $5.00 left of this month's monthly API spend limit " +
          "($100.00, Porkbun's default for an account that set none; $95.00 spent so far); nothing was sent to Porkbun",
        figures: { currency: "USD", charge: "11.08", limit: "100.00", used: "95.00", remaining: "5.00", source: "default" },
        remedy: expect.stringContaining("only the account holder can raise the monthly API spend limit"),
      },
    });
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([`GET ${API}/account/apiSettings`]);
  });

  it("weighs the legacy cost alias the same way, since the vendor sends it", async () => {
    const sent = porkbun(settings({ limit: 2000, source: "account", spent: 1500, remaining: 500 }));
    const { call } = await connect(keyFiles());
    const result = await call("renew_domain", { domain: "example.com", cost: 501 });
    expect(result.value).toMatchObject({ error: { kind: "over_limit", figures: { charge: "5.01", remaining: "5.00", source: "account" } } });
    expect(sent).toHaveLength(1);
  });
});

describe("a purchase within the limit", () => {
  it.each([
    ["exactly what is left", { limit: 10000, source: "default", spent: 8892, remaining: 1108 }],
    ["no cap at all", { limit: null, source: "none", spent: 52000, remaining: null }],
  ])("is sent as it was given: %s", async (_why, cap) => {
    const sent = porkbun(settings(cap));
    const { call } = await connect(keyFiles());
    const result = await call("register_domain", { domain: "example.com", cost_cents: 1108 });
    expect(result.isError).toBe(false);
    expect(sent.map((s) => s.url)).toEqual([`${API}/account/apiSettings`, `${API}/domain/create/example.com`]);
    expect(sent[1]?.body).toMatchObject({ cost: 1108 });
  });
});

describe("what is not checked", () => {
  it("a dry run: nothing is bought, and Porkbun's dry run reports the cap itself", async () => {
    const sent = porkbun(settings({ limit: 100, source: "account", spent: 100, remaining: 0 }));
    const { call } = await connect(keyFiles());
    await call("buy_closeout", { domain: "old.example", cost_cents: 999, dry_run: true });
    expect(sent.map((s) => s.url)).toEqual([`${API}/closeout/buy/old.example`]);
  });

  it("an amount the vendor refuses itself (absent, or two names that disagree), and a tool that charges nothing now", () => {
    expect(chargeOf("register_domain", { domain: "example.com" })).toBeUndefined();
    expect(chargeOf("register_domain", { domain: "example.com", cost_cents: 1108, cost: 1200 })).toBeUndefined();
    expect(chargeOf("top_up_account_credit", {})).toBeUndefined();
    expect(chargeOf("create_hosting", { domain: "example.com", acknowledged_cost_cents: 300 })).toBeUndefined();
    expect(chargeOf("update_auto_renew", { domain: "example.com", status: "on" })).toBeUndefined();
  });
});

describe("a top-up over what is left of the monthly API top-up limit", () => {
  it("is refused against the top-up cap, which Porkbun reports as limit and added", async () => {
    const sent = porkbun(settings({ limit: null, source: "none", spent: 0, remaining: null }, { limit: 10000, source: "default", added: 7500 }));
    const { call } = await connect(keyFiles());
    const result = await call("top_up_account_credit", { amount_cents: 5000 });
    expect(result.value).toMatchObject({
      error: {
        kind: "over_limit",
        code: "TOPUP_LIMIT_EXCEEDED",
        cap: "topup",
        message: expect.stringContaining("$50.00, more than the $25.00 left of this month's monthly API top-up limit ($100.00, Porkbun's default for an account that set none; $75.00 added so far)"),
        figures: { charge: "50.00", limit: "100.00", used: "75.00", remaining: "25.00" },
      },
    });
    expect(sent).toHaveLength(1);
  });
});

describe("spend controls this server cannot read", () => {
  it.each([
    ["no spendLimit", { status: "SUCCESS", monthlySpend: 0 }],
    ["a capped limit without remaining", settings({ limit: 10000, source: "default", spent: 0 })],
    ["an amount that is not whole cents", settings({ limit: 10000, source: "default", spent: 0.5, remaining: 9999.5 })],
  ])("refuse the charge rather than guess it fits: %s", async (_why, answer) => {
    const sent = porkbun(answer);
    const { call } = await connect(keyFiles());
    const result = await call("register_domain", { domain: "example.com", cost_cents: 1108 });
    expect(result.value).toMatchObject({ error: { kind: "drift", message: expect.stringMatching(/^get_api_settings: .*nothing was sent to Porkbun$/) } });
    expect(sent).toHaveLength(1);
  });
});

describe("a settings read that fails", () => {
  it("says it failed on the read before the purchase, which was not sent", async () => {
    const sent = stubFetch(() => json({ status: "ERROR", code: "INVALID_API_KEYS", message: "Invalid API key." }, 403));
    const { call } = await connect(keyFiles());
    const result = await call("transfer_domain", { domain: "example.com", cost_cents: 1108, auth_code: "x" });
    expect(result.value).toMatchObject({
      error: { kind: "api", code: "INVALID_API_KEYS", message: expect.stringMatching(/^get_api_settings, read before transfer_domain: .*; transfer_domain was not sent$/) },
    });
    expect(sent.map((s) => s.url)).toEqual([`${API}/account/apiSettings`]);
  });
});

describe("the charge table", () => {
  const catalog = buildDeps({}).porkbun.catalog;
  const policy = policyFor(catalog);

  it("names only money tools the vendor offers, each with the amount field in its schema", () => {
    for (const [tool, charge] of Object.entries(CHARGED_NOW)) {
      expect(policy[tool]?.access, tool).toBe("money");
      const spec = catalog.find((t) => t.name === tool);
      expect(spec?.inputSchema, tool).toHaveProperty(charge.field.name);
    }
  });

  it("weighs the same cents the confirmation line shows", () => {
    for (const [tool, charge] of Object.entries(CHARGED_NOW)) {
      const rule = policy[tool];
      if (rule?.access !== "money") throw new Error(`${tool} is not money`);
      const args = { domain: "example.com", [charge.field.name]: 4321 };
      expect(chargeOf(tool, args), tool).toEqual({ cap: charge.cap, cents: 4321 });
      expect(rule.summary(args), tool).toContain("$43.21");
    }
  });
});
