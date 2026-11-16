# @foreverworks/mcp-rag

## 0.4.0

### Minor Changes

- 2017f2c: Use Cloudflare Clef-flash or Clef to score candidate passages for relevance on a fixed rubric, with the same local fallback and deadlines as the BGE reranker. Select the model through configuration or `search.reranker_model` to compare models on frozen collections. Provider metadata reports the chosen model and its input-token usage.
- 308645f: `RAG_LOCAL_ONLY_COLLECTIONS` names collections, separated by commas, whose questions and passages never leave the machine, even when `RAG_QUERY_PROVIDER=cloudflare` is on. A `search` whose scope includes one embeds the question and reranks the candidates with the local servers only, ignoring `inference_timeout_ms` and `reranker_model`, and lists those collections under `local_only` in its reply; a scope that mixes one with regular collections runs entirely local. A `search` that names no collections now leaves them out, as it leaves out snapshots, and searches them only when they are named. They cannot be embedded at a remote provider: `create_collection` and `index_path` refuse that with an error naming the variable, and `snapshot_collections` refuses to copy one, since the copy would not be local-only. A search that leaves some out while others remain lists them under `left_out_local_only`. Names are lowercased; an entry that is not a collection name protects nothing, so `health` lists it under `local_only_invalid` and reports not ok. `health` lists the names under `local_only_collections`, and those that match no collection yet under `local_only_unknown`. The variable is read at startup, and listing a name does not undo text already embedded at a remote provider. Local inference is slower than Workers AI. With the variable unset or empty nothing changes except that `health` shows an empty list.
- 9ead0c1: Optionally run query embedding and reranking on Cloudflare Workers AI, with vector compatibility probes, bounded requests, automatic local fallback and provider metadata. A single call can force local inference for a comparison. Indexing providers remain independent.
  
  `snapshot_collections` is a new `write` tool to freeze collections and their existing vectors locally for reproducible comparisons. Snapshots are excluded from default searches and cannot be indexed or pruned.
- e5ec1c3: `similar` finds the documents in a collection that say most nearly the same thing as one of its documents: duplicates and near-duplicates to merge, related documents, or a document's closest neighbours before you write a new one. Give it the document's source as `list_sources` and `search` show it, and it returns the closest `limit` (10) documents, best first. Each has a `score`, the mean of `forward` and `backward` (how much of the named document is found in it, and how much of it in the named document): 1 for identical text, the same whichever of the two you start from, and in principle below 0 for opposite ones, which the default `min_score` of 0 leaves out. Each also has its `chunks` and the closest pair of passages by chunk id and location, which `expand` reads. `candidates` (10) sets how many nearest chunks each chunk of the named document contributes when the candidate documents are found. A document of more than 64 chunks, the named one or a result, is compared by 64 spread evenly through it, and the reply says which (`sampled`, on the reply and on each result). It compares the vectors already stored, in one query through the collection's own vector index, so no embedding model is called, and a call that runs past 15 seconds is cancelled with an error that suggests a smaller `candidates`. It is a `read` tool: it changes nothing.

### Patch Changes

- 6cabc5b: `index_path` says why it could not read a file. A file this server may not open, such as one with mode 0600 owned by another user, was reported in `failed_files` as `"error": "[object Object]"`, which hid the cause; it now reads `unreadable: <path> cannot be opened by this server (EACCES)`, with the system's own code, and the rest of the folder is still indexed. A file that is over the size limit, or that vanished while the folder was being read, is reported with its reason the same way.
- c132159: The server's instructions, which your client hands the model at the start of every session, are about half as long, so every session costs less. They now say what the server reaches, the tool to start with, the flows that run across tools, and what the model must know before its first call (what spends money, sends, publishes or acts on something in a home, and what to do when a sign-in is needed). What a tool's own description already says is left to it. Nothing a tool does changes.
  
  porkbun: the vendor's paragraph on publishing a site is now one sentence, and `deploy_site`'s description carries its checks, adding that `list_hosting_files` shows what is already there before an upload replaces it.
- Updated dependencies [75ea94a]
- Updated dependencies [0834240]
- Updated dependencies [64969a3]
- Updated dependencies [4ef1bf8]
- Updated dependencies [7b93f2f]
- Updated dependencies [27f0094]
  - @foreverworks/mcp-kit@0.3.0

## 0.3.0

### Minor Changes

