---
"@foreverworks/mcp-kit": minor
---

A server can now listen on an address other than `127.0.0.1`, so one that runs in a container can be reached over a private network on a published port. `MCP_HTTP_HOST` is the address to bind (`0.0.0.0` for every IPv4 interface, `::` for every interface, or one interface's address), and `MCP_HTTP_ALLOWED_HOSTS` the `Host` values the server answers besides `127.0.0.1:<port>` and `localhost:<port>`: `name` for that name on any port, `name:port` for one port. It works with bearer tokens, which are still required, and any other `Host` still gets a 421.

A bind address that is not a loopback one is refused at startup unless `MCP_HTTP_ALLOWED_HOSTS` (or `MCP_HTTP_PUBLIC_HOSTS`) names who the listener is for, and either variable without `MCP_HTTP_PORT` stops the start. With neither set nothing changes: the server binds `127.0.0.1` and answers the same two `Host` names. See docs/configuration.md, "A server in a container".
