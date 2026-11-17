---
"@foreverworks/mcp-rag": minor
---

`RAG_NAMED_ONLY_COLLECTIONS` names collections, separated by commas, that a `search` reads only when it names them: a search that names no collections leaves them out, as it leaves out snapshots and local-only collections, and lists those it left out under `left_out_named_only` when others remain. Named, they are searched like any other collection, with the configured query provider; indexing, remote embedding and snapshots are unchanged. `health` lists the names under `named_only_collections`, those that match no collection yet under `named_only_unknown`, and entries that are not collection names under `named_only_invalid`, reporting not ok. A collection on both lists is local-only. With the variable unset or empty nothing changes except that `health` shows an empty list.
