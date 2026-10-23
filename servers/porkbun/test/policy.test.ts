import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import type { ToolSpec } from "../src/app/ports.js";
import { buildDeps } from "../src/composition.js";
import { LIVE_KEY_PROFILE, SECRET_FIELDS, VENDOR_PROFILES, VENDOR_VERSION } from "../src/infra/vendor.js";
import { LEFT_OUT } from "../src/infra/vendor/offer.js";
import { CLASSIFIED, policyFor, policyGaps } from "../src/mcp/policy.js";
import { OWN_TOOLS } from "../src/mcp/register.js";

const catalog = buildDeps({}).porkbun.catalog;
const policy = policyFor(catalog);
const namesWith = (access: string) => catalog.filter((t) => policy[t.name]?.access === access).map((t) => t.name);
const tool = (name: string, readOnlyHint?: boolean): ToolSpec => ({
  name,
  description: name,
  inputSchema: {},
  annotations: readOnlyHint === undefined ? {} : { readOnlyHint },
});

describe("the policy against the pinned vendor", () => {
  it("fits: every tool classified, each hand-kept name once, none stale", () => {
    expect(policyGaps(catalog)).toEqual([]);
    expect(Object.keys(policy)).toEqual([...catalog.map((t) => t.name), ...CLASSIFIED.own]);
    expect(CLASSIFIED.own).toEqual(OWN_TOOLS.map((t) => t.name));
  });

  it("puts every tool without readOnlyHint in exactly one of MONEY or WRITE", () => {
    const notReadOnly = catalog.filter((t) => t.annotations.readOnlyHint !== true).map((t) => t.name);
    for (const name of notReadOnly) {
      expect([CLASSIFIED.money.includes(name), CLASSIFIED.write.includes(name)].filter(Boolean), name).toHaveLength(1);
    }
    expect(new Set([...namesWith("write"), ...namesWith("money")])).toEqual(new Set([...notReadOnly, "get_ssl_bundle"]));
  });

  it("derives read from the vendor's readOnlyHint, except the one read that hands out a private key", () => {
    const readOnly = catalog.filter((t) => t.annotations.readOnlyHint === true).map((t) => t.name);
    expect(namesWith("read")).toEqual(readOnly.filter((name) => name !== "get_ssl_bundle"));
    expect(policy["get_ssl_bundle"]?.access).toBe("money");
  });

  it("stops the server when the vendor adds a tool without readOnlyHint that nobody classified", () => {
    expect(() => policyFor([...catalog, tool("buy_everything")])).toThrow(/neither MONEY nor WRITE: buy_everything/);
    expect(() => policyFor([...catalog, tool("sell_everything", false)])).toThrow(/sell_everything/);
    expect(policyFor([...catalog, tool("list_everything", true)])["list_everything"]).toEqual({ access: "read" });
  });

  it("stops the server when the vendor takes the name of one of this server's own tools", () => {
    expect(() => policyFor([...catalog, tool("export_dns_zone", true)])).toThrow(/own but also the vendor's \(rename ours\): export_dns_zone/);
  });

  it("stops the server when a hand-kept name is stale or the vendor made a WRITE tool read-only", () => {
    expect(() => policyFor(catalog.filter((t) => t.name !== "register_domain"))).toThrow(/not offered by the vendor: register_domain/);
    const nowReadOnly = catalog.map((t) => (t.name === "deploy_site" ? { ...t, annotations: { readOnlyHint: true } } : t));
    expect(() => policyFor(nowReadOnly)).toThrow(/read-only by the vendor's own hint \(drop them\): deploy_site/);
  });

  it("agrees with the vendor's own list of what its app-directory connection must not offer, where it should", () => {
    // Porkbun's /mcp/no-purchases leaves out every purchase, top-up, secret, credential input and
    // money-adjacent tool; /mcp leaves out only the sandbox. Their difference is the vendor's own view,
    // less what this server does not offer at all (src/infra/vendor/offer.ts).
    const exclude = (path: string) => VENDOR_PROFILES.find((p) => p.path === path)?.exclude ?? new Set<string>();
    const live = exclude(LIVE_KEY_PROFILE);
    const vendorMoneyOrSecret = [...exclude("/mcp/no-purchases")].filter((name) => !live.has(name) && !Object.hasOwn(LEFT_OUT, name));
    const money = namesWith("money");
    // The vendor also holds these off that path while the ChatGPT review of it is open (its HELD_FOR_REVIEW,
    // "read-only, but held off the directory path"): invoices, the account's phone and email codes, forwards,
    // the mailbox list and the aftermarket search. None spends or hands out a secret.
    const heldForReview = [
      "list_invoices",
      "get_invoice",
      "get_invoice_pdf",
      "send_phone_verification_code",
      "confirm_phone_verification",
      "send_email_verification_code",
      "confirm_email_verification",
      "list_email_forwards",
      "create_email_forward",
      "delete_email_forward",
      "list_mailboxes",
      "search_aftermarket",
    ];
    // An EPP code going IN to a transfer already paid for: a credential input, not a charge or a secret out.
    expect(vendorMoneyOrSecret.filter((name) => !money.includes(name)).sort()).toEqual(["update_transfer_auth_code", ...heldForReview].sort());
    // Ours beyond the vendor's: releasing a paid transfer moves the domain; a registrant change moves ownership.
    expect(money.filter((name) => !vendorMoneyOrSecret.includes(name)).sort()).toEqual(["start_transfer", "update_contacts"]);
  });

  it("withholds the result fields the vendor itself hides as secrets", () => {
    expect(SECRET_FIELDS).toContain("secret");
  });
});

describe("the pin", () => {
  it("is exact, and is the version installed and running", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    const pin = manifest.dependencies["@porkbunllc/mcp-server"];
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
    const installed = createRequire(import.meta.url)("@porkbunllc/mcp-server/package.json") as { version: string };
    expect(installed.version).toBe(pin);
    expect(VENDOR_VERSION).toBe(pin);
  });
});
