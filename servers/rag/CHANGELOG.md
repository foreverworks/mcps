# @foreverworks/mcp-rag

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
