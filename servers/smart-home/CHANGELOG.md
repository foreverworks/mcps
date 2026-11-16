# @foreverworks/mcp-smart-home

## 0.1.2

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

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Infrared remote control through BroadLink RM blasters on the local network, over BroadLink's own local protocol: each blaster's status (online, model, firmware, whether it is locked in BroadLink's app), a catalog of your devices and their buttons, pressing a button by name, and learning a remote's button by pressing it on the real remote.

Its `write` tools send infrared or put a blaster in learning mode: `press`, `learn`, `press_confirmed` and `send_code`. `press_confirmed` (for buttons the catalog marks for approval, such as one that starts heating) and `send_code` (a code not in the catalog) are confirmed with you before every call. Nothing here moves money: no tool is `money`.

`press`, `press_confirmed` and `send_code` space several presses by `interval_ms` (400 ms by default, up to 10 s, at most 20 s of waiting in one call), and a catalog device can set its own `interval_ms`. A button marked `wake` in the catalog, for a device that spends its first press waking up, gets one wake press first; a call can skip it with `wake: false`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
