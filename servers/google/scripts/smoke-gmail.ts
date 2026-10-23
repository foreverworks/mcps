/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would. Needs credentials; everything in test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke-gmail.ts
 *
 * Reads the account registry from the environment, so it exercises whatever
 * the deployment is actually configured with rather than a shape invented here.
 */
import { connectSmoke, sha256Of, toolJson } from "@foreverworks/mcp-kit";

const main = async () => {
  // Over stdio the whole environment goes to the child (connectSmoke's default),
  // registry variables included.
  const client = await connectSmoke();

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  const accounts = toolJson(await client.callTool({ name: "list_accounts", arguments: {} }));
  console.log("\naccounts:", JSON.stringify(accounts, null, 2));

  // health answers per product; this script is about the gmail section.
  const health = toolJson(await client.callTool({ name: "health", arguments: {} })).gmail;
  console.log("\nhealth (every mailbox):", JSON.stringify(health, null, 2));
  if (health.error || health.allOk === false) process.exitCode = 1;

  // The point of the multi-account server: one query, every mailbox, results
  // tagged with where they came from.
  const t0 = Date.now();
  const search = toolJson(await client.callTool({
    name: "search_threads",
    arguments: { query: "newer_than:120d", max_results: 10 },
  }));
  const perAccount = search.threads?.reduce(
    (n: Record<string, number>, t: { account: string }) => ({ ...n, [t.account]: (n[t.account] ?? 0) + 1 }),
    {},
  );
  console.log(
    `\nsearch_threads (all accounts) -> ${search.threads?.length} threads in ${((Date.now() - t0) / 1000).toFixed(2)}s`,
    JSON.stringify(perAccount),
  );
  console.log("first:", JSON.stringify(search.threads?.[0], null, 2));
  console.log("paging:", JSON.stringify(search.accounts));

  const first = search.threads?.[0];
  const account = first?.account;
  const meta = toolJson(await client.callTool({
    name: "get_thread",
    arguments: { thread_id: first?.id, detail: "metadata", account },
  }));
  const text = toolJson(await client.callTool({
    name: "get_thread",
    arguments: { thread_id: first?.id, detail: "text", account },
  }));
  console.log(`\nget_thread metadata: ${JSON.stringify(meta).length} chars, body key: ${"body" in (meta.messages?.[0] ?? {})}`);
  console.log(`get_thread text    : ${JSON.stringify(text).length} chars, bodySource: ${text.messages?.[0]?.bodySource}`);

  const bad = toolJson(await client.callTool({ name: "get_thread", arguments: { thread_id: "deadbeef", account } }));
  console.log("\nerror shape:", JSON.stringify(bad.error, null, 2)?.slice(0, 300));

  const unknown = toolJson(await client.callTool({ name: "health", arguments: { account: "nosuchbox" } }));
  console.log("unknown account:", JSON.stringify(unknown.gmail?.error ?? unknown).slice(0, 200));

  const anchor = health.accounts?.find((a: { account: string }) => a.account === account);
  const hist = toolJson(await client.callTool({
    name: "list_history",
    arguments: { start_history_id: String(anchor?.historyId), account },
  }));
  console.log("\nlist_history:", JSON.stringify({ added: hist.messagesAdded?.length, historyId: hist.historyId }));

  // A harvest, capped small and pointed at a scratch folder inside the
  // attachments folder: it writes real files.
  const harvest = toolJson(await client.callTool({
    name: "harvest_attachments",
    arguments: {
      query: "has:attachment newer_than:60d",
      max_threads: 5,
      max_attachments: 3,
      account,
      save_dir: "smoke",
    },
  }));
  console.log(
    "\nharvest:",
    JSON.stringify(
      {
        account: harvest.account,
        threadsMatched: harvest.threadsMatched,
        attachmentsFound: harvest.attachmentsFound,
        savedCount: harvest.savedCount,
        failedCount: harvest.failedCount,
        truncated: harvest.truncated,
        bytesTotal: harvest.bytesTotal,
        firstFile: harvest.saved?.[0]?.path,
      },
      null,
      2,
    ),
  );

  // THE WRITE PATH, per account: a draft to itself, read back, deleted, and
  // proved gone. Nothing is sent. On an account still on its read-only grant
  // the create must be REFUSED by the guard, and that refusal is the check.
  const stamp = new Date().toISOString();
  const SMOKE_FILE = Buffer.from("smoke attachment\n");
  for (const acct of health.accounts ?? []) {
    const label = acct.account as string;
    const subject = `[smoke] gmail MCP draft ${stamp} (safe to delete)`;
    const created = toolJson(await client.callTool({
      name: "create_draft",
      arguments: {
        account: label,
        to: [acct.mailbox],
        subject,
        body_text: "Created by servers/google/scripts/smoke-gmail.ts. Deleted by it a second later.",
        // Encoded HERE, by the script, with the file's sha256: never by a model (mcp-kit inputFile.ts).
        attachments: [{ content_base64: SMOKE_FILE.toString("base64"), sha256: sha256Of(SMOKE_FILE), filename: "smoke.txt" }],
      },
    }));
    if (created.error) {
      const refused = created.error.code === "readonly_grant" || created.error.code === "insufficient_scope";
      console.log(`\n[${label}] create_draft ${refused ? "REFUSED by the write guard (read-only grant)" : "FAILED"}:`, JSON.stringify(created.error).slice(0, 300));
      if (!refused || acct.activeGrant === "modify") process.exitCode = 1;
      continue;
    }
    const back = toolJson(await client.callTool({ name: "get_draft", arguments: { account: label, draft_id: created.draftId } }));
    const listed = toolJson(await client.callTool({ name: "list_drafts", arguments: { account: label, query: `subject:"${stamp}"` } }));
    const roundTrip = {
      draftId: created.draftId,
      webUrl: created.webUrl,
      subjectMatches: back.message?.subject === subject,
      to: back.message?.to,
      attachments: back.message?.attachments?.map((a: { filename: string; size: number }) => `${a.filename}:${a.size}`),
      listed: listed.drafts?.some((d: { draftId: string }) => d.draftId === created.draftId),
    };
    const deleted = toolJson(await client.callTool({ name: "delete_draft", arguments: { account: label, draft_id: created.draftId } }));
    const gone = toolJson(await client.callTool({ name: "get_draft", arguments: { account: label, draft_id: created.draftId } }));
    console.log(`\n[${label}] draft round trip:`, JSON.stringify({ ...roundTrip, deleted: deleted.deleted, goneStatus: gone.error?.status }, null, 2));
    if (!roundTrip.subjectMatches || !roundTrip.listed || deleted.deleted !== true || gone.error?.status !== 404) process.exitCode = 1;
  }

  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
