---
"@foreverworks/mcp-kit": patch
---

Every tool now states all four hints in `tools/list`: `destructiveHint` is `false` on a `read` tool and `true` on a `write` that does not say otherwise, where it used to be left out for the client's default. Nothing a tool may do changes. Directories that check the hints, such as OpenAI's plugin directory, find `readOnlyHint`, `destructiveHint` and `openWorldHint` on every tool.
