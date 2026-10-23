# <img src="icons/icon.svg" width="36" height="36" alt="Trademark search icon"> Trademark search MCP server

Check from your AI assistant whether a name is already a registered or pending
trademark in the US ([USPTO](https://www.uspto.gov)) and the EU
([EUIPO](https://euipo.europa.eu)), by Nice class and by the words of a mark's
goods and services, before you buy the domain or draw the logo. Read one mark,
and follow a US mark's file step by step, its documents saved as a PDF. Every
tool only reads public registers: nothing is filed, and the one file written
is that PDF, in the server's own outbox.

**You need** nothing to search the US: no account and no key. A US mark's
history and documents need a free USPTO TSDR API key. EU marks need an EUIPO
app's client id and secret with a Trademark Search subscription, which EUIPO
approves by hand (allow a week or more). Romania's OSIM, WIPO and the other
national offices are not searched, and every result says so.

## What you can ask

- "Is Turnip already a trademark for software, in the US or the EU?"
- "Search Blue Night in classes 9 and 42, dead marks included, and show me what
  sounds alike."
- "Which live US marks contain the word talon and cover mobile applications?"
- "What happened in the file of the closest US match? Was it opposed?"
- "Save the office actions in that mark's file since January 2025 as one PDF."

## Install

<!-- install:begin -->
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=trademarks&inputs=%5B%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22uspto_tsdr_api_key_file%22%2C%22description%22%3A%22Optional.%20For%20US%20mark%20histories%20and%20documents%3A%20path%20of%20a%20file%20holding%20a%20USPTO%20TSDR%20API%20key.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22euipo_client_id_file%22%2C%22description%22%3A%22Optional.%20For%20EU%20marks%3A%20path%20of%20a%20file%20holding%20the%20EUIPO%20app's%20client%20id.%22%7D%2C%7B%22type%22%3A%22promptString%22%2C%22id%22%3A%22euipo_client_secret_file%22%2C%22description%22%3A%22Optional.%20For%20EU%20marks%3A%20path%20of%20a%20file%20holding%20the%20EUIPO%20app's%20client%20secret.%22%7D%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40foreverworks%2Fmcp-trademarks%22%5D%2C%22env%22%3A%7B%22USPTO_TSDR_API_KEY_FILE%22%3A%22%24%7Binput%3Auspto_tsdr_api_key_file%7D%22%2C%22EUIPO_CLIENT_ID_FILE%22%3A%22%24%7Binput%3Aeuipo_client_id_file%7D%22%2C%22EUIPO_CLIENT_SECRET_FILE%22%3A%22%24%7Binput%3Aeuipo_client_secret_file%7D%22%7D%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=trademarks&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBmb3JldmVyd29ya3MvbWNwLXRyYWRlbWFya3MiXSwiZW52Ijp7IlVTUFRPX1RTRFJfQVBJX0tFWV9GSUxFIjoiJHtlbnY6VVNQVE9fVFNEUl9BUElfS0VZX0ZJTEV9IiwiRVVJUE9fQ0xJRU5UX0lEX0ZJTEUiOiIke2VudjpFVUlQT19DTElFTlRfSURfRklMRX0iLCJFVUlQT19DTElFTlRfU0VDUkVUX0ZJTEUiOiIke2VudjpFVUlQT19DTElFTlRfU0VDUkVUX0ZJTEV9In19) [![Download for Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Download_Bundle-D97757?style=flat-square&logo=claude&logoColor=white)](https://github.com/foreverworks/mcps/releases/latest/download/mcp-trademarks.mcpb)

> [!NOTE]
> `@foreverworks/mcp-trademarks` is not on npm yet: the buttons and the `npx` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).

With Claude Code:

```bash
claude mcp add trademarks -- npx -y @foreverworks/mcp-trademarks
```

Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:

```json
{
  "mcpServers": {
    "trademarks": {
      "command": "npx",
      "args": ["-y", "@foreverworks/mcp-trademarks"]
    }
  }
}
```

Each runs the published package on Node 22.19 or newer. VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty. Cursor reads each from your environment instead (`${env:USPTO_TSDR_API_KEY_FILE}` and so on), so set them before you start Cursor. Every setting is optional; [Configuration](#configuration) says which ones you need for which tools.

### From a clone

```bash
git clone https://github.com/foreverworks/mcps.git && cd mcps
npm ci && npm run build
claude mcp add trademarks -- node "$PWD/servers/trademarks/dist/index.js"
```

In a JSON configuration, the command is `node` and its one argument the full path of `servers/trademarks/dist/index.js`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).
<!-- install:end -->

## Configuration

Every setting is optional. A missing credential never stops the server: its
source shows as `not_configured` in `health`, a search marks its office as not
searched, and the TSDR tools answer a `config` failure, each with the remedy.

| Variable | Required | Meaning |
|---|---|---|
| `USPTO_TSDR_API_KEY_FILE` | for US files | File holding a USPTO TSDR API key (`USPTO_TSDR_API_KEY` for a local run). |
| `EUIPO_CLIENT_ID_FILE`, `EUIPO_CLIENT_SECRET_FILE` | for EM | Files holding the EUIPO app's client id and secret (`EUIPO_CLIENT_ID` and `EUIPO_CLIENT_SECRET` for a local run). |
| `EUIPO_ENVIRONMENT` | no | `production` (unset) or `sandbox`, which holds test data. |
| `TRADEMARKS_SOURCES` | no | Which sources run, comma-separated: `uspto`, `euipo`, `tsdr`. Unset is all three. |
| `TRADEMARKS_OUTBOX_DIR` | no | Where `download_mark_documents` saves its PDFs; default `outbox/` in the state folder. Files are 0640, so a deployment can share the folder with the user's group. |
| `TRADEMARKS_STATE_DIR` | no | The state folder; the default is in [docs/configuration.md](../../docs/configuration.md). |
| `TRADEMARKS_USPTO_URL` | no | The USPTO search backend's base; unset is `https://tmsearch.uspto.gov/prod-stage-v1-0-0/`. |
| `TRADEMARKS_TSDR_URL` | no | TSDR's base; unset is `https://tsdrapi.uspto.gov/ts/cd`. |

What each tool needs:

| Tools | Office | Needs |
|---|---|---|
| `search_marks`, `get_mark` | US | Nothing. |
| `search_marks`, `get_mark` | EM | The EUIPO client id and secret, with an approved subscription. |
| `mark_history`, `mark_documents`, `download_mark_documents` | US | The TSDR API key. |

### Getting a USPTO TSDR API key

1. Create a USPTO.gov account at <https://account.uspto.gov>: free, with
   two-step sign-in and no identity verification (unlike the Open Data
   Portal's key, which needs ID.me).
2. Open the API key manager,
   <https://account.uspto.gov/profile/api-manager>, and request a key for the
   **TSDR API**. An Open Data Portal key is a different key, which TSDR
   refuses.
3. Write the key to a file only the server's user can read, and point
   `USPTO_TSDR_API_KEY_FILE` at it. A key expires after a year; the manager
   shows when, and renews it.

### Getting EUIPO credentials

1. Create an EUIPO user account, and sign in at <https://dev.euipo.europa.eu>.
2. Under Apps, register an app. It gets a client id and a secret: write each
   to a file only the server's user can read.
3. Subscribe the app to the Trademark Search product (production, or sandbox
   for test data), accepting its terms of use. "Most subscription requests
   are subject to approval", and EUIPO emails the account when it approves.
   Until then, EUIPO issues a token but refuses the call, and `health` shows
   EM as `pending`.

The server reaches `tmsearch.uspto.gov`, `tsdrapi.uspto.gov`,
`api.euipo.europa.eu` and `euipo.europa.eu` (the token endpoint), and, when
the sandbox is used, `api-sandbox.euipo.europa.eu` and
`auth-sandbox.euipo.europa.eu`; a deployment that sets `MCP_EGRESS_ALLOW` must
allow them. The variables every server shares (transport, limits, egress) are
in [docs/configuration.md](../../docs/configuration.md).

## First run

1. Ask your assistant to run the trademark server's `health` check: each
   source's state, with what it needs. `ok` is true when at least one source
   searches and no configured source fails, so `pending` and `not_configured`
   do not fail a deployment's health check.
2. Search a name you know is taken, in its classes, to see what a hit looks
   like before you rely on a miss.

## Tools

Every tool is **read**: it changes nothing anywhere, and
`download_mark_documents` writes only into the server's own outbox.

| Tool | Access | What it does |
|---|---|---|
| `health` | read | Each source's state (`ok`, `not_configured` with what it needs, `pending` while the register approves access, `failing`), whether it is an official API, what `similar` reaches there, and the offices no source covers, with the reason. |
| `search_marks` | read | One name in every office at once (or the ones named). Per office: the marks found, closest first, with status, owners, classes, filing date, the office's link and a similarity score, and counts per relation. One request per office. |
| `get_mark` | read | One mark by office and number: status, owners, each class's goods and services (cut at 600 characters), and the dates the office publishes (filing and registration from both; the status date and expiry from EUIPO only, since USPTO's search gives neither). |
| `mark_history` | read | A US mark's status in USPTO's words, with its code and date, and every step of its file, newest first, from USPTO's official TSDR API. |
| `mark_documents` | read | The documents in a US mark's file, newest first: date, type code, description, incoming or outgoing, pages. |
| `download_mark_documents` | read | The documents a type code and a date window pick, as one PDF in the outbox, with its path, SHA-256 and size. Without a filter it is the whole file, hundreds of pages for an old mark. USPTO allows 4 a minute. |

`search_marks` takes the `name` as written (a name, not a pattern: no `*`);
`offices` (`EM`, `US`, `RO`, `WO`, default all four, so those not searched say
so); `classes` (Nice classes 1 to 45, default every class); `goods`, words
that must appear together, in order, in a mark's goods and services; `match`:
`exact` (the mark is the name), `word` (it contains the name) or `similar`
(the default: also what sounds alike or is a letter off); `status`: `live`
(the default: registered and pending) or `all`; and `limit`, the marks listed
per office (1 to 100, default 20).

## Troubleshooting

**An office says `searched: false`.** Read its `reason` or `error`. RO and WO
are never searched here, and the reason says where a person can look; EM with
a `config` error means no EUIPO credentials yet. An office not searched is not
clear.

**`config` from the TSDR tools.** There is no TSDR key: get one
([above](#getting-a-uspto-tsdr-api-key)), or read the mark's file by hand at
tsdr.uspto.gov.

**`auth`.** From TSDR: check in the API key manager that the key is a TSDR
API key (an Open Data Portal key is refused) and has not expired. From EUIPO:
compare the client id and secret with the app's, under Apps at
dev.euipo.europa.eu.

**`subscription`, or EM `pending` in `health`.** EUIPO accepted the app but
not the call: its Trademark Search subscription is missing or still waiting
for approval ([step 3](#getting-euipo-credentials)). Until then, search EU
marks by hand at <https://euipo.europa.eu/eSearch>.

**`not_found`.** A USPTO serial number has 8 digits, an EUIPO application
number 9, leading zeros included.

**`unsupported`.** That office has no source here, or EM was asked for a
mark's file, which EUIPO's API does not give. The message says where to look.

**`rate_limited`.** The register was still throttling after three tries
(TSDR allows 60 reads a minute and 4 document downloads): wait a minute and
ask for less at a time.

**`api`.** A refusal, a server error that outlived its retries, or no
connection (status 0). Retry in a minute; if it persists, run `health`. A 401
or 403 from USPTO's search may mean it now requires its page's browser
challenge, which this server never answers.

**`drift`.** The register answered in a shape this server does not know, or
refused a query the server built. The US search is an undocumented backend
USPTO may change without notice; please report it.

## How it works

### What a result says

Each office answers in its own section, in one of three ways: searched
(`found`, the register's own count of candidates; `examined`, how many came
back; `more` when it holds more than that; `counts` and `marks`); not searched
because no source covers the office (`reason`, with where a person can look);
or not searched because its source failed or has no credentials (`error` with
its `remedy`). So an empty `marks` list always means "searched, nothing
found", never "could not look".

- **The relation is computed here**, the same for every office. Case, accents,
  spaces and punctuation are ignored, so "Blue Night", "BLUENIGHT" and
  "blue-night" are `identical`; a mark holding the name (TURNIP QPT, STURNIP)
  `contains` it; anything else the source returned is `similar`.
- **Registers find by words.** A two-word name searched at USPTO finds the
  marks written as one word and as two alike, while the same name searched as
  one word misses marks written as two. Search a compound spaced as well.
- **Goods are filtered by the register**, so only where its source can. USPTO's
  search can; EUIPO's search API cannot (goods and services come only with one
  mark's details). Each searched office says which in `goods_filter`:
  `applied`, or `unsupported`, its marks then listed unfiltered. Classes say
  where a mark could conflict; goods say whether it really does, as class 9
  covers both software and sunglasses.
- **Order:** identical marks, then those containing the name, then similar
  ones. Within the first two, registered before pending; within similar ones,
  the most alike first by the score below, then the source's own relevance.
- **A mark's `classes` are those it covers now.** USPTO lists a class it has
  cancelled from a mark as "(CANCELLED) IC 035", and such a class does not
  count for a class filter. A dead mark keeps the classes it had.

### The similarity score

Every mark with words carries `similarity`, 0 to 100, computed here the same
way for every office, so USPTO and EUIPO candidates share one scale. Half is
how the marks are written: the edit distance between the folded texts (TURNIP
and DURNIP are one letter apart). Half is how they sound: the edit distance
between phonetic keys, which rewrite the spellings of one sound (ph and f, ck
and k, a soft c or g, a silent gh or final e), put letters that sound alike in
one class (d and t, b and p, m and n, every vowel), and collapse repeats, so
TURNIP, DURNIP, TERNIP and DURNNIP share one key. TURNIP scores 100 against
TURNIP, 92 against DURNIP and 67 against TURNIP QPT: the score compares whole
marks, so a mark that contains the name scores lower the more it adds, and its
`relation` says it contains the name. The keys suit names in the Latin
alphabet. The score knows nothing of goods and services or of what an examiner
would decide, and a logo with no words has none.

### Sources (researched 2026-10-05)

| Office | Source | Status here |
|---|---|---|
| US (USPTO) | search backend of tmsearch.uspto.gov | **used**, unofficial, no key |
| US (USPTO) | TSDR API, a mark's file | **used with a key**, official |
| EM (EUIPO) | Trademark Search API, dev.euipo.europa.eu | **used once credentials exist**, official |
| RO (OSIM) | api.osim.ro:8443/tm-registry; TMview | not searched |
| WO (WIPO) | Global Brand Database | not searched |
| many (TMview) | tmdn.org/tmview front-end JSON | not used |

Each source gets one request at a time across every session the process
serves: USPTO's search one a second, TSDR one a second and a document bundle
every fifteen seconds, EUIPO four a second. A 429 or a server error is tried
up to three times.

**USPTO search.** USPTO's documented APIs do not search by name: TSDR answers
by serial or registration number only, and the Open Data Portal
(data.uspto.gov) offers bulk data (since 2026-06-18 only to a USPTO.gov
account with MFA and, for its API key, ID.me verification). So the server uses
the backend of USPTO's own Trademark Search page: its public
`https://tmsearch.uspto.gov/configuration.json` names the base
(`serviceUrlSearchElastic`), and `POST <base>tmsearch` takes the
Elasticsearch query the page builds (`buildQueryTree` in its bundle). It
answers a plain request with an honest User-Agent, no key and no challenge.
The page loads an AWS WAF challenge script, whose token the backend did not
require when this was researched; this server never answers or imitates it.

- **Terms:** USPTO's "Terms of Use for USPTO websites" (updated 2026-08-13)
  deny access to whoever generates "unusually high numbers of database
  accesses (searches, pages, or hits), whether generated manually or in an
  automated fashion", and say the online databases are not a source for bulk
  downloads. They do not forbid automated access as such, and US government
  records are not under copyright. One request per name, at most one a
  second, is far below either line.
- **Risk:** the backend is undocumented and unversioned, so `health` marks it
  `official: false` ([Limitations](#limitations)).
- **Goods and services** are the index's `GS` field, asked as the page's own
  refinement asks (`match_phrase`), through USPTO's analyser. The index keeps
  the text of classes a mark has cancelled, so a mark whose words appear only
  there is left out; one whose words appear nowhere in its text (USPTO matched
  a plural or a stem) is kept.
- **`similar` reaches** the index's phonetic field (`WMP5`: a d for a t,
  another vowel, a doubled letter), a prefix match, one or two letters' edit
  distance, and recorded translations: a mark recorded as meaning the name
  matches it, and comes back with its `translation`.

**TSDR** is USPTO's official Trademark Status and Document Retrieval API ("TSDR
API v1"), with the key in the `USPTO-API-KEY` header.
`GET /casestatus/sn<serial>/info` gives the status (USPTO's code, its sentence
`extStatusDesc`, the summary `tm5StatusDesc` such as "LIVE/REGISTRATION/Issued
and Active", and the key dates) and `prosecutionHistory`, every step with its
date, code and description; a step's date is a timestamp at Eastern midnight,
so the day is its first ten characters. `GET /casedocs/sn<serial>/info` lists
the documents, as XML only (JSON gets a 406), with no id of their own, so a
download picks by type and date:
`GET /casedocs/bundle.pdf?sn=&type=&fromDate=&toDate=`, saved and checked to
start as a PDF does. A mark is `registered`, `pending` or `dead` by its
summary's first words, the same rule `search_marks` uses. `health` reads the
status of USPTO's own documentation example (`78787878`). The shapes were
recorded from public serials; the test fixtures invent every name, number,
address and date.

**EUIPO.** The Trademark Search API (OpenAPI 1.1.0, from
dev.euipo.europa.eu/product/trademark-search_110) covers EU trade marks and
international registrations designating the EU: `GET /trademarks` with an
RSQL `query` (the verbal element supports `==` with `*` wildcards; no fuzzy or
phonetic search), classes, status and pages of 10 to 100, and
`GET /trademarks/{applicationNumber}` for one mark; 25,000 calls a day on the
default plan. "Subscription requests for the Sandbox environment can take up
to a week. However, requests for the Production environment may take a bit
longer" (Getting started). Auth is OAuth2 client credentials (scope `uid`) at
EUIPO's token endpoint, giving a two-hour token kept in memory only, plus
`X-IBM-Client-Id` on every request. EUIPO withholds an applicant's name until
the filing fee is paid, so such a mark lists no owners.

- **Not yet run against the live API.** The adapter is built to the spec and
  tested against it. Two things the spec leaves open are handled defensively:
  whether `==` ignores case (each comparison is asked in the name's own,
  upper, lower and title case), and whether `*` works inside a quoted value (a
  name is quoted only when it holds a space or an RSQL character).

**Not searched.**

- **OSIM (Romania):** its own search (`https://api.osim.ro:8443/tm-registry`)
  redirects every visitor to a reCAPTCHA page, and OSIM publishes no API. An
  EU mark also covers Romania, so EM answers part of the question.
- **WIPO:** the Global Brand Database has no public API (the one in WIPO's
  catalogue is for collaborating IP offices); its terms forbid automated
  queries, bulk downloading and scraping, and call more than 10 search actions
  a minute from one IP excessive
  (wipo.int/en/web/global-brand-database/terms_and_conditions, section 2.1);
  its pages carry a proof-of-work captcha. International registrations still
  show up where they designate the EU (EM) or the US (serial numbers
  79xxxxxx).
- **TMview** (tmdn.org/tmview) covers EUIPO, OSIM, USPTO, WIPO and most
  national offices in one search, from an undocumented JSON backend
  (`POST /tmview/api/search/results`) that resets any connection whose
  User-Agent is not a browser's, so using it means passing as a browser. The
  legal notice tmdn.org's legal page leads to
  (euipn.org/en/info/legal-notices, read 2026-10-05) reserves the data "by any
  means, including bots, scrapers, or other automated processes", "except as
  specifically and explicitly authorised by the EUIPO in writing"
  (`TDM-RESERVATION: 1`). With that authorisation it would be the one source
  for every office; until then, check RO and the rest there by hand.

### Trying it

`npx tsx scripts/smoke.ts [name ...]` drives the built server against the
real registers: `health`, each name in classes 9, 35 and 42 in every office,
then `get_mark` on the first US mark found. A search takes about a second,
nearly all of it the one US request.

## Limitations

- **A name check, not a clearance opinion.** Likelihood of confusion also
  turns on goods and services, and on similarity no string comparison sees.
- **The US search is undocumented and unofficial.** USPTO can change or close
  it without notice; a shape the server does not know fails as `drift`, never
  as "nothing found".
- **RO (OSIM), WO (WIPO) and the offices only TMview covers are not
  searched.** Each result says so, and where a person can look.
- **EUIPO's search is by words**: no phonetic or fuzzy match there, so
  `similar` reaches less in EM than in the US.
- **A mark's file comes from the US only.** EUIPO's API gives an EU mark's
  status and status date, not its history or documents.

## Other servers for trademark registers

Searched 2026-10-15. No trademark office publishes one: none from USPTO,
EUIPO, WIPO or OSIM in the MCP Registry, on their sites or on GitHub. What
else exists:

- **Clarivate's CompuMark Trademark MCP**: remote, needs a CompuMark
  subscription, claims 188 databases.
- **MarkMesh**: remote, an API key, more than 30 registers, a monthly fee
  after a trial.
- None was found from Corsearch, Markify or Trademarkia.
- **Antevo's trademark server**: remote and free, no account; screens a name
  in 19 registers including US and EM, some through TMview, with no class
  filter and no lookup by number.
- **TrademarkMind**: remote; covers the US register and WIPO's Madrid
  register, and checks logos too; its operator is unnamed.
- **`patent_mcp_server`**: open source; covers the US only, through the same
  USPTO backend as this one.
- **Others** cover the US alone (Goalie IP, GleanMark) or look up a US mark by
  number.

None of them combines what this one does: it asks each office directly and
nothing else, so a name under consideration reaches no third party; it uses
only sources whose terms do not forbid automated access, never answers USPTO's
bot challenge, and does not use TMview or WIPO; every office answers for
itself, and one not searched says why instead of reading as clear; it filters
by Nice class and reads one mark by number in both offices; and it runs
self-hosted. The services above reach more offices: for RO and the rest, they
or TMview by hand are the wider net.
