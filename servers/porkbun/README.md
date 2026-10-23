# <img src="icons/icon.svg" width="36" height="36" alt="Porkbun icon"> Porkbun MCP server

Run your [Porkbun](https://porkbun.com) account from your AI assistant: find
and register domains, edit DNS and DNSSEC, publish a static site, transfer a
domain in or move its DNS to Cloudflare, set up mailboxes and webhooks, and
read invoices. The tools are Porkbun's own
([`@porkbunllc/mcp-server`](https://www.npmjs.com/package/@porkbunllc/mcp-server)),
plus a zone file export, with [safety around them](#other-servers-for-porkbun).
Every tool that spends money, commits to a charge, changes a domain's owner
or hands out a secret is `money`: your client asks you first, and a charge
over the account's monthly API limit is refused before it reaches Porkbun.

**You need** a Porkbun account and an API key pair (`pk1_...` and `sk1_...`),
each half in a file, with API access turned on for the domains it should
manage. Purchases are paid from account credit, or by your card through
Stripe Link. To save a file (a certificate, an invoice PDF, a zone file, a
mailbox password), the server also needs a directory to save into.

## What you can ask

- "Which of my domains expire in the next three months, and which of those
  have auto-renew off?"
- "Is talonbakery.com available? If it costs less than $15 a year, register
  it."
- "Back up the DNS of example.com, then point shop.example.com at
  203.0.113.10."
- "Publish the site in ./dist to example.com's static hosting."
- "If I moved example.org to my Cloudflare account, which DNS records would be
  dropped?"
- "Save last month's Porkbun invoice as a PDF."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=porkbun&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22porkbun_api_key_file%22%2C%22description%22%3A%22Path%20of%20a%20file%20holding%20your%20Porkbun%20API%20key%20(pk1_...).%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22porkbun_secret_api_key_file%22%2C%22description%22%3A%22Path%20of%20a%20file%20holding%20your%20Porkbun%20secret%20API%20key%20(sk1_...).%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22porkbun_outbox_dir%22%2C%22description%22%3A%22Optional.%20Where%20the%20tools%20that%20save%20a%20file%20(an%20SSL%20bundle%2C%20an%20invoice%20PDF%2C%20a%20DNS%20zone%20export%2C%20a%20new%20mailbox's%20password)%20write%20it.%20Without%20it%20those%20tools%20answer%20with%20a%20configuration%20error%3B%20every%20other%20tool%20works.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-porkbun%22%5D%2C%22env%22%3A%7B%22PORKBUN_API_KEY_FILE%22%3A%22%24%7Binput%3Aporkbun_api_key_file%7D%22%2C%22PORKBUN_SECRET_API_KEY_FILE%22%3A%22%24%7Binput%3Aporkbun_secret_api_key_file%7D%22%2C%22PORKBUN_OUTBOX_DIR%22%3A%22%24%7Binput%3Aporkbun_outbox_dir%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=porkbun&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLXBvcmtidW4iXSwiZW52Ijp7IlBPUktCVU5fQVBJX0tFWV9GSUxFIjoiJHtlbnY6UE9SS0JVTl9BUElfS0VZX0ZJTEV9IiwiUE9SS0JVTl9TRUNSRVRfQVBJX0tFWV9GSUxFIjoiJHtlbnY6UE9SS0JVTl9TRUNSRVRfQVBJX0tFWV9GSUxFfSIsIlBPUktCVU5fT1VUQk9YX0RJUiI6IiR7ZW52OlBPUktCVU5fT1VUQk9YX0RJUn0ifX0%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-porkbun.mcpb)

> [!NOTE]
> `@foreverworks/mcp-porkbun` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add porkbun -e PORKBUN_API_KEY_FILE="<path to API key file>" -e PORKBUN_SECRET_API_KEY_FILE="<path to Secret API key file>" -- npx -y @foreverworks/mcp-porkbun
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "porkbun": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-porkbun"],
      "env": {
        "PORKBUN_API_KEY_FILE": "<path to API key file>",
        "PORKBUN_SECRET_API_KEY_FILE": "<path to Secret API key file>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:PORKBUN_API_KEY_FILE}` and so on), so set them before you start Cursor. The commands above set only what is required; [Configuration](#configuration) has the rest.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add porkbun -e PORKBUN_API_KEY_FILE="<path to API key file>" -e PORKBUN_SECRET_API_KEY_FILE="<path to Secret API key file>" -- node "$PWD/servers/porkbun/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/porkbun/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `PORKBUN_API_KEY_FILE` | yes, or `PORKBUN_API_KEY` | File holding the API key (`pk1_...`). A file that is named but missing or empty is a `config` failure, never a fallback. |
| `PORKBUN_SECRET_API_KEY_FILE` | yes, or `PORKBUN_SECRET_API_KEY` | File holding the secret API key (`sk1_...`). |
| `PORKBUN_API_KEY`, `PORKBUN_SECRET_API_KEY` | no | The keys themselves, for a local stdio run (the names Porkbun's own server reads). |
| `PORKBUN_OUTBOX_DIR` | for the tools that save a file | Where files are saved, with mode 0640 (the server's user and the directory's group). No default: unset, `get_ssl_bundle`, `get_invoice_pdf`, `export_dns_zone`, and `create_mailbox` or `setup_mailbox` without a `password` answer `config`; every other tool works. |
| `PORKBUN_BASE_URL`, `PORKBUN_DOCS_BASE` | no | Read by Porkbun's package: the API base (default `https://api.porkbun.com/api/json/v3`) and where the documentation tools fetch from (default `https://porkbun.com`). Leave them unset. |
| `PORKBUN_X402_PRIVATE_KEY`, `PORKBUN_X402_MAX_CENTS` | no | Read by Porkbun's package to pay in USDC, which this server does not offer. Never set them. |

The keys are read on the first call that needs them, so the documentation
tools (`read_doc`, `search_docs`, `list_doc_topics`), `get_pricing` and
`mock_call` work without them. The keys are never logged or returned: the
audit line carries no arguments or results.

A deployment that limits egress sets
`MCP_EGRESS_ALLOW=api.porkbun.com,porkbun.com`. `deploy_site` and
`import_dns_records` read files from `MCP_FILE_ROOTS`. Both, and the other
variables every server shares, are in
[docs/configuration.md](../../docs/configuration.md).

### Getting the API key pair

1. Sign in at [porkbun.com](https://porkbun.com) and open
   [API Access](https://porkbun.com/account/api).
2. Create a key for this server alone, so you can restrict and revoke it on
   its own. Porkbun shows the secret key once: copy both halves now.
3. Optionally restrict the key (there, or later with the gear icon next to
   it): **Allowed IPs**, **Allowed domains**, and **Permissions** (Full
   access, Read-only, **Manage, but no purchases**, or custom scopes). A call
   outside them fails and changes nothing.
4. Save each half in a file readable only by you (`chmod 600`), and point
   `PORKBUN_API_KEY_FILE` and `PORKBUN_SECRET_API_KEY_FILE` at them.
5. Turn on API access for the domains: **Opt In All Domains** on the same
   page, or each domain's **API Access** under Domain Management. Without it,
   every call on that domain fails.

## First run

1. Ask your assistant to run Porkbun's `ping`. It checks the connection and
   the key pair, and shows the key's scopes.
2. Ask for the API spend settings (`get_api_settings`) and the balance
   (`get_balance`): what the account may still spend this month, and the
   credit a purchase is paid from.
3. Purchases and top-ups need a verified email and phone. If a call answers
   `VERIFICATION_REQUIRED`, the assistant sends each code
   (`send_email_verification_code`, `send_phone_verification_code`) and you
   read it back to confirm.

## Tools

**read** changes nothing; **write** changes the account, its DNS or its
hosting, but spends nothing and hands out no secret; **money** spends or
commits money, changes a domain's owner, or hands out a secret, and your
client asks you before each call.

113 tools: 54 read, 39 write, 20 money, generated from the running server
because they follow Porkbun's package. Each row is the first sentence of the
tool's description: Porkbun's, amended where this server differs, or this
server's own for `deploy_site`, `get_ssl_bundle`, `get_invoice_pdf` and
`export_dns_zone`.

<!-- tools:begin -->
| Tool | Access | What it does |
|---|---|---|
| `buy_closeout` | **money** | **Spends account credit, or pays directly by card (`pay_with_card`).** Buys a closeout at its current price and claims the name. |
| `cancel_transfer` | **money** | **Cancels a paid inbound transfer and refunds the order.** Confirm with the user first. |
| `check_domain` | read | Check whether a single domain is available for registration and what it costs. |
| `check_domains` | read | Check up to 25 domains for availability and price in ONE call. |
| `configure_auto_topup` | **money** | Set the top-up amount, and/or turn auto top-up on or off. |
| `confirm_email_verification` | write | Verify the account's email address with the code from the verification email (`send_email_verification_code`, or any verification email from the last 3 days). |
| `confirm_phone_verification` | write | Verify the account's phone number with the code the user received from `send_phone_verification_code`. |
| `connect_domains_to_cloudflare` | write | Queue domains to move into the customer's own Cloudflare account: Porkbun creates the zone there, copies over the DNS records it holds, and repoints the registry nameservers at Cloudflare. |
| `create_cloudflare_record` | write | Create a DNS record in a domain's Cloudflare zone. |
| `create_dns_record` | write | Create a DNS record on a domain in the authenticated account. |
| `create_dnssec_record` | write | Submit a DNSSEC DS record to the registry for a domain. |
| `create_email_forward` | write | Forward an address at the domain (e.g. |
| `create_glue_record` | write | Create a glue record for a host on a domain. |
| `create_hosting` | **money** | Provision hosting for a domain in the account: Secure Static Hosting OR Cloud for WordPress (a managed WordPress site), chosen by `sku`. |
| `create_mailbox` | **money** | **Spends account credit, or pays directly by card (`pay_with_card`).** Buy one email hosting mailbox ($36.00 a year, renewing automatically; the current price is `price` in `list_mailboxes`) and set it up in the same call. |
| `create_url_forward` | write | Add a URL forwarding rule for a domain. |
| `create_webhook` | **money** | Register a webhook endpoint. |
| `create_wp_credentials` | **money** | CLOUD FOR WORDPRESS ONLY. |
| `delete_cloudflare_record` | write | Delete a DNS record from a domain's Cloudflare zone. |
| `delete_dns_record` | write | Delete a single DNS record by its numeric `record_id` (obtained from `list_dns_records`). |
| `delete_dnssec_record` | write | Remove a DNSSEC DS record from the registry for a domain, identified by key tag. |
| `delete_email_forward` | write | Delete one email forward, named by its `address` and `forward_to` (from `list_email_forwards`; an address can forward to several mailboxes, so both are needed). |
| `delete_glue_record` | write | Delete a glue record by host on a domain. |
| `delete_hosting` | write | Deprovision (cancel) Secure Static Hosting for a domain; teardown is scheduled by Porkbun. |
| `delete_hosting_file` | write | Delete a file or directory at `path` in a domain's Secure Static Hosting space. |
| `delete_url_forward` | write | Delete a URL forwarding rule by its `id` (obtained from `list_url_forwards`). |
| `delete_webhook` | write | Delete a webhook endpoint by id. |
| `delete_wp_credentials` | write | CLOUD FOR WORDPRESS ONLY. |
| `deploy_site` | write | Upload static files to a domain's Secure Static Hosting. |
| `diff_dns_restore_point` | read | Compare a DNS restore point with the live zone before changing anything. |
| `disconnect_cloudflare` | write | Remove this account's stored Cloudflare connection. |
| `edit_cloudflare_record` | write | Update a DNS record in a domain's Cloudflare zone. |
| `export_dns_zone` | read | Save a domain's DNS records as a BIND zone file (RFC 1035) in this server's outbox: every record list_dns_records returns, under `$ORIGIN <domain>.`, host names absolute, MX and SRV with their priority, TXT text quoted in 255-byte strings, each record's notes as a comment. |
| `get_api_settings` | read | Get the account's API spend controls and the limits actually enforced, in cents. |
| `get_auto_topup` | read | Read the account's auto top-up configuration: whether it is on, the balance threshold that triggers it, the amount added, whether a payment method is actually on file, and `effectiveAmount`: what `top_up_account_credit` would charge right now. |
| `get_balance` | read | Get the available account credit balance for the authenticated Porkbun account. |
| `get_closeout` | read | Get one closeout plus `totalPrice`: the binding amount, which is the closeout price plus the registration year that comes with it. |
| `get_cloudflare_connection` | read | Check whether this Porkbun account is connected to a Cloudflare account, and which one. |
| `get_cloudflare_domain_status` | read | Get the Cloudflare move status for ONE domain, including the Cloudflare zone id once created and the nameservers Porkbun replaced (kept so the move can be undone). |
| `get_cloudflare_queue` | read | List every Cloudflare move this account has requested, with per-domain status and message. |
| `get_cloudflare_records` | read | List a domain's LIVE DNS records as Cloudflare holds them, each with its orange-cloud (`proxied`) state and whether it is `proxiable` at all. |
| `get_cloudflare_zone` | read | Get what CLOUDFLARE currently says about a domain's zone (status, paused, its nameservers, activation date) rather than what Porkbun's queue row remembers. |
| `get_cloudflare_zone_settings` | read | Read the Cloudflare zone settings that matter after a move: ssl mode, always_use_https, automatic_https_rewrites, min_tls_version, development_mode, cache_level. |
| `get_contacts` | read | Get the four contacts (registrant, admin, tech, billing) for a domain in the authenticated account, with their current field values (name, organization, address, phone, email). |
| `get_domain` | read | Get the metadata for a single domain in the authenticated account: status, TLD, create date, expire date, security lock, WHOIS privacy, auto-renew, API access opt-in, and (optionally) labels. |
| `get_hosting` | read | Get Secure Static Hosting status for a domain (plan, server, trial, expiry, auto-renew), or null if the domain has no hosting. |
| `get_invoice` | read | Get one invoice as data: who it is billed to, how it was paid (card brand and last four only), each line with its product, term, resulting domain expiry and status, and the gross, refunded and net totals in cents. |
| `get_invoice_pdf` | read | Save an invoice PDF, the same document as Download PDF on porkbun.com, in this server's outbox. |
| `get_nameservers` | read | Get the current nameservers configured for a domain in the authenticated account. |
| `get_pricing` | read | Get current Porkbun pricing: registration, renewal and transfer prices per TLD in USD. |
| `get_registration_requirements` | read | Get a TLD's registration requirements as JSON Schema. |
| `get_ssl_bundle` | **money** | Save a domain's free Porkbun-issued TLS certificate and its private key in this server's outbox, instead of returning the key. |
| `get_transfer_setup` | read | Report where a held inbound transfer is and what it is waiting on: whether it is held at PENDINGDNS, whether its DNS zone exists, how many records it holds, what the domain currently delegates to, and the next step. |
| `get_transfer_status` | read | Get the status of a specific inbound transfer for a domain. |
| `get_webhook` | read | Fetch a single webhook endpoint by its numeric id, including its signing secret and delivery health (consecutive failures, last success/failure) (its secret is withheld on this server). |
| `get_webhook_delivery` | read | Fetch a single webhook delivery by id, including the full JSON payload that was (or will be) sent and its delivery status. |
| `get_webhook_event_types` | read | List the event types you can subscribe a webhook endpoint to. |
| `import_dns_records` | write | Create many DNS records on a Porkbun domain in one call: the companion to scan_dns_records for keeping a transferred domain working. |
| `list_cloudflare_inventory` | read | List every domain in the account with its Cloudflare eligibility: `state` is eligible / warn / blocked / connected / inprogress, each with a human-readable reason (DNSSEC live, custom nameservers, uses Porkbun hosting, etc). |
| `list_dns_records` | read | List all DNS records for a domain in the authenticated account. |
| `list_dns_restore_points` | read | List the saved versions of a domain's DNS zone, newest first. |
| `list_dnssec_records` | read | List the DNSSEC DS records currently submitted to the registry for a domain. |
| `list_doc_topics` | read | List the available Porkbun API documentation topics. |
| `list_domains` | read | List domains in the authenticated Porkbun account. |
| `list_email_forwards` | read | List the email forwards on a domain: each `address` at the domain and the `forwardTo` mailbox it is delivered to (one address can forward to several). |
| `list_glue_records` | read | List glue records for a domain. |
| `list_hosting_files` | read | List file/directory names under an optional `path` in a domain's Secure Static Hosting space. |
| `list_hosting_plans` | read | List the hosting plans provisionable via the API, with price (cents: pass as `acknowledged_cost_cents` to create_hosting), interval, trial length, and features. |
| `list_invoices` | read | List the account's invoices (one per order), newest first, with each one's date, state (`PAID`, `PARTIALLY_REFUNDED`, `REFUNDED` or `UNPAID`), net total in cents and the domains on it. |
| `list_mailboxes` | read | List a domain's email hosting mailboxes (real inboxes at the domain, read over IMAP/POP or webmail), with `status`, `address`, whether each is the free `trial`, and `expires`. |
| `list_marketplace` | read | Browse domains for sale on Porkbun Marketplace: names other Porkbun customers listed themselves, not new registrations. |
| `list_transfers` | read | List all in-progress and recent inbound domain transfers for the authenticated account. |
| `list_url_forwards` | read | List all URL forwarding rules configured for a domain. |
| `list_webhook_deliveries` | read | List recent webhook delivery attempts (newest first), across all endpoints or filtered to one. |
| `list_webhooks` | read | List the webhook endpoints registered on the authenticated account (its secret is withheld on this server). |
| `list_wp_credentials` | read | CLOUD FOR WORDPRESS ONLY. |
| `make_hosting_dir` | write | Create a directory (and any missing parent directories) at `path` in a domain's Secure Static Hosting space. |
| `mock_call` | read | Get a schema-accurate EXAMPLE response for any API endpoint with NO credentials: nothing to set up. |
| `ping` | read | Verify the Porkbun API connection and credentials. |
| `preflight_domain` | read | Ask whether a change is about to break a domain, BEFORE making it. |
| `prepare_transfer` | write | Create the Porkbun DNS zone for a domain whose inbound transfer is held, so records can be added before the domain moves. |
| `preview_cloudflare_move` | read | Show exactly which DNS records would be copied into Cloudflare for a domain, and which would be dropped, WITHOUT queueing anything. |
| `read_doc` | read | Read a Porkbun documentation page as Markdown. |
| `register_domain` | **money** | **Spends account credit, or pays directly by card (`pay_with_card`).** Registers a new domain on the authenticated Porkbun account. |
| `renew_domain` | **money** | **Spends account credit, or pays directly by card (`pay_with_card`).** Renews an existing domain in the authenticated account. |
| `renew_mailbox` | **money** | **Spends account credit, or pays directly by card (`pay_with_card`).** Add a year to an email hosting mailbox now, at its `renewalPrice` from `list_mailboxes` ($36.00, or a legacy price for mailboxes that still qualify). |
| `resend_webhook` | write | Re-queue a past webhook delivery to its endpoint. |
| `restore_dns_zone` | write | Put a domain's DNS zone back to a saved restore point. |
| `retry_cloudflare_domain` | write | Re-queue a domain whose Cloudflare move failed or was skipped. |
| `rollback_cloudflare_domain` | write | UNDO a completed Cloudflare move: point the domain's nameservers back at Porkbun, restoring the DNS Porkbun still holds. |
| `rotate_webhook_secret` | **money** | Generate a new signing secret for a webhook endpoint and return the endpoint with the new secret. |
| `scan_dns_records` | read | Discover the DNS records a domain currently publishes by querying its live authoritative nameservers. |
| `search_aftermarket` | read | Find registered domains that are FOR SALE on the aftermarket: Afternic, Sedo, Atom, NameBright and DAX listings and auctions, plus Porkbun Marketplace, merged to the lowest price per name. |
| `search_closeouts` | read | Search expired-domain closeouts: names that did not sell at auction and are now offered at a fixed price that descends on a schedule. |
| `search_docs` | read | Keyword-search the full Porkbun API reference and return the most relevant sections (endpoints/topics) as Markdown. |
| `send_email_verification_code` | write | Email a verification code to the email address on the user's Porkbun account, to clear VERIFICATION_REQUIRED (purchases and top-ups need a verified email and phone). |
| `send_phone_verification_code` | write | Text a verification code to the phone number on the user's Porkbun account, to clear VERIFICATION_REQUIRED (purchases and top-ups need a verified phone and email, and new accounts are not asked to verify the phone at signup). |
| `set_cloudflare_proxy` | write | Turn the Cloudflare proxy (orange cloud) on or off for a domain's DNS records. |
| `set_cloudflare_zone_settings` | write | Change Cloudflare zone settings for a moved domain. |
| `set_email_password` | **money** | Change the password of an email hosting mailbox (an active one, from `list_mailboxes`). |
| `setup_mailbox` | **money** | Give a waiting mailbox (already paid for, or the free trial that comes with a domain registration) its address and password. |
| `start_transfer` | **money** | Release a held inbound transfer to the registry. |
| `test_webhook` | write | Send a `webhook.test` event to an endpoint to confirm it's reachable and that signature verification works. |
| `top_up_account_credit` | **money** | **Charges the user's saved payment method** (`amount_cents` is integer cents: 803 charges $8.03; tell the user the dollar figure first) and adds the money to their Porkbun account credit immediately. |
| `top_up_with_card_mpp` | **money** | Get a payment link that adds account credit when paid with the user's CARD over MPP (Machine Payments Protocol), using a Stripe Shared Payment Token from their agent wallet (Stripe's Link Agent Wallet). |
| `transfer_domain` | **money** | **Spends account credit, or pays directly by card (`pay_with_card`).** Initiates a transfer of an external domain into Porkbun. |
| `update_auto_renew` | **money** | Turn auto-renewal on or off for a domain in the authenticated account. |
| `update_contacts` | **money** | Edit a domain's contacts. |
| `update_dns_record` | write | Update an existing DNS record by its numeric `record_id` (obtained from `list_dns_records`). |
| `update_glue_record` | write | Update the IP addresses associated with an existing glue record. |
| `update_nameservers` | write | Replace the nameservers for a domain in the authenticated account. |
| `update_transfer_auth_code` | write | Replace the authorization code on an inbound transfer that stalled because the code was wrong, and re-queue it: instead of cancelling, refunding and resubmitting. |
| `update_webhook` | write | Update a webhook endpoint. |
<!-- tools:end -->

### How a tool is classified

`src/mcp/policy.ts` derives the class where that is safe: a tool Porkbun
marks `readOnlyHint: true` is read. Only `MONEY` and `WRITE` are kept by
hand, each tool named once, and a tool without `readOnlyHint` in neither stops
the server at startup, so a new Porkbun tool that might spend is looked at
before it ships. Email and phone verification is write: the code reaches you,
never the assistant. `export_dns_zone` is read: it lists records and writes a
file.

### Left out

The four sandbox tools (`create_sandbox_key`, `sandbox_topup`,
`sandbox_reset`, `sandbox_trigger_webhook`) answer only to a sandbox key, and
this server holds a live one; Porkbun's own live-key profile leaves them out
too. Four more are left out on purpose (`src/infra/vendor/offer.ts`), with
every purchase's `pay_with_usdc` and `usdc_checkout_id` arguments: a USDC
payment needs a wallet key in the server's environment, or a checkout paid
where this server cannot see it, and an API key handed to the assistant is a
leaked key.

| Tool | Why it is not offered |
|---|---|
| `top_up_with_usdc` | It adds credit in USDC on Base over x402, a crypto payment this server does not make. |
| `get_usdc_topup_status` | It reads a USDC checkout, which nothing here opens. |
| `request_api_key` | Its answer (`requestToken`, `codeVerifier`) is all anyone needs to collect the new live key pair. |
| `retrieve_api_key` | It hands the assistant a live API key pair. |

## Money

Every `money` tool is marked so in `tools/list`, and your client asks you to
approve each call (Claude Code does, in every permission mode). With
`MCP_CONFIRM=elicit` the server asks you itself instead, in one line naming
the action, the domain and the dollars, computed from the integer cents in the
arguments without dividing. A dry run is confirmed too, its line starting
`DRY RUN, no charge:`. For example:

```
porkbun: register example.com for $11.08 from Porkbun account credit
porkbun: turn auto top-up ON: charge the saved card $50.00 whenever credit drops below $10.00
porkbun: DRY RUN, no charge: provision hosting PIXIESECURESTATICM2 on example.com at $3.00 per period, auto-renewing
```

When a call gives two amounts that disagree (`cost_cents` and its legacy
`cost`), the line says so, and Porkbun's package refuses the call before
anything is sent.

| Tools | Why they are money |
|---|---|
| `register_domain`, `renew_domain`, `buy_closeout`, `transfer_domain` | Spend account credit, or your card through Stripe Link. |
| `create_mailbox`, `renew_mailbox` | Buy a year of an email mailbox, renewing automatically. |
| `create_hosting` | A subscription: a 15-day trial on a domain's first provision, then the plan's price at every renewal; a re-provision charges at once. |
| `top_up_account_credit`, `top_up_with_card_mpp` | Charge the saved card now, or open a link that charges your card through Stripe Link once you approve it. |
| `configure_auto_topup` | Lets the card be charged whenever the balance runs low. |
| `update_auto_renew` | On, a charge at every expiry; off, the domain lapses. |
| `start_transfer`, `cancel_transfer` | Release a paid, held transfer (the domain leaves its registrar), or withdraw one and refund its order. |
| `update_contacts` | A registrant change makes a new owner of record. |
| `get_ssl_bundle`, `setup_mailbox` | Save a private key or a generated mailbox password in the outbox, where whoever reads it holds the secret. |
| `create_wp_credentials` | Mints a WordPress application password, shown once; the `administrator` role can run code. |
| `set_email_password` | Every mail app signed in with the old password stops. |
| `create_webhook`, `rotate_webhook_secret` | Hand out an endpoint's signing secret; a rotation stops the receiver's old one from verifying. |

### The monthly caps, checked first

Porkbun caps an account's API purchases (a spend limit) and the credit added
over the API (a top-up limit) per calendar month. Each is the account
holder's own figure, $100 when they set none, or no cap at all. Porkbun
refuses a call over a cap only once it arrives, so before `register_domain`,
`renew_domain`, `transfer_domain`, `buy_closeout`, `create_mailbox`,
`renew_mailbox`, `top_up_account_credit` and `top_up_with_card_mpp` this
server reads the caps (`get_api_settings`) and refuses a charge over what is
left:

```json
{"error": {"kind": "over_limit", "code": "MONTHLY_SPEND_LIMIT_EXCEEDED", "cap": "spend",
  "message": "register_domain would charge $11.08, more than the $5.00 left of this month's monthly API spend limit ($100.00, Porkbun's default for an account that set none; $95.00 spent so far); nothing was sent to Porkbun",
  "figures": {"currency": "USD", "charge": "11.08", "limit": "100.00", "used": "95.00", "remaining": "5.00", "source": "default"}}}
```

`code` is what Porkbun would have answered. The amount checked comes from the
same argument as the dollars in the confirmation line
(`src/domain/charges.ts`), so what you approve is what is checked. Within the
cap, the call goes to Porkbun as given, and Porkbun's own check still runs.
Left to Porkbun: a dry run (which reports the cap itself), `create_hosting` (a
first provision is a free trial, a re-provision is charged, and the arguments
do not say which), a top-up without `amount_cents`, and `configure_auto_topup`
and `update_auto_renew`, which charge later. Caps that cannot be read refuse
the charge rather than guess.

### Secrets in results

Outside `money` tools, every secret field in a result is replaced by a note:
the fields Porkbun hides on its own app-directory connection (`redactKeys` in
its `profiles.js`, today `secret`). That matters for `list_webhooks` and
`get_webhook`, which Porkbun marks read-only but which return each endpoint's
signing secret. A secret leaves this server only through a call your client
asked you to approve; the account holder also sees it at
porkbun.com/account/api. A password you pass in a call goes through the
conversation: `set_email_password` needs one, while `create_mailbox` and
`setup_mailbox` can let Porkbun make it. With `MCP_CONFIRM=none` nobody is
asked, and a deployment that sets it accepts that.

## Troubleshooting

**`config`: "no Porkbun API key pair is configured for this server".** Set
`PORKBUN_API_KEY_FILE` and `PORKBUN_SECRET_API_KEY_FILE`
([Getting the API key pair](#getting-the-api-key-pair)).

**`config` naming `PORKBUN_OUTBOX_DIR`.** The tool saves a file and has
nowhere to put it: set the variable to a directory the server may write. A
mailbox call that would generate a password is refused before anything is
bought, since Porkbun shows that password once.

**`api` on one domain while the others work.** The domain has no API access:
turn it on under Domain Management, or Opt In All Domains on the API page.

**`api` with `IP_NOT_ALLOWED`, `DOMAIN_NOT_ALLOWED` or
`INSUFFICIENT_SCOPE`.** The key's own restrictions refused the call. Change
them at [porkbun.com/account/api](https://porkbun.com/account/api).

**`api` with `INSUFFICIENT_FUNDS`.** The credit is short by the amount in the
message. Repeat the call with `pay_with_card: true`, or after a top-up
(`top_up_account_credit`, or
[porkbun.com/account/credit](https://porkbun.com/account/credit)).

**`api` with `VERIFICATION_REQUIRED`.** Verify the account's email and phone
([First run](#first-run), step 3).

**`over_limit`.** Nothing was sent. Only the account holder can raise the
limit, at [porkbun.com/account/api](https://porkbun.com/account/api); until
then, spend less or wait for the next calendar month.

**`input` or `refused`.** This server's own check (a DS digest of the wrong
length, a DKIM key that does not parse), or Porkbun's package (two amounts
that disagree), refused the arguments. The message names what to change;
nothing was sent.

**`bad_bundle`.** The private key Porkbun sent is not the certificate's, so
nothing was saved. Try later; if it persists, download the bundle at
porkbun.com (Domain Management, SSL) and check it.

**`drift`.** Porkbun answered without a field this server reads (a bundle's
`privatekey`, an invoice's `contentBase64`, the caps). Nothing was saved or
charged; please report it.

**`network`** means Porkbun did not answer: retry in a minute. **`egress`**
means a host outside `MCP_EGRESS_ALLOW`, which needs `api.porkbun.com` and
`porkbun.com`.

## How it works

### Wrapped, not ported

Every other server in this repository models its API by hand or from a
published schema. This one wraps Porkbun's package instead, on purpose:

- **Porkbun owns the API.** Its tool descriptions carry its own rules (the
  exact price a registration must echo, how a held transfer avoids an
  outage, what `INSUFFICIENT_FUNDS` means). A port would be a second copy,
  always a little behind.
- **It moves fast.** On npm, 0.22.0 to 0.52.0 took seven weeks.
- **What it lacks is around the tools:** where the keys come from, who may
  call, what is logged, what a client must confirm, how a failure reads.

So the names, descriptions, input schemas, annotations and handlers are
Porkbun's, read from the pinned package at startup (`src/infra/vendor.ts`).
The package ships no type declarations, so each export used is parsed: a
version that changes a shape stops the server rather than run on a guess.
Results are Porkbun's JSON; a failure is
`{ "error": { kind, message, remedy, code?, status? } }`, sorted from
Porkbun's error text in `src/infra/porkbunPort/vendorErrors.ts`. Porkbun's
server instructions are sent at initialize unchanged.

### Files instead of typed bytes

Ten Porkbun tools are wrapped (`WRAPPED` in `src/mcp/register.ts`), each
checking at startup that Porkbun's tool still takes what the wrapper sends.
Four keep bytes out of the model's hands:

- **`deploy_site`**: Porkbun's tool takes each file as base64 in the
  arguments, where one wrong character publishes a broken asset unnoticed.
  Here a file is `{ path, local_path }` (inside the server's file roots) or
  `{ path, content_base64, sha256 }` (written by a script, the hash checked),
  at most 10 MB. The answer adds `sent_files`, each file's sha256 and size as
  sent; a file that cannot be read or does not match uploads nothing.
- **`get_ssl_bundle`**: the private key must belong to the leaf certificate,
  and both are saved as `<domain>.fullchain.pem` and `<domain>.privkey.pem`
  (in `save_dir`, a folder of the outbox, if given). The answer gives each
  file's path, size and sha256, and the certificate's subject, names,
  issuer, validity and fingerprint.
- **`get_invoice_pdf`**: Porkbun's base64, tens of thousands of characters, is
  decoded strictly, must start like a PDF and match the size Porkbun states,
  and is saved under Porkbun's file name. Porkbun's other fields stay, the
  15-minute `downloadUrl` among them.
- **`create_mailbox` and `setup_mailbox`**: a password Porkbun generates is
  saved as `<address>.password`, and the answer's `password` says where,
  never what. Move it to a password manager and delete the file.

The certificate, the invoice and a zone file are linked in the result (a
`resource_link`), so a client can open them without reading the JSON; a
mailbox password deliberately is not.

### Checks before sending

- **`create_dnssec_record`**: a DS record that does not match the zone's key
  breaks the domain for every validating resolver. Given `dnskey` (the line a
  signer prints), the DS is computed here (RFC 4034 5.1.4), after cheap
  checks of the key: an ECDSA key must be on its curve, an Ed25519 or Ed448
  key the right length, an RSA modulus 512 to 4096 bits. Typed DS fields must
  agree, and so must Porkbun's four `keyData*` fields. Without a key, the
  fields are checked for shape (key tag, algorithm, digest type, a hex digest
  of 40, 64 or 96 characters). Tested against the examples in RFC 4034, 4509
  and 6605.
- **DKIM and SPF**, in `create_dns_record`, `update_dns_record` and every
  record of `import_dns_records`: a `v=DKIM1` record must hold a key that
  parses (RSA of 1024 bits or more, or a 32-byte ed25519 key; an empty `p=`
  revokes). A `v=spf1` record must have no obvious mistake: an unknown
  mechanism, a bad address or prefix, an include without a domain, a term
  after `all`, a second `v=spf1` or `redirect=`, more than ten lookups.
- **`import_dns_records`** also takes `records_file` (a JSON array) or
  `zone_file` (below) instead of records typed inline, parsed with Porkbun's
  own record schema; the answer adds the file's sha256, size and count.
- **`update_nameservers`** checks each name (RFC 1123, fully qualified, not an
  IP address, no duplicates) and answers with `nameservers: { before, after }`.

### Zone files

`export_dns_zone` saves what `list_dns_records` returns as `<domain>.zone`
(RFC 1035) and answers with its path, size, sha256 and a count per type: a
backup before a large change, a zone to compare over time or move to another
DNS host. Owners are relative to `$ORIGIN <domain>.`, and there is no SOA
(Porkbun serves its own). The same records always give the same bytes, so two
exports compare with `diff`.

`import_dns_records` with `zone_file` reads such a file, or another host's
export: `$ORIGIN`, `$TTL` with units, `@`, relative names, a blank owner,
parentheses, comments and escaped quoted strings. SOA, NS and DNSSEC signing
data are set aside and listed in `zone_file.ignored`. Nothing is imported in
part: the whole file is refused, with every problem and its line, for a name
outside the domain, a type Porkbun cannot hold (it takes A, AAAA, CNAME,
ALIAS, MX, TXT, SRV, CAA, TLSA, SSHFP, HTTPS and SVCB), a class other than
IN, `$INCLUDE`, `$GENERATE` or a line that does not parse.

### Updating the pinned version

`package.json` pins `"@porkbunllc/mcp-server": "0.52.0"` exactly. It also
brings `@x402/core`, `@x402/evm` and `viem`, loaded only to sign a USDC
payment this server never asks for. Porkbun keeps no changelog: each version
is a commit whose subject starts with the version, in
[oborseth/Porkbun-MCP](https://github.com/oborseth/Porkbun-MCP/commits/main).

1. Read those commits and the published diff
   (`npm diff --diff=@porkbunllc/mcp-server@0.52.0 --diff=@porkbunllc/mcp-server@<new>`),
   above all every new or changed description: a tool that spends, charges a
   card or returns a secret goes in `MONEY`, whatever its annotations say. A
   new way to pay, or a tool that hands out a key, is a question for
   `offer.ts`; a version that offers USDC in words it does not recognise
   stops the server at startup.
2. `npm install -w @foreverworks/mcp-porkbun --save-exact @porkbunllc/mcp-server@<new>`
3. `npm run check`, then `npx tsx scripts/check-docs.ts --write porkbun`. The
   policy test fails on an unclassified tool, a stale name, or Porkbun's own
   list of purchase, top-up and secret tools no longer matching the money
   class; `vendorErrors.test.ts` fails on a reworded error message.

`npx tsx scripts/smoke.ts` drives the built server with your key pair,
read-only: `ping`, `list_domains` and `get_balance`, and no write or money
tool, not even as a dry run.

## Limitations

- **Results are relayed, not modelled.** A field Porkbun drops is missing
  from the result, except in `get_ssl_bundle`, `get_invoice_pdf` and the caps
  read before a charge, where it is `drift`.
- **The checks catch a lost character, not every changed one.** A changed
  character inside an RSA key (DKIM, DNSKEY) still parses as some key, while
  an ECDSA key almost always falls off its curve. Prefer `dnskey`, which
  removes the typed digest altogether. The DS is computed for SHA-1, SHA-256
  and SHA-384; a GOST or SM3 digest is checked for shape only.
- **SPF is checked as written.** An `include` is not followed, and nothing
  here queries DNS. Other record types are Porkbun's to validate, and an
  import driven by a scan imports what Porkbun found without this server
  seeing it.
- **Zone files.** CAA, TLSA, SSHFP, HTTPS and SVCB are kept as written.
  ALIAS, which Porkbun exports, is not a type every DNS server reads. Notes
  become comments on export and are not read back.
- **One live key pair.** The sandbox tools need Porkbun's own server with a
  sandbox key. USDC payments and API key minting are not offered: pay from
  credit or by card, and make keys at
  [porkbun.com/account/api](https://porkbun.com/account/api).

## Other servers for Porkbun

Searched 2026-10-15. Porkbun publishes its own, and it is the one this server
runs:

- **`@porkbunllc/mcp-server`** (`com.porkbun/mcp` in the MCP Registry), by
  Porkbun: stdio, with the key pair in environment variables. Porkbun also
  hosts it over Streamable HTTP, where an OAuth sign-in issues the client its
  own API key (scoped or revocable), with narrower endpoints that leave out
  purchases or top-ups. The account itself adds a monthly spend limit, dry
  runs, and keys limited by IP, domain and permission.

Community servers cover parts of the same API:

- **`porkbun-mcp`** on PyPI: domains, DNS, DNSSEC and SSL, read-only unless a
  variable allows writes.
- **`porkbun-mcp`** on npm: read-only by default.
- **`porkbun-mcp-server`** on GitHub.

This one adds what Porkbun's server leaves to its client: every tool
classified and each money call confirmed in one line ([Money](#money)), the
monthly caps checked before a charge is sent, secrets kept out of results
([Secrets in results](#secrets-in-results)), files by path instead of base64
a model types ([Files instead of typed bytes](#files-instead-of-typed-bytes)),
payloads checked ([Checks before sending](#checks-before-sending)), zone file
export and import ([Zone files](#zone-files)), and a service of its own: keys
in files, and over HTTP a token per client and an audit line per call.

In return, Porkbun's hosted endpoint gives each connection its own key, which
with the account's spend limit is a finer grant than this server's one key
pair.
