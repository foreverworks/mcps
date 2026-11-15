---
"@foreverworks/mcp-kit": minor
---

Three pieces that servers had copied between them are now the kit's:

- `storedFile(path, { schema, fromDisk, toDisk, corrupt?, lock? })` keeps one record (a session, a grant) in a JSON file of the state directory: checked against the server's own shape on disk at every read, written whole at 0600, and a file of the wrong shape either read as absent or reported through the server's `corrupt`.
- `pendingAuthorizationFile(stateDir, name)` and `pendingPkceAuthorizationFile(stateDir, name)` keep the one begun authorization-code flow between the call that sends a person to the authorize page and the one that takes the address they land on.
- `connectUpstream(endpoint, { name, client, fail })` makes a server the MCP client of another one, over Streamable HTTP or stdio, with `usingUpstream`, `fillTemplate` and `atPath` for a vault or mailbox tool the server does not know in advance. A tool that answers an error is a failure, through the server's `fail`; a failure of the server's own while the transport is made (a token file it cannot read) reaches its caller unchanged.
