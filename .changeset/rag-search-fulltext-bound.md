---
"@foreverworks/mcp-rag": patch
---

`search` stays fast on a large collection. Its full-text half leaves out the stop words of Postgres's english and romanian configurations ("the", "when", "did"), which match nearly every passage, ranks with `ts_rank` instead of the costlier `ts_rank_cd`, and gives up after 5 seconds, in which case the vector half stands alone and the reply says so. Over 105,882 chunks a question such as "When did the New York Post withdraw its motion to unseal the appellate briefs?" took 50 seconds before the reranker.
