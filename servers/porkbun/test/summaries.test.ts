import type { ToolArgs } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { policyFor } from "../src/mcp/policy.js";

const catalog = buildDeps({}).porkbun.catalog;
const policy = policyFor(catalog);

/** The line a user reads for this call. */
const line = (tool: string, args: ToolArgs): string => {
  const rule = policy[tool];
  if (rule?.access !== "money") throw new Error(`${tool} is not money`);
  return rule.summary(args);
};

describe("the line a user confirms", () => {
  it.each([
    ["register_domain", { domain: "Example.COM", cost_cents: 1108 }, "register example.com for $11.08 from Porkbun account credit"],
    ["register_domain", { domain: "example.com", cost: 1108 }, "register example.com for $11.08 from Porkbun account credit"],
    ["register_domain", { domain: "example.com" }, "register example.com for no cost_cents (the call will be refused) from Porkbun account credit"],
    ["renew_domain", { domain: "example.com", cost_cents: 1108, dry_run: true }, "DRY RUN, no charge: renew example.com for $11.08 from Porkbun account credit"],
    [
      "transfer_domain",
      { domain: "example.com", cost_cents: 1108, auth_code: "EPP-SECRET-1", hold_for_dns_setup: true },
      "transfer example.com in to Porkbun for $11.08 from Porkbun account credit, held for DNS setup until start_transfer",
    ],
    ["transfer_domain", { domain: "example.com", cost_cents: 1108, auth_code: "x" }, "transfer example.com in to Porkbun for $11.08 from Porkbun account credit, released to the registry at once"],
    ["buy_closeout", { domain: "old.example", cost_cents: 0, dry_run: true }, "DRY RUN, no charge: buy the closeout old.example for $0.00 from Porkbun account credit"],
    [
      "create_hosting",
      { domain: "example.com", sku: "PIXIESECURESTATICY2", acknowledged_cost_cents: 3000, agree_to_terms: "yes", agree_to_nameserver_change: true },
      "provision hosting PIXIESECURESTATICY2 on example.com at $30.00 per period, auto-renewing; moves the domain to Porkbun nameservers",
    ],
    ["top_up_account_credit", { amount_cents: 2500 }, "charge the saved card $25.00 into Porkbun account credit"],
    ["top_up_account_credit", {}, "charge the saved card the configured top-up amount ($50 if never set) into Porkbun account credit"],
    [
      "configure_auto_topup",
      { enabled: true, threshold_cents: 2000, amount_cents: 10000 },
      "turn auto top-up ON: charge the saved card $100.00 whenever credit drops below $20.00",
    ],
    ["configure_auto_topup", { enabled: false }, "turn auto top-up OFF"],
    ["configure_auto_topup", { amount_cents: 5000 }, "set the top-up amount to $50.00; auto top-up stays as it is"],
    ["update_auto_renew", { domain: "example.com", status: "on" }, "turn auto-renew ON for example.com: Porkbun charges account credit at every expiry"],
    ["update_auto_renew", { domain: "example.com", status: "off" }, "turn auto-renew OFF for example.com: it expires unless renewed by hand"],
    [
      "start_transfer",
      { domain: "example.com", force: true },
      "release the held, already paid transfer of example.com to the registry: the domain leaves its registrar (FORCED, with an empty Porkbun DNS zone)",
    ],
    ["cancel_transfer", { domain: "example.com" }, "cancel the inbound transfer of example.com at the registry and refund its order"],
    [
      "update_contacts",
      { domain: "example.com", contacts: { tech: {}, registrant: { firstName: "Ana", lastName: "Pop", organization: "Exemplu SRL", email: "ana@example.com" } } },
      "change the tech, registrant contact(s) of example.com; the registrant, the owner of record, becomes Ana Pop (Exemplu SRL) <ana@example.com>",
    ],
    ["update_contacts", { domain: "example.com", contacts: { admin: {} } }, "change the admin contact(s) of example.com"],
    ["get_ssl_bundle", { domain: "example.com" }, "save example.com's Porkbun TLS certificate and its PRIVATE KEY in this server's outbox"],
    [
      "create_wp_credentials",
      { domain: "example.com", role: "administrator", acknowledge_full_access: true },
      "mint a WordPress application password on example.com for the calling agent, role ADMINISTRATOR (full control, can install code)",
    ],
    [
      "create_webhook",
      { url: "https://hooks.example.com/pb", events: ["dns.*"] },
      "add a webhook posting dns.* to https://hooks.example.com/pb and hand its signing secret to the calling agent",
    ],
    ["rotate_webhook_secret", { id: 7 }, "rotate the signing secret of webhook 7 (its receiver stops verifying) and hand the new one to the calling agent"],
    [
      "register_domain",
      { domain: "example.com", cost_cents: 1108, pay_with_card: true },
      "register example.com for $11.08 by the user's card through Stripe Link (a link to pay first; held, charged only if it succeeds)",
    ],
    [
      "renew_domain",
      { domain: "example.com", cost_cents: 1108, card_payment_id: "cp_123" },
      "renew example.com for $11.08 with card payment cp_123, already authorised in Stripe Link (charged only if it succeeds)",
    ],
    [
      "create_hosting",
      { domain: "example.com", sku: "PIXIESECURESTATICM2", acknowledged_cost_cents: 300, agree_to_terms: "yes", pay_with_card: true },
      "provision hosting PIXIESECURESTATICM2 on example.com at $3.00 per period, auto-renewing; a charge now is paid by the user's card through Stripe Link (a link to pay first; held, charged only if it succeeds)",
    ],
    [
      "create_mailbox",
      { domain: "Example.com", address: "info", cost_cents: 3600 },
      "buy the email mailbox info@example.com for $36.00 a year, renewing automatically, from Porkbun account credit; Porkbun generates its password, saved in this server's outbox",
    ],
    [
      "create_mailbox",
      { domain: "example.com", address: "info@example.com", cost_cents: 3600, password: "Never-In-The-Line-1", confirm_dns_changes: true },
      "buy the email mailbox info@example.com for $36.00 a year, renewing automatically, from Porkbun account credit; with the password given in the call; REPLACES the domain's other MX records and rewrites its SPF as the earlier answer described",
    ],
    ["renew_mailbox", { domain: "example.com", mailbox_id: 42, cost_cents: 3600 }, "add a year to the email mailbox mailbox #42 on example.com for $36.00 from Porkbun account credit"],
    ["renew_mailbox", { domain: "example.com", address: "info", cost_cents: 0, dry_run: true }, "DRY RUN, no charge: add a year to the email mailbox info@example.com for $0.00 from Porkbun account credit"],
    [
      "setup_mailbox",
      { domain: "example.com", address: "hello" },
      "set up the waiting email mailbox hello@example.com (free); Porkbun generates its password, saved in this server's outbox",
    ],
    [
      "set_email_password",
      { email_address: "Hello@Example.com", password: "Never-In-The-Line-1" },
      "change the password of the email mailbox hello@example.com: every mail app signed in with the old one stops until it gets the new one",
    ],
    [
      "top_up_with_card_mpp",
      { amount_cents: 2000 },
      "open a single-use link that charges the user's card $20.00 through Stripe Link into Porkbun account credit once they approve it",
    ],
  ] as const)("%s %j", (tool, args, expected) => {
    expect(line(tool, args)).toBe(expected);
  });

  it("leads with DRY RUN on every money tool whose vendor schema takes dry_run", () => {
    const withDryRun = catalog.filter((t) => policy[t.name]?.access === "money" && "dry_run" in t.inputSchema).map((t) => t.name);
    expect(withDryRun.length).toBeGreaterThan(5);
    for (const tool of withDryRun) expect(line(tool, { domain: "example.com", dry_run: true }), tool).toMatch(/^DRY RUN, no charge: /);
  });

  it("never carries a transfer's auth code, and stays one line", () => {
    const text = line("transfer_domain", { domain: "example.com", cost_cents: 1108, auth_code: "EPP-SECRET-1" });
    expect(text).not.toContain("EPP-SECRET-1");
    for (const t of catalog.filter((t) => policy[t.name]?.access === "money")) {
      const empty = line(t.name, {});
      expect(empty, t.name).not.toMatch(/[\r\n]/);
      expect(empty.length, t.name).toBeLessThanOrEqual(300);
    }
  });
});
