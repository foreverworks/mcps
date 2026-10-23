# AGENTS.md

Orientation for AI agents working in this repository. The house style and the
README template are in [CONTRIBUTING.md](CONTRIBUTING.md); how a server and the
toolkit are built is in [docs/architecture.md](docs/architecture.md). Read both
before changing code. This file is what matters only if you are an agent.

## A checkout is not a deployment

These servers are TypeScript and run from `servers/<name>/dist/index.js`, which
is not in git. Editing `src/` changes nothing that runs until it is built, and on
a machine that deploys this repository, building may be what deploys it: a
successful root build touches `.built`, which a deployment can watch. Build what
you mean to ship. Your deployment's own instructions say how it deploys this
repository; follow them over anything here.

## The bar for a change

```bash
npm ci && npm run check
```

`check` is typecheck (src, tests and scripts), every test, the build, the docs
check (`scripts/check-docs.ts`): every server must start with an empty
environment, list every tool it registers in its README with the right access
class, and document every variable it reads; the pack check
(`scripts/check-pack.ts`): what npm would publish for each workspace comes from
tracked sources and nothing else; and the site check (`scripts/site.ts`): the
site builds from the package.json files and READMEs, and every link in it
leads somewhere. If you only ran the tests, you have not shown that what is on
disk changed.

"The tests pass" is not "it works". Each server's `scripts/smoke.ts` drives the
built server over the real protocol. Where a running service holds the grants
and you cannot read them, point it at the service:
`MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file>`. Read a smoke
script's header before running it: some take options that write.

## Rules that are easy to break

- **Look before you build a server.** A new server starts with a search for the
  vendor's own and for maintained community ones, and its README records what
  was found, the date, and why this one is still needed
  ([CONTRIBUTING.md](CONTRIBUTING.md#adding-a-server), step 1).
- **No personal data, no deployment specifics.** This repository is public.
  Tests, fixtures and docs use invented data; nothing in code, tool descriptions
  or remedies names a host, a path, a command or a person of any particular
  deployment. A deployment's specifics reach a server through its environment,
  and the text a tool shows is derived from it.
- **Classify every tool** in `src/mcp/policy.ts`; the server will not start
  otherwise. `money` means money moves or a legal document is made or unmade.
- **Files go in by path** through the kit's input-file reader, never as text or
  base64 a model types; results report SHA-256 and size.
- **Errors are tagged objects**: in a catch that describes a failure, call the
  server's `asAppError(thrown)` before anything else; `instanceof Error` misses
  every one of them.
- **Money never touches a float.**

## Two habits worth copying

**Do not add a field you cannot fill.** A key that is always `[]` reads as an
answer. Gmail's cheap read format returns no MIME tree, so the server omits the
attachment list there rather than returning an empty one.

**Measure before you optimise, and record the measurement** next to the code it
justifies, so the next person does not re-derive it (the Gmail client's batching
decision in `servers/google/src/gmail/infra/pool.ts` is an example).
