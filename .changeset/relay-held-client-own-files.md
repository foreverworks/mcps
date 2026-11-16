---
"@foreverworks/mcp-relay": patch
---

A client the server holds to a ceiling (`MCP_CLIENT_MAX_ACCESS`) now gets back the files its own calls hand back: when such a client calls a `read` tool that saves a file and links it, the relay brings the file to your machine as it does for any other client (this needs the server on a version of the kit that serves them). Uploads stay refused for it, and so do links to files another client's calls saved. The words for each refusal now differ by direction: `the upstream takes no files from alice (403): ...` for an upload, and `the upstream does not give alice this file (403): ...` for a linked file, which also says that a server that restarted has forgotten the call, so calling the tool again brings the file.
