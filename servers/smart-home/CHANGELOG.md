# @foreverworks/mcp-smart-home

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
