# @foreverworks/mcp-porkbun

## 0.1.5

### Patch Changes

- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.1.4

### Patch Changes

- e0d83fe: `create_mailbox` and `setup_mailbox` now link the password file they save in the result (a `resource_link`), as `get_ssl_bundle` links its key. A relay on your machine fetches back only the outbox files a result links, so a generated password was unreachable when the server ran elsewhere. The file's name, its mode (0640) and the answer's text are unchanged.

## 0.1.3

### Patch Changes

- c132159: The server's instructions, which your client hands the model at the start of every session, are about half as long, so every session costs less. They now say what the server reaches, the tool to start with, the flows that run across tools, and what the model must know before its first call (what spends money, sends, publishes or acts on something in a home, and what to do when a sign-in is needed). What a tool's own description already says is left to it. Nothing a tool does changes.
  
  porkbun: the vendor's paragraph on publishing a site is now one sentence, and `deploy_site`'s description carries its checks, adding that `list_hosting_files` shows what is already there before an upload replaces it.
- Updated dependencies [75ea94a]
- Updated dependencies [0834240]
- Updated dependencies [64969a3]
- Updated dependencies [4ef1bf8]
- Updated dependencies [7b93f2f]
- Updated dependencies [27f0094]
  - @foreverworks/mcp-kit@0.3.0

## 0.1.2

### Patch Changes

- ad0d6fc: The server now announces its own version when a client connects, as every other server here does. It announced the version of the Porkbun package its tools come from (0.52.0), which a client could not tell apart from this package's.

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
