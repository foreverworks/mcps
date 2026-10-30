# <img src="icons/icon.svg" width="36" height="36" alt="Local RAG icon"> Local RAG MCP server

Let your AI assistant search your own documents and quote what they say:
contracts, scanned letters, manuals, notes. It indexes files into a Postgres
database with pgvector, finds the passages that answer a question (in any
language the models read, worded differently from the text), and hands them
back with the file and page or heading they came from. Embeddings and
reranking run on servers you host, so documents and questions stay on your
machine. For a corpus too large to embed on a CPU, a collection can be
indexed at Cloudflare Workers AI instead, which runs the same model; its
documents' text then goes to Cloudflare, and questions are still embedded on
your machine.

**You need** Postgres with the [pgvector](https://github.com/pgvector/pgvector)
extension, two [text-embeddings-inference](https://github.com/huggingface/text-embeddings-inference)
servers (one with an embedding model, one with a reranker), and for anything
beyond plain text: poppler's `pdftotext`, `ocrmypdf` and `tesseract` with the
languages you need, and `pandoc`.

## What you can ask

- "Index the scanned contracts in contracts/ in Romanian, then tell me who
  pays for major repairs in the 2019 lease, with the page."
- "Which of my manuals say how to descale the coffee machine? Quote the steps."
- "Search the board minutes for every decision about the office move, and read
  me the paragraphs around the first one."
- "Index notes/ again; only the files I changed this week should be read."
- "Remove the drafts folder from the index."
- "Make a collection for the court archive indexed at Cloudflare, index it,
  and tell me what it cost."

## Install

<!-- install:begin -->
> [!NOTE]
> Local RAG is one of this repository's [extras](../../README.md#extras), which run from a clone and are not published to npm, the MCP Registry or as desktop bundles. Run it on Node 22.19 or newer.

With Claude Code:

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add rag -e RAG_DATABASE_URL="<Database URL>" -e RAG_EMBED_URL="<Embedding server>" -e RAG_RERANK_URL="<Rerank server>" -- node "$PWD/servers/rag/dist/index.js"
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON, with the full path of `servers/rag/dist/index.js` in your clone:

```json
{
  "mcpServers": {
    "rag": {
      "command": "node",
      "args": ["<path to the clone>/servers/rag/dist/index.js"],
      "env": {
        "RAG_DATABASE_URL": "<Database URL>",
        "RAG_EMBED_URL": "<Embedding server>",
        "RAG_RERANK_URL": "<Rerank server>"
      }
    }
  }
}
```

The commands above set only what is required; [Configuration](#configuration) has the rest. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->
## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `RAG_DATABASE_URL` | yes | `postgresql://user@host:port/database` of a database where the `vector` extension exists (or that the user may create). The password may be left out and given by the next variable. |
| `RAG_DATABASE_PASSWORD_FILE` | no | File holding the database password. For a local run, `RAG_DATABASE_PASSWORD` may hold it instead. |
| `RAG_EMBED_URL` | yes | Base URL of a text-embeddings-inference server with an embedding model, such as `http://127.0.0.1:8530`. |
| `RAG_RERANK_URL` | yes | Base URL of a text-embeddings-inference server with a reranker model, such as `http://127.0.0.1:8531`. |
| `RAG_SOURCE_ROOTS` | no | Folders, separated by `:`, the server may index from in place, besides `MCP_FILE_ROOTS`. Links inside them are never followed. |
| `RAG_OCR_LANGUAGE` | no | Tesseract language code(s) for OCR when a call names none. Default `eng`. |
| `RAG_MAX_FILE_BYTES` | no | Largest file it reads. Default 200 MiB. |
| `RAG_EMBED_BATCH` | no | Texts per embed request. Default 32, text-embeddings-inference's default limit. |
| `RAG_RERANK_BATCH` | no | Passages per rerank request; a search with more candidates sends several. Default 32, text-embeddings-inference's default `--max-client-batch-size`. |
| `RAG_CLOUDFLARE_ACCOUNT_ID` | no | The Cloudflare account that runs Workers AI, for collections indexed there. |
| `RAG_CLOUDFLARE_API_TOKEN_FILE` | no | File holding a Cloudflare API token that may run Workers AI on that account: the account permission Workers AI Read is enough. For a local run, `RAG_CLOUDFLARE_API_TOKEN` may hold it instead. |
| `RAG_CLOUDFLARE_MODEL` | no | The Workers AI model that matches the local embedding model. Default `@cf/baai/bge-m3`, which is `BAAI/bge-m3`. |
| `RAG_CLOUDFLARE_BATCH` | no | Texts per Workers AI request. Default 64. |
| `RAG_REMOTE_CONCURRENCY` | no | Files indexed at once for a collection embedded at a remote provider. Default 8; the local endpoint always takes one at a time. |

Without them the server still starts and lists its tools, and each call that
needs one answers a `config` error naming it. Files are read from
`MCP_FILE_ROOTS` and `RAG_SOURCE_ROOTS`; that and the other variables every
server shares are in [docs/configuration.md](../../docs/configuration.md).

### The database

The server creates its tables (`rag_collection`, `rag_document`, `rag_chunk`,
`rag_meta`) on the first `create_collection`, sized for the embedding model's
vectors, and the `unaccent` extension, which a database owner may create.
pgvector is not a trusted extension: unless the server's user is a superuser,
create it once as one:

```sql
CREATE EXTENSION vector;
```

Give the server a database of its own. One database holds vectors of one
dimension, so a second embedding model needs a second database.

### Embedding providers

Each collection records where its chunks are embedded when it is indexed:

- **`local`**, the default: the embed endpoint above.
- **`cloudflare`**: [Workers AI](https://developers.cloudflare.com/workers-ai/models/bge-m3/),
  which serves `BAAI/bge-m3` as `@cf/baai/bge-m3`, and takes the embedding off
  your CPU: 100 MB of English text is about 27 million bge-m3 tokens, many
  hours of work for a CPU (see the measurements under How it works).

Questions are always embedded by the local endpoint, so a collection indexed at
Cloudflare is searched exactly like one indexed locally. That holds only while
both give the same vectors, so `create_collection` sends three probe texts to
both and refuses the provider unless every pair has a cosine similarity of at
least 0.999. `BAAI/bge-m3` served by text-embeddings-inference and
`@cf/baai/bge-m3` agree to 0.99999. Naming a provider for an existing
collection moves it there (with the same probe); what it already holds stays,
and only new chunks go to the new provider.

What it costs: Workers AI bills in neurons, and bge-m3 takes about 1,075 per
million input tokens. Every account gets 10,000 neurons a day free, about 9
million tokens; past that, an account on the Workers Free plan is refused until
00:00 UTC, and the Workers Paid plan bills $0.011 per 1,000 neurons (about
$0.012 per million tokens). `index_path` reports the requests, texts, tokens
and neurons Workers AI billed for the call, and `list_collections` the total
per collection. A spent daily allocation stops the call with a `provider`
error whose reason is `quota`; the files indexed until then stay indexed, and
the collection can go on locally meanwhile. Workers AI enforces the allocation
late: one account's requests went through to 25,666 neurons before it answered
code 4006 to every one, and that refusal still held hours after the 00:00 UTC
reset.

### The models

Any embedding and reranker models text-embeddings-inference serves will do.
For Romanian and English together, `BAAI/bge-m3` (1024 dimensions, 8192-token
context) with `BAAI/bge-reranker-v2-m3` works well. On a CPU, serve a model
with ONNX weights (`onnx/model.onnx` in its repository): text-embeddings-inference
runs those through ONNX Runtime, and its other CPU backend was five times
slower for the reranker on the same machine. `onnx-community/bge-reranker-v2-m3-ONNX`
is that reranker exported to ONNX.

## First run

1. `health`: the database, both endpoints with their models, and the
   extractors it found.
2. `create_collection` with a name.
3. `index_path` with a file or folder; `search` with a question.

## Tools

**read** changes nothing; **write** changes this server's own index, which the
files can always rebuild; `drop_collection` is marked for a person to approve
each call (see Confirmation in [docs/security.md](../../docs/security.md)).

| Tool | Access | What it does |
|---|---|---|
| `health` | read | The database (extensions, tables, dimension, collections), the embed and rerank endpoints (model, revision, dimension), the extractors on PATH with tesseract's languages, and which remote providers are configured. |
| `list_collections` | read | Every collection with its description, embedding model, provider, what a remote provider has cost it, documents and chunks. |
| `create_collection` | write | A named collection, recording the embedding model and dimension and where its chunks are embedded (a remote provider only after the probe); for an existing one, moves it to the provider named. The first one creates the tables. |
| `drop_collection` | write | Deletes a collection and everything indexed in it. The files are not touched. |
| `index_path` | write | Indexes a file or a folder: text extracted (OCR for scanned pages and images), cut into chunks with stable ids and their page or heading, and only new chunks embedded; unchanged files are passed over and do not count toward `max_files`, so a second call goes on from the first. `prune` removes sources no longer in the folder. |
| `remove_source` | write | Removes one indexed file, or every one under a folder. |
| `list_sources` | read | The indexed files of a collection, with sha256, size, pages and chunks. |
| `search` | read | Hybrid search (vectors and full text, fused by reciprocal rank) reranked; passages with source, location and scores. |
| `expand` | read | The chunks around a search result, in order. |
| `read_document` | read | A document's indexed text, chunk by chunk with locations, a page of it at a time. |

### Confirmation

`drop_collection` is a write with `confirm`: under `MCP_CONFIRM=client` the
client asks the person (MCP's `requiresUserInteraction`); under `elicit` the
server asks with the line "drop the collection NAME and everything indexed in
it".

## How it works

- **Extraction.** PDFs through `pdftotext`, page by page; the pages with fewer
  than 20 visible characters, and only those, are OCRed by `ocrmypdf
  --force-ocr --pages` (a scanned page that carries a stamped page number has a
  few characters of text, and `--skip-text` would pass it over), and their text
  is tesseract's own (`--sidecar`): pdftotext reading the OCRed layer lost the
  space before Romanian words that start with î. Images through `tesseract`.
  docx, odt, rtf, html and epub through `pandoc` to Markdown, whose headings
  become locations; pandoc runs with `--sandbox` and a 1 GiB heap, since a
  document is a ZIP or XML from anywhere. Each file's bytes are copied to a
  private temporary folder first, so a tool never opens the caller's path. A
  tool that runs past its deadline is killed with every process it started. Text
  is normalised (NFC, line endings, white space, no control characters; UTF-16
  text files with a byte order mark are read as such); for a language that
  includes `ron`, the cedilla letters `ş` and `ţ` that OCR and older documents
  produce become `ș` and `ț`, which is what a question has.
- **Chunks** are about 1200 characters, cut at paragraphs, then sentences, then
  words, never across a page or a heading. A chunk's id hashes its source, its
  location and its text, so the same text keeps its id and its embedding when a
  file is indexed again. A file is passed over when its sha256 and the way it
  was read (the language, whether OCR ran, this server's extraction version)
  are unchanged; a file whose OCR failed is read again on the next run. A file
  with no text is recorded with no chunks, so it is not read again either.
- **Indexing a folder** lists the files of the formats above, in name order,
  without following links or entering dot-named folders. `max_files` counts the
  files read in a call, not those passed over as unchanged, so calling again
  goes on where the last call stopped. `prune` removes the sources no longer in
  the folder (only its own files when `recursive` is false), once the whole
  folder has been listed.
- **Search** takes the 50 nearest chunks by cosine (HNSW, with pgvector's
  iterative scan so filters still fill the list) and the 50 best full-text
  matches of any of the question's words of three letters or more (accents
  removed on both sides), fuses them by reciprocal rank (k = 60), and lets the
  reranker read the best `candidates` (20) against the question.

Measured on one 16-vCPU AMD EPYC server with no GPU, 8 cores per model,
`bge-m3` and `bge-reranker-v2-m3` as ONNX: 1.4 chunks of 512 tokens embedded per
second, 42 ms to embed a question, 9 s to rerank 20 passages of 300 tokens and
23 s for 50. `Alibaba-NLP/gte-multilingual-reranker-base` as ONNX did the same 20
in 3.5 s.

Indexing 24,959 English documents (100 MB of text, 105,882 chunks, about 27
million tokens) on the same server: 1.74 chunks per second on the local
endpoint, 28.4 at Workers AI with 8 files at a time. A search over those
105,882 chunks takes 3.5 s before the reranker and about 16 s with it.

## Limitations

- **Formats.** No legacy `.doc`, `.ppt` or `.xls`: convert them first (for
  example `soffice --headless --convert-to docx`). No `.pptx` or `.xlsx`
  either, which pandoc does not read; a PDF of the slides works.
- **One OCR language per call.** A pair such as `ron+eng` let the English model
  strip Romanian accents in a test; index each language's files in its own call.
- **One embedding dimension per database**, and a collection only with the model
  that built it.
- **Slow on a CPU**, as measured above: index large folders in several calls
  (`max_files`) or at a remote provider, and keep `candidates` near 20.
- **One remote provider**, Cloudflare Workers AI, and only for indexing: the
  reranker and every question run on the local endpoints.
- **No scheduling.** Nothing watches the folders; call `index_path` again.

## Other servers for local RAG

Searched 2026-10-29 (the MCP registry, PyPI, GitHub). Vector database vendors
publish servers for their own databases (Qdrant's `mcp-server-qdrant`,
Chroma's `chroma-mcp`); they store and search what they are given and leave
extraction, chunking and reranking to the caller. Community servers:

- **`karaage0703/mcp-rag-server`** (Python): Markdown, text, PowerPoint and PDF
  into Postgres with pgvector, incremental indexing; no OCR, no reranker.
- **`mcpaisuite-ragmcp`** (PyPI): pluggable loaders including OCR through
  pytesseract and a pgvector backend.

This one puts what a mixed, partly scanned, non-English archive needs in one
server: OCR only where a page has no text, hybrid retrieval with
a cross-encoder reranker, file input by path through checked roots, and the
same guard, audit and confirmation as every server in this repository.
