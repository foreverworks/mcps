---
"@foreverworks/mcp-kit": minor
---

Two pieces for a server that signs in to an OAuth-only service on behalf of many clients. `discoverOAuth` finds a protected MCP endpoint's authorization server from its 401 and its metadata documents (RFC 9728 and RFC 8414, checked against mix-ups, https only) and `registerPublicClient` registers a public client by dynamic registration (RFC 7591). `makeGrantSource` keeps a grant whose refresh token rotates: one refresh at a time across callers and processes, and the new pair written before the new access token is used.

`makeOAuthClient` takes `singleUse`, which sends the refresh_token and authorization_code grants once instead of retrying a 5xx, since both spend a single-use credential. `makeGrantSource` drops the stored grant only when `isRevoked` says the provider ended it (`invalid_grant`, `invalid_client`), never for a busy or failing provider, and logs loudly when rotated tokens cannot be saved.
