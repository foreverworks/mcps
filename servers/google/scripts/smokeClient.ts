/**
 * What the Docs, Sheets and Slides smoke scripts share: the server driven as a
 * real MCP client drives it (mcp-kit's connectSmoke: the running service when
 * MCP_URL is set, the built one over stdio otherwise), a call that stops the run on the first
 * `error`, and a scratch folder on Drive that is trashed at the end whatever
 * happened in between.
 *
 * The account is SMOKE_ACCOUNT, else the editors account on the Drive grant
 * (the scratch folder is made by Drive, so the two must be one identity).
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

export type Call = (name: string, args: Record<string, unknown>) => Promise<any>;

/**
 * Run `body` against the built server with a scratch folder, then trash what
 * it made (the files it registered, then the folder): Drive's trash, where it
 * stays recoverable for 30 days, never a permanent delete.
 */
export const smoke = async (
  product: string,
  body: (call: Call, folderId: string, made: (id: string) => void, account: string) => Promise<void>,
): Promise<void> => {
  const client = await connectSmoke({ name: `smoke-${product}` });
  const call: Call = async (name, args) => {
    const body = toolJson(await client.callTool({ name, arguments: args }));
    if (body?.error) throw new Error(`${name} failed: ${JSON.stringify(body.error)}`);
    return body;
  };
  const made: string[] = [];
  let failed = false;
  let folderId = "";
  try {
    const listed = (await call("list_accounts", {})).editors as { accounts?: { account: string; source: string }[] };
    const account = process.env["SMOKE_ACCOUNT"] || listed.accounts?.find((a) => a.source === "drive")?.account;
    if (!account) throw new Error("no editors account runs on the Drive grant; set SMOKE_ACCOUNT or GOOGLE_EDITORS_DRIVE_ACCOUNT");
    const health = (await call("health", { account })).editors;
    console.log("editors health:", JSON.stringify(health));
    folderId = (await call("create_folder", { path: `mcp-${product}-smoke-${Date.now()}` })).id;
    console.log("scratch folder:", folderId);
    await body(call, folderId, (id) => made.push(id), account);
  } catch (e) {
    failed = true;
    console.error(e instanceof Error ? e.message : e);
  } finally {
    for (const id of [...made, ...(folderId ? [folderId] : [])]) {
      const gone = await call("trash_file", { file_id: id }).catch((e: unknown) => ({ error: String(e) }));
      console.log(`trash ${id}:`, gone.trashed ?? gone.error);
    }
    await client.close();
  }
  if (failed) process.exit(1);
};
