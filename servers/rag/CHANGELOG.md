# @foreverworks/mcp-rag

## 0.1.0

The first release. Retrieval over your own documents, on your own machine: index PDFs (scanned pages OCRed), images, docx, odt, html, epub, Markdown and text into Postgres with pgvector, then search them with hybrid retrieval (vectors and full text, fused by reciprocal rank) and a reranker, and read around what it finds. Embeddings and reranking come from text-embeddings-inference servers you run.

Its `write` tools change only the server's own index, which the files can always rebuild: `create_collection`, `index_path`, `remove_source` and `drop_collection`. `drop_collection` throws away everything indexed in a collection at once, so it asks a person to approve each call. Nothing here is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