- 32f123c: `search` takes `also`: up to four other phrasings of the question (a keyword version, a rewording, a translation into the documents' language). Each is retrieved like the query, in parallel; their fused lists are fused again, the query's first on ties, and the reranker reads the best `candidates` against the query as asked, so a search costs no more reranking than before. The reply echoes the phrasings it used. Over 100 questions on a 24,959-document English corpus, two or three rephrasings raised the questions whose first passage holds the answer from 54 to 64, at the same latency. Without `also`, `search` works as before.

### Patch Changes

- Updated dependencies [2cf1e19]
  - @foreverworks/mcp-kit@0.2.1

## 0.2.0

### Minor Changes

- bb97c16: A collection can be embedded by any of several embedding models, each served by its own endpoint: `RAG_EMBED_MODELS` names more models besides `RAG_EMBED_URL`'s (named by `RAG_EMBED_NAME`), each with its URL, the prompt its questions get (`query_prompt`, a prompt from the model's own configuration, such as Qwen3-Embedding's `query`; `RAG_EMBED_QUERY_PROMPT` for the default) and its Workers AI counterpart and batch. `create_collection` takes `embedding_model`, and a collection keeps the model it was built with, found again by the model and revision it recorded. `search` over collections built with different models embeds the question once per model and fuses each model's nearest chunks as a list of its own; `index_path` reports the model by name. Each collection now has an HNSW index of its own, partial on its name, so collections from different models never share a graph: a new collection gets it at once, `create_collection` with an existing collection's name builds it concurrently and drops the index all collections shared once none needs it, and `health` lists the collections still without one. `health` lists every embedding model, the default first.
- ee10795: A collection can be indexed at Cloudflare Workers AI, which serves the same `BAAI/bge-m3` model, instead of the local embed endpoint: `create_collection` takes `embedding_provider` (`local`, the default, or `cloudflare`), proves with three probe texts that Workers AI embeds them as the local endpoint does (cosine at least 0.999) and refuses it otherwise, and moves an existing collection to the provider named without embedding again what it holds. Questions are always embedded locally. `index_path` embeds in batches of 64, retries Workers AI's capacity and rate-limit refusals with backoff and Retry-After, stops at once on a spent daily allocation with a `provider` error whose reason is `quota`, and reports the requests, texts, tokens and neurons each call cost; `list_collections` shows each collection's provider and its total spend, and `health` which providers are configured, without calling them. New settings: `RAG_CLOUDFLARE_ACCOUNT_ID`, `RAG_CLOUDFLARE_API_TOKEN_FILE`, `RAG_CLOUDFLARE_MODEL`, `RAG_CLOUDFLARE_BATCH`. The write tools are the same four: `create_collection`, `index_path`, `remove_source` and `drop_collection`.
- 82f54e5: A collection embedded at a remote provider is indexed several files at a time (`RAG_REMOTE_CONCURRENCY`, default 8), since Workers AI answers a request in a fraction of a second and takes many at once; a call still reads at most `max_files`, and the local endpoint still takes one file at a time.

### Patch Changes

- 49a43bf: Workers AI's code 4006, what a Workers Free account is answered once its daily allocation is spent, is a `provider` error with reason `quota` like the documented 3036, so `index_path` stops at once instead of retrying a refusal that lasts until 00:00 UTC.
- 719484f: `search` stays fast on a large collection. Its full-text half leaves out the stop words of Postgres's english and romanian configurations ("the", "when", "did"), which match nearly every passage, ranks with `ts_rank` instead of the costlier `ts_rank_cd`, and gives up after 5 seconds, in which case the vector half stands alone and the reply says so. Over 105,882 chunks a question such as "When did the New York Post withdraw its motion to unseal the appellate briefs?" took 50 seconds before the reranker.
- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. Retrieval over your own documents, on your own machine: index PDFs (scanned pages OCRed), images, docx, odt, html, epub, Markdown and text into Postgres with pgvector, then search them with hybrid retrieval (vectors and full text, fused by reciprocal rank) and a reranker, and read around what it finds. Embeddings and reranking come from text-embeddings-inference servers you run.

Its `write` tools change only the server's own index, which the files can always rebuild: `create_collection`, `index_path`, `remove_source` and `drop_collection`. `drop_collection` throws away everything indexed in a collection at once, so it asks a person to approve each call. Nothing here is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
