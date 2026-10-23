import type { ToolArgs, ToolPolicy, ToolRule } from "@foreverworks/mcp-kit";

import type { ToolSpec } from "../app/ports.js";
import { CHARGED_NOW, type CentsField, PURCHASE_COST, TOP_UP_AMOUNT } from "../domain/charges.js";
import { contactsChange, dollars, domainOf, dryRunPrefix, events, FROM_CREDIT, fundedBy, given, mailboxOf, mailboxPassword, mailDns } from "./policy/lines.js";

/**
 * Every Porkbun tool, classified (packages/mcp-kit, policy.ts), DERIVED from
 * the vendor's own annotations wherever that is safe:
 *
 * - `readOnlyHint: true` -> read, unless the tool is in MONEY.
 * - MONEY -> money: the client asks the user to approve each call; the line
 *   below is what the server shows when it asks itself (MCP_CONFIRM=elicit).
 * - WRITE -> write.
 *
 * MONEY and WRITE are the only lists kept by hand, and each tool is named once.
 * A tool without `readOnlyHint` that is in neither stops the server at startup
 * and fails the policy test, so a new vendor tool that might spend money is
 * looked at before it ships. `README.md` has the reasons in one table.
 */

const dollarsOr = (args: ToolArgs, name: string, legacy: string) => dollars(args, name, legacy, `no ${name} (the call will be refused)`);
/** The amount in a field the spend-limit check also reads (src/domain/charges.ts), so the line and the check weigh the same cents. */
const amount = (args: ToolArgs, field: CentsField, whenAbsent: string) => dollars(args, field.name, field.legacy, whenAbsent);
const cost = (args: ToolArgs) => amount(args, PURCHASE_COST, `no ${PURCHASE_COST.name} (the call will be refused)`);

/**
 * Money or an irreversible secret. Each line: the action, the domain, the
 * amount in dollars from the integer cents in the arguments; "DRY RUN, no
 * charge:" leads when `dry_run` is true.
 */
const MONEY: Readonly<Record<string, (args: ToolArgs) => string>> = {
  // Spends account credit, or the user's card through Stripe Link.
  register_domain: (a) => `register ${domainOf(a)} for ${cost(a)} ${fundedBy(a)}`,
  renew_domain: (a) => `renew ${domainOf(a)} for ${cost(a)} ${fundedBy(a)}`,
  transfer_domain: (a) =>
    `transfer ${domainOf(a)} in to Porkbun for ${cost(a)} ${fundedBy(a)}, ` +
    (a["hold_for_dns_setup"] === true ? "held for DNS setup until start_transfer" : "released to the registry at once"),
  buy_closeout: (a) => `buy the closeout ${domainOf(a)} for ${cost(a)} ${fundedBy(a)}`,
  create_mailbox: (a) => `buy the email mailbox ${mailboxOf(a)} for ${cost(a)} a year, renewing automatically, ${fundedBy(a)}; ${mailboxPassword(a)}${mailDns(a)}`,
  renew_mailbox: (a) => `add a year to the email mailbox ${mailboxOf(a)} for ${cost(a)} ${fundedBy(a)}`,
  // A subscription: a 15-day trial on a domain's first provision, then the plan price on every renewal.
  create_hosting: (a) =>
    `provision hosting ${String(a["sku"] ?? "(no sku)")} on ${domainOf(a)} at ${dollarsOr(a, "acknowledged_cost_cents", "acknowledged_cost")} per period, auto-renewing` +
    (a["agree_to_nameserver_change"] === true ? "; moves the domain to Porkbun nameservers" : "") +
    (fundedBy(a) === FROM_CREDIT ? "" : `; a charge now is paid ${fundedBy(a)}`),
  // Charges the saved card, now or whenever the balance runs low.
  top_up_account_credit: (a) =>
    `charge the saved card ${amount(a, TOP_UP_AMOUNT, "the configured top-up amount ($50 if never set)")} into Porkbun account credit`,
  top_up_with_card_mpp: (a) =>
    `open a single-use link that charges the user's card ${amount(a, TOP_UP_AMOUNT, `no ${TOP_UP_AMOUNT.name} (the call will be refused)`)} through Stripe Link into Porkbun account credit once they approve it`,
  configure_auto_topup: (a) => {
    const amount = dollars(a, "amount_cents", "amount", "the amount on file");
    if (a["enabled"] === true) {
      return `turn auto top-up ON: charge the saved card ${amount} whenever credit drops below ${dollars(a, "threshold_cents", "threshold", "(no threshold: refused)")}`;
    }
    const keep = given(a, "amount_cents", "amount") ? `, top-up amount ${amount}` : "";
    return a["enabled"] === false ? `turn auto top-up OFF${keep}` : `set the top-up amount to ${amount}; auto top-up stays as it is`;
  },
  // Commits the account to a charge, or undoes one.
  update_auto_renew: (a) =>
    a["status"] === "on"
      ? `turn auto-renew ON for ${domainOf(a)}: Porkbun charges account credit at every expiry`
      : `turn auto-renew OFF for ${domainOf(a)}: it expires unless renewed by hand`,
  start_transfer: (a) =>
    `release the held, already paid transfer of ${domainOf(a)} to the registry: the domain leaves its registrar` +
    (a["force"] === true ? " (FORCED, with an empty Porkbun DNS zone)" : ""),
  cancel_transfer: (a) => `cancel the inbound transfer of ${domainOf(a)} at the registry and refund its order`,
  // Legal effect: a registrant change makes a new owner of record.
  update_contacts: contactsChange,
  // An irreversible secret: handed to the calling agent, or saved where whoever reads the outbox has it.
  get_ssl_bundle: (a) => `save ${domainOf(a)}'s Porkbun TLS certificate and its PRIVATE KEY in this server's outbox`,
  create_wp_credentials: (a) =>
    `mint a WordPress application password on ${domainOf(a)} for the calling agent, role ` +
    (a["role"] === "administrator" ? "ADMINISTRATOR (full control, can install code)" : "editor"),
  setup_mailbox: (a) => `set up the waiting email mailbox ${mailboxOf(a)} (free); ${mailboxPassword(a)}${mailDns(a)}`,
  set_email_password: (a) => `change the password of the email mailbox ${String(a["email_address"] ?? "(no address)").toLowerCase()}: every mail app signed in with the old one stops until it gets the new one`,
  create_webhook: (a) => `add a webhook posting ${events(a)} to ${String(a["url"] ?? "(no url)")} and hand its signing secret to the calling agent`,
  rotate_webhook_secret: (a) =>
    `rotate the signing secret of webhook ${String(a["id"] ?? "(no id)")} (its receiver stops verifying) and hand the new one to the calling agent`,
};

