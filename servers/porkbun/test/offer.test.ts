/**
 * What this server leaves out of the vendor's catalog (src/infra/vendor/offer.ts),
 * and that the money tools 0.52.0 added confirm exactly what they send.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { describedHere, FUNDING, LEFT_OUT, LEFT_OUT_PARAMS, paramsHere, type VendorFundingText } from "../src/infra/vendor/offer.js";
import { connect, json, keyFiles, stubFetch } from "./harness.js";

const API = "https://api.porkbun.com/api/json/v3";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what is not offered", () => {
  it("no USDC payment, no API key minting: not as tools, not as arguments, not in a description", async () => {
    const { client } = await connect(keyFiles());
    const listed = (await client.listTools()).tools;
    const names = listed.map((t) => t.name);
    for (const name of Object.keys(LEFT_OUT)) expect(names, name).not.toContain(name);
    for (const tool of listed) {
      const params = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      for (const param of LEFT_OUT_PARAMS) expect(params, `${tool.name} ${param}`).not.toContain(param);
      expect(tool.description ?? "", tool.name).not.toMatch(/\bpay_with_usdc\b|\busdc_checkout_id\b|PORKBUN_X402/);
    }
  });

  it("tells a purchase it is paid from credit or by card, and a description that names a left-out tool says it is not here", async () => {
    const { client } = await connect(keyFiles());
    const describe = new Map((await client.listTools()).tools.map((t) => [t.name, t.description ?? ""]));
    const register = describe.get("register_domain") ?? "";
    expect(register).toMatch(/^\*\*Spends account credit, or pays directly by card \(`pay_with_card`\)\.\*\*/);
    expect(register).toContain(FUNDING);
    expect(register).toContain("`pay_with_card: true` when the user pays with Stripe Link");
    expect(describe.get("top_up_with_card_mpp")).toContain("Not offered on this server: `top_up_with_usdc` (adds credit in USDC on Base over x402");
    expect(describe.get("ping")).not.toContain("Not offered on this server");
  });

  it("refuses a USDC payment argument before anything is sent", async () => {
    const sent = stubFetch(() => json({ status: "SUCCESS" }));
    const { client } = await connect(keyFiles());
    const result = (await client.callTool({ name: "register_domain", arguments: { domain: "example.com", cost_cents: 1108, pay_with_usdc: true } })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("pay_with_usdc");
    expect(sent).toEqual([]);
  });

  const vendor: VendorFundingText = {
    fundingLocal: "FUNDING.",
    payWithUsdcNote: " USDC NOTE with `pay_with_usdc`.",
    payDirectOpening: ", or pays directly by card (`pay_with_card`) or in USDC (`pay_with_usdc`)",
    payDirectParams: ["pay_with_card", "card_payment_id", "pay_with_usdc", "usdc_checkout_id"],
  };

  it("stops the server when the vendor offers USDC in words it does not recognise, or renames a payment argument", () => {
    expect(describedHere("buy", "**Spends credit, or pays directly by card (`pay_with_card`) or in USDC (`pay_with_usdc`).** FUNDING. USDC NOTE with `pay_with_usdc`.", vendor)).toBe(
      `**Spends credit, or pays directly by card (\`pay_with_card\`).** ${FUNDING}`,
    );
    expect(() => describedHere("buy", "Or send `pay_with_usdc: true`.", vendor)).toThrow(/still offers USDC payment/);
    expect(() => paramsHere("buy", { domain: 1 }, { ...vendor, payDirectParams: ["pay_with_card", "pay_in_usdc"] })).toThrow(/no longer names pay_with_usdc, usdc_checkout_id/);
    expect(() => paramsHere("buy", { domain: 1, pay_in_usdc: 2 }, vendor)).toThrow(/takes pay_in_usdc, a USDC payment argument/);
    expect(paramsHere("buy", { domain: 1, pay_with_card: 2, pay_with_usdc: 3, usdc_checkout_id: 4 }, vendor)).toEqual({ domain: 1, pay_with_card: 2 });
  });
});

describe("the new money tools confirm what they send", () => {
  /** Porkbun with no cap, so the call goes through; every other answer SUCCESS. */
  const porkbun = () =>
    stubFetch((url) =>
      json(
        url.endsWith("/account/apiSettings")
          ? { status: "SUCCESS", spendLimit: { source: "none", limit: null, spent: 0, remaining: null }, topupLimit: { source: "none", limit: null, added: 0 } }
          : { status: "SUCCESS" },
      ),
    );

  it.each([
    ["create_mailbox", { domain: "example.com", address: "info", cost_cents: 3600 }, "/email/createMailbox/example.com", { address: "info", cost: 3600 }, "$36.00"],
    ["renew_mailbox", { domain: "example.com", mailbox_id: 42, cost_cents: 3456 }, "/email/renewMailbox/example.com", { mailboxId: 42, cost: 3456 }, "$34.56"],
    ["top_up_with_card_mpp", { amount_cents: 2050 }, "/account/topupMpp", { amount: 2050 }, "$20.50"],
  ] as const)("%s", async (tool, args, path, body, dollars) => {
    const sent = porkbun();
    const { call, asked } = await connect({ ...keyFiles(), PORKBUN_OUTBOX_DIR: mkdtempSync(join(tmpdir(), "porkbun-outbox-")) });
    const result = await call(tool, args);
    expect(result.isError, result.text).toBe(false);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(dollars);
    const purchase = sent.find((s) => s.url === `${API}${path}`);
    expect(purchase?.body).toMatchObject(body);
  });

  it("set_email_password and setup_mailbox never put the password in the line, and send it as given", async () => {
    const sent = porkbun();
    const { call, asked } = await connect(keyFiles());
    await call("set_email_password", { email_address: "Hello@Example.com", password: "Invented-Pass-123!" });
    await call("setup_mailbox", { domain: "example.com", address: "hello", password: "Invented-Pass-123!" });
    expect(asked.join("\n")).not.toContain("Invented-Pass-123!");
    expect(asked[0]).toContain("hello@example.com");
    expect(sent.find((s) => s.url === `${API}/email/setPassword`)?.body).toMatchObject({ emailAddress: "hello@example.com", password: "Invented-Pass-123!" });
    expect(sent.find((s) => s.url === `${API}/email/setupMailbox/example.com`)?.body).toMatchObject({ address: "hello", password: "Invented-Pass-123!" });
  });
});
