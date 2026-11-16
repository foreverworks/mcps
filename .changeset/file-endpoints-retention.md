---
"@foreverworks/mcp-kit": minor
---

`MCP_HTTP_FILES_MAX_AGE_MIN` (a whole number of minutes above zero) deletes the files in the file-endpoint folders (`MCP_HTTP_FILES_INBOX`, `MCP_HTTP_FILES_OUTBOX`) once they were last written longer ago than that, and the folders they leave empty, for a server in a container whose folders are tmpfs: nothing else clears them there, and tmpfs pages count against the container's memory. The server looks when it starts and then every quarter of the age (no oftener than every minute, no rarer than every hour); a file an upload is still writing is never taken, links are neither followed nor deleted, and a failed sweep writes one `files {...}` line and the server goes on. Unset, nothing changes: no file is deleted and no timer runs. A value that is not a whole number of minutes above zero, or the setting with no folder to clear, stops the start.
