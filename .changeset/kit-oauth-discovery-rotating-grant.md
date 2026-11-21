---
"@foreverworks/mcp-kit": minor
---

Two pieces for a server that signs in to an OAuth-only service on behalf of many clients. `discoverOAuth` finds a protected MCP endpoint's authorization server from its 401 and its metadata documents (RFC 9728 and RFC 8414, checked against mix-ups, https only) and `registerPublicClient` registers a public client by dynamic registration (RFC 7591). `makeGrantSource` keeps a grant whose refresh token rotates: one refresh at a time across callers and processes, and the new pair written before the new access token is used.
