# Contributing

Thank you for helping. This repository is one toolchain for many MCP servers,
and the point of that is that they read alike: a fix in one should be easy to
carry to the others, and a reader who knows one server knows where everything
is in the next. So most of this page is the house style.

## Setup

Node 22.19 or newer, npm 10 or newer.

```bash
npm ci          # once, at the root: workspaces share one lockfile
npm run check   # typecheck, tests, build, then the docs check, for every workspace
```

Every server imports `packages/mcp-kit` (and the delivery-app servers
`packages/receipts`) from their `dist/`, so the root `build`, `test` and
`typecheck` build those two first (`npm run kit`). A command for one workspace
does not, so on a fresh clone run `npm run kit` once before
`npm run build -w @foreverworks/mcp-oblio` and the same for `test`,
`typecheck` and `dev` (`tsx src/index.ts`).

`npm run check` is the bar for a change:

- `typecheck` covers `test/` and `scripts/` as well as `src/` (each workspace has
  a `tsconfig.test.json` for exactly that).
- `test` runs every workspace's tests in isolation: `packages/mcp-kit/testing/isolate.ts`
  empties the environment, points HOME at a temp dir, pins the time zone to UTC
  and makes `fetch` refuse anything but loopback. A test that needs the network
  stubs it.
- `build` is what runs: a deployment executes `servers/<name>/dist/index.js`, and
  `dist/` is not in git.
