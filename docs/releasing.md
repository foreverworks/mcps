# Releasing

For maintainers: how the packages reach npm, the MCP Registry and Claude
Desktop. Nothing is published yet: the repository is private and every
package is still `"private": true`. The first release starts at
[The first release](#the-first-release); every later one is
[Cutting a release](#cutting-a-release).

## What a release publishes

| What | Where | Name |
|---|---|---|
| `packages/mcp-kit` | npm | `@foreverworks/mcp-kit` |
| each server for Romania or for everyone | npm, with provenance | `@foreverworks/mcp-<server>` |
| each such server's `server.json` | the official MCP Registry | `com.foreverworks/<server>` |
| each such server's desktop bundle | the GitHub release of the tag | `mcp-<server>.mcpb` |

**What ships follows from each server's audience**, its package.json
`mcp.audience` ([CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-server), step 7),
and nothing else: a `romania` or `general` server ships, an `extras` server
never does, and a toolkit package ships when a server that ships depends on
it (so `packages/receipts`, which only the extras use, does not). An extras
server has no `mcpName` and no `server.json`, and its package.json says
`"private": true`, all written by `npx tsx scripts/check-docs.ts --write`;
`scripts/bundle.ts` refuses to bundle one, and `scripts/release.ts` refuses
to start while any of them is not private.

A package that ships is published once its package.json no longer says
`"private": true` and npm lacks its version: removing the flag is the decision
to publish it now. Versions live only in each package.json; a server announces
its own at start (`packageVersion`), and its `server.json` is generated from it.
`.github/workflows/release.yml` publishes, and `scripts/release.ts` decides
what ([What the workflow does](#what-the-workflow-does)).

## Cutting a release

1. **See what changed.** On an up-to-date `main`, read the pending changesets
   in `.changeset/`, and run `npx tsx scripts/access-changes.ts` for the tools
   whose access class changed since the last release tag: each must be told,
   or the release fails.
2. **Version.** `npm run release:version` turns the pending changesets into
   versions and changelog entries (and deletes them), updates the lockfile,
   builds, and regenerates every `server.json` and README install block.
   Review the diff and commit it.
3. **Check the plan.** `npx tsx scripts/release.ts plan` lists what would go
   to npm and to the registry, and sends nothing.
4. **Rehearse it**, if anything about the release itself changed (a package
   made public, the workflow, a script it runs): push `main`, then

   ```bash
   gh workflow run release.yml -R foreverworks/mcps -f rehearse=true
   ```

   runs everything a release runs before it sends anything, then npm's dry
   run of each publish and a login to the registry with its key. It sends
   nothing, and it works while the repository is private.
5. **Tag and push.** Push `main`, then tag the release commit:

   ```bash
   tag="release-$(date -u +%F)"
   git rev-parse -q --verify "refs/tags/$tag" >/dev/null && tag="$tag.2"
   git tag "$tag" && git push origin "$tag"
   ```

   A third release on the same day takes `.3`.

6. **Watch it** with `gh run watch` or in the Actions tab. If the `release`
   environment requires a reviewer, the run waits for one.
7. **If a step failed,** fix the cause and run it again: `scripts/release.ts`
   skips every version npm or the registry already has, so nothing is sent
   twice.

## The first release

Once only, in order:

1. **The first version** is 0.1.0 for every package, as each CHANGELOG.md's
   first entry says: `0.x` while interfaces may still change. The changesets
   pending before it are folded into those entries. To start at another
   version, change both the package.json and the entry.
2. **Choose what goes first.** Which servers can ever ship is their
   audience's to say ([What a release publishes](#what-a-release-publishes)).
   Of those, remove `"private": true` from each one this release publishes,
   and from `mcp-kit`, which every server needs. A public package that
   depends on a private one is refused before anything is sent. Then run
   `npx tsx scripts/check-docs.ts --write`, which drops the "not on npm yet"
   note from those servers' install blocks, and commit. Nothing is published
   while the repository is private, so this can come first.
3. **The registry key.** Set the repository secret `MCP_REGISTRY_PRIVATE_KEY`
   ([below](#the-registry-namespace-comforeverworks)).
4. **Rehearse** as in [Cutting a release](#cutting-a-release), step 4. It is
   the first run of the release workflow, so let it find what is wrong while
   nothing can be sent.
5. **Go public.** Work through
   [Before the repository goes public](#before-the-repository-goes-public),
   then change the repository's visibility.
6. **Protect the environment.** In the repository's Settings, Environments,
   create `release`, with required reviewers if every release should wait for
   a person. A private repository on GitHub's free plan cannot have
   environments, so this comes after going public. If you skip it, the first
   run creates `release` with no protection rule.
7. **Give the workflow a token, once.** npm's trusted publishing needs a
   package that exists, so each first publish needs a token. On npmjs.com,
   create a granular access token with "Bypass two-factor authentication"
   (the workflow cannot answer a 2FA prompt), "Read and write (publish and
   stage)" on the `@foreverworks` scope only, no access to organizations,
   and the shortest expiry, and save it as the repository secret
   `NPM_TOKEN`:

   ```bash
   gh secret set NPM_TOKEN -R foreverworks/mcps
   ```

   npm refuses to make a token while the account is suspended, as it is for
   72 hours after a two-factor recovery code is used. npm says such tokens
   lose direct publishing in January 2027; from then on a token can only
   stage a version, which a maintainer approves on npmjs.com before it is
   published.

8. **Release** as in [Cutting a release](#cutting-a-release).
9. **Trust the workflow** for each package published. On your own machine,
   signed in to npm (`npm login`) with two-factor authentication on your
   account and npm 11.15.0 or newer, in a clone of `main`:

   ```bash
   npx tsx scripts/release.ts trust
   ```

   For each public package on npm that does not trust it yet, it runs
   `npm trust github <package> --file release.yml --repo foreverworks/mcps
   --env release --allow-publish --yes`; `--dry-run` shows what it would do.
   Without `--allow-publish`, a connection made after 2026-09-03 allows only
   staged publishing, and the workflow runs `npm publish`. A granular token
   that bypasses two-factor authentication cannot make these connections.
10. **Retire the token.** Delete the secret
    (`gh secret delete NPM_TOKEN -R foreverworks/mcps`) and revoke the token on
    npmjs.com. From then on the workflow publishes with its OIDC token alone.
11. **Prove it within two days.** A new connection lapses unless a publish
    through it succeeds within two days, so release a patch (a changeset, then
    [Cutting a release](#cutting-a-release)) with no token in place. If one
    lapsed, delete it on npmjs.com and run step 9 again.

## Before the repository goes public

- [x] **History.** The published history starts from one squashed commit;
  nothing older is in this repository.
- [x] **Commit identities.** Every author and committer address is one meant
  to be public, such as a GitHub noreply address:
  `git log --format='%ae %ce' | sort -u`.
- [x] **Secret scan** of the tree and the history (`gitleaks dir` and
  `gitleaks git`, or trufflehog). Expected, all made up for tests:
  the self-signed keys under `servers/anaf-efactura/test/fixtures/seal/`, a
  JWT in `packages/mcp-kit/test/net.test.ts`, API keys in
  `servers/porkbun/test/vendorErrors.test.ts` and a service-account key in
  `servers/bitwarden/test/server.test.ts`. Anything else is a finding.
- [x] **Personal-data sweep**, last: no real names, addresses, tax ids,
  account ids, hostnames, or figures and stories from a real account or
  deployment, in `src/`, `test/`, `scripts/` or the docs, in the tree or the
  history ([CONTRIBUTING.md](../CONTRIBUTING.md#personal-data-and-deployments)).
  Done by reading, not by pattern search: every tracked file on 2026-10-22,
  then every file changed since, on 2026-10-23. Pattern searches missed what
  only a reader recognises (filing numbers, message ids, brand names).
- [x] **`npm run check` green on a clean clone**, on Node 22 and 24.
- [x] **CI on GitHub-hosted runners.** No job, and no pull request from a
  fork, runs on a self-hosted runner.
- [x] **GitHub settings**: private vulnerability reporting on (SECURITY.md
  relies on it), branch protection on `main` (no force pushes, no deletion),
  Dependabot alerts and security updates, and version updates for npm and
  actions (`.github/dependabot.yml`).
- [x] **Decide per server what ships.** The rule: an extras server, built
  for one particular setup or on an unofficial API, is never published;
  every other server is. Each server's package.json `mcp.audience` holds the
  decision ([What a release publishes](#what-a-release-publishes)), and the
  root README's [Extras](../README.md#extras) section lists the servers it
  keeps out.

## What the workflow does

`.github/workflows/release.yml` starts when a `release-*` tag is pushed, or by
hand from the Actions tab. It publishes only from a public repository, on a
GitHub-hosted runner (npm's trusted publishing refuses self-hosted ones), in
the GitHub environment `release`, one run at a time. Steps 1 to 4 and the plan
are `.github/actions/prepare-release`, which the rehearsal runs too. In order,
it:

1. installs npm 12.2.1, runs `npm ci` and `npm run check` (typecheck, tests,
   build, the docs and pack checks) on Node 24;
2. runs the access check, `npx tsx scripts/access-changes.ts --check`
   ([.changeset/README.md](../.changeset/README.md));
3. installs `mcp-publisher` 1.8.1, checked against its SHA-256, and runs
   `mcp-publisher validate` on every `servers/*/server.json`;
4. builds the desktop bundle of every server that ships and is public
   (`scripts/bundle.ts --public`), so a broken bundle stops the release
   before anything is sent;
5. prints the plan, then publishes each public package whose version npm
   lacks (`npm publish --access public --provenance`, the toolkit packages
   first), then each such server's `server.json` to the registry, logging in
   before each entry because a registry login lasts five minutes;
6. on a tag only, creates the GitHub release named after the tag, with every
   bundle. A run started by hand publishes the same but attaches no bundles.

Started by hand with `rehearse`, it runs a separate job instead, on any
repository and outside the `release` environment: steps 1 to 4 and the plan,
then `scripts/release.ts rehearse`, which logs in to the registry with the
key (proving the secret and the DNS record) and runs `npm publish --dry-run`
for each package npm lacks. It holds no npm token and sends nothing.

## The registry namespace: com.foreverworks

Every server is registered as `com.foreverworks/<server>`, the `mcpName` that
`check-docs` writes into its package.json. The registry checks that name
against the npm package the entry names, which is why npm goes first, and
grants the namespace to whoever proves the domain with a DNS record:

- **The record** is a TXT record on the apex of foreverworks.com,
  `v=MCPv1; k=ed25519; p=<the public key, base64>`. It proves
  `com.foreverworks/*` and `com.foreverworks.*/*`. See it with
  `dig +short TXT foreverworks.com`.
- **The private key** (the hex seed `mcp-publisher` takes, and the PEM) is in
  the maintainers' password vault, and the hex seed is the repository secret
  `MCP_REGISTRY_PRIVATE_KEY`. To test it without publishing anything:
  `mcp-publisher login dns --domain foreverworks.com --private-key <hex seed>`.
- **To rotate it**: `openssl genpkey -algorithm Ed25519 -out key.pem`; the new
  record's `p=` is `openssl pkey -in key.pem -pubout -outform DER | tail -c 32 |
  base64`; the seed is `openssl pkey -in key.pem -noout -text | grep -A3 priv: |
  tail -n +2 | tr -d ' :\n'`. Add the new record, replace the secret and the
  vault entry, then remove the old record.

Each `server.json` follows the registry's schema of 2025-12-11
(`SERVER_SCHEMA` in `scripts/packaging.ts`). When the registry publishes a
newer one, change that constant and run
`npx tsx scripts/check-docs.ts --write`.

## What a package contains

`npm run check:pack`, part of `npm run check`, holds every package to
package.json, README, CHANGELOG.md, LICENSE, files under `docs/` and `icons/`,
and `dist/` files compiled from `src/`. Every build empties `dist/` first, so
a long-lived checkout cannot ship what an earlier layout left there; `prepack`
copies the repository's LICENSE into the package.

A desktop bundle (`scripts/bundle.ts`) holds the server and the toolkit as
npm would publish them, their dependencies installed without scripts or dev
packages, and a manifest from package.json with the tool list, icon and
LICENSE, checked and packed by the mcpb CLI. Its name has no version, so each
README's link to the latest release finds it. CI builds the bundle of every
server that ships on each push; to try one in Claude Desktop, run
`npm run build && npm run bundle -- --out bundles oblio`.

## Between releases

- A changed tool surface is a major change for its package
  ([.changeset/README.md](../.changeset/README.md)); the servers that keep
  `test/tools.snapshot.json` make it visible in review.
- Keep [auth.md](auth.md) current with the MCP specification revisions the SDK
  serves.
