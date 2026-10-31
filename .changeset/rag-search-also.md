---
"@foreverworks/mcp-rag": minor
---

`search` takes `also`: up to four other phrasings of the question (a keyword version, a rewording, a translation into the documents' language). Each is retrieved like the query, in parallel; their fused lists are fused again, the query's first on ties, and the reranker reads the best `candidates` against the query as asked, so a search costs no more reranking than before. The reply echoes the phrasings it used. Over 100 questions on a 24,959-document English corpus, two or three rephrasings raised the questions whose first passage holds the answer from 54 to 64, at the same latency. Without `also`, `search` works as before.
