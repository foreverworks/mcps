# <img src="icons/icon.svg" width="36" height="36" alt="Smart home icon"> Smart home MCP server

Press the buttons of your TV, heater, fan or air conditioner remote by name
from your AI assistant, through a BroadLink RM infrared blaster on your home
network, and teach it new buttons by pressing them on the real remote. It
talks to the blaster directly over BroadLink's local protocol, with no cloud
account. Nothing moves money, but every press acts on a device in your home:
buttons you mark for approval (anything that can start heating, say) and codes
that are not in your catalog go through `press_confirmed` and `send_code`,
which your client asks you about before every call.

**You need** a BroadLink RM blaster (RM mini 3, RM4 mini, RM4C, RM4 pro and
their kin) set up on your Wi-Fi with BroadLink's app, with Lock device turned
off in the app; its address, ideally reserved on your router; and a catalog
file naming your devices and the code of each button. No account and no key.
Remotes that speak NEC, the protocol most cheap remotes use, are kept as two
bytes per button; others as the timings the blaster measured.

## What you can ask

- "Is the IR blaster online?"
- "Turn the TV volume up three times."
- "Step the heater's level twice, a second and a half apart, so I can read its display."
- "Which buttons does the heater have?"
- "I'm pointing the fan remote at the blaster: learn the button I press."
- "Try NEC command 0x15 on the heater while I watch it."

## Install

<!-- install:begin -->
> [!NOTE]
> Smart home is one of this repository's [extras](../../README.md#extras), which run from a clone and are not published to npm, the MCP Registry or as desktop bundles. Run it on Node 22.19 or newer.

With Claude Code:

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add smart-home -e SMART_HOME_CONFIG_FILE="<path to Catalog file>" -- node "$PWD/servers/smart-home/dist/index.js"
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON, with the full path of `servers/smart-home/dist/index.js` in your clone:

```json
{
  "mcpServers": {
    "smart-home": {
      "command": "node",
      "args": ["<path to the clone>/servers/smart-home/dist/index.js"],
      "env": {
        "SMART_HOME_CONFIG_FILE": "<path to Catalog file>"
      }
    }
  }
}
```

[Configuration](#configuration) says what it holds. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `SMART_HOME_CONFIG_FILE` | yes | The catalog: a JSON file naming the blasters, the devices each one faces, and every button's code (below). It is read again on every call, so an edit takes effect on the next one. |

With it unset the server still starts, and every tool but `health` answers a
`config` error naming it. A deployment that sets `MCP_EGRESS_ALLOW` must allow
each blaster's host, and a sandbox that closes private networks (systemd's
`IPAddressDeny`) must open each blaster's address for UDP. The variables every
server shares are in [docs/configuration.md](../../docs/configuration.md).

### The catalog

```json
{
  "blasters": [
    { "name": "living-room", "host": "192.0.2.10", "mac": "02:00:00:00:00:01" }
  ],
  "devices": [
    {
      "name": "tv",
      "title": "Living room TV",
      "address": "0x04",
      "buttons": [
        { "name": "power", "command": "0x08", "toggle": true },
        { "name": "volume_up", "command": "0x02" }
      ]
    },
    {
      "name": "heater",
      "title": "Fan heater",
      "address": "0x00",
      "note": "On the floor by the window.",
      "interval_ms": 1500,
      "buttons": [
        { "name": "power", "command": "0x46", "toggle": true, "confirm": true, "note": "starts heating" },
        { "name": "swing", "command": "0x09" },
        { "name": "level", "command": "0x0b", "wake": true, "note": "steps the heating level" }
      ]
    }
  ]
}
```

- **A blaster** has a `name`, its `host` (an IPv4 address or a name that
  resolves to one) and, best, its `mac`: then a different device answering at
  that address (after the router handed it to someone else) is noticed instead
  of being sent codes.
- **A device** has a `name`, an optional `title` and `note`, the `blaster`
  facing it (needed only when there are several), and the NEC `address` its
  remote uses. Names are lowercase letters, digits, `-` and `_`.
