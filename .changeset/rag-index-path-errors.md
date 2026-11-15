---
"@foreverworks/mcp-rag": patch
---

`index_path` says why it could not read a file. A file this server may not open, such as one with mode 0600 owned by another user, was reported in `failed_files` as `"error": "[object Object]"`, which hid the cause; it now reads `unreadable: <path> cannot be opened by this server (EACCES)`, with the system's own code, and the rest of the folder is still indexed. A file that is over the size limit, or that vanished while the folder was being read, is reported with its reason the same way.
