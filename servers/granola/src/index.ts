#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "Meetings, notes and transcripts from one Granola account, read through Granola's own MCP server; nothing here changes a meeting. " +
  "Start with health. When it says there is no grant, or a call answers not_authorized, the account's owner signs in: begin_authorization, they open its link in a browser and sign in to Granola, " +
  "then complete_authorization with the address the browser lands on. After that search_meetings finds meetings (list_meetings lists them by date), get_meetings reads their notes and summaries, and get_meeting_transcript and search_transcripts read what was said " +
  "(transcripts need a paid Granola plan). Granola limits requests per tool (query_granola_meetings far more tightly than the rest): batch ids rather than looping.";

/**
 * MCP server bridging Granola's hosted MCP server. stdio by default, HTTP when
 * MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS the
 * protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = await buildDeps(process.env);
  await serve({
    name: "granola",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: INSTRUCTIONS,
    policy: POLICY,
    register: (server) => registerAll(server, deps),
  });
};

main().catch((error: unknown) => {
  console.error("granola failed to start:", error);
  process.exit(1);
});
