# <img src="icons/icon.svg" width="36" height="36" alt="Expo Application Services icon"> Expo Application Services MCP server

Find out from your AI assistant why an Expo app's build, workflow run or store
submission failed, through [Expo Application Services](https://expo.dev/eas)
(EAS): job logs by step, Apple's or Google's error text, a credentials audit,
fingerprints and update channels. It can also cancel builds and runs, submit
an existing build, republish or roll out an update, set the App Store Connect
key a bundle id submits with, and dispatch a workflow. `dispatch_workflow` is
the one `money` tool: your client asks you before each call.

**You need** an Expo account with an EAS project, and an access token in a
file, ideally a robot user's with the Developer role. A dispatch runs a
workflow file from the project's GitHub repository, and its build jobs spend
build credits on your Expo plan.

## What you can ask

- "Why did the last iOS workflow run of @acme/my-app fail?"
- "Does every iOS bundle have a key set for TestFlight submissions, and does
  any certificate expire in the next 30 days?"
- "Run ios-beta.yml on main and tell me when it finishes."
- "Which fingerprints have updates but no build yet?"
- "Promote the latest update on the staging branch to production."
- "Raise the rollout of the latest production update to 50%."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=eas&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22expo_token_file%22%2C%22description%22%3A%22Path%20of%20a%20file%20holding%20an%20Expo%20access%20token.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22eas_project%22%2C%22description%22%3A%22Optional.%20The%20project%20a%20call%20means%20when%20it%20names%20none%2C%20as%20%40account%2Fslug.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-eas%22%5D%2C%22env%22%3A%7B%22EXPO_TOKEN_FILE%22%3A%22%24%7Binput%3Aexpo_token_file%7D%22%2C%22EAS_PROJECT%22%3A%22%24%7Binput%3Aeas_project%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=eas&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWVhcyJdLCJlbnYiOnsiRVhQT19UT0tFTl9GSUxFIjoiJHtlbnY6RVhQT19UT0tFTl9GSUxFfSIsIkVBU19QUk9KRUNUIjoiJHtlbnY6RUFTX1BST0pFQ1R9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-eas.mcpb)

> [!NOTE]
> `@foreverworks/mcp-eas` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add eas -e EXPO_TOKEN_FILE="<path to Expo token file>" -- npx -y @foreverworks/mcp-eas
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "eas": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-eas"],
      "env": {
        "EXPO_TOKEN_FILE": "<path to Expo token file>"
      }
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:EXPO_TOKEN_FILE}` and so on), so set them before you start Cursor. The commands above set only what is required; [Configuration](#configuration) has the rest.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add eas -e EXPO_TOKEN_FILE="<path to Expo token file>" -- node "$PWD/servers/eas/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/eas/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `EXPO_TOKEN_FILE` | yes, or `EXPO_TOKEN` | File holding the Expo access token. It is read again after a 401, so a replaced token works without a restart. |
| `EXPO_TOKEN` | no | The token itself (eas-cli's own name), for a local stdio run. |
| `EAS_PROJECT` | no | The project a call means when it names none and the token sees several: `@account/slug`, a slug or an id. |
| `EAS_PRODUCTION_CHANNELS` | no | Comma-separated channel names whose updates reach real users; default `production`. A republish or a rollout names the ones it reaches. |
| `EXPO_API_URL` | no | The GraphQL endpoint; default `https://api.expo.dev/graphql`. |

`validate_workflow` reads a file given by `path` from `MCP_FILE_ROOTS`. That
and the other variables every server shares (transport, limits, what tools
may do) are in [docs/configuration.md](../../docs/configuration.md).

### Getting a robot user's token

