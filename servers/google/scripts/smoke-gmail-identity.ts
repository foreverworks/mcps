/** Read-only protocol proof for message identity. Prints counts, never message content. */
import assert from "node:assert/strict";
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const main = async () => {
  const client = await connectSmoke();
  try {
    const search = toolJson(await client.callTool({ name: "search_threads", arguments: {
      query: process.env["SMOKE_QUERY"] || "newer_than:30d", max_results: 1,
      ...(process.env["SMOKE_ACCOUNT"] ? { account: process.env["SMOKE_ACCOUNT"] } : {}),
    } }));
    assert.ok(!search.error, "search failed");
    const first = search.threads?.[0];
    assert.ok(first?.id && first?.account, "no message available for read-only smoke");
    const args = { thread_id: first.id, account: first.account };
    const meta = toolJson(await client.callTool({ name: "get_thread", arguments: { ...args, detail: "metadata" } }));
    const full = toolJson(await client.callTool({ name: "get_thread", arguments: { ...args, detail: "text" } }));
    assert.ok(!meta.error && !full.error, "thread fetch failed");
    type Message = { id: string; messageId?: string; replyTo?: string; body?: string };
    const messages = meta.messages as Message[];
    let identities = 0, replyDestinations = 0;
    for (const m of messages) {
      assert.equal(m.body, undefined);
      const other = (full.messages as Message[]).find((x) => x.id === m.id);
      assert.ok(other, "message disappeared between reads");
      assert.equal(m.messageId, other.messageId);
      assert.equal(m.replyTo, other.replyTo);
      if (m.messageId) identities++;
      if (m.replyTo) replyDestinations++;
    }
    assert.ok(identities > 0, "the deployed response did not preserve any RFC Message-ID");
    console.log(JSON.stringify({ account: first.account, messages: messages.length,
      messageIds: identities, replyDestinations, metadataMatchesFull: true, mailboxWrites: 0 }));
  } finally {
    await client.close();
  }
};

main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
