# @foreverworks/mcp-home-assistant

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

- ad0d6fc: No change to the server. This version is the first published by the repository's release workflow through npm's trusted publishing, with no npm token anywhere; `npm view` names GitHub Actions as its publisher.

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Your Home Assistant from your AI assistant, over Home Assistant's own REST and WebSocket APIs with a long-lived access token: the instance's health, entities and their states, areas with their devices and entities, state history and the logbook over a window, the actions it offers with their fields, templates rendered by Home Assistant itself, and running actions.

Its `write` tools run actions: `call_action`, and `call_action_confirmed`, which you approve before every call. Actions on locks, alarm panels, covers and valves (or the domains `HOME_ASSISTANT_CONFIRM_DOMAINS` names) go only through `call_action_confirmed`. Nothing here moves money: no tool is `money`.

A token Home Assistant refuses is never sent again, because Home Assistant counts each refusal as a failed login and can ban the address. A token of a user who is not an administrator is the recommended choice: everything works with it except `render_template` and the actions Home Assistant keeps for administrators, which the server refuses itself without sending them.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
