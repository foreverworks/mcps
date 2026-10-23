# Security policy

These servers hold access to mailboxes, documents, invoices, bank data and tax
filings, so we take every report seriously, and thank you for making one.

## Reporting a vulnerability

Report it privately, through GitHub's private vulnerability reporting on this
repository (Security, then Report a vulnerability), not in a public issue or
pull request. Include:

- the server or package, and the commit you tested;
- how to reproduce it, step by step;
- what an attacker could do with it, and what they would need first.

Test only with accounts and data you own, or with invented data.

## What to expect

We will acknowledge your report within a few working days, keep you informed
while we fix it, and credit you in the release notes unless you would rather
we did not.

## Scope

In scope: the code in this repository, including the shared toolkit
(`packages/mcp-kit`) and every server, and the deployment guidance in `docs/`.
For example, a call that runs above its ceiling or without the confirmation
the deployment asked for, a file read from outside the file roots, a request
that gets past the token check, or a credential that reaches a log or a tool
result.

Out of scope: the upstream services (report those to their owners), and
findings that need an attacker who already holds a server's credentials or
bearer token, or can start the process.
[docs/security.md](docs/security.md#where-the-protections-stop) lists what
each protection does not cover.

## Supported versions

The latest commit on `main`. Packages will follow semantic versioning once
they are on npm.
