# <img src="icons/icon.svg" width="36" height="36" alt="App Store and Google Play icon"> App Store and Google Play MCP server

Read and answer your app's App Store and Google Play reviews from your AI
assistant, and see what TestFlight testers sent you: screenshot feedback, and
crashes with their logs. It works through
[App Store Connect](https://appstoreconnect.apple.com) and the
[Google Play Developer API](https://developers.google.com/android-publisher).
Two tools write: `reply_app_store_review` and `reply_play_review` publish a
reply in the developer's name, visible to everyone, so send only text you have
approved. Nothing here moves money.

**You need** credentials for each store you use, and one store is enough: for
the App Store, an App Store Connect API key (its `.p8` file, key id and issuer
id); for Google Play, a Google Cloud service account with a JSON key, invited
to your app in Play Console. Google's API returns only the last seven days of
reviews.

## What you can ask

- "What did people say about the last release, and which App Store reviews
  still have no reply?"
- "Show this week's Google Play reviews of com.example.app, translated into
  English, worst first."
- "What crashed for TestFlight testers on build 42?"
- "Draft replies to the App Store reviews from Germany that mention signing
  in." Then, once you have read them: "Send these."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=app-stores&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22asc_key_id%22%2C%22description%22%3A%22Optional.%20For%20the%20App%20Store%3A%20the%20App%20Store%20Connect%20API%20key's%20id%20(10%20characters).%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22asc_issuer_id%22%2C%22description%22%3A%22Optional.%20For%20the%20App%20Store%3A%20the%20issuer%20id%20App%20Store%20Connect%20shows%20above%20your%20team%20keys.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22asc_private_key_file%22%2C%22description%22%3A%22Optional.%20For%20the%20App%20Store%3A%20path%20of%20the%20.p8%20key%20file%20App%20Store%20Connect%20let%20you%20download.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22play_service_account_file%22%2C%22description%22%3A%22Optional.%20For%20Google%20Play%3A%20path%20of%20the%20service%20account's%20JSON%20key.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22play_packages%22%2C%22description%22%3A%22Optional.%20For%20Google%20Play%3A%20the%20package%20names%20to%20answer%20for%2C%20comma-separated%2C%20e.g.%20com.example.app.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-app-stores%22%5D%2C%22env%22%3A%7B%22ASC_KEY_ID%22%3A%22%24%7Binput%3Aasc_key_id%7D%22%2C%22ASC_ISSUER_ID%22%3A%22%24%7Binput%3Aasc_issuer_id%7D%22%2C%22ASC_PRIVATE_KEY_FILE%22%3A%22%24%7Binput%3Aasc_private_key_file%7D%22%2C%22PLAY_SERVICE_ACCOUNT_FILE%22%3A%22%24%7Binput%3Aplay_service_account_file%7D%22%2C%22PLAY_PACKAGES%22%3A%22%24%7Binput%3Aplay_packages%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=app-stores&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLWFwcC1zdG9yZXMiXSwiZW52Ijp7IkFTQ19LRVlfSUQiOiIke2VudjpBU0NfS0VZX0lEfSIsIkFTQ19JU1NVRVJfSUQiOiIke2VudjpBU0NfSVNTVUVSX0lEfSIsIkFTQ19QUklWQVRFX0tFWV9GSUxFIjoiJHtlbnY6QVNDX1BSSVZBVEVfS0VZX0ZJTEV9IiwiUExBWV9TRVJWSUNFX0FDQ09VTlRfRklMRSI6IiR7ZW52OlBMQVlfU0VSVklDRV9BQ0NPVU5UX0ZJTEV9IiwiUExBWV9QQUNLQUdFUyI6IiR7ZW52OlBMQVlfUEFDS0FHRVN9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-app-stores.mcpb)

> [!NOTE]
> `@foreverworks/mcp-app-stores` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add app-stores -- npx -y @foreverworks/mcp-app-stores
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "app-stores": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-app-stores"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:ASC_KEY_ID}` and so on), so set them before you start Cursor. Every setting is optional; [Configuration](#configuration) says which ones you need for which tools.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add app-stores -- node "$PWD/servers/app-stores/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/app-stores/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

The commands above configure no store. Add the variables of each store you
use:

```bash
claude mcp add app-stores \
  -e ASC_KEY_ID=ABCDE12345 -e ASC_ISSUER_ID="<issuer id>" -e ASC_PRIVATE_KEY_FILE="<path to AuthKey.p8>" \
  -e PLAY_SERVICE_ACCOUNT_FILE="<path to service account JSON>" -e PLAY_PACKAGES=com.example.app \
  -- npx -y @foreverworks/mcp-app-stores
```

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `ASC_KEY_ID` | for the App Store | The App Store Connect API key's id (10 letters and digits). |
| `ASC_ISSUER_ID` | for the App Store | The issuer id App Store Connect shows above your team keys (a UUID). |
| `ASC_PRIVATE_KEY_FILE` | for the App Store | The `.p8` file App Store Connect let you download once. |
| `ASC_PRIVATE_KEY` | no | The key's text itself, instead of the file, for a local stdio run. |
| `PLAY_SERVICE_ACCOUNT_FILE` | for Google Play | The service account's JSON key, as Google Cloud downloads it. |
| `PLAY_SERVICE_ACCOUNT` | no | The JSON key's text itself, instead of the file, for a local stdio run. |
| `PLAY_PACKAGES` | no | Comma-separated package names this server answers for, e.g. `com.example.app`. Google has no call that lists a service account's apps, so `health` checks these, and a call that names no package means the only one. |
| `APP_STORES_OUTBOX_DIR` | no | Where crash logs are saved. Default: `outbox/` in the state folder. |
| `APP_STORES_STATE_DIR` | no | The state folder; the default is in [docs/configuration.md](../../docs/configuration.md#conventions). |

A store you leave out shows as `configured: false` in `health`, and its tools
answer `config`. Credentials are read on the first call that needs them, so
the server starts without any. The variables every server shares (transport,
limits, what tools may do) are in
[docs/configuration.md](../../docs/configuration.md).

### Getting an App Store Connect API key

1. In [App Store Connect](https://appstoreconnect.apple.com), open **Users
   and Access**, then **Integrations**, **App Store Connect API**, **Team
   Keys**.
2. Generate a key with the access it needs and no more: **Customer Support**
   reads and answers reviews, **Developer** reads TestFlight feedback.
3. Download the `.p8` file. App Store Connect offers it once: save it readable
   only by you (`chmod 600`), and point `ASC_PRIVATE_KEY_FILE` at it.
4. Copy the **Key ID** from the key's row into `ASC_KEY_ID`, and the
   **Issuer ID** shown above the list into `ASC_ISSUER_ID`.

A team key does not expire; revoke it on the same page once it is unused.

### Getting a Google Play service account

1. In the [Google Cloud console](https://console.cloud.google.com), in any
   project, open **IAM and Admin**, **Service accounts**, and **Create service
   account**. It needs no roles in the project.
2. On the new account, open **Keys**, **Add key**, **Create new key**,
   **JSON**. Save the file readable only by you (`chmod 600`) and point
   `PLAY_SERVICE_ACCOUNT_FILE` at it. If your organisation forbids service
   account keys (`iam.disableServiceAccountKeyCreation`), lift that policy for
   the project while you make the key.
3. In [Play Console](https://play.google.com/console), open **Users and
   permissions**, **Invite new users**, and enter the service account's
   e-mail address (`client_email` in the JSON file). Give it two permissions
   on the app: **View app information** (to read reviews) and **Reply to
   reviews**.
4. Set `PLAY_PACKAGES` to the app's package name (several, comma-separated).

## First run

1. Ask your assistant to run the app stores' `health` check. For each store
   it says whether the credentials work, with the apps the key sees (bundle
   ids and Apple ids) and each Play package with one review read.
2. Then read before you write: ask for draft replies, and send only those you
   approved.

## Tools

**read** changes nothing in either store (a crash log is saved to the
server's outbox); **write** publishes a reply under a review.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Whether each store's credentials work, the apps the App Store Connect key sees, and each Play package with one review read. |
| `list_app_store_reviews` | read | An app's App Store reviews with your reply and its state, by star rating, storefront or whether you replied. |
| `list_play_reviews` | read | A package's Play reviews from the last 7 days (Google's limit) with your reply, optionally translated. |
| `list_testflight_feedback` | read | Screenshot and crash feedback testers sent from TestFlight, with the device, OS and build. |
| `get_testflight_crash_log` | read | One crash feedback's log, saved whole to the outbox, with its first 40 lines. |
| `reply_app_store_review` / `reply_play_review` | write | Publish your reply under a review. Refuses to replace an existing reply unless asked; the same text twice is sent once. |

## Troubleshooting

**`config`: "App Store Connect is not configured" or "Google Play is not
configured".** The message names the missing variables. Any other `config`
message names a value the store did not issue: a key id that is not 10
letters and digits, an issuer id that is not a UUID, a `.p8` that is not an
EC P-256 key, or a JSON file that is not a service account's key.

**`auth`.** The store refused the credentials: the key was revoked or the
service account deleted. Check it in App Store Connect (Users and Access,
Integrations) or the service account's Google Cloud project, and replace the
file.

**`forbidden` from the App Store.** The key lacks the role: reviews need
Customer Support, TestFlight feedback needs Developer.

**`forbidden` from Google Play.** The service account cannot act on that app:
in Play Console, Users and permissions, give it View app information and
Reply to reviews on the app. A newly invited account can take hours to reach
the API. If the message says the Google Play Android Developer API is
disabled, enable it in the service account's Google Cloud project.

**`input`: "... already has a public reply".** The review has a different
reply, quoted in the message. Call again with `replace: true` only if you mean
yours to take its place. Other `input` messages name the problem: a reply over
the store's limit, or an app or package to name because there are several.

**`not_found`.** These credentials do not reach that id or app: `health` lists
the apps and packages they do.

**`outcome_unknown`** after a reply. The connection dropped after the reply
left, so it may already be public. List the review again (it shows its reply)
before you send it again.

**`rate_limited`.** The store is throttling these credentials; wait a minute.
**`api`** with status 0 means the store was unreachable; another status, that
it failed: retry later. **`drift`** means the store's answer changed shape:
please report it with the message.

## How it works

- **No token endpoint for Apple.** App Store Connect takes a JSON Web Token
  as the bearer itself: the server signs one with the `.p8` key (ES256), lets
  it live 19 of the 20 minutes Apple allows, and keeps it in memory. Google
  trades an assertion signed with the service account's key (RS256, RFC 7523)
  at `oauth2.googleapis.com` for an hour-long token. A key file that names
  another token endpoint is refused, so the assertion goes nowhere else.
- **Replies are public, so they are careful.** Both stores silently replace
  an existing reply, so the server reads the review first: it refuses to
  replace a different reply unless `replace` is true, and sends nothing when
  the text is the same.
  Apple holds a new reply as `pending` until its own check publishes it,
  usually within a day.
- **Limits are the stores'.** A reply holds up to 5,970 characters at Apple
  and about 350 at Google, checked before sending. Google's API returns only
  reviews with text, written or changed in the last seven days; the full
  history is in Play Console's monthly review reports (Download reports,
  Reviews).
- **Models, not relays.** The shapes come from Apple's OpenAPI specification
  4.5.1 and Google's `androidpublisher` v3 reference; a documented field that
  goes missing fails as `drift` instead of travelling on as an empty value.
- **Crash logs go to the outbox**, because one runs to hundreds of lines. The
  first 40, returned with the file's path and SHA-256, hold the exception and
  the crashed thread in either of Apple's formats.

`npx tsx scripts/smoke.ts` drives the built server read-only with your
credentials: `health`, three reviews per configured store, and three pieces
of TestFlight feedback. It never replies.

## Limitations

- **Reviews only from the API's window**: the App Store's full history,
  Google's last seven days.
- **No Play crash reports** (Android vitals are a different API, the Play
  Developer Reporting API), no review summaries, no deleting a reply.
- **TestFlight screenshots are links that expire** (`expiresAt`); the server
  does not download them.
- **TestFlight feedback names a build by its build number**; its marketing
  version is in App Store Connect.

## Other servers for App Store Connect and Google Play

Searched 2026-10-22. Neither Apple nor Google publishes one.

- **Expo's hosted MCP server** covers all of this (App Store and Play reviews
  and replies, TestFlight feedback and crashes, Play crashes), but it runs on
  Expo's side behind a person's browser sign-in, and its replies replace an
  existing one without asking.

Community servers each cover part of it, over stdio:

- **`asc-mcp`** (Swift, macOS only): App Store reviews, replies, and
  TestFlight feedback with crash logs.
- **Heimdall** (`erayendes/app-store-connect-mcp`): the whole App Store
  Connect API.
- **`app-publish-mcp`**: reviews and replies in both stores, no TestFlight
  feedback.
- **`google-play-developer-mcp`** and **`google-play-console-cli`**: Play
  reviews and replies.
- **`antoniolg/play-store-mcp`** and **`shipstores`** do releases, not
  reviews, and **`JoshuaRileyDev/app-store-connect-mcp-server`** is archived.

This one does what none of them does in one place: both stores and
TestFlight from one service that keeps the keys in files and runs on Linux; a
reply refused when it would replace a public one, and sent once when
repeated; Google's seven-day window stated in every answer; a crash log saved
with its checksum; and failures typed per store, saying what to change in
which console.
