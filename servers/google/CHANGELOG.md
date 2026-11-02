# @foreverworks/mcp-google

## 0.2.0

### Minor Changes

- 5adbf90: `npx -y @foreverworks/mcp-google setup` sets the server up from nothing, in a terminal. It asks which products and accounts to connect, creates the Google Cloud project and enables its APIs through gcloud when gcloud is signed in (otherwise it opens one console link that enables them all), opens each Google Auth Platform page with what to choose and the exact scopes to add, picks up the client file you download and keeps it readable only by you, and runs each approval in your browser with Google's redirect received on `127.0.0.1`. Each account's address is learned from its first approval. At the end it prints the command that adds the server to your client.
  
  The server now needs no variables: `claude mcp add google -- npx -y @foreverworks/mcp-google` is the whole install line. Without `GOOGLE_OAUTH_CLIENT_FILE` it uses the client setup saved in its state directory; without `GMAIL_MODIFY_ACCOUNTS` every `gmail/<label>/credentials.json` there is a mailbox, found on each call like the other products' grants; without `GMAIL_ADDRESSES` each account's address is the one its grant recorded. A variable that is set still wins, so a configuration that lists its paths works as before. `health` has a `config` section, and `--health` with no product starts with `CONFIG:` lines, saying where the state directory, the OAuth client, the mailboxes and each account's address came from. The VS Code and Claude Desktop installs no longer ask for those three settings.
  
  `--health` passes a product nobody has set up yet, saying so, as it already did for Tasks, contacts and Meet: Gmail, Calendar, Drive and Docs, Sheets and Slides no longer fail it just for having no grant, so a server set up for some products checks clean. A grant that exists and does not work still fails it.

### Patch Changes

- Updated dependencies [2cf1e19]
  - @foreverworks/mcp-kit@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Several Google accounts through one server: Gmail, Calendar, a Drive, Docs, Sheets and Slides (as simple operations and through their full APIs, every batch checked against Google's own schema), comments, sharing and revisions on any file, Google Tasks, contacts with a Workspace directory, and what Meet recorded of a meeting. Reads that make sense across accounts read all of them; every write names its account.

Its `write` tools change mail, calendars, files and tasks: drafts and labels, events and invitations, files and their sharing, documents, rows and slides. Some of them reach other people, and their descriptions ask for your explicit go before each: `send_message`, `send_draft`, `reply` and `forward` when they send, and `share_file`. Nothing here moves money: no tool is `money`.

`GOOGLE_TOOLSETS` loads only the products a client needs (`gmail,calendar`, say), so it is handed those tools and not all 115; unset, it serves every one.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both. `begin_consent` offers the sign-in page through your client where the client supports URL elicitation, and puts the link in the result where it does not.
