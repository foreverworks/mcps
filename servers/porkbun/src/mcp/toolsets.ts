import { toolsetPolicy, toolsetsFrom, type ToolPolicy, type Toolsets } from "@foreverworks/mcp-kit";

/**
 * Toolsets (packages/mcp-kit toolsets.ts): PORKBUN_TOOLSETS, a comma-separated
 * list of the names below, loads only those tools, so a client that edits DNS
 * is not handed 113 tool definitions with every request. Unset, blank or
 * `all` loads every one, which is the server as it always was.
 *
 * Porkbun's package gives its tools no categories, so the table below is
 * ours, by tool name, and nothing is derived from a name's shape. It must name
 * every tool this server offers, and only those: a pin of the package that
 * adds a tool or drops one stops the server at start (toolsetGaps) and fails
 * test/toolsets.test.ts, so a new tool is placed by a person instead of being
 * dropped from every subset, or slipping into one, unseen.
 */

/** The toolsets, in the order a person reads them; the error for an unknown name and the README list them so. */
export const TOOLSET_NAMES = ["domains", "dns", "dnssec", "glue", "forwards", "hosting", "mailboxes", "cloudflare", "transfers", "marketplace", "webhooks", "account", "docs"] as const;

export type Toolset = (typeof TOOLSET_NAMES)[number];

/**
 * In every toolset's place, whatever is loaded. `ping` is the health check:
 * the connection, the key and its scopes, where a person starts and where any
 * failure is diagnosed. Every purchase, in five of the toolsets (domains,
 * transfers, marketplace, mailboxes, hosting), is paid from the balance and
 * counts against the monthly API spend cap, so `get_balance` (whose own
 * description says to call it before offering to buy anything) and
 * `get_api_settings` (which every capped tool's description names) come with
 * any of them. The three weigh 734 tokens together (GPT-4 tokenizer,
 * 2026-10-23), of 44,172 for every tool.
 */
export const ALWAYS: readonly string[] = ["ping", "get_balance", "get_api_settings"];

/**
 * Every other tool, and the toolsets it is in. A tool a sequence needs sits in
 * each toolset whose sequence it is: a transfer's price comes from
 * check_domain and its zone from scan_dns_records and import_dns_records, and
 * preflight_domain is the check before a nameserver change or a DNSSEC key.
 */
export const TOOLSET_OF: Readonly<Record<string, readonly Toolset[]>> = {
  // Finding, buying and keeping a domain.
  check_domain: ["domains", "transfers"],
  check_domains: ["domains"],
  get_pricing: ["domains"],
  get_registration_requirements: ["domains"],
  list_domains: ["domains"],
  get_domain: ["domains"],
  register_domain: ["domains"],
  renew_domain: ["domains"],
  update_auto_renew: ["domains"],
  get_contacts: ["domains"],
  update_contacts: ["domains"],

  // The zone at Porkbun, its history, where the domain delegates, and the certificate Porkbun issues for a domain on its nameservers.
  list_dns_records: ["dns"],
  create_dns_record: ["dns"],
  update_dns_record: ["dns"],
  delete_dns_record: ["dns"],
  scan_dns_records: ["dns", "transfers"],
  import_dns_records: ["dns", "transfers"],
  list_dns_restore_points: ["dns"],
  diff_dns_restore_point: ["dns"],
  restore_dns_zone: ["dns"],
  export_dns_zone: ["dns"],
  get_nameservers: ["dns"],
  update_nameservers: ["dns"],
  preflight_domain: ["dns", "dnssec"],
  get_ssl_bundle: ["dns"],

  // DS records at the registry.
  list_dnssec_records: ["dnssec"],
  create_dnssec_record: ["dnssec"],
  delete_dnssec_record: ["dnssec"],

  // Glue records: nameservers named under the domain they serve.
  list_glue_records: ["glue"],
  create_glue_record: ["glue"],
  update_glue_record: ["glue"],
  delete_glue_record: ["glue"],

  // URL and email forwarding.
  list_url_forwards: ["forwards"],
  create_url_forward: ["forwards"],
  delete_url_forward: ["forwards"],
  list_email_forwards: ["forwards"],
  create_email_forward: ["forwards"],
  delete_email_forward: ["forwards"],

  // Static hosting and Cloud for WordPress.
  list_hosting_plans: ["hosting"],
  create_hosting: ["hosting"],
  get_hosting: ["hosting"],
  delete_hosting: ["hosting"],
  deploy_site: ["hosting"],
  list_hosting_files: ["hosting"],
  delete_hosting_file: ["hosting"],
  make_hosting_dir: ["hosting"],
  create_wp_credentials: ["hosting"],
  list_wp_credentials: ["hosting"],
  delete_wp_credentials: ["hosting"],

  // Email hosting mailboxes.
  list_mailboxes: ["mailboxes"],
  create_mailbox: ["mailboxes"],
  setup_mailbox: ["mailboxes"],
  renew_mailbox: ["mailboxes"],
  set_email_password: ["mailboxes"],

  // Moving DNS to the customer's own Cloudflare account, and the zone there.
  get_cloudflare_connection: ["cloudflare"],
  list_cloudflare_inventory: ["cloudflare"],
  preview_cloudflare_move: ["cloudflare"],
  connect_domains_to_cloudflare: ["cloudflare"],
  get_cloudflare_queue: ["cloudflare"],
  get_cloudflare_domain_status: ["cloudflare"],
  retry_cloudflare_domain: ["cloudflare"],
  rollback_cloudflare_domain: ["cloudflare"],
  disconnect_cloudflare: ["cloudflare"],
  get_cloudflare_zone: ["cloudflare"],
  get_cloudflare_zone_settings: ["cloudflare"],
  set_cloudflare_zone_settings: ["cloudflare"],
  get_cloudflare_records: ["cloudflare"],
  create_cloudflare_record: ["cloudflare"],
  edit_cloudflare_record: ["cloudflare"],
  delete_cloudflare_record: ["cloudflare"],
  set_cloudflare_proxy: ["cloudflare"],

  // Transferring a domain in.
  transfer_domain: ["transfers"],
  get_transfer_setup: ["transfers"],
  prepare_transfer: ["transfers"],
  start_transfer: ["transfers"],
  cancel_transfer: ["transfers"],
  update_transfer_auth_code: ["transfers"],
  list_transfers: ["transfers"],
  get_transfer_status: ["transfers"],

  // Names other people sell: Porkbun Marketplace, the aftermarket, expired-domain closeouts.
  list_marketplace: ["marketplace"],
  search_aftermarket: ["marketplace"],
  search_closeouts: ["marketplace"],
  get_closeout: ["marketplace"],
  buy_closeout: ["marketplace"],

  // Webhooks: endpoints, their secrets, deliveries.
  get_webhook_event_types: ["webhooks"],
  list_webhooks: ["webhooks"],
  get_webhook: ["webhooks"],
  create_webhook: ["webhooks"],
  update_webhook: ["webhooks"],
  rotate_webhook_secret: ["webhooks"],
  test_webhook: ["webhooks"],
  delete_webhook: ["webhooks"],
  list_webhook_deliveries: ["webhooks"],
  get_webhook_delivery: ["webhooks"],
  resend_webhook: ["webhooks"],

  // Account credit and top-ups, verifying the account's phone and email, invoices.
  get_auto_topup: ["account"],
  configure_auto_topup: ["account"],
  top_up_account_credit: ["account"],
  top_up_with_card_mpp: ["account"],
  send_phone_verification_code: ["account"],
  confirm_phone_verification: ["account"],
  send_email_verification_code: ["account"],
  confirm_email_verification: ["account"],
  list_invoices: ["account"],
  get_invoice: ["account"],
  get_invoice_pdf: ["account"],

  // Porkbun's API documentation, and example answers that need no key.
  list_doc_topics: ["docs"],
  read_doc: ["docs"],
  search_docs: ["docs"],
  mock_call: ["docs"],
};

