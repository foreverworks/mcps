# @foreverworks/mcp-granola

## 0.1.0

The first release. Your assistant can search and read your Granola meetings,
notes and transcripts through Granola's own official MCP server, from clients
and scripts that cannot sign in to Granola themselves: `search_meetings`,
`get_meetings`, `get_meeting_transcript`, `search_transcripts`,
`list_meeting_folders`, `get_meeting_attachment`, `get_account_info`,
`list_templates`, `get_agent_brief` and `query_granola_meetings`, all `read`,
forwarded exactly as Granola answers them. The server holds one sign-in to your
Granola account, refreshes it by itself (Granola's refresh tokens rotate, so one
refresh runs at a time and the new pair is saved before it is used), and serves
those tools to every client that presents the server's own token.
`begin_authorization` and `complete_authorization` connect the account once, and
`refresh_grant` proves the refresh works; all three are `write`: they change
only what the server holds. `health` is `read`. Granola's tools that change
your notes or account (folders, titles, summaries, private notes, a note made
from a transcript, feedback, sign-out, a switch of workspace) are deliberately
never offered. No tool is `money`. Transcript tools need a paid Granola plan.
