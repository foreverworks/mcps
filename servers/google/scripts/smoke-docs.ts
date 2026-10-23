/**
 * Live smoke test for Docs: drives the server as a real MCP client would, the
 * running service when MCP_URL is set (mcp-kit connectSmoke), else the built
 * one over stdio. Needs the Drive grant (or SMOKE_ACCOUNT's) and the Docs API enabled; everything in
 * test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke-docs.ts
 *
 * It WRITES, on that account's Drive only: a scratch folder and one document in it,
 * created, read, edited by section and appended to, then both trashed.
 */
import { smoke } from "./smokeClient.js";

await smoke("docs", async (call, folderId, made, account) => {
  const created = await call("create_document", {
    account,
    title: "mcp docs smoke",
    folder_id: folderId,
    markdown: "# Plan\n\nFirst **draft** with a [link](https://example.com).\n\n## Steps\n\n1. one\n2. two\n\n# Risks\n\n| Risk | Owner |\n| --- | --- |\n| late | us |",
  });
  made(created.documentId);
  console.log("created:", created.link);

  const read = await call("read_document", { account, document_id: created.documentId });
  console.log("sections:", read.sections.map((s: { path: string }) => s.path).join(" | "));
  console.log("markdown:\n" + read.markdown);

  const edited = await call("edit_document_section", {
    account,
    document_id: created.documentId,
    section: "Plan > Steps",
    markdown: "- replaced\n  - nested\n\n`code` and *italic*",
    expected_revision: read.revisionId,
  });
  console.log("edited:", JSON.stringify(edited));

  const stale = await call("edit_document_section", {
    account,
    document_id: created.documentId,
    section: "Risks",
    markdown: "never written",
    expected_revision: read.revisionId,
  }).catch((e: unknown) => String(e));
  console.log("stale revision refused:", String(stale).includes("stale_revision"));

  await call("append_to_document", { account, document_id: created.documentId, markdown: "## Appendix\n\nthe end" });
  const after = await call("read_document", { account, document_id: created.documentId });
  console.log("after:\n" + after.markdown);
});
