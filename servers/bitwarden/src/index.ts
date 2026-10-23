#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "A Bitwarden account an agent keeps its own logins in. Before signing up anywhere, create_login first (it generates and stores the password), " +
  "then get_password to type it. After enabling 2FA on a site, store its key with update_login(totp_secret) and read codes with totp. " +
  "A secret that is not a login (a key file, an API token) goes into create_note, from its file; get_field hands it out. " +
  "check_exposed says whether a stored password is in Have I Been Pwned's breach list, sending only five characters of its hash. " +
  "Never copy a password or 2FA key into files, commits, messages or replies.";

/**
 * MCP server for a Bitwarden account an agent keeps its own logins in,
 * through the official CLI (`@bitwarden/cli`, pinned). stdio by default, HTTP
 * when MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS
 * the protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "bitwarden", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("bitwarden failed to start:", error);
  process.exit(1);
});
