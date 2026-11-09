---
"@foreverworks/mcp-devices": minor
---

A device reached over ssh may have a second port in its catalog entry, `ssh.fallback_port`: the port the same machine answers on when `port` does not, such as a freshly installed server whose sshd listens on 22 until its configuration moves it to another port. A lease carries it as `DEVICE_SSH_FALLBACK_PORT` in `env` and as `fallbackPort` in the address, beside `DEVICE_SSH_PORT`, and the holder tries the first port and then this one. A fallback port outside 1 to 65535, or equal to the port (or to 22 when none is set), is refused when the catalog loads. Catalogs without one behave as before.
