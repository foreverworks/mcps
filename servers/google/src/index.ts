#!/usr/bin/env node
import { packageIdentity, packageVersion, productIcons, serve } from "@foreverworks/mcp-kit";

import { runHealthCheck } from "./cli/health.js";
import { buildRegistries } from "./composition.js";
import { POLICY, PRODUCTS } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

/**
 * MCP server for several Google accounts at once: their mail, their
 * calendars, a Drive, and Docs, Sheets and Slides, through one server.
 *
 * It exists beside Google's own Gmail and Calendar MCP servers rather than
 * instead of them: a connector authenticates ONE Google account at a time, the
 * point of an agenda here is to see every account at once, and Google's Gmail
 * server can neither fetch attachment bytes nor sync by historyId.
 *
 * stdio by default, or HTTP when MCP_HTTP_PORT is set; `serve` in mcp-kit
 * decides, and nothing here knows which. Nothing is logged to stdout: over
 * stdio it IS the protocol channel, and a stray line there corrupts the session.
 */
const INSTRUCTIONS =
  "Several Google accounts through one server: Gmail, Calendar, a Drive, Docs, Sheets and Slides, Google Tasks, " +
  "contacts with a Workspace directory, and Meet's transcripts. Start with " +
  "list_accounts: it names each account label (one label is one identity in every product) and which products " +
  "reach it. The reads that make sense across accounts (search_threads, agenda, free_busy, list_tasks, find_people) read every account " +
  "when none is given; every write names its account, because there is no default for one, and Drive tools take " +
  "none. To address someone by name, find_people finds the address. For mail, create_draft is the default for anything addressed to someone: send_message, send_draft, " +
  "reply or forward with send, and share_file act only on the user's explicit go for that message or file. In " +
  "Docs, read_document comes before edit_document_section, which is pinned to the revision read; before any " +
  "batch_update_* call, editors_api_reference says what each request takes. A meeting's transcript and notes: " +
  "list_meetings (from an agenda event), then get_transcript. Files come back through the " +
  "server's outbox with their SHA-256 (get_attachment, harvest_attachments, download_file) and go in by path " +
  "(upload_file). When health or a tool says a grant is missing or lapsed, begin_consent returns the link the " +
  "account's owner opens, and complete_consent takes the address it lands on.";

const main = async (): Promise<void> => {
  // One binary, two modes. `--health [gmail|calendar|drive|editors|tasks|contacts|meet]` is for a scheduled
  // check; it shares this server's composition, so the check can never drift from
  // what the server itself would do.
  const at = process.argv.indexOf("--health");
  if (at !== -1) {
    process.exit(await runHealthCheck(process.argv[at + 1]));
  }
  const registries = buildRegistries();
  await serve({
    name: "google",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    products: Object.entries(PRODUCTS).map(([product, tools]) => ({ icons: productIcons(import.meta.url, product), tools })),
    instructions: INSTRUCTIONS,
    policy: POLICY,
    register: (server) => registerAll(server, registries),
  });
};

main().catch((error: unknown) => {
  console.error("google failed to start:", error);
  process.exit(1);
});
