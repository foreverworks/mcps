# @foreverworks/mcp-smart-home

## 0.1.0

The first release. Infrared remote control through BroadLink RM blasters on the local network, over BroadLink's own local protocol: each blaster's status (online, model, firmware, whether it is locked in BroadLink's app), a catalog of your devices and their buttons, pressing a button by name, and learning a remote's button by pressing it on the real remote.

Its `write` tools send infrared or put a blaster in learning mode: `press`, `learn`, `press_confirmed` and `send_code`. `press_confirmed` (for buttons the catalog marks for approval, such as one that starts heating) and `send_code` (a code not in the catalog) are confirmed with you before every call. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