Make a robot user for the server: it belongs to the account rather than to a
person, its role bounds what the server can do, and you can revoke it on its
own. At [expo.dev](https://expo.dev), in the account's settings:

1. Open **Robots** and **Create robot**, with a name that says where it runs.
   Give it the **Developer** role, which is enough for every tool here (build,
   submit, credentials; no billing, no members). **Viewer** limits the server
   to the reads: every write then answers `forbidden`.
2. On the robot, **Create access token**. Expo shows it once: save it in a
   file readable only by you (`chmod 600`).
3. Point `EXPO_TOKEN_FILE` at that file.

Expo access tokens do not expire; to rotate one, replace the file.

## First run

1. Ask your assistant to run the EAS `health` check. It says whether the
   token works, as which actor (ideally a robot user), and the accounts and
   projects it sees.
2. If it sees several projects, set `EAS_PROJECT`, or name the project in
   each request (`list_projects` gives the names).
3. Ask for a credentials audit (`audit_credentials`) to see what is missing
   or about to expire.

## Tools

**read** changes nothing; **write** changes something at EAS or in a store
without spending build credits; **money** spends EAS build credits, and your
client asks you before each call.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | The token is accepted; its actor (ideally a robot user), accounts and visible projects. |
| `list_projects` | read | The projects the token sees, per account: what `project` takes everywhere. |
| `list_builds` | read | Builds, newest first, by platform, status, profile, bundle id or package, commit, fingerprint. |
| `get_build` | read | One build: artifacts, fingerprint, runtime, timings, error; for an ERRORED build the failed step and its line, from the log. |
| `list_workflows` | read | The project's `.eas/workflows` files. |
| `validate_workflow` | read | Checks a workflow file before it runs, at a ref or as a file: valid or not, each problem EAS's validator names, the jobs, and the builds a dispatch would spend credits on. |
| `list_workflow_runs` | read | Runs, newest first, by file, status or ref; each FAILURE run carries `reason`, read from its failed jobs' logs. |
| `get_workflow_run` | read | A run's jobs (type, status, outputs, artifacts) and, when it failed, why per job, with the failed step's tail. |
| `wait_for_run` | read | Waits for a run or a build to end (up to 14 minutes a call), reporting progress, then answers like `get_workflow_run` or `get_build`. |
| `get_job_logs` | read | A job's log by step: every step's result, and one step's last lines (the failed one by default). |
| `list_submissions` | read | Submissions with Apple's or Google's error text (for a workflow's submission it lives on the job, which this reads). |
| `get_submission` | read | One submission, and for an ERRORED one the failed step of its log. |
| `audit_credentials` | read | Per bundle id and package: certificate and profile with expiry, the App Store Connect key for submissions, push key, keystore fingerprints, Play service account; what is missing, expired or expiring in 30 days. |
| `list_fingerprints` | read | Fingerprints, newest first or by hash, with the builds and updates that carry each. |
| `list_updates` | read | Channels and the branches they serve (production marked), and per branch the latest update for each platform and runtime. |
| `cancel_build` | write | Cancels a queued or running build. |
| `cancel_workflow_run` | write | Cancels a run that has not ended. |
| `set_submit_key` | write | Sets or clears the App Store Connect API key EAS submits one bundle id with, by its Apple key id or EAS id; answers with the bundle's audit after. |
| `submit_build` | write | Submits an existing FINISHED build: iOS to App Store Connect, Android to a Play track; refuses one that differs from `expect_version` or `expect_build_number`. |
| `republish_update` | write | Puts an existing update group on a branch again (a rollback or a promotion), uploading nothing; refuses a group of another project, a signed one, one in a rollout, or one not from `expect_commit`. |
| `set_rollout` | write | Raises an update group's rollout to a percentage of its branch's devices; 100 rolls it out to all. The same percentage again changes nothing. |
| `revert_rollout` | write | Ends a rollout by sending its devices back to the update before it; deletes nothing. |
| `dispatch_workflow` | **money** | Runs a workflow file at a git ref the repository already has; its build jobs spend EAS build credits. |

## Money

The only way this server starts a build is a workflow run, so
`dispatch_workflow` is the one `money` tool. It is marked so in `tools/list`,
and your client asks you to approve each call (Claude Code does, in every
permission mode). Before the call, the server reads the workflow file at that
ref from EAS (which runs nothing), and the run starts that revision of the
file, so it runs those jobs even if the branch moves in between. With
`MCP_CONFIRM=elicit` the server asks you itself instead, in one line naming
each build job's platform and profile:

```
eas: Run EAS workflow ios-beta.yml of @acme/my-app at main: builds ios preview (if its condition holds); may spend EAS build credits.
```

The line names no commit: EAS keys a revision by its content and reports the
commit where it first saw that content, not where the ref points now. A file
without build jobs says it spends no build credits.

The other changes spend nothing, so they are `write`, though a republish or a
rollout reaches a branch's devices at their next launch, production included
(each answer names the production channels it reached), and another republish
undoes it.

`submit_build` and `republish_update` take an id the model copies, and a
miscopied one would ship something else unnoticed. So each answer says what
shipped (a build's platform, profile, app version, build number and commit; a
group's project, source branch, commit and message), and each checks what you
expect before sending: `expect_version` and `expect_build_number` for a
build, `expect_commit` (a prefix of 7 or more characters) for a group. A
group from another project is always refused.

## Troubleshooting

**`config`: "neither EXPO_TOKEN_FILE nor EXPO_TOKEN is set".** Give the
server a token ([Getting a robot user's token](#getting-a-robot-users-token)).

**`auth`.** EAS refused the token: the robot or its token was deleted or
revoked. Check them at expo.dev (account settings, Robots) and replace the
token file; it is read again on the next call.

**`forbidden`.** The robot lacks the permission: writes need the Developer
role on the project's account. Change its role at expo.dev (account settings,
Members).

**`not_found`.** Check the id or name: `list_projects`, `list_builds`,
`list_workflow_runs` and `list_submissions` give them. A project of another
account answers `not_found` too.

**`input`.** The arguments failed a check here or at EAS: a build or group
other than the one you expected, a rollout percentage lower than now, a ref
that is not a git ref. For a workflow file, `issues` lists every problem EAS's
validator named, field by field (`jobs.build.params.platform: Required`).
Nothing changed.

**`refused`.** EAS declined as the message says (a build that already ended,
a workflow file that is not on that ref). Nothing changed.

**`outcome_unknown`** after a dispatch, a submission or another change. The
connection dropped after the request left, so nobody knows whether EAS acted.
Look first (`get_workflow_run`, `get_build`, `list_submissions`): repeating a
dispatch or a submission does it twice.

**A submit job fails at "Prepare credentials"** with a message that names
nothing. The bundle id usually has no App Store Connect key set for
submissions, often a development twin of one that has it.
`audit_credentials` shows it, and `set_submit_key` sets a key the account
already holds.

**`wait_for_run` answers `done: false`.** The run is waiting for an approval,
or still going after the minutes you gave. Call it again; the run is not
affected.

**`rate_limited`.** EAS is throttling the token; wait a minute. **`api`**
with status 0 means EAS was unreachable; another status, that it failed:
retry later, and check [status.expo.dev](https://status.expo.dev) if it
persists. **`drift`** means EAS's API changed (a query no longer validates):
please report it with the message.

## How it works

**One GraphQL endpoint**, `https://api.expo.dev/graphql`. A query repeats
after a 5xx or a dropped connection; a mutation is never repeated blind and
fails as `outcome_unknown`. The projects the token sees are kept for 5
minutes, shared by every client of an HTTP process. EAS answers errors with
HTTP 200 and an `errors` list, which `src/infra/graphqlErrors.ts` maps:
`*_NOT_FOUND` is `not_found`, `VALIDATION_ERROR` is `input`, another USER
error is `refused`, `GRAPHQL_VALIDATION_FAILED` is `drift`.

**Queries written from the schema, holding no secret.** The queries in
`src/infra/easApi/queries.ts` come from EAS's introspection and eas-cli
24.10's own, validated against the live schema; EAS validates each one on
every request too, so a removed field fails loudly as `drift`. None selects a
secret: no P12 or its password, no provisioning profile file, no keystore or
its passwords, no `.p8`, no FCM key, no environment variable value.
`set_submit_key` names a key the account already holds; nothing is uploaded.

**Logs** are signed Cloud Storage URLs, fetched without the token:
brotli-compressed, one JSON object per line. `src/domain/logs.ts` groups them
by step and picks the line that says why a failed step failed (the last it
printed that is not the builder's "exited with non-zero code").

### Rollouts

An update published with `eas update --rollout-percentage` reaches that share
of the devices on its branch and runtime; the others keep the update before
it. `list_updates` shows a group's `rolloutPercentage`. From there:

- **Further:** `set_rollout` with a higher percentage moves every platform of
  the rollout together (or one, with `platform`). EAS only lets a rollout
  grow, so a lower number is refused with a pointer to the revert. At 100
  every device gets the update, which ends the rollout.
- **Back:** `revert_rollout` publishes the update before it on the branch
  again, naming the rollout it ends (EAS requires that to publish over a
  rollout in progress). Unlike eas-cli, it deletes no rollout group. A second
  revert, or one after a newer publish, is refused instead of publishing
  twice, because the rollout must still be the latest update for its
  platform and runtime.
- **Not covered:** reverting a rollout with no update before it (the
  branch's first on its runtime), which means going back to the update
  embedded in the app and needs the project's `expo-updates` version
  (`eas update:revert-update-rollout` does that); and rollouts between two
  branches on a channel (`eas channel:rollout`).

### Checking a workflow before it runs

`validate_workflow` answers "will this file run?" without a checkout or
spending anything. Give it `workflow` and `git_ref` to check the copy a
dispatch would run, or `path` for a file you are still editing (inside the
server's file roots; over HTTP, copy it there, or have a script send it as
`content_base64` with its `sha256`). It parses the YAML as a dispatch does
(merge keys on, as EAS reads them), so it lists the build jobs a dispatch
line would name, then asks EAS's own validator, as `eas workflow:validate`
does. That command also checks that each build job's profile exists in your
`eas.json`; this cannot.

`npx tsx scripts/smoke.ts` drives the built server read-only and checks that
`dispatch_workflow` is the one `money` tool (`--project`, `--workflow`, and
`--expect-key <Apple key id>` to fail unless every iOS bundle has that submit
key).

## Limitations

- **No build from a local tree** (`eas build`, or `eas workflow:run` without
  `--ref`). That uploads the working directory, which is slow and can hang,
  and nobody could see what is built; dispatch at a ref instead.
- **No `eas update` publish**, only republishing an existing group, and **no
  credential uploads**: certificates, profiles, keystores and keys stay where
  `eas credentials` puts them.
- **`submit_build` uses what EAS already holds** for the build's identifier;
  `audit_credentials` says what is missing first.
- **The token sees what its robot sees**: a project of another account is
  invisible.
- **Rollouts**: per-update rollouts only, and no revert to the embedded
  update ([Rollouts](#rollouts)).

## Other servers for Expo Application Services

Searched 2026-10-15. Expo publishes one, and two community servers touch EAS:

- **Expo MCP Server**, hosted by Expo: Streamable HTTP, with a person's
  OAuth sign-in in a browser. It starts, cancels and reads builds and their
  logs; creates, validates, runs, cancels and reads workflow runs and job
  logs; submits a finished build; reads TestFlight crashes and feedback, App
  Store and Google Play reviews (and replies) and Play crashes; and searches
  the docs. With the `expo-mcp` package it drives a local simulator. It is
  ahead of this one on writing workflows, building from a profile, crashes
  and store reviews.
- **`shipstores`** on PyPI: stdio, maintained; five EAS tools that run eas-cli
  in a project folder, beside many App Store Connect and Play Console tools.
- **`expo-mcp-server`** on GitHub: stdio; builds, updates and submissions;
  unchanged since December 2025.

This one adds what they lack: a credentials audit per bundle id and package;
submissions listed with Apple's or Google's error text; each failed run's
reason in the list itself; fingerprints, update channels and republishing an
update group; and setting the App Store Connect key a bundle id submits with.
It signs in as a robot user whose role bounds what it may do, with the token
in a file, so it can run as a shared service; Expo's server signs in only
interactively.
