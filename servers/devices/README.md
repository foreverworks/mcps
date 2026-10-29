# <img src="icons/icon.svg" width="36" height="36" alt="Device broker icon"> Device broker MCP server

Give several AI agents fair turns on your own Android emulators, iOS
simulators, Mac and Windows desktops, Batocera retro-gaming boxes, and build
slots. An agent gets a lease
with the address its tools use (adb, simctl, ssh), a place in a fair queue, or
the reason nothing can serve it (a Mac asleep, a host short of memory). The
broker starts an emulator when its host has room and stops or resets every
device after its lease, but drives none. Its `write` tools change who holds a
device; nothing moves money, and nothing asks for a confirmation.

**You need** your own device hosts (Linux machines with the Android emulator,
Macs with Xcode), reachable over ssh from the broker without a prompt; a
catalog file naming them and their devices; and, for emulators the broker
starts, a small control command on each Android host. There is no account and
no key.

## What you can ask

- "Get me an Android emulator for the next hour to test the sign-up flow."
- "Which devices are free right now, and who holds the iPhone simulators?"
- "Lease an iPhone simulator a Maestro flow can drive, and wait in line if
  they're all taken."
- "Hold my emulator while Ana signs in to the test account, then take it
  back."
- "I'm done with the emulator. Reset it and give it back."
- "The simulator won't boot: quarantine it so nobody else gets it."

## Install

<!-- install:begin -->
> [!NOTE]
> Device broker is one of this repository's [extras](../../README.md#extras), which run from a clone and are not published to npm, the MCP Registry or as desktop bundles. Run it on Node 22.19 or newer.

With Claude Code:

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add devices -e DEVICES_CATALOG_FILE="<path to Device catalog>" -- node "$PWD/servers/devices/dist/index.js"
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON, with the full path of `servers/devices/dist/index.js` in your clone:

```json
{
  "mcpServers": {
    "devices": {
      "command": "node",
      "args": ["<path to the clone>/servers/devices/dist/index.js"],
      "env": {
        "DEVICES_CATALOG_FILE": "<path to Device catalog>"
      }
    }
  }
}
```