- **`interval_ms`** on a device is the pause between its presses when a call
  presses more than once and names none: 400 to 10000 milliseconds, 400 when
  unset. Raise it for a device whose display someone reads between presses,
  or one that misses presses that come quickly.
- **A button** has a `name` and either `command`, the NEC command byte, or
  `pulses`, the microseconds `learn` measured for a remote of another protocol.
  A button may carry its own `address`. Bytes are numbers or hex strings
  (`"0x46"`), the way IR code tables print them.
- **`toggle: true`** says the button flips the device between two states.
  Nothing here can read the state back, and every answer about such a button
  says so.
- **`confirm: true`** puts the button behind `press_confirmed`: `press` refuses
  it, and your client asks you before every press. Use it for anything that
  must not happen unattended: heating, a door, a pump.
- **`wake: true`** says the device spends the button's first press waking up
  (its display lights and shows the current setting) and acts only on a
  press that follows while it is awake, as many heaters and fans do. `press`
  then sends one press more, first, and the device's pause after it. If the
  device was already awake, that first press acts too: a call can say
  `wake: false` while the device is still awake from a press a moment ago,
  of this button or of any other, when its display wakes as a whole.

`learn` answers each new button as the entry to add here, so the catalog stays
the one place codes are kept.

### Getting the blaster ready

1. Set the blaster up with BroadLink's app as its instructions say, so it
   joins your Wi-Fi.
2. In the app, open the blaster's settings and turn **Lock device** off.
   Adding the blaster in the app turns it on, and a locked blaster answers
   every request but refuses to open a session (`locked`).
3. Find its address in your router's list of connected devices (its MAC is on
   the box and in the app's device info) and reserve that address for it, so
   it keeps it.
4. Put the address and MAC in the catalog, and call `status`.

## First run

1. Ask for `status`. A good answer says `online: true`, the model (`RM4
   mini`), `locked: false` and a firmware number.
2. Point the remote at the blaster, call `learn` for the device, and press one
   button once while the blaster's LED is lit. Add the entry it answers to the
   catalog under that button's name, then `press` it to check. One button per
   call, with a few seconds between: a press while nothing listens is lost.

## Tools