/** The tools of one toolset, in the table's order. */
export const toolsOf = (toolset: Toolset): readonly string[] => Object.keys(TOOLSET_OF).filter((tool) => TOOLSET_OF[tool]?.includes(toolset) === true);

/** What is wrong with ALWAYS and TOOLSET_OF against the tools this server offers (`offered`: the full policy's names); empty when nothing is. */
export const toolsetGaps = (offered: readonly string[]): readonly string[] => {
  const placed = [...ALWAYS, ...Object.keys(TOOLSET_OF)];
  const entries = Object.entries(TOOLSET_OF);
  const gaps = [
    [`offered but in no toolset (place them in src/mcp/toolsets.ts)`, offered.filter((tool) => !placed.includes(tool))],
    [`in a toolset but not offered (drop them)`, placed.filter((tool) => !offered.includes(tool))],
    [`both always loaded and in a toolset`, ALWAYS.filter((tool) => Object.hasOwn(TOOLSET_OF, tool))],
    [`named twice in ALWAYS`, ALWAYS.filter((tool, i) => ALWAYS.indexOf(tool) !== i)],
    [`given no toolset`, entries.filter(([, toolsets]) => toolsets.length === 0).map(([tool]) => tool)],
    [`given one toolset twice`, entries.filter(([, toolsets]) => new Set(toolsets).size !== toolsets.length).map(([tool]) => tool)],
  ] as const;
  return gaps.filter(([, tools]) => tools.length > 0).map(([what, tools]) => `${what}: ${tools.join(", ")}`);
};

/**
 * The toolsets PORKBUN_TOOLSETS names (every one when it is unset, blank or
 * `all`), and the policy of a server that loads them: `full`'s rules for the
 * tools always loaded and those of the loaded toolsets, nothing else. Throws,
 * stopping the server, when the table does not fit `full` or the variable
 * names a toolset there is not.
 */
export const loadToolsets = (full: ToolPolicy, env: NodeJS.ProcessEnv = process.env): { readonly loaded: readonly Toolset[]; readonly policy: ToolPolicy } => {
  const gaps = toolsetGaps(Object.keys(full));
  if (gaps.length > 0) throw new Error(`porkbun: src/mcp/toolsets.ts does not fit the tools offered; ${gaps.join("; ")}`);
  const rulesOf = (tools: readonly string[]): ToolPolicy => Object.fromEntries(tools.flatMap((tool) => (full[tool] === undefined ? [] : [[tool, full[tool]]])));
  const toolsets = Object.fromEntries(TOOLSET_NAMES.map((toolset) => [toolset, rulesOf(toolsOf(toolset))])) as Toolsets<Toolset>;
  const loaded = toolsetsFrom(env, "PORKBUN_TOOLSETS", toolsets);
  return { loaded, policy: toolsetPolicy(rulesOf(ALWAYS), toolsets, loaded) };
};
