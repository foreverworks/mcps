# <img src="icons/icon.svg" width="36" height="36" alt="Local RAG icon"> Local RAG MCP server

Let your AI assistant search your own documents and quote what they say:
contracts, scanned letters, manuals, notes. It indexes files into a Postgres
database with pgvector, finds the passages that answer a question (in any
language the models read, worded differently from the text), and hands them
back with the file and page or heading they came from. It also finds the
documents that say nearly the same thing as one you name, so duplicates can be
merged and related notes found. Embeddings and
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
- "Which notes in my notes collection say nearly the same thing as
  notes/pricing.md? List the ones I could merge, with how alike they are."
- "Before I write a new page on onboarding, show me the documents already
  closest to the old onboarding guide."
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
| `RAG_EMBED_URL` | yes | Base URL of a text-embeddings-inference server with an embedding model, such as `http://127.0.0.1:8530`: the default model. Not needed when `RAG_EMBED_MODELS` names one. |
| `RAG_EMBED_NAME` | no | The name of that model, which `create_collection` and `health` use. Default `default`. |
| `RAG_EMBED_QUERY_PROMPT` | no | The prompt questions get with that model, by the name its own configuration gives it (text-embeddings-inference's `prompt_name`), for a model trained with one. Documents never get it. |
| `RAG_EMBED_MODELS` | no | More embedding models, as a JSON object by name: `{"<name>": {"url": "...", "query_prompt": "...", "cloudflare_model": "...", "cloudflare_batch": 32}}`, only `url` required. See [Several embedding models](#several-embedding-models). |
| `RAG_RERANK_URL` | yes | Base URL of a text-embeddings-inference server with a reranker model, such as `http://127.0.0.1:8531`. |
| `RAG_QUERY_PROVIDER` | no | Query embedding and reranking: `local` (default), or `cloudflare` with automatic local fallback. Independent of a collection's indexing provider. |
| `RAG_QUERY_TIMEOUT_MS` | no | Deadline per remote inference request during search. Default 2000 ms, one attempt. |
| `RAG_LOCAL_ONLY_COLLECTIONS` | no | Collection names, separated by commas, whose questions and passages never leave this machine, even with `RAG_QUERY_PROVIDER=cloudflare`. A search that names no collections leaves them out. See [Local-only collections](#local-only-collections). |
| `RAG_SOURCE_ROOTS` | no | Folders, separated by `:`, the server may index from in place, besides `MCP_FILE_ROOTS`. Links inside them are never followed. |
| `RAG_OCR_LANGUAGE` | no | Tesseract language code(s) for OCR when a call names none. Default `eng`. |
| `RAG_MAX_FILE_BYTES` | no | Largest file it reads. Default 200 MiB. |
| `RAG_EMBED_BATCH` | no | Texts per embed request. Default 32, text-embeddings-inference's default limit. |
| `RAG_RERANK_BATCH` | no | Passages per rerank request; a search with more candidates sends several. Default 32, text-embeddings-inference's default `--max-client-batch-size`. |
| `RAG_CLOUDFLARE_ACCOUNT_ID` | no | The Cloudflare account that runs Workers AI, for collections indexed there. |
| `RAG_CLOUDFLARE_API_TOKEN_FILE` | no | File holding a Cloudflare API token that may run Workers AI on that account: the account permission Workers AI Read is enough. For a local run, `RAG_CLOUDFLARE_API_TOKEN` may hold it instead. |
| `RAG_CLOUDFLARE_MODEL` | no | The Workers AI model that matches the default embedding model. Default `@cf/baai/bge-m3`, which is `BAAI/bge-m3`. |
| `RAG_CLOUDFLARE_BATCH` | no | Texts per Workers AI request. Default 64. |
| `RAG_CLOUDFLARE_RERANK_MODEL` | no | Remote relevance model: `@cf/baai/bge-reranker-base` (default), `@cf/cloudflare/clef-flash`, or `@cf/cloudflare/clef`. Decision models score each passage on a fixed five-level rubric. |
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
dimension, so a model of another dimension needs a second database; models of
the same dimension share one.

Each collection has an HNSW index of its own, partial on the collection's name,
as pgvector advises for filtering by a few values: a search reads only its
collection's graph, and collections embedded by different models never share
one. Tables made by an earlier version had one index for every collection
(`rag_chunk_embedding`); `health` lists the collections still without their own,
and `create_collection` with each one's name builds it (concurrently: search and
indexing go on meanwhile; 105,882 chunks took about three minutes) and drops the
shared index once no collection needs it.

### Several embedding models

A collection is embedded by one model, which the server finds again by the
model and revision it recorded: `create_collection` takes `embedding_model`, the
name `health` lists, and a collection keeps that model for good. The models are
`RAG_EMBED_URL` (the default) and the ones `RAG_EMBED_MODELS` names, each served
by its own endpoint. A search over collections built with different models
embeds the question once per model and fuses each model's nearest chunks as a
ranked list of its own, since cosines from two models do not compare; the
reranker then reads them all against the question.

```json
{
  "qwen3-0.6b": {
    "url": "http://127.0.0.1:8532",
    "query_prompt": "query",
    "cloudflare_model": "@cf/qwen/qwen3-embedding-0.6b",
    "cloudflare_batch": 32
  }
}
```

`query_prompt` names a prompt from the model's own sentence-transformers
configuration, which text-embeddings-inference puts before the question.
`Qwen/Qwen3-Embedding-0.6B` defines `query` as `Instruct: Given a web search
query, retrieve relevant passages that answer the query` and a new line, and
Qwen says retrieval loses 1 to 5% without it; bge-m3 needs none. Naming the
prompt rather than writing it here keeps the model's own text, which holds a
new line an environment file would mangle. `cloudflare_model` and
`cloudflare_batch` are that model's counterpart at Workers AI and the texts it
takes per request (Qwen3's takes 32); without them the model indexes locally
only.

### Embedding providers

Each collection records where its chunks are embedded when it is indexed:

- **`local`**, the default: the embed endpoint above.
- **`cloudflare`**: [Workers AI](https://developers.cloudflare.com/workers-ai/models/bge-m3/),
  which serves `BAAI/bge-m3` as `@cf/baai/bge-m3`, and takes the embedding off
  your CPU: 100 MB of English text is about 27 million bge-m3 tokens, many
  hours of work for a CPU (see the measurements under How it works).

Questions use the configured query provider (local by default), independently
of where documents were embedded. That holds only while
both give the same vectors, so `create_collection` sends three probe texts to
both and refuses the provider unless every pair has a cosine similarity of at
least 0.999. `BAAI/bge-m3` served by text-embeddings-inference and
`@cf/baai/bge-m3` agree to 0.99999. `Qwen/Qwen3-Embedding-0.6B` is
`@cf/qwen/qwen3-embedding-0.6b`. Naming a provider for an existing
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
is that reranker exported to ONNX. `Qwen/Qwen3-Embedding-0.6B` (1024
dimensions, Apache-2.0) has no ONNX weights and runs on the other backend; on
the server measured below it embeds a question in about 0.7 s and holds 2.7 GiB.

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
| `snapshot_collections` | write | Freeze copies of collections and their stored vectors in one local database snapshot. Excluded from default search; explicitly name copies to compare inference settings. |
| `drop_collection` | write | Deletes a collection and everything indexed in it. The files are not touched. |
| `index_path` | write | Indexes a file or a folder: text extracted (OCR for scanned pages and images), cut into chunks with stable ids and their page or heading, and only new chunks embedded; unchanged files are passed over and do not count toward `max_files`, so a second call goes on from the first. `prune` removes sources no longer in the folder. |
| `remove_source` | write | Removes one indexed file, or every one under a folder. |
| `list_sources` | read | The indexed files of a collection, with sha256, size, pages and chunks. |
| `search` | read | Hybrid search (vectors and full text, fused by reciprocal rank) reranked, optionally over several phrasings of the question merged; passages with source, location and scores. |
| `expand` | read | The chunks around a search result, in order. |
| `similar` | read | The documents of a collection that say most nearly the same thing as one you name: a score (1 for identical text), how much of each is found in the other, and the closest pair of passages. For duplicates to merge, related documents, or a document's neighbours before you write a new one. |
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
- **Search** takes the 50 nearest chunks by cosine (each collection's own HNSW
  index, with pgvector's iterative scan so a source filter still fills the
  list; one list per embedding model) and the 50 best full-text
  matches of any of the question's words of three letters or more (accents
  removed on both sides), fuses them by reciprocal rank (k = 60), and lets the
  reranker read the best `candidates` (20) against the question.
- **Other phrasings** (`also`, up to 4) are each retrieved the same way, in
  parallel; their fused lists are fused again (the question's own first on
  ties), and the reranker still reads the best `candidates` against the
  question as asked. A client writes them before it searches: a keyword
  version, a rewording, and for a question in another language than the
  documents a translation. Words the question lacks (a synonym, the documents'
  language) reach the full-text half that way, and the cost is one more
  embedding and two queries per phrasing, not more reranking.
- **Similar documents** (`similar`) compare vectors that are already stored, so
  no model is called. Each chunk of the document you name (64 spread evenly
  through it, the first and the last included, when it has more) looks up its
  `candidates` (10) nearest chunks outside the document, through the
  collection's own HNSW index, and the documents holding those chunks are the
  candidates. Each candidate is then scored exactly, in the same SQL statement,
  so no vector leaves the database. `forward` is the mean, over the named
  document's chunks, of the highest cosine to any chunk of the candidate: how
  much of the document the candidate says again. `backward` is the same the
  other way round: how much of the candidate the document says. `score` is
  their mean, so identical documents score 1 and a pair scores the same
  whichever one you start from. Being a mean of cosine similarities it is
  near 0 for unrelated documents and can in principle fall below 0, which the
  default `min_score` of 0 leaves out. A short note found inside a long report
  scores high one way and low the other, which is why both halves are shown.
  `best` is the single closest pair of chunks, each with its id and location
  for `expand`. A candidate of more than 64 chunks is sampled the same way, and
  its entry says so (`sampled`), as the reply does for the named document.
  Results are ordered by the score shown (four decimals), then by source. A
  call that runs past 15 seconds, as one would if the collection had no vector
  index of its own, is cancelled with an error that suggests a smaller
  `candidates`, so it holds a database connection that `search` needs for no
  more than 15 seconds.

Measured on one 16-vCPU AMD EPYC server with no GPU, 8 cores per model,
`bge-m3` and `bge-reranker-v2-m3` as ONNX: 1.4 chunks of 512 tokens embedded per
second, 42 ms to embed a question, 9 s to rerank 20 passages of 300 tokens and
23 s for 50. `Alibaba-NLP/gte-multilingual-reranker-base` as ONNX did the same 20
in 3.5 s.

Indexing 24,959 English documents (100 MB of text, 105,882 chunks, about 27
million tokens) on the same server: 1.74 chunks per second on the local
endpoint, 28.4 at Workers AI with 8 files at a time. A search over those
105,882 chunks takes 3.5 s before the reranker and about 16 s with it.

On 100 questions over that corpus, each with every file that answers it,
`gte-multilingual-reranker-base` reranking 20 candidates: the first result
held the answer for 54 questions alone and for 64 with two or three
rephrasings in `also` (10 won, none lost, McNemar p = 0.002), in the same 5 s.
50 candidates instead of 20 gave 58 (not significant) and took 11 s; without
the reranker, 38.

### Query inference at Workers AI

Set `RAG_QUERY_PROVIDER=cloudflare` to send questions to the same Workers AI
embedding model and candidate passages to `RAG_CLOUDFLARE_RERANK_MODEL`.
The database, hybrid retrieval and document indexing stay where configured.
Before remote query vectors enter a local index, three English and Romanian
probe texts must agree with its local model at cosine >= 0.999. Successful
probes expire after an hour and are keyed by local revision and remote model.
Named local query prompts fall back locally until they have a remote mapping.

Each remote request has one attempt and a deadline (`RAG_QUERY_TIMEOUT_MS`,
2000 ms by default). Missing configuration, refusal, quota, rate limits,
timeouts, incompatible vectors and invalid responses fall back to the local
endpoint. The next call tries Cloudflare again. If a rerank batch fails, every
candidate is reranked locally so scores from different models never mix.
`search` returns `inference` with the actual provider, model, elapsed time,
reported usage and a closed fallback category. The same metadata goes to stderr
when Cloudflare is selected; it never includes queries, passages or API errors.
`health.query_inference` reports configuration and successful compatibility
probes, without making a remote request. `search.local_inference=true` forces
local inference for a single comparison or a private query; collections in
`RAG_LOCAL_ONLY_COLLECTIONS` always get it ([below](#local-only-collections)).
`search.inference_timeout_ms` sets a remote deadline for one call, including a
very short budget to verify fallback and recovery without disrupting the service.
`search.reranker_model` selects a remote relevance model for one comparison.
The Clef models rate each passage independently against the same query and a
fixed rubric, from unrelated to directly answering the central question. All
scores must be present, finite and inside the rubric; otherwise every candidate
falls back to the local reranker. Clef reports input tokens rather than neurons;
an absent neuron count is unknown, not evidence that an inference was free.

### Local-only collections

Some collections should never be sent anywhere: a journal, notes you would not
paste into a web form. List their names in `RAG_LOCAL_ONLY_COLLECTIONS` (for
example `private,journal`) and the server keeps what you ask about them, and
what it finds in them, on your machine, whatever else is configured:

- A search whose scope includes one embeds the question and reranks the
  candidates with your own embed and rerank servers only, even when
  `RAG_QUERY_PROVIDER=cloudflare`. A caller cannot turn this off:
  `inference_timeout_ms` and `reranker_model` are ignored for such a search,
  and the reply lists the collections under `local_only`. A scope that mixes
  one with regular collections runs entirely local too, since the question and
  the candidates of every collection are processed together.
- A search that names no collections leaves them out, as it leaves out
  snapshots, so a broad question does not surface them by accident. They are
  searched when named in `collections`.
- Their chunks are never embedded at a remote provider. `create_collection`
  and `index_path` refuse a collection that would be, with an error naming the
  variable; one embedded at a remote provider before you listed it is refused
  until `create_collection` with `embedding_provider: "local"` moves it, which
  does not embed again what it holds.
- `snapshot_collections` refuses them: a copy has a name of its own and would
  no longer be local-only.
- `health.local_only_collections` lists the names, sorted. Names are matched
  exactly as written, and a name applies as soon as a collection of that name
  exists.

The cost is speed: local inference is slower than Workers AI, and a search that
holds a local-only collection is as slow as `RAG_QUERY_PROVIDER=local`. Fewer
`candidates`, or `rerank: false`, shortens it. This protects what the server
sends to a remote provider; anyone who can call the server's tools can still
read these collections.

For reproducible comparisons, `snapshot_collections` (write) freezes several
collections in one database snapshot, copying their existing vectors locally.
Snapshots cannot be indexed or pruned, and default searches exclude them.
Name them explicitly in `search.collections`; remove them with `drop_collection`.

## Limitations

- **Formats.** No legacy `.doc`, `.ppt` or `.xls`: convert them first (for
  example `soffice --headless --convert-to docx`). No `.pptx` or `.xlsx`
  either, which pandoc does not read; a PDF of the slides works.
- **One OCR language per call.** A pair such as `ron+eng` let the English model
  strip Romanian accents in a test; index each language's files in its own call.
- **One embedding dimension per database**, and a collection only with the model
  that built it: another model means another collection, indexed again.
- **Slow on a CPU**, as measured above: index large folders in several calls
  (`max_files`) or at a remote provider, and keep `candidates` near 20.
- **One remote provider**, Cloudflare Workers AI, supported for indexing and
  optional query inference. Its reranker differs from the local one; evaluate
  it on your language and corpus before choosing it.
- **No scheduling.** Nothing watches the folders; call `index_path` again.
- **`similar` compares a sample of a long document.** One of more than 64 chunks
  is compared by 64 spread evenly through it, so a change confined to the
  chunks between them goes unseen; `sampled`, on the reply for the document you
  name and on each result, says when this happened. It finds
  candidates through each chunk's nearest chunks only, so a document that
  matches a source only weakly, or whose matches are crowded out by many copies,
  may need a larger `candidates`.

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
