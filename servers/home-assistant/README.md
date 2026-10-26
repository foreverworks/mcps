# <img src="icons/icon.svg" width="36" height="36" alt="Home Assistant icon"> Home Assistant MCP server

Read your [Home Assistant](https://www.home-assistant.io/)'s entities, areas,
history and logbook from your AI assistant, ask it anything a template can
answer, and run its actions: dim a light, set a thermostat, start a script.
Running an action is the only thing that changes anything, and actions on
locks, alarm panels, covers and valves are approved by you, call by call,
before they run. Nothing here moves money.

**You need** a Home Assistant this machine can reach (on your network or
through its remote address) and a long-lived access token made by an
administrator. There is no account to open and no cost. A wrong token costs a
failed login, and Home Assistant may ban an address after a few, so the
server never sends a refused token twice.

## What you can ask

- "Which lights are on right now?"
- "How did the living room temperature change overnight?"
- "Who or what unlocked the front door this morning?"
- "Which devices are in the hallway?"
- "Dim the kitchen light to 30 percent."
- "Lock the front door." (you approve it first)

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=home-assistant&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22home_assistant_url%22%2C%22description%22%3A%22The%20address%20you%20open%20Home%20Assistant%20at%2C%20such%20as%20http%3A%2F%2Fhomeassistant.local%3A8123.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22home_assistant_token_file%22%2C%22description%22%3A%22Path%20of%20a%20file%20holding%20a%20long-lived%20access%20token%20made%20in%20an%20administrator's%20Home%20Assistant%20profile.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22home_assistant_confirm_domains%22%2C%22description%22%3A%22Optional.%20Action%20domains%20you%20approve%20call%20by%20call%2C%20comma-separated%20(default%20lock%2Calarm_control_panel%2Ccover%2Cvalve%3B%20none%20for%20none).%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-home-assistant%22%5D%2C%22env%22%3A%7B%22HOME_ASSISTANT_URL%22%3A%22%24%7Binput%3Ahome_assistant_url%7D%22%2C%22HOME_ASSISTANT_TOKEN_FILE%22%3A%22%24%7Binput%3Ahome_assistant_token_file%7D%22%2C%22HOME_ASSISTANT_CONFIRM_DOMAINS%22%3A%22%24%7Binput%3Ahome_assistant_confirm_domains%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=home-assistant&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWhvbWUtYXNzaXN0YW50Il0sImVudiI6eyJIT01FX0FTU0lTVEFOVF9VUkwiOiIke2VudjpIT01FX0FTU0lTVEFOVF9VUkx9IiwiSE9NRV9BU1NJU1RBTlRfVE9LRU5fRklMRSI6IiR7ZW52OkhPTUVfQVNTSVNUQU5UX1RPS0VOX0ZJTEV9IiwiSE9NRV9BU1NJU1RBTlRfQ09ORklSTV9ET01BSU5TIjoiJHtlbnY6SE9NRV9BU1NJU1RBTlRfQ09ORklSTV9ET01BSU5TfSJ9fQ%3D%3D) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-home-assistant.mcpb)

> [!NOTE]
> `@foreverworks/mcp-home-assistant` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add home-assistant -e HOME_ASSISTANT_URL="<Home Assistant address>" -e HOME_ASSISTANT_TOKEN_FILE="<path to Long-lived access token file>" -- npx -y @foreverworks/mcp-home-assistant
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "home-assistant": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-home-assistant"],
      "env": {
        "HOME_ASSISTANT_URL": "<Home Assistant address>",
        "HOME_ASSISTANT_TOKEN_FILE": "<path to Long-lived access token file>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:HOME_ASSISTANT_URL}` and so on), so set them before you start Cursor. The commands above set only what is required; [Configuration](#configuration) has the rest.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add home-assistant -e HOME_ASSISTANT_URL="<Home Assistant address>" -e HOME_ASSISTANT_TOKEN_FILE="<path to Long-lived access token file>" -- node "$PWD/servers/home-assistant/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/home-assistant/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `HOME_ASSISTANT_URL` | yes | The address you open Home Assistant at, such as `http://homeassistant.local:8123` or `https://ha.example.com`, without `/api`. A path prefix is kept, for an instance behind a proxy. |
| `HOME_ASSISTANT_TOKEN_FILE` | yes | A file holding the long-lived access token and nothing else (`HOME_ASSISTANT_TOKEN` takes the token itself, for a local run). |
| `HOME_ASSISTANT_CONFIRM_DOMAINS` | no | The action domains you approve call by call, separated by commas. Default `lock,alarm_control_panel,cover,valve`; `none` for none. A value that is not a list of domains refuses every action until it is fixed, so a typo never turns approval off. |

Every call reads these again, so a corrected value takes effect on the next
call without a restart. With them unset the server still starts and lists its
tools, and each tool answers a `config` error naming what is missing.

A deployment that sets `MCP_EGRESS_ALLOW` must allow the host of
`HOME_ASSISTANT_URL` (`homeassistant.local` for the address above): the
server reaches nothing else, over HTTP or its WebSocket. A sandbox that closes
private networks (systemd's `IPAddressDeny`) must open the instance's address
([docs/deploying.md](../../docs/deploying.md)). The variables every server
shares are in [docs/configuration.md](../../docs/configuration.md).

### Getting a long-lived access token

1. Sign in to Home Assistant as an administrator. A user made for the
   assistant is best: the logbook then names it as the cause of what it does.
   It must be an administrator, because Home Assistant renders templates only
   for administrators, and answers anyone else with a 401 that it counts as a
   failed login.
2. Open your profile (your name at the bottom of the sidebar) and its
   **Security** tab.
3. Under **Long-lived access tokens**, select **Create token**, give it a name
   such as "MCP server", and copy the token. Home Assistant shows it once; it
   is valid for ten years unless you delete it there.
4. Save it alone in a file only you can read, and point
   `HOME_ASSISTANT_TOKEN_FILE` at it:

   ```bash
   umask 077 && printf '%s\n' '<the token>' > home-assistant-token
   ```

## First run

1. Ask for `health`. A good answer says `ok: true`, the version,
   `state: RUNNING`, the time zone, `websocket: ok`, and how many entities
   each domain has.
2. Ask what is in an area, or which lights are on, to see `list_areas` and
   `list_entities` at work, then try an action on a light.
3. If `health` answers `auth`, fix the token before anything else: see
   [Troubleshooting](#troubleshooting).

## Tools

**read** changes nothing; write runs an action in your home; **write** in
bold is approved by you before every call ([below](#confirmation)).

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether the server works with the instance: version, state, time zone, whether the WebSocket API signs in, and entities per domain; `ok: false` with the problem. |
| `list_entities` | read | Finds entities by domain, area or words: one row each with id, name, state, unit and area (up to 1,000, default 100). |
| `get_states` | read | The state of up to 50 entities, with their attributes and when they last changed. |
| `list_areas` | read | Every area (or one) with its floor, devices and entities, from Home Assistant's registries. |
| `history` | read | How up to 20 entities' states changed over a window (default the last 24 hours, at most 31 days), keeping the newest changes. |
| `logbook` | read | What happened over a window, optionally for one entity, with what caused each entry: a user, an action, an automation. |
| `list_actions` | read | The actions on offer: every domain's action names, or one domain's actions with their fields. |
| `render_template` | read | Renders a Home Assistant template, with its states and helpers. |
| `call_action` | write | Runs an action on a target (entities, devices, areas, floors or labels) with its data, and answers with the states that changed; refuses one you approve call by call. |
| `call_action_confirmed` | **write** | The same, for any action, after you approve the call. |

### Confirmation

`call_action` refuses, with `needs_confirmation` and before sending anything,
an action that needs your approval:

- an action in one of `HOME_ASSISTANT_CONFIRM_DOMAINS` (`lock.unlock`,
  `cover.open_cover`, `alarm_control_panel.alarm_disarm`, `valve.open_valve`);
- an action of another domain aimed at an entity of one
  (`homeassistant.toggle` on `cover.garage_door`);
- a `homeassistant` action aimed at devices, areas, floors, labels or `all`,
  which can reach any of them.

Those go through `call_action_confirmed`, which is confirmed like a payment,
though nothing is paid: your client asks you before each call (Claude Code
does, in every permission mode). With `MCP_CONFIRM=elicit` the server asks you
itself, in one line computed from the call that will run, a code or a
password shown as `****`:

```
home-assistant: run the Home Assistant action lock.unlock on lock.front_door, with code=****
```

`MCP_MAX_ACCESS=read` turns both action tools off and leaves every read. How
each client asks is in
[docs/security.md](../../docs/security.md#money-and-confirmation).

## Troubleshooting

**`auth`, status 401.** Home Assistant refused the token: it was deleted, its
user was removed, it was copied short, or the user is not an administrator.
Make a new one ([above](#getting-a-long-lived-access-token)) and put it in the
token file. Until the file holds another token or the server restarts, every
call answers `auth` with `sent: false` and sends nothing, because Home
Assistant logs each refusal as a failed login and can ban the address.

**`auth`, status 403.** Home Assistant, or a proxy in front of it, refuses
this machine's address. Usually Home Assistant banned it after failed logins:
remove the address from `ip_bans.yaml` in Home Assistant's configuration
folder, restart Home Assistant, check the token, then restart this server.

**`unreachable`.** Nothing answered at `HOME_ASSISTANT_URL`. Check that Home
Assistant runs and that this machine reaches it: a browser here should open
the same address. The message names what the network said
(`ECONNREFUSED`: nothing listens on that port; `ENOTFOUND`: the name does not
resolve here).

**`unavailable`.** Home Assistant answered with a server error: it is
starting, stopping or restarting. Wait a minute and call `health`.

**`permission`.** The token works, but Home Assistant answers that command
only for administrators. Make the token as an administrator.

**`needs_confirmation`.** The action is one you approve call by call; the
assistant should call `call_action_confirmed`, which asks you first.

**`outcome_unknown`.** The action was sent and no clear answer came back: it
may have run. Look at the entities (`get_states`) before running it again.
The server never sends an action twice by itself.

**`not_found` for an endpoint.** The integration behind `history` or
`logbook` is not loaded. `default_config:` in `configuration.yaml` loads both,
with the recorder.

**`drift`.** Something other than Home Assistant answered, often a proxy's
sign-in page. Point `HOME_ASSISTANT_URL` at Home Assistant itself, or at a
proxy that passes `/api` through with no sign-in of its own.

**A certificate error with `https://`.** The server checks certificates like
a browser does. For an instance with its own certificate authority, give Node
that authority's certificate with `NODE_EXTRA_CA_CERTS`, or use the instance's
`http://` address on a network you trust.

## How it works

**Two APIs.** States, actions, history, the logbook and templates come from
the REST API. The area, floor, device and entity registries exist only on the
WebSocket API, so `list_areas` and `list_entities` open a short session for
them: sign in with the token, send the commands at once, close.

**A refused token is never sent again.** Home Assistant logs every request
with a bad token as a failed login, raises a "Login attempt failed"
notification, and where IP banning is on, bans the address after as few as
one, for good. So a 401 or 403 is answered at once, never retried or renewed,
and the server remembers the refused token by its SHA-256: later calls fail
without a request until the token file changes or the process restarts. Until
a token has been accepted once, requests go one at a time, so a wrong token
costs one failed login rather than one per request a tool had in flight.

**An action is sent once.** A read is tried once more after a network error
or a 502, 503 or 504. An action is not: after a timeout or a server error it
may have run, so the answer is `outcome_unknown`. Home Assistant answers an
action it does not have and one whose data does not validate with the same
bare 400, so after a 400 the server reads the list of actions to say which.

**Credentials stay out of answers.** A camera's `access_token` attribute is
dropped, and the `token=` in proxy addresses such as `entity_picture` is
replaced with `[redacted]`, before a state reaches a model.

## Limitations

- It reads and runs, and does not configure: automations, scripts, scenes,
  dashboards, helpers, integrations and users stay in Home Assistant's own
  interface.
- No live updates: each call reads the current state; nothing subscribes to
  events.
- Approval goes by domain. A script, scene or automation that unlocks a door
  runs as a `script`, `scene` or `automation` action: add those domains to
  `HOME_ASSISTANT_CONFIRM_DOMAINS` if yours do such things.
  `homeassistant.restart` is not approved by default; add `homeassistant` to
  approve every cross-domain action, restarts included.
- One instance per server, with a long-lived token. Home Assistant's OAuth
  sign-in is not used.
- History and the logbook go back only as far as the recorder keeps (10 days
  unless configured otherwise).

## Other servers for Home Assistant

Searched 2026-10-26 (Home Assistant's documentation, GitHub, PyPI, npm, the
web). Found:

- **Home Assistant's own [Model Context Protocol Server](https://www.home-assistant.io/integrations/mcp_server/)
  integration** (since 2025.2): serves the tools of its Assist API at
  `/api/mcp`, signs clients in with OAuth (administrators by default), and
  reaches only the entities exposed to Assist. Its documentation names no
  history, logbook, registries or templates.
- **[ha-mcp](https://github.com/homeassistant-ai/ha-mcp)** (Python): about 90
  tools, among them automations, dashboards, history, traces and backups;
  installed as a custom integration, an add-on, or a process with a token.
- **[hass-mcp](https://github.com/voska/hass-mcp)** (Python): entities,
  actions, history, statistics, the error log and dashboards, with a
  long-lived token.
- **[homeassistant-mcp](https://github.com/tevonsb/homeassistant-mcp)**
  (TypeScript): device control, add-ons and automation configuration.

This one is for a reader who wants a small, read-mostly surface on the same
toolkit as the other servers here: every tool classified read or write,
`MCP_MAX_ACCESS` and per-client ceilings, an audit line per call, the actions
that open a home approved call by call with the exact line, a token Home
Assistant refused never sent again, and egress held to the one instance. It
installs nothing in Home Assistant.