**read** changes nothing; write sends infrared or puts the blaster in
learning mode; **write** in bold is confirmed with you before every call
([below](#confirmation)).

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether the server works: ok unless the catalog is unusable, a blaster's address answers as another device, or a blaster is locked. A blaster without power is reported (`reachable: false`), not a failure. |
| `status` | read | Each blaster as it answers now: online, model, MAC, the name set in the app, firmware, and whether it is locked. |
| `devices` | read | The catalog: every device, the blaster facing it, its buttons with their codes, which toggle and which need your approval. |
| `press` | write | Presses a device's button by name, 1 to 10 times, `interval_ms` apart, with a wake press first for a button marked `wake`; refuses a button marked `confirm`. |
| `learn` | write | Listens for one press of a remote (5 to 60 s, default 25) and answers its code, the catalog buttons that already send it, and the entry to add. |
| `press_confirmed` | **write** | The same as `press`, for any button, after you approve the call. |
| `send_code` | **write** | Sends an NEC code that is not in the catalog, by address and command byte, 1 to 10 times, `interval_ms` apart: for finding the code of a button the remote lacks. |

### Confirmation

The two bold tools are confirmed like a payment, though nothing is paid: your
client asks you before each call (Claude Code does, in every permission mode).
With `MCP_CONFIRM=elicit` the server asks you itself, in one line computed
from the arguments, for example:

```
smart-home: press "power" on device "heater" by infrared, once
smart-home: press "level" on device "heater" by infrared, 2 times, 1.5 s apart
smart-home: send the untested NEC code 0x00/0x15 once through the blaster facing "heater": the device may do whatever that code means to it
```

How each client asks is in
[docs/security.md](../../docs/security.md#money-and-confirmation).

## Troubleshooting

**`offline`.** The blaster did not answer. A loose USB plug is the usual cause;
with power back it rejoins the Wi-Fi by itself within a minute. Otherwise
check that this machine can reach its address over UDP port 80.

**`locked`.** Lock device is on in BroadLink's app (adding the blaster there
turns it on again). Turn it off in the blaster's settings, then call `status`.

**`identity`.** Another device answers at the blaster's address: the router
gave that address to someone else. Reserve the address for the blaster's MAC,
or correct `host` in the catalog.

**`outcome_unknown`.** The blaster took the code and did not confirm it. It
may have gone out: look at the device before pressing again, because a second
press of a toggle undoes the first. The server never resends a code by itself.

**`needs_confirmation`.** The button is marked `confirm`; call
`press_confirmed`, which asks you first.

**`nothing_learned`.** No remote reached the blaster while it listened. Hold
the remote a hand's width away, pointed at the blaster, call `learn`, then
press once while the LED is lit.

**A button does nothing on the device.** Compare its code with what `learn`
hears from the real remote: codes are compared by what they decode to, never
by their bytes, because two presses of one button differ in their timing.

## How it works

**The protocol.** Each blaster is one UDP port. A hello answers with the
device's type, MAC, name and lock flag; an auth request under the protocol's
public default key opens a session with its own AES key; the commands follow
under that key. Every call opens its own session, so nothing is kept between
calls and a blaster that rebooted is simply asked again. The packets are
byte-identical to python-broadlink's, the library every open integration
follows (the tests hold them to its bytes).

**Sending.** A button's NEC bytes become the frame and one repeat code, the
way the quickest real press looks to a receiver, timed in the blaster's own
unit. That unit was measured from a real blaster's recordings of an NEC remote
(31 us; python-broadlink's 32.84 us is 6% long), so a generated code lands
within a unit or two of what the blaster records from the remote itself. A
code is sent once: if the blaster does not confirm it, the answer says the
outcome is unknown instead of trying again, because a second press of a
toggle undoes the first.

**Spacing presses.** Several presses in one call are separate presses, never
one held button: 400 ms apart by default, longer than an NEC remote's frame
period and the repeat code each press carries. A call's `interval_ms`, else
its device's in the catalog, sets a longer pause, up to 10 s, so someone can
read the device's display between presses or a device that is slow to take
the next one gets it. One call waits at most 20 s between its presses in
all; a longer run is refused before anything is sent, and goes as several
calls. A button marked `wake` gets one press more, first, and the answer
says so (`wake_press`).

**Learning.** The blaster listens in windows of about 25 seconds; the server
opens a new one before the last closes, and asks every second for a captured
code. The capture is decoded as NEC when it is one (leader, 32 bits with the
command's check byte, repeat codes while the button was held) and compared
with the catalog by address and command.

## Limitations

- Infrared only: an RM pro's radio (433 MHz) side is not used.
- Only NEC is decoded; any other protocol is kept as the measured timings,
  which `press` replays as they were heard.
- IR goes one way: nothing here can read whether a device is on, off or how it
  is set.
- A blaster is found by its configured address, not by discovery: a broadcast
  does not cross a router or a VPN, and an address is what a reservation
  keeps stable.
- Setting a blaster up on Wi-Fi, renaming it and locking it stay in
  BroadLink's app.

## Other servers for BroadLink blasters

Searched 2026-10-26 (GitHub, npm, the web). BroadLink publishes no MCP server
and no documentation of its local protocol. Found:

- **`timothystewart6-techno-broadlink-mcp`** (GitHub), generated by a tool
  for a web app named Broadlink; it does not talk to the devices.
- **`node-broadlink`** (npm), a JavaScript library for the devices, not a
  server.
- Home automation hubs drive the same blasters (Home Assistant's and
  openHAB's BroadLink integrations), and Home Assistant can serve its devices
  over MCP, for a home that already runs it.

This one needs no hub: it speaks the blaster's protocol itself, keeps codes as
NEC bytes in a file you can read, refuses unapproved presses of buttons you
mark, and never resends a code the blaster did not confirm.
