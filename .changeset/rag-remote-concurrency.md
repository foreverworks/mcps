---
"@foreverworks/mcp-rag": minor
---

A collection embedded at a remote provider is indexed several files at a time (`RAG_REMOTE_CONCURRENCY`, default 8), since Workers AI answers a request in a fraction of a second and takes many at once; a call still reads at most `max_files`, and the local endpoint still takes one file at a time.
