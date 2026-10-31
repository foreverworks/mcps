# @foreverworks/mcp-google

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
