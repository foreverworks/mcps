---
"@foreverworks/mcp-rag": minor
---

Optionally run query embedding and reranking on Cloudflare Workers AI, with vector compatibility probes, bounded requests, automatic local fallback and provider metadata. A single call can force local inference for a comparison. Indexing providers remain independent.

Add snapshot_collections (write) to freeze collections and their existing vectors locally for reproducible comparisons. Snapshots are excluded from default searches and cannot be indexed or pruned.