/** Effects that neither spend nor hand out a secret. Secret fields are withheld from their results. */
const WRITE: readonly string[] = [
  // A held transfer's zone, and the auth code going IN to a transfer already paid for.
  "prepare_transfer",
  "update_transfer_auth_code",
  // DNS at Porkbun and at the registry: free, and restore points undo zone edits.
  "import_dns_records",
  "create_dns_record",
  "update_dns_record",
  "delete_dns_record",
  "restore_dns_zone",
  "update_nameservers",
  "create_dnssec_record",
  "delete_dnssec_record",
  "create_url_forward",
  "delete_url_forward",
  "create_glue_record",
  "update_glue_record",
  "delete_glue_record",
  // Hosting: files, revoking a WordPress password, and ending a plan (which stops a charge).
  "deploy_site",
  "delete_hosting_file",
  "make_hosting_dir",
  "delete_wp_credentials",
  "delete_hosting",
  // Email forwarding: free, and the vendor asks before it replaces another provider's MX or SPF.
  "create_email_forward",
  "delete_email_forward",
  // Proving the account's phone and email with a code the user reads out: no money, no secret handed out.
  "send_phone_verification_code",
  "confirm_phone_verification",
  "send_email_verification_code",
  "confirm_email_verification",
  // Webhooks, less the two that hand out a signing secret.
  "update_webhook",
  "test_webhook",
  "resend_webhook",
  "delete_webhook",
  // Cloudflare: the customer's own zone, free.
  "connect_domains_to_cloudflare",
  "retry_cloudflare_domain",
  "rollback_cloudflare_domain",
  "disconnect_cloudflare",
  "set_cloudflare_proxy",
  "set_cloudflare_zone_settings",
  "create_cloudflare_record",
  "edit_cloudflare_record",
  "delete_cloudflare_record",
];

/** This server's own tools (src/mcp/register.ts OWN_TOOLS), beside the vendor's: what each may do. */
const OWN: Readonly<Record<string, ToolRule>> = {
  // Lists the records (list_dns_records) and writes a zone file to the outbox; changes nothing at Porkbun.
  export_dns_zone: { access: "read" },
};

const moneyRule = (line: (args: ToolArgs) => string): ToolRule => ({ access: "money", summary: (args) => `${dryRunPrefix(args)}${line(args)}` });

const ruleFor = (tool: ToolSpec): ToolRule => {
  const line = MONEY[tool.name];
  if (line !== undefined) return moneyRule(line);
  return tool.annotations.readOnlyHint === true ? { access: "read" } : { access: "write" };
};

/** What is wrong with MONEY and WRITE against this catalog; empty when nothing is. */
export const policyGaps = (catalog: readonly ToolSpec[]): readonly string[] => {
  const names = new Set(catalog.map((tool) => tool.name));
  const readOnly = new Set(catalog.filter((tool) => tool.annotations.readOnlyHint === true).map((tool) => tool.name));
  const money = Object.keys(MONEY);
  const unclassified = catalog.filter((t) => !readOnly.has(t.name) && !Object.hasOwn(MONEY, t.name) && !WRITE.includes(t.name)).map((t) => t.name);
  const gaps = [
    [`not read-only and in neither MONEY nor WRITE`, unclassified],
    [`in both MONEY and WRITE`, WRITE.filter((name) => Object.hasOwn(MONEY, name))],
    [`in WRITE but read-only by the vendor's own hint (drop them)`, WRITE.filter((name) => readOnly.has(name))],
    [`named twice in WRITE`, WRITE.filter((name, i) => WRITE.indexOf(name) !== i)],
    [`classified but not offered by the vendor`, [...money, ...WRITE].filter((name) => !names.has(name))],
    [`checked against a monthly cap (src/domain/charges.ts) but not money`, Object.keys(CHARGED_NOW).filter((name) => !Object.hasOwn(MONEY, name))],
    [`this server's own but also the vendor's (rename ours)`, Object.keys(OWN).filter((name) => names.has(name))],
  ] as const;
  return gaps.filter(([, tools]) => tools.length > 0).map(([what, tools]) => `${what}: ${tools.join(", ")}`);
};

/** The policy for the vendor's catalog; throws, stopping the server, when MONEY and WRITE do not fit it. */
export const policyFor = (catalog: readonly ToolSpec[]): ToolPolicy => {
  const gaps = policyGaps(catalog);
  if (gaps.length > 0) throw new Error(`porkbun: src/mcp/policy.ts does not fit the vendor's tools; ${gaps.join("; ")}`);
  return { ...Object.fromEntries(catalog.map((tool) => [tool.name, ruleFor(tool)])), ...OWN };
};

/** The hand-kept lists, for the tests that check them against the vendor. */
export const CLASSIFIED = { money: Object.keys(MONEY), write: WRITE, own: Object.keys(OWN) } as const;
