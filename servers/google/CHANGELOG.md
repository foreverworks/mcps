# @foreverworks/mcp-google

## 1.0.0

The first release. Several Google accounts through one server: Gmail, Calendar, a Drive, Docs, Sheets and Slides (as simple operations and through their full APIs, every batch checked against Google's own schema), comments, sharing and revisions on any file, Google Tasks, contacts with a Workspace directory, and what Meet recorded of a meeting. Reads that make sense across accounts read all of them; every write names its account.

Its `write` tools change mail, calendars, files and tasks: drafts and labels, events and invitations, files and their sharing, documents, rows and slides. Some of them reach other people, and their descriptions ask for your explicit go before each: `send_message`, `send_draft`, `reply` and `forward` when they send, and `share_file`. Nothing here moves money: no tool is `money`.
