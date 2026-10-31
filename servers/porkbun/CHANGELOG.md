# @foreverworks/mcp-porkbun

## 0.1.1

### Patch Changes

- 89e12b7: The Porkbun server's `@x402/core` and `@x402/evm` (through `@porkbunllc/mcp-server`) resolve to 2.29.0, which validates with zod 4.6.7 instead of a zod 3 of its own: zod before 4.6.6 could exhaust memory validating an oversized constrained collection (GHSA-mrhx-c7xc-m3w5). The desktop bundle and a clone built from this repository carry it. Tools and their arguments are unchanged.
- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Porkbun's official MCP tools (`@porkbunllc/mcp-server`, pinned to one version) for domains, DNS, transfers, hosting, mailboxes, webhooks, Cloudflare and the account, served with keys from files, an audit line per call, limits, and files uploaded by path.

Its `money` tools spend money or hand out a secret: `register_domain`, `renew_domain`, `transfer_domain`, `start_transfer`, `cancel_transfer`, `buy_closeout`, `update_auto_renew`, `configure_auto_topup`, `top_up_account_credit`, `top_up_with_card_mpp`, `create_hosting`, `create_mailbox`, `setup_mailbox`, `renew_mailbox`, `set_email_password`, `create_webhook`, `rotate_webhook_secret`, `create_wp_credentials`, `get_ssl_bundle` and `update_contacts`. A client that honours the confirmation mark asks you before every call. A secret one of them makes is saved to the server's outbox, never shown in the answer.

Its `write` tools change DNS records, forwards, glue and DNSSEC records, hosting files, webhooks and the Cloudflare connection, and spend nothing.

`PORKBUN_TOOLSETS` loads only the toolsets a client needs (`dns,forwards`, say), so it is handed those tools and not all 113; unset, it serves every one. In any toolset a purchase stays `money` and is checked against the account's monthly API caps.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
