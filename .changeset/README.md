# Changesets

For contributors: when a change needs a changeset, how to write one, and what
the checks hold it to. Changesets become the `CHANGELOG.md` people read before
upgrading, one beside each package's `package.json`.

## Adding one

Any change a package's users would notice gets a changeset, in the same pull
request:

```bash
npx changeset
```

It asks which packages changed and how (patch, minor or major), and writes a
small Markdown file here to commit with the change. A changed tool surface (a
renamed tool or argument, a removed tool) is a major change. By hand, quote
each package name in the header as `npx changeset` does
(`"@foreverworks/mcp-oblio": minor`): the access check below finds a package
only that way.

At release time, `npm run release:version` turns the pending changesets into
each package's new version and changelog entry
([docs/releasing.md](../docs/releasing.md)).

**Until the first release** there is no earlier version to change from: edit
the package's 0.1.0 entry in its `CHANGELOG.md` instead, if someone installing
it for the first time needs to know, and add no changeset.

## Writing the entry

Write for the person upgrading, not the reviewer: what they can do now or
what works differently, and what they must change, if anything. Name tools in
backticks: that is how the checks find them.

**A tool's access class is the change people most need to see.** When a new
tool is `write` or `money`, a `write` or `money` tool goes away, or a tool
changes class, say so in its own sentence, with the class before and after:

```markdown
---
"@foreverworks/mcp-oblio": minor
---

`reverse_invoice` issues a storno for an invoice the client already has. It is
`money`: a client that honours the confirmation mark asks you before each call.

`delete_invoice` is now `money` (it was `write`): it unmakes a fiscal document.
```

## What the checks enforce

- **`npm run check`** (`scripts/check-docs.ts`) fails when a package has no
  `CHANGELOG.md`, or when a server's `CHANGELOG.md` does not name one of its
  `money` tools in backticks. It reads `CHANGELOG.md` only, so a new `money`
  tool fails it until its changeset is versioned into the changelog.
- **CI and the release** run `npx tsx scripts/access-changes.ts --check`. It
  compares each server's README tool tables with those at the newest
  `release-*` tag, and fails on any change of class and any new or removed
  `write` or `money` tool, unless the tool is named in backticks in a pending
  changeset for that package or in a line its `CHANGELOG.md` gained since the
  tag. A `read` tool may come or go untold. Before the first release tag
  there is nothing to compare, and the check passes.

Without `--check`, the script lists the changes it sees and which are not yet
told; `--since <ref>` compares with another commit.
