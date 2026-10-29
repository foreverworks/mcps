# @foreverworks/mcp-rag

## 0.1.0

The first release. Retrieval over your own documents, on your own machine: index PDFs (scanned pages OCRed), images, docx, odt, html, epub, Markdown and text into Postgres with pgvector, then search them with hybrid retrieval (vectors and full text, fused by reciprocal rank) and a reranker, and read around what it finds. Embeddings and reranking come from text-embeddings-inference servers you run.

Indexing and removing sources are writes to the server's own index; `drop_collection` asks a person to approve each call. Nothing here is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
