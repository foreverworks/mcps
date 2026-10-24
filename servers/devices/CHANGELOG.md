# @foreverworks/mcp-devices

## 0.1.0

The first release. A broker for agents that share a few phones and desktops: leases on the Android emulators and iOS simulators its catalog names, on desktops and Batocera retro-gaming boxes beside them and on build slots, a fair queue when everything is taken, spare devices started within each host's budget, and a plain reason when nothing can serve a request.

A Batocera box is a VM started for each lease from its stock image and thrown away after it, so every holder gets a fresh one. A device reached over ssh may carry the catalog's `screenshot` command, which a lease hands its holder as `DEVICE_SCREENSHOT`: run on the device over ssh, it writes a PNG of the screen to stdout.

A device the broker starts whose unit fails before it boots (a start timeout, an out-of-memory kill) ends its lease at once and is stopped, and the session's next `acquire` for that platform answers `failed` with the unit's reason, once, so a wrapper waiting for the boot sees the failure instead of waiting out its own timeout. The host's control command gives that reason by printing systemd's `Result` after a failed instance's state in `status`; one that prints two columns still works, and the reason then says only that the unit failed.

Its `write` tools change who holds what: `acquire`, `wait`, `renew`, `pause`, `resume`, `release`, `report` and `clear`. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
