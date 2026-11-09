---
"@foreverworks/mcp-devices": minor
---

An Android host no longer needs an `ssh` target. Leave it out of a host that has a `control` command, and the broker runs that command on its own machine (as a program and its arguments, with no shell), so emulators that run as containers behind an API can be brokered by a command that calls it. The control command gets a fourth call for such a host, `<control> probe`, which prints the host's available memory in KiB, its 1-minute load and what `status` prints, in three sections separated by a line holding `@@devices@@`. Every other host still needs `ssh`, and a catalog where every host has one behaves exactly as before. The README's control command section states the contract.

An Android device whose `adb.serial` is `<IPv4>:<port>`, and that has no `probe`, is a network device: the broker connects it to its adb server while it waits for the emulator to boot (after clearing a stale entry), and disconnects it after it stops the emulator. Serials such as `emulator-5554` behave as before.