- `check:docs` (`scripts/check-docs.ts`) starts every built server with an empty
  environment and fails when a README's tool tables or configuration disagree
  with the code (see [Writing a server's README](#writing-a-servers-readme)).
- `check:pack` (`scripts/check-pack.ts`) lists what npm would publish for each
  workspace and fails on anything that is not package.json, README, LICENSE,
  a tracked doc, or a dist file compiled from a tracked source. Every build
  empties `dist/` first (`scripts/clean-dist.mjs`), so a stale checkout cannot
  ship what an earlier layout left behind.

"The tests pass" is not "it works". Each server ships `scripts/smoke.ts`, which
drives the built server over the real protocol with your credentials (or a
running service, with `MCP_URL`); run it for anything that touches an API.

## The shape of a server

Copy `servers/oblio` or `servers/bolt-food` rather than inventing a layout.
Dependencies point inward:

```
  mcp/            the protocol: registers tools, owns their zod schemas and
   |              descriptions, checks the SHAPE of what came in, formats what
   |              goes out. Thin: validate, call one use case, format.
   v
  app/            use cases and ports. Ports are interfaces; nothing here knows a
   |              URL, and a port names an operation, never get/post over a path.
   v
  domain/         models and pure rules: business validation, arithmetic,
                  decisions. Imports nothing, except the kit's pure modules
                  (decimal, dates, compact, outbox) and, types only, wire types
                  an API's owner publishes.

  infra/          adapters that implement the ports: the only place an API's URLs
                  and parameter names appear. domain/schema.ts holds the wire
                  shapes, every field optional, mapped inward by pure functions.
  composition.ts  the one module that names both a port and its implementation,
                  which is what lets tests replace the network.
```

- **No classes.** State lives in closures behind `make*` factories; functions
  are pure where they can be, with effects at the edges.
- **Errors are tagged plain objects**, thrown through the server's `makeErrorKit`
  namespace. `instanceof Error` misses every one of them; call the server's
  `asAppError(thrown)` first in any catch that describes a failure.
- **Tools never throw.** `handled` (the kit's envelope) turns a failure into
  `{ "error": { kind, message, remedy } }` with `isError: true`. A remedy is one
  sentence an operator can act on, about this integration, and it names no
  particular deployment: no hostnames, no internal commands, no people.
- **Money never touches a float.** Amounts are decimal strings or integer minor
  units, with the kit's `decimal.ts` for arithmetic; an amount in a tool's
  arguments is a string checked by a pattern.
- **Small files.** A module lives beside the one thing that uses it
  (`xyz.ts` and its helpers in `xyz/`); something several modules use rises to
  their nearest common folder; something several servers use goes to a package.
  `packages/mcp-kit/src/serve/` is the pattern.
- **Shared first, specialised gradually.** The kit's networking stack is the
  bottom layer (`makeHttp`, then OAuth grants, then a token source and bearer
  auth); a server adds only its API's policy (which answers mean "later", which
  tagged failure each becomes). The bar for moving code into the kit is that it
  would be identical for an API none of these servers talk to. Remedies, retry
  predicates and field names stay per server.
- **Model the API, do not relay it.** Wire types in `domain/schema.ts`, every
  field optional; pure mappers inward; a documented field that goes missing
  fails loudly (`drift`) instead of travelling on as an empty value. Keep the
  source document (the raw XML, the unparsed body) when the thing is a filing or
  a payment.
- **Do not add a field you cannot fill.** A key that is always `[]` reads as an
  answer.
- **Measure before you optimise, and record the measurement** next to the code
  it justifies.

[docs/architecture.md](docs/architecture.md) explains the kit, the transports
and the guard in more depth.

## Adding a tool

1. Register it in the server's `src/mcp/`, with a description written for a
   model: what it does, what it returns, what to call before or after it.
2. Classify it in `src/mcp/policy.ts`: `read` (no effect outside the server),
   `write` (an effect that is not money or law), or `money` (money moves, or a
   legal or fiscal document is made or unmade). The server will not start with a
   tool missing from its policy. A `write` that acts outside the computer (paper
   through a printer, a scanner's lamp) is marked `confirm: true` with a
   `summary`, and is confirmed like money. A `write` that sets a state rather
   than adding one (a label on, a message in the trash) may be marked
   `idempotent: true`, which tells clients they may repeat it; add a test that
   calls it twice and finds no second effect (`idempotentWrites(POLICY)` lists
   the ones that need one).
3. A `money` tool gives a `summary(args)`: the ONE line a user confirms when
   the server asks (`MCP_CONFIRM=elicit`), naming the counterparty, the amount
   with its currency, the document and the account, computed with the same
   domain function the call itself uses. Get that line wrong and the user
   confirms something other than what runs.
4. A tool that takes a file takes it by `path` through the kit's input-file
   reader, never as text or base64 the model types. See
   [docs/security.md](docs/security.md#files-going-in).
5. Add it to the README's tool table (the docs check will remind you).
6. Optionally, for a small result a program would act on, give it an
   `outputSchema` (a `z.strictObject`, in `src/mcp/outputs.ts`) and declare
   the controller's result as `OutputOf<typeof THAT_SCHEMA>`: clients then get
   the result as typed structured content, the guard fails a result that
   drifts from it, and the compiler holds the use case to it. It is opt-in
   because a client that forwards both the schema and the result pays twice
   (`scripts/measure-tokens.ts` weighs it).
7. Add a changeset (`npx changeset`) saying what someone using the package can
   now do. A new `write` or `money` tool, or a tool whose class changes, gets a
   sentence of its own naming the tool and its class
   ([.changeset/README.md](.changeset/README.md)); the docs check fails a
   `money` tool its package's CHANGELOG.md never names, and CI fails a change
   of class since the last release that nothing tells.

## Adding a server

1. Look for one first: the vendor's own (its site, docs and GitHub
   organisation) and maintained community servers (the MCP registry, npm,
   PyPI, GitHub). If one does the job, use it and stop here. Otherwise the new
   README says what you found, on which date, and what this server does that
   they do not. "None found" is a finding; an unrecorded search is not.
2. Copy the layout of `servers/oblio` (or `servers/bolt-food` for a read-only
   API) and the `package.json` fields of any server.
3. It must start with an empty environment: read credentials when a tool needs
   them, and answer that tool with a `config` error naming the variable.
4. Follow [docs/configuration.md](docs/configuration.md): secrets from `*_FILE`
   variables, state through the kit's `stateDirOf`, dates through `timeZoneOf`.
5. Write `scripts/smoke.ts` with the kit's `connectSmoke`.
6. Write its README from the template below. The root README's table of
   servers is generated from each package.json (step 7).
7. Give its `package.json` a `description` in two parts, what it serves, then
   after a colon what an assistant can do with it (the registry shows the first
   part; the root README's table, the second), and an `mcp` block: a `title` a
   person reads, the `group` it belongs to in the root README's table (the
   groups are listed in `scripts/check-docs.ts`), and the `inputs` someone
   installing it sets (each variable's `type`, `file`,
   `directory`, `text` or `secret`, whether it is `required`, and one sentence
   for the prompt). `scripts/packaging.ts` says what each type becomes.
   `npx tsx scripts/check-docs.ts --write` then writes its `mcpName` and its
   registry entry, `server.json`; the check fails while either is stale.
8. Give it a `CHANGELOG.md` whose first entry says, for a person, what it
   does and which of its tools are `money`, and add `CHANGELOG.md` to its
   package.json `files`.
9. Draw its icon: a glyph in `scripts/icons.ts` (its header says how the set
   is drawn, so a new one fits), then `npx tsx scripts/icons.ts`, and add
   `icons` to its package.json `files`. Its `serve()` call spreads
   `...packageIdentity(import.meta.url)`, which announces the title, the home
   page and the icon at initialize.

## Writing a server's README

A server's README is the first thing a stranger reads, often arriving from the
MCP Registry or a search, knowing the service but not this repository. In the
first screen they want three answers: what can my assistant do with this, what
can it change (and can it spend money), and what do I need before I start. The
rest of the page is for the moment they are setting it up, and the moment
something goes wrong.

### How we write

- **Start with what the reader gets.** The first sentence says what an
  assistant can do with the server, verbs first, naming the service in the
  reader's words. Not "an MCP server for X", which they already know.
- **Say what it can change, early.** Whether anything writes, and which tools
  are `money`, belongs in the opening paragraph, not only in the tool table.
- **Say what they need before they invest time**: the account, the credential,
  the plan or approval it takes, a cost, a limit that shapes every use (four
  bank reads a day).
- **Show it working.** "What you can ask" holds questions a person would type,
  each one answerable by the tools on the page. Examples use invented data only.
- **Main path first.** One way to get running; alternatives after it, or in
  `<details>`.
- **Walk through the hard part.** Getting a credential is where people give
  up: numbered steps, the console's own names for its buttons and scopes, a
  direct link, and what the file must contain.
- **Anticipate where they get stuck**, and key the fix to what they see: a
  consent that lapsed, a code that expires in minutes, the exact `kind` or
  message of an error. That is what Troubleshooting is for.
- **Every claim is true in the code.** Tool names, numbers, defaults, limits
  and flags are read from the source, not remembered. What is not built goes
  under Limitations, never into the promise.
- **Plain sentences.** Short, active, concrete. No em dashes, no emoji in
  headings, no hype ("powerful", "seamless", "simply"). Say why, not only what.
- **One source of truth.** Link to [docs/configuration.md](docs/configuration.md)
  for the shared variables instead of repeating them; never edit a generated
  block by hand.
- **Images only when they show something real**, committed to the repository,
  safe on light and dark backgrounds, with a width and alt text that says what
  they show. GitHub links every image to its own file, so even a decorative
  icon needs alt text, unless it sits inside a link that already has a name.
- **No personal data and no deployment specifics**, as everywhere in this
  repository: invented names, `example.com`, clearly fake ids.

### The sections

Every server's README has these sections, in this order, with these headings,
so a reader who knows one server finds everything in the next.
`scripts/check-docs.ts` holds the headings to this list.

```markdown
# <img src="icons/icon.svg" width="36" height="36" alt="<Title> icon"> <Title> MCP server

What an assistant can do with it, verbs first, linking the service. What it can
change, naming its `money` tools and saying they are confirmed with the user, or
that it is read-only.

**You need** the account and credentials, a phrase each (or "nothing: no account
and no key"), and any cost or limit a reader must know before investing time.

## What you can ask

- "Three to six questions a person would type, each answerable by the tools here."

## Install

<!-- install:begin --> ... <!-- install:end -->   (generated: buttons, Claude Code, JSON, from source)

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `X_API_KEY_FILE` | yes | File holding the API key (`X_API_KEY` for a local run). |

### Getting <the credential>

1. Numbered steps from the provider's console, with its own names and a link.

## First run                    (optional: when setup continues after install)

1. What to ask first (usually its `health` tool), and what a good answer says.
2. The steps a new user takes next: a consent, a sign-in, a calibration.

## Tools

One line of legend, then a table per area (`### <area>` when there are several):

| Tool | Access | What it does |
|---|---|---|
| `tool_name` | read | One line, for a person. |
| `other` / `pair` | **money** | Rows may name several tools of one class. |

## Money                        (only for a server with `money` tools)

What each one does, who confirms it and how, and an example of the line a user
confirms when the server asks itself (`MCP_CONFIRM=elicit`).

## Troubleshooting              (optional, and worth writing)

**What the reader sees** (the error's kind or message). What to do about it.

## How it works                 (optional)

The API's traps, the decisions and why, the measurements. For the curious and
for contributors; short paragraphs with a bold lead-in.

## Limitations

What it does not do, and why.

## Other servers for <service>

The vendor's own and the community ones found, the date of the search, and what
this one does that they do not (or "none found").
```

The install block (buttons for VS Code, Cursor and Claude Desktop, the Claude
Code command, a JSON configuration for other clients, and how to run it from a
clone) is generated from the package.json `mcp` block: a new README gets it
from `npx tsx scripts/check-docs.ts --write`, and the check fails while it is
stale. Server-specific install notes go after it.

`scripts/check-docs.ts` holds each README to the code: its sections are the
ones above, in order, with Money exactly when a tool is `money`; every
registered tool appears exactly once in a tool table, with its policy's access
class; no table names a tool that does not exist; every variable the source
reads is in the README (or, if every server shares it, in
docs/configuration.md). A server whose tools come from a vendor's package
generates its table between `<!-- tools:begin -->` and `<!-- tools:end -->`.

## Personal data and deployments

This repository is public. Tests, fixtures, examples and docs use invented data
only: `example.com` addresses, names like "Ana Popescu", the standard example
IBANs, clearly fake tax ids. Never paste a real API response without replacing
every identifier, name, address and amount in it.

Nothing in code, tool descriptions or remedies names a particular deployment
(hosts, paths, internal commands, people). A deployment's specifics reach a
server through its environment, and the text a tool shows is derived from it
(the kit's `inputFilesFrom(env)` is the pattern: it says where to put a file
from `MCP_FILE_ROOTS` and `MCP_FILE_SCRIPT`).

## Commits

One logical change per commit. The subject is `<server or area>: <what changed,
as a sentence>` (`oblio: refuse a due date before the issue date`); the body
says why, and what was measured or checked. Run `npm run check` before you push.

## Reporting a vulnerability

Please do not open a public issue; see [SECURITY.md](SECURITY.md).
