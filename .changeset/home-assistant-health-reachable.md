---
"@foreverworks/mcp-home-assistant": patch
---

`health` reports a Home Assistant that does not answer at all (switched off, restarting, its machine down, or no route from where the server runs) as `ok: true` with `reachable: false` and what the network said, the way the printer and smart-home servers report a device without power. A monitor that reads `ok` no longer pages while the machine is off on purpose; a refused token, a server error, recovery mode or a WebSocket that fails still make `health` not ok. A Home Assistant that answers says `reachable: true`.
