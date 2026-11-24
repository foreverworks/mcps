---
"@foreverworks/mcp-granola": minor
---

A new server for Granola: your assistant searches and reads your meetings, notes and transcripts (`search_meetings`, `get_meetings`, `get_meeting_transcript`, `search_transcripts`, `list_meeting_folders`, `get_meeting_attachment`, `get_account_info`, `list_templates`, `get_agent_brief` and `query_granola_meetings`, all `read`) through Granola's own official MCP server, from clients and scripts that cannot sign in to Granola themselves. The server holds one sign-in to your Granola account and refreshes it by itself, one refresh at a time with the rotated token saved before it is used; `begin_authorization` and `complete_authorization` (`write`) connect the account once, and `refresh_grant` (`write`) proves the refresh works. Granola's tools that change notes or the account are never offered. No tool is `money`. Transcript tools need a paid Granola plan.