[Configuration](#configuration) says what it holds. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

Agents that share devices must share one broker, over HTTP (`MCP_HTTP_PORT`,
[docs/configuration.md](../../docs/configuration.md#transport)), each client
with its own token ([Tenants](#tenants)): the leases live in that one process,
and two brokers would each lease a device the other holds.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `DEVICES_CATALOG_FILE` | yes | The catalog (below). Unset, the broker starts with nothing configured and answers every request that it has no devices. Set to a file that cannot be read or does not validate, it still starts, and every tool answers why as a `config` error. |
| `DEVICES_STATE_DIR` | no | Where `state.json` (leases, queue, quarantines) and ssh's `known_hosts` go; created on first use. Default in [docs/configuration.md](../../docs/configuration.md#conventions). |
| `DEVICES_BOX` | no | The name `status` gives this broker when the catalog has no `box`. Default: the hostname. |

### Reaching the hosts

The broker reaches each host over `ssh` as its own user, with `BatchMode=yes`,
so that user's ssh configuration (a key in `~/.ssh/config`, an agent, or an
identity-based SSH such as Tailscale SSH) must let it in without a prompt.
Host keys are accepted on first contact and pinned in the state directory.

- **An Android host** is Linux with the Android emulator, and a
  [control command](#the-control-command) for the emulators the broker
  starts. The broker reads its memory and load (`/proc/meminfo`,
  `/proc/loadavg`). An emulator without a `probe` is read through an adb
  server on the broker's own loopback at its `adb.port`: run the broker on the
  host, or forward the host's adb server
  (`ssh -N -L 5037:127.0.0.1:5037 builder@android-host.example.com`).
- **An iOS host** is a Mac with Xcode (`xcrun simctl`). The broker reads its
  power (`pmset`), load (`sysctl vm.loadavg`) and simulators, and whether a
  CI job runs or a desktop session is open ([How it works](#how-it-works)).

### The catalog

One JSON file, read at start. Every name, address and number below is
invented.

```json
{
  "box": "broker-1",
  "session_hint": "the output of `show-session-id` (Claude Code's $CLAUDE_CODE_SESSION_ID)",
  "wrappers": { "android": ["apk-run", "flow-run"], "ios": ["sim-run"] },
  "profiles": {
    "android-phone": "Android 14 (API 34) emulator, 1080x2400 at 420 dpi",
    "android-phone-15": "Android 15 (API 35) emulator, 1080x2400 at 420 dpi",
    "ios-phone": "iPhone 16 on the newest installed iOS runtime",
    "ios-watch": "iPhone 16 with an Apple Watch paired, newest iOS and watchOS runtimes",
    "batocera": "Batocera on a VM, a fresh box from the stock image for every lease"
  },
  "default_profiles": { "ios": "ios-phone" },
  "hosts": [
    { "id": "android-host", "label": "the Linux box", "platform": "android", "ssh": "builder@android-host.example.com",
      "spawn_max": 2, "cost_mib": 8192, "reserve_mib": 8192, "builders": 1, "control": "/usr/local/bin/emulator-ctl" },
    { "id": "mac-1", "label": "the Mac mini", "platform": "ios", "ssh": "runner@mac-1.example.com",
      "requires_ac": false, "spawn_max": 1, "builders": 1 }
  ],
  "devices": [
    { "id": "emulator-5554", "platform": "android", "host": "android-host", "profile": "android-phone",
      "mode": "spawn", "maestro": true, "instance": "phone1", "adb": { "port": 5037, "serial": "emulator-5554" },
      "variants": [{ "profile": "android-phone-15", "instance": "phone1api35" }] },
    { "id": "emulator-5556", "platform": "android", "host": "android-host", "profile": "android-phone",
      "mode": "spawn", "maestro": true, "instance": "phone2", "adb": { "port": 5037, "serial": "emulator-5556" } },
    { "id": "batocera-1", "platform": "batocera", "host": "android-host", "profile": "batocera", "mode": "spawn",
      "instance": "bato1", "probe": "unit", "cost_mib": 4096,
      "ssh": { "target": "root@127.0.0.1", "port": 2223, "jump": "builder@android-host.example.com" },
      "screenshot": "ffmpeg -loglevel error -f x11grab -i :0 -frames:v 1 -f image2pipe -c:v png -" },
    { "id": "dev-iphone", "platform": "ios", "host": "mac-1", "profile": "ios-phone", "mode": "fixed", "maestro": true,
      "simulator": { "name": "dev-iphone", "type": "iPhone 16" } },
    { "id": "spare-iphone-1", "platform": "ios", "host": "mac-1", "profile": "ios-phone", "mode": "spawn", "maestro": true,
      "simulator": { "name": "spare-iphone-1", "type": "iPhone 16" },
      "note": "created on first use, shut down after each lease" },
    { "id": "spare-watch-1", "platform": "ios", "host": "mac-1", "profile": "ios-watch", "mode": "spawn", "maestro": true,
      "simulator": { "name": "spare-watch-1", "type": "iPhone 16",
                     "watch": { "name": "spare-watch-1-watch", "type": "Apple Watch Series 10 (46mm)" } },
      "note": "leased only by its profile; the watch is created, paired and shut down with the phone" },
    { "id": "ci-iphone", "platform": "ios", "host": "mac-1", "profile": "ios-phone", "mode": "reserved",
      "simulator": { "name": "ci-iphone", "type": "iPhone 16" }, "note": "CI's own; shown, never leased" }
  ]
}
```

Top level:

| Field | Meaning |
|---|---|
| `box` | The name `status` gives this broker. Default: `DEVICES_BOX`, else the hostname. |
| `note` | For a catalog with no hosts on purpose: said in every answer instead (`"devices are brokered on broker-1"`). |
| `session_hint` | Where an agent on this deployment finds its session id, written into every `session` argument's description. Default: any stable id per agent session. |
| `wrappers` | Per platform (`ios`, `android`, `macos`, `windows`, `batocera`), commands on this deployment that take a lease for their user and renew it on every call. The server's instructions, `acquire`, `renew`, `session` and each grant's `next` name them. Default: none, and no description mentions any. |
| `profiles` | Profile name to a line saying what it is. Every device names one; `acquire` takes one. |
| `default_profiles` | Platform to the profile a request that names none gets. A device of that platform on another profile (a tablet, a phone with a watch) is then leased only to a request that names its profile, so a wrapper asking for a phone never gets one. Must be declared and served by some device of the platform. Default: none, and a request without a profile takes any device of the platform. |
| `forms` | Profile to its form, for a profile that is not its platform's usual device (`{ "wear-os": "watch" }`). A session holds one device per platform and form, so a phone and the watch it pairs with are leased together. Each profile declared. Default: none. |
| `hosts`, `devices` | Below. |

A host:

| Field | Default | Meaning |
|---|---|---|
| `id`, `label` | | A stable id (in build slot names: `builder:ios@mac-1`), and the name reasons use. |
| `platform` | | `android` or `ios`: what its phones and builds are, and how it is probed. A device reached over ssh may sit on either. |
| `ssh` | | The ssh target, `user@host`. Also handed to an iOS lease's holder as `IOS_SIM_MAC`. |
| `requires_ac` | `false` | A Mac laptop: nothing is built on it on battery. (Nothing is ever started on a Mac on battery, whatever this says: it sleeps a minute after it goes idle, so the broker reports it degraded.) |
| `spawn_max` | `0` | How many devices the broker may have started on it at once. |
| `cost_mib`, `reserve_mib` | `0` | Android hosts: what one started device costs, and the `MemAvailable` that must remain after it. `reserve_mib: 0` skips the memory check. |
| `builders` | `0` | Build slots, leased as `builder:<platform>`. |
| `control` | | The absolute path of the control command. Required on a host with devices the broker starts. |
| `isolates` | `false` | Whether each device on it is isolated from the host and from the others (its own uid and network namespace, say). Only such a host may serve a guest tenant. |

A device:

| Field | Default | Meaning |
|---|---|---|
| `id` | | Stable and unique: a serial, a simulator's name. |
| `platform`, `host`, `profile` | | `ios`, `android`, `macos`, `windows` or `batocera`; a declared host of the same platform (devices reached over ssh aside, below); a declared profile. |
| `mode` | | `fixed`: exists and stays, leased as it is. `spawn`: started (an emulator, a VM) or created (a simulator) for a lease, stopped after it. `reserved`: shown, never leased. |
| `maestro` | `false` | Whether a Maestro flow can drive it (`acquire` can ask for one). |
| `adb` | | Android, required: `{ "port", "serial" }`, how its holder reaches it with adb. |
| `instance` | | A started slot (Android, Windows or Batocera, `spawn`), required: the name the host's control command starts and stops, `^[a-z][a-z0-9]{0,15}$`, unique per host. |
| `variants` | | A started slot only: its other system images, `[{ "profile", "instance" }]`, each started instead of `instance` for a lease that asks for its profile. Each profile declared and served once by the slot; each instance unique per host. |
| `probe` | | A started slot only: how the broker tells it has booted, and clears it after a dirty lease. Absent: the adb server at `adb.port` on the broker's loopback. `{ "door": <port> }`: the device's own adbd, through a tunnel at that port on the broker's loopback (one device per port). `"unit"`: the control command's `status` says `active` only once it has booted, for a device whose adbd the broker cannot reach (its data is then not cleared after a dirty lease, and only its own tenant ever gets it). |
| `simulator` | | iOS, required: `{ "name", "type", "watch"? }`, the simulator's name (unique on its Mac, a watch's included) and the device type `simctl create` takes. `watch`, on a `spawn` device only, is `{ "name", "type" }` of a watch the broker creates and pairs with the phone. |
| `ssh` | | A device reached over ssh (`macos`, `windows`, `batocera`), required (and refused on a phone): `{ "target", "port"?, "jump"? }`, how its holder reaches it with ssh. |
| `screenshot` | | A device reached over ssh only: one line, a command that, run on the device over its `ssh` address, writes a PNG of its screen to stdout. Its holder gets it as `address.screenshot` and `DEVICE_SCREENSHOT`. The broker never runs it, and has no default: what grabs a screen depends on what the device runs (`ffmpeg ... -f x11grab` for an X display, in the example above). |
| `cost_mib` | host's | A `spawn` slot that costs its host more or less memory than the host's `cost_mib` (a VM beside emulators). |
| `tenant` | `default` | Whom it serves: `default` or `guest:<id>` ([Tenants](#tenants)). |
| `note` | | One line shown in `status`. |

A `macos` device is a Mac's desktop session: `fixed`, on an `ios` host. A
`windows` VM or a `batocera` box the broker starts is a `spawn` slot with an
`instance` and probe `"unit"`, on an `android` host, the only kind whose probe
reads the control command. The catalog is checked at start against every rule
above; if it breaks one, every tool says which.

### The control command

The broker starts and stops emulators and VMs only through the host's
`control` command, over ssh, so its ssh account needs no other privilege: the
command may hand the request to a privileged service that starts nothing but
its own emulators. It must answer three calls:

| Call | Must answer | Deadline |
|---|---|---|
| `<control> start <instance>` | Exit 0 once the start is under way; it need not wait for the boot (the broker polls for it). Starting a running instance succeeds. A failed instance is reset first (`systemctl reset-failed`), so `status` never reports a failure from before the start. | 90 s |
| `<control> stop <instance>` | Exit 0 once the emulator has stopped (saving a snapshot on the way is fine). Stopping a stopped instance succeeds. | 240 s |
| `<control> status` | Exit 0 and one line per instance, `<instance> <state>`, or `<instance> <state> <result>` where `<result>` is systemd's `Result` for a `failed` unit (`timeout`, `oom-kill`, `exit-code`, `signal`). `active`, `activating`, `deactivating` and `reloading` count as running (and for a `"unit"` probe, `active` must mean booted); anything else (`inactive`, `failed`) is stopped, and `failed` ends a lease still waiting for that instance to boot, with the result as its reason. Lines that do not parse are ignored; a command that prints two columns only gives no result. Run on every probe, once a minute: keep it cheap. | 20 s |

A `batocera` instance is a fresh box on every start: `start` boots it from the
stock image on a new disk (an overlay over the image, say) and `stop` throws
that disk away. The broker stops a box after every lease, so that stop is its
reset, and the next holder never sees what the last one did.

A slot's variants are instances like any other; `status` lists a slot's
`profiles` and the one it `runs`. Only one runs at a time (they share the
slot's serial and ports), so the broker stops any other it saw running before
starting one. A non-zero exit is a failure, and the last lines of stderr are
the reason the broker gives. With one systemd unit per emulator, for example:

```sh
#!/bin/sh
# /usr/local/bin/emulator-ctl: this host's emulators, one unit each (emulator@phone1, ...).
case "$1" in
  start)  systemctl --user reset-failed "emulator@$2" 2>/dev/null
          exec systemctl --user start --no-block "emulator@$2" ;;
  stop)   exec systemctl --user stop "emulator@$2" ;;
  status) for i in phone1 phone1api35 phone2; do
            s=$(systemctl --user is-active "emulator@$i")
            if [ "$s" = failed ]; then echo "$i $s $(systemctl --user show -P Result "emulator@$i")"; else echo "$i $s"; fi
          done ;;
  *)      echo "usage: $0 start|stop <instance> | status" >&2; exit 2 ;;
esac
```

### Tenants

Over HTTP, each client has its own bearer token (`token-<label>` in
`MCP_HTTP_TOKENS_DIR`,
[docs/configuration.md](../../docs/configuration.md#transport)). A token
labelled `guest-<id>` (`<id>` matching `^[a-z][a-z0-9]{1,15}$`) is the tenant
`guest:<id>`; every other label, and a stdio run, is `default`. A label that
starts with `guest` and is not well formed owns nothing. A caller sees and
acts on only its own tenant's devices: another tenant's device, lease or
ticket answers as one that does not exist, and no reason, status line or event
names it. Build slots run as the host's own ssh account, so they belong to the
default tenant. A host's memory is one budget for every tenant.

## First run

1. Ask for the broker's `status`: each host's health, and why one is degraded
   or down. A catalog that did not load says why here.
2. Lease a device, drive it, and release it. From a shell, `scripts/smoke.ts`
   does the same against a running broker (`MCP_URL`, `MCP_TOKEN_FILE`), on
   each platform that is up.

## Tools

**read** changes nothing; **write** changes who holds a device, and may start,
stop or reset one.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether the broker works (catalog loaded, state readable), with each host's last probe; a host that is down is reported, not a fault. |
| `status` | read | Your tenant's hosts and their health, every device and who holds it, build slots, the queue, recent events; with `session`, your own leases and their addresses. |
| `acquire` | write | A device (`ios`, `android`, `macos`, `windows`, `batocera`) or a build slot (`builder:ios`, `builder:android`): granted, queued (a ticket) or unavailable (the reason). Takes a `profile`, `maestro`, `minutes` (default 45, 30 for a build slot, at most 240) and `priority` (`interactive`, or `background` for a loop). A started device is `booting`, then `ready`; `until_booted` waits up to that many seconds (10 to 300) for the boot, reporting progress. A started device whose unit fails before it boots ends its lease, and the session's next `acquire` for that platform answers `failed` with the reason, once. |
| `wait` | write | Long-polls a ticket for up to 50 s (default 45), reporting your place in the queue; claims the grant when the queue reaches it. |
| `renew` | write | Extends a lease you hold to now plus `minutes`, at most 4 h after it was granted. |
| `pause` | write | Hands your device to a person without losing it: the lease holds without your calls for `minutes` (default 60, at most 4 h a call, never past 8 h from the grant), shown as paused with your note, and ends if the pause runs out. Build slots are not paused. |
| `resume` | write | Takes the device back from the person: an ordinary lease again, with 20 minutes from now before it ends unless you call. |
| `release` | write | Ends a lease: `clean` (left as it is), `dirty` (reset) or `broken` (quarantined with your note). |
| `report` | write | Quarantines a wedged device with a note; it does not end your lease. |
| `clear` | write | Returns a quarantined device to service, with a note of what was checked. |

Some tool descriptions are written from the catalog (its wrappers,
`session_hint` and profiles); none names a host.

### Sessions

Every tool that touches a lease takes `session`: 1 to 200 characters naming
one agent session, the same on every call (Claude Code's
`$CLAUDE_CODE_SESSION_ID` is one). It is not MCP's `Mcp-Session-Id`, which
names one connection: a wrapper the agent runs opens its own, calls `acquire`
(or `renew`) with the agent's id, and exports the lease's `address.env`.

- **A lease belongs to the tenant and the session together.** A session holds
  at most one device per platform and form (the catalog's `forms`), and
  asking again returns that lease and extends it. Asking with a profile that
  lease does not run is an `input` failure naming the device and the profile
  it runs: release it, then ask.
- **`renew`, `pause`, `resume` and `release` find a lease** by its `lease` id
  (`ls-<n>`), else by `want`, else they take the session's first lease.
- **The session id is the client's claim, not a credential.** Within one
  tenant, a caller that sends another session's id acts as that session; the
  boundary between tenants is the token.

### What a lease gives its holder

A granted device lease carries `address`, whose `env` its holder exports:

| Platform | `env` |
|---|---|
| Android | `DEVICE_ID`, `ANDROID_SERIAL`, `ANDROID_ADB_SERVER_PORT` (adb reads the last two itself) |
| iOS | `DEVICE_ID`, `IOS_SIM_MAC` (the host's ssh target), `IOS_SIM_DEVICE` (the simulator's UDID, or its name before the broker has seen it), and for a phone with a paired watch `IOS_SIM_WATCH` (the watch's UDID, or its name) |
| macOS, Windows, Batocera | `DEVICE_ID`, `DEVICE_SSH` (an ssh destination), and `DEVICE_SSH_PORT`, `DEVICE_SSH_JUMP` and `DEVICE_SCREENSHOT` where the catalog sets them: `ssh ${DEVICE_SSH_JUMP:+-J "$DEVICE_SSH_JUMP"} -p "${DEVICE_SSH_PORT:-22}" "$DEVICE_SSH"`, and for a screenshot `ssh ... "$DEVICE_SSH" "$DEVICE_SCREENSHOT" > screen.png` |

## Troubleshooting

**`acquire` answers `unavailable`.** Not a failure: the `reason` names every
cause, such as a host down (asleep, off, locked after a reboot), a Mac on
battery or busy, too little free memory, a device quarantined or not
answering, or nothing in the catalog for what was asked. Fix the cause, or
ask for something else.

**`acquire` answers `queued`.** Everything that could serve you is leased,
resetting, or at its host's `spawn_max`: keep calling `wait` with the ticket.

**`acquire` answers `failed`.** The device the broker started for your lease
did not boot: its host's control command reported its unit `failed`, and
`reason` says why in the unit's words
(`batocera-1 did not start: its unit (bato1) failed (timeout)`). The lease has
ended and the device is being stopped; acquire again to get a fresh one. It is
said once, to your session's next `acquire` for that platform within 10
minutes. A device that fails every time needs a look on its host: `status`'s
events record each failure.

**A device stays `booting`.** Ask again (`acquire` returns the same lease with
its state), or pass `until_booted` to wait for the boot in one call.

**A device shows `not answering` in `status`.** A fixed simulator must exist
exactly once by its name on its Mac. A Mac desktop needs someone logged in to
that account; its `why` says so.

**`config`.** The catalog cannot be read or does not validate, or the state
directory is not writable; the message names the rule. Fix it and restart the
broker.

**`input`.** The call names something that does not exist or is not yours (a
lease that ended, a dropped ticket, another session's lease), or a profile
your lease does not run. `status` with your `session` lists what you hold.

**`host`.** A host refused or failed a command the broker sent (ssh, simctl,
adb, the control command). `status` shows its health; a second try after a
minute usually tells a blip from a fault. A stop that failed after a lease is
retried within a minute; a failed reset shows in `status`'s events, to check
by hand.

## How it works

- **A lease ends by itself** after 20 minutes without a call from its holder
  (`acquire` or `renew`; a `wait` counts once granted), or when its time runs
  out, and is then treated as `dirty`. A queued grant never claimed goes back
  clean.
- **A pause is a promise.** The broker drives nothing, so the holder keeps
  it: a paused lease's view says `do not drive it until resume`. The 8-hour
  cap frees a forgotten pause.
- **The queue is fair and forgets the dead:** interactive before background,
  then by arrival. A ticket not polled for 2 minutes is dropped; a grant not
  claimed within 5 minutes passes to the next in line.
- **Placement** (`domain/place.ts`, pure): a free fixed device, else a spawn
  slot on a host with room, else the queue if something will come back, else
  `unavailable` with every reason. Room means `up`, under `spawn_max`, and on
  an Android host `reserve_mib` left after `cost_mib` for each emulator
  started since the last probe, so sessions asking within one minute do not
  all pass on one reading.
- **A Mac is `up`** on AC power, with no CI job running (a GitHub Actions
  `Runner.Worker` process) and a one-minute load of at most 12, since a
  simulator booting beside a CI job can starve the job. Otherwise it is
  `degraded`: it serves its fixed simulators and starts nothing.
- **A lease is `booting`** from its grant, which starts the slot, until the
  probe says it has booted (adb lists it as a `device` with
  `sys.boot_completed` set, or its unit is `active`).
- **A start that fails ends its lease at once.** When a probe begun after the
  broker started the slot finds the lease's instance `failed` (systemd gave up
  on it: a start timeout, an out-of-memory kill, the process exiting), the
  lease ends and the slot is stopped as after any lease, which clears the
  failed unit. An earlier probe does not count: it can still show the last
  run's failure. The slot is not quarantined, since a failed start may be
  transient, and the event log keeps it. The holder's wrapper is still asking
  `acquire` while it waits for the boot, so the session's next `acquire` for
  that platform and form, within 10 minutes, answers `failed` with the
  unit's reason, once, rather than quietly handing it another device;
  `status` and `wait` leave that answer for it.
- **After a lease**, an emulator or VM the broker started is always stopped;
  after a `dirty` one, every third-party app's data is cleared first
  (`pm clear`). A simulator is always shut down, since a booted one costs its
  Mac gigabytes; `dirty` also uninstalls the holder's apps and resets privacy
  grants. A fixed emulator stays running, its apps' data cleared after a
  `dirty` or `broken` lease. The device stays busy until this is done, so the
  queue never hands it on mid-stop.
- **Nothing runs without a lease.** Each tick stops an emulator slot the last
  probe saw running with no lease and no work in progress (once per probe), so
  a host returns to zero emulators whatever started one: a failed stop, a
  broker restart, a hand.
- **Desktops and Batocera boxes.** A `macos` device is present while the
  host's ssh account has a desktop session (`launchctl print gui/<uid>`),
  which the broker never starts or ends. A `windows` VM or a `batocera` box is
  started and stopped like an emulator, but with no adb, `dirty` clears
  nothing on it; a Batocera box needs nothing cleared, since its stop throws
  it away ([the control command](#the-control-command)).
- **Simulators are found by name**, and handed out only when exactly one of
  that name exists on the Mac: with two, a holder may drive the wrong one. A
  spare is created on the newest installed iOS runtime when first granted, and
  deleted after 7 days unused.
- **Paired watches.** Each grant of a spare with a `watch` creates whichever
  of the phone and the watch is missing (the watch on the newest installed
  watchOS runtime) and pairs them unless `simctl list pairs` shows the pair,
  mending one undone by hand; a watch paired with another phone is refused,
  not taken. The holder boots the watch like the phone
  (`simctl boot $IOS_SIM_WATCH`). After every lease, each watch paired with
  the phone is shut down (its apps uninstalled after `dirty`); it is deleted
  with the phone.
- **adb without the adb binary.** The binary starts a server when none
  answers on its port, squatting a port meant for a forward. So the broker
  speaks adb's host protocol over a socket (`infra/adb.ts`), and to a door,
  adb's device protocol straight to the slot's adbd (`infra/door.ts`). A
  door's device must not ask for adb authentication (`ro.adb.secure=0`), so
  the tunnel's own (mutual TLS, say) is the boundary.
- **State** is one JSON file, written whole after each change, one change at
  a time, so concurrent calls cannot lose an update and leases survive a
  restart (work a restart cut short is forgotten). The clock ticks every 15
  seconds; hosts are probed at most once a minute.

## Limitations

- **One broker per set of devices**: its state is one process and one file.
- **Emulators and simulators only**, no physical phones. Android hosts are
  Linux and iOS hosts are Macs. A simulator shares its Mac's network and
  identity, so a Mac serves the default tenant only, unless its catalog entry
  says it `isolates` its devices, which the check takes at its word.
- **An adb server is reached on the broker's loopback only**, never across a
  network: an adb server listening beyond loopback hands its devices to
  anyone.
- **The catalog is read at start**; a change needs a restart.
- **A build slot is only a slot**: the broker counts it, the holder builds.
- **Session ids are not authenticated within a tenant** ([Sessions](#sessions)).

## Other servers for mobile devices

Searched 2026-10-15. Most mobile servers drive a device rather than hand one
out:

- **Drivers** use whatever device is running: `@mobilenext/mobile-mcp`,
  Appium's `appium-mcp`, Maestro's built-in `maestro mcp`.
- **Device clouds** lease their own phones, not yours: BrowserStack
  (`@browserstack/mcp-server`, also hosted), Sauce Labs (a hosted server and
  `sauce-api-mcp`), Firebase (a `run_test` tool in `firebase-tools`), and
  hosted disposable devices from Limrun and AgentCloud. AWS publishes none for
  Device Farm.

Three do share devices among agents:

- **Callstack's `agent-device`** (CLI, MCP and Node API) also drives the
  device. It keeps parallel agents on one machine off each other's simulators
  and emulators, and has a proxy with a bearer token, tenants and leases that
  expire when idle; a busy device is an error, not a queue.
- **`manzanas`** brokers iOS simulators on several Macs with TTL leases, FIFO
  queues, a warm pool and a reset after each lease, over stdio with no
  authentication.
- **`berth`** leases Android emulators on Kubernetes, one Pod per lease, over
  HTTP with a single token.

None of them does all of this in one place: Android emulators on Linux, iOS
simulators on Macs and build slots in one queue; a device started only on a
healthy host with room, and the reason said when nothing can serve; every
device stopped or cleaned after its lease, a wedged one quarantined; each
client's token deciding which devices it sees. This one drives nothing: a
lease gives the address a driver such as Maestro uses. For iOS simulators
alone, `manzanas` is faster to a ready device, with its warm pool, and also
drives it.
