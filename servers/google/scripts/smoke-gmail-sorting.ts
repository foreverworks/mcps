/**
 * Live smoke test of the mailbox-sorting tools, READ-ONLY: a sender
 * breakdown, the filter list, and a dry run of a bulk label change. Nothing
 * in the mailbox changes, so it is safe on a mailbox nobody wants touched.
 *
 *   npm run build && npx tsx scripts/smoke-gmail-sorting.ts [account] [query]
 *
 * Against a running service, set MCP_URL and MCP_TOKEN_FILE (mcp-kit connectSmoke).
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

/** A whole inbox takes about two minutes at Gmail's quota, past the SDK's 60 s default. */
const LONG = { timeout: 300_000 };

const main = async () => {
  const account = process.argv[2] ?? "";
  const query = process.argv[3] ?? "in:inbox";
  const client = await connectSmoke();
  const { tools } = await client.listTools();
  const missing = ["sender_breakdown", "modify_labels_matching", "list_filters", "create_filter", "delete_filter"].filter(
    (n) => !tools.some((t) => t.name === n),
  );
  if (missing.length) {
    console.log("missing tools:", missing.join(", "));
    process.exitCode = 1;
  }

  const t0 = Date.now();
  const senders = toolJson(await client.callTool({ name: "sender_breakdown", arguments: { query, top: 10, account } }, LONG));
  console.log(`sender_breakdown (${((Date.now() - t0) / 1000).toFixed(1)}s):`, JSON.stringify({ ...senders, domains: senders.domains?.map((d: { domain: string; threads: number; unread: number }) => `${d.domain} ${d.threads}/${d.unread}`) }, null, 2));
  if (senders.error) process.exitCode = 1;

  const filters = toolJson(await client.callTool({ name: "list_filters", arguments: { account } }));
  console.log("\nlist_filters:", JSON.stringify(filters, null, 2).slice(0, 1500));
  if (filters.error) process.exitCode = 1;

  // A dry run never changes anything; a write account is still required, as for any write tool.
  const writeAccount = senders.account as string | undefined;
  const t1 = Date.now();
  const dry = toolJson(await client.callTool({
    name: "modify_labels_matching",
    arguments: { query, remove: ["UNREAD"], dry_run: true, limit: 10000, account: writeAccount },
  }, LONG));
  console.log(`\nmodify_labels_matching dry run (${((Date.now() - t1) / 1000).toFixed(1)}s):`, JSON.stringify({ ...dry, sample: dry.sample?.slice(0, 3) }, null, 2));
  if (dry.error || dry.dryRun !== true) process.exitCode = 1;

  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
