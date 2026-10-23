/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would. Needs the Drive grant; everything in test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke-drive.ts
 *
 * Nearly read-only. It creates one throwaway folder, plans a move without
 * applying it, and trashes the folder again, because a move tool that was never exercised against
 * the real API is a claim rather than a result — and the trash is where the
 * evidence goes, not a permanent delete.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const main = async (): Promise<void> => {
  const client = await connectSmoke();

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  // health answers per product; this script is about the drive section.
  const health = toolJson(await client.callTool({ name: "health", arguments: {} })).drive;
  console.log("\nhealth:", JSON.stringify(health));
  if (health.error) {
    await client.close();
    process.exit(1);
  }

  const root = toolJson(await client.callTool({ name: "list_folder", arguments: { path: "", limit: 50 } }));
  console.log(`\nroot -> ${root.entries?.length ?? "?"} entries`);

  const cursor = toolJson(await client.callTool({ name: "start_drive_cursor", arguments: {} }));
  console.log("start_cursor:", JSON.stringify(cursor).slice(0, 120));

  const found = toolJson(
    await client.callTool({ name: "find_files", arguments: { mime_type: "application/vnd.google-apps.folder", limit: 5 } }),
  );
  console.log(`find folders -> ${found.length ?? "?"} rows`);

  // The failure worth seeing shaped correctly: a path nothing answers to.
  const missing = toolJson(await client.callTool({ name: "resolve_path", arguments: { path: "No Such Folder At All" } }));
  console.log("not_found shape:", JSON.stringify(missing.error));

  const scratch = `mcp-drive-smoke-${Date.now()}`;
  const made = toolJson(await client.callTool({ name: "create_folder", arguments: { path: scratch } }));
  console.log(`\nmkdir ${scratch}:`, JSON.stringify(made));

  const dry = toolJson(
    await client.callTool({
      name: "move_file",
      arguments: { sources: [`id:${made.id}`], destination_path: "", dry_run: true },
    }),
  );
  console.log("move dry_run verdict:", JSON.stringify(dry.plan?.steps?.[0]?.verdict ?? dry.error));

  const gone = toolJson(await client.callTool({ name: "trash_file", arguments: { file_id: made.id } }));
  console.log("trash:", JSON.stringify(gone.trashed ?? gone.error));

  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
