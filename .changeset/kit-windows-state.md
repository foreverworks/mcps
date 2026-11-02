---
"@foreverworks/mcp-kit": patch
---

On Windows, a server's default state directory is `%APPDATA%\mcps\<server>` when `XDG_STATE_HOME` is not set, instead of `.local\state\mcps\<server>` in the user's profile. A server that already keeps state there finds it again with its `<SERVER>_STATE_DIR` variable, or once the folder is moved.
