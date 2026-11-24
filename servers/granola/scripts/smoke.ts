/**
 * Live smoke test: drives the server as a real MCP client would.
 *
 *   npm run build -w @foreverworks/mcp-granola
 *   npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * It needs no account for its first part: discovery against Granola's real server
 * (GRANOLA_MCP_URL, default https://mcp.granola.ai/mcp) must reach the 401, the
 * resource metadata, the authorization server's metadata and its registration
 * endpoint. Nothing is registered. Then, against the server it drives, `health`
 * and the tool list. With a grant held (run it against the running service that
 * holds one, with MCP_URL), it also runs one `search_meetings` for a single
 * meeting, which reads and changes nothing. It never calls
 * `begin_authorization` or `complete_authorization`: signing in is a person's.
 */
import { connectSmoke, discoverOAuth, toolJson } from "@foreverworks/mcp-kit";

import { KNOWN_TOOLS, WITHHELD_TOOLS } from "../src/domain/tools.js";

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const main = async (): Promise<void> => {
  const upstream = process.env["GRANOLA_MCP_URL"]?.trim() || "https://mcp.granola.ai/mcp";
  const found = await discoverOAuth({
    resourceUrl: upstream,
    fail: (message) => {
      throw new Error(message);
    },
  });
  console.log("discovery:", JSON.stringify({ issuer: found.issuer, registration: found.registrationEndpoint !== undefined, scopes: found.serverScopes }));
  check(found.registrationEndpoint !== undefined, "the sign-in service offers dynamic registration");
  check(found.challengeMethods.includes("S256"), "it supports PKCE S256");
  check(found.serverScopes.includes("offline_access"), "it can grant offline_access (a refresh token)");

  const client = await connectSmoke({ name: "smoke" });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  check(["health", "refresh_grant", "begin_authorization", "complete_authorization", ...KNOWN_TOOLS].every((n) => tools.some((t) => t.name === n)), "every tool is listed");
  check(!tools.some((t) => WITHHELD_TOOLS.includes(t.name)), "no write or account tool is offered");

  const health = await call("health");
  console.log("health:", JSON.stringify(health));
  if (health.grant?.present === true) {
    check(health.ok === true, "the grant works and Granola answers");
    console.log(`  tools Granola lists that nobody has classified here yet: ${JSON.stringify(health.tools?.hidden ?? [])}`);
    const found = await call("search_meetings", { query: "weekly sync", limit: 1 });
    check(found.error === undefined, "search_meetings answers");
  } else {
    console.log("  (no grant held here: the account part is skipped; run against a service that holds one)");
    check(health.ok === false && typeof health.next === "string", "health says how to sign in");
  }

  await client.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nsmoke: every check passed");
};

main().catch((error: unknown) => {
  console.error("smoke failed:", error);
  process.exit(1);
});
