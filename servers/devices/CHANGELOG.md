# @foreverworks/mcp-devices

## 0.2.1

### Patch Changes

- a60e69a: `release` tells the holder only what the broker's after-lease work does. A dirty release used to say "app data cleared, then stopped" for every Android slot with an adb address, even when no clear ran: a slot read through its unit (a guest's, whose door the broker cannot reach) keeps its tenant's data, and one released before it booted had none to clear. The text now comes from the work itself, so those say "stopped", a device with nothing to do says "left as it is", and a device released broken says what was done to it before "quarantined until someone checks it and clears it".
- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.2.0

### Minor Changes

- 887e1cd: An Android host no longer needs an `ssh` target. Leave it out of a host that has a `control` command, and the broker runs that command on its own machine (as a program and its arguments, with no shell), so emulators that run as containers behind an API can be brokered by a command that calls it. The control command gets a fourth call for such a host, `<control> probe`, which prints the host's available memory in KiB, its 1-minute load and what `status` prints, in three sections separated by a line holding `@@devices@@`. Every other host still needs `ssh`, and a catalog where every host has one behaves exactly as before. The README's control command section states the contract.
  
  An Android device whose `adb.serial` is `<IPv4>:<port>`, and that has no `probe`, is a network device: the broker connects it to its adb server while it waits for the emulator to boot (after clearing a stale entry), and disconnects it after it stops the emulator. Serials such as `emulator-5554` behave as before.
- e7aaea9: A new platform, `server`: a throwaway Linux VM for testing what configures a machine (an Ansible play, cloud-init, an installer), started for each lease and thrown away after it, like a Batocera box. Its holder makes a key pair for the lease and passes the public half to `acquire` as `ssh_key`; the broker hands it to the host's control command as a third argument, `<control> start <instance> <key>` (`<type> <base64>`, its comment dropped), and the command authorises it on the server it starts, so only the holder gets in and the key opens nothing once the server is gone. A server lease without a key is refused, and so is a key on any other platform; a session that holds a server and asks again with another key is told to release it first. The lease's address is the server's ssh destination and port (`DEVICE_SSH`, `DEVICE_SSH_PORT`), as for the other devices reached over ssh. A server is always a spawn slot with probe `"unit"`: its control command reports it `active` once it can be reached. Catalogs without one behave as before.
- 321632c: A device reached over ssh may have a second port in its catalog entry, `ssh.fallback_port`: the port the same machine answers on when `port` does not, such as a freshly installed server whose sshd listens on 22 until its configuration moves it to another port. A lease carries it as `DEVICE_SSH_FALLBACK_PORT` in `env` and as `fallbackPort` in the address, beside `DEVICE_SSH_PORT`, and the holder tries the first port and then this one. A fallback port outside 1 to 65535, or equal to the port (or to 22 when none is set), is refused when the catalog loads. Catalogs without one behave as before.

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

The first release. A broker for agents that share a few phones and desktops: leases on the Android emulators and iOS simulators its catalog names, on desktops and Batocera retro-gaming boxes beside them and on build slots, a fair queue when everything is taken, spare devices started within each host's budget, and a plain reason when nothing can serve a request.

A Batocera box is a VM started for each lease from its stock image and thrown away after it, so every holder gets a fresh one. A device reached over ssh may carry the catalog's `screenshot` command, which a lease hands its holder as `DEVICE_SCREENSHOT`: run on the device over ssh, it writes a PNG of the screen to stdout.

A device the broker starts whose unit fails before it boots (a start timeout, an out-of-memory kill) ends its lease at once and is stopped, and the session's next `acquire` for that platform answers `failed` with the unit's reason, once, so a wrapper waiting for the boot sees the failure instead of waiting out its own timeout. The host's control command gives that reason by printing systemd's `Result` after a failed instance's state in `status`; one that prints two columns still works, and the reason then says only that the unit failed.

Its `write` tools change who holds what: `acquire`, `wait`, `renew`, `pause`, `resume`, `release`, `report` and `clear`. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
