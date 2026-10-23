/**
 * Live smoke test: drives the built server over the real MCP protocol, as a
 * client would. Needs a session (or proves what happens without one);
 * everything in test/ needs none.
 *
 *   npm run build -w @foreverworks/mcp-onrc
 *   ONRC_STATE_DIR=<dir> npx tsx scripts/smoke.ts                                   # stdio
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<file> npx tsx scripts/smoke.ts   # a running service
 *
 * READ-ONLY: it never begins, completes or ends a login (those are the
 * deployment's login command's), so it cannot spend the user's session or a
 * Keycloak code. Without a session it checks that every read answers
 * needs_login with a remedy that names begin_login. With one it reads
 * health, session_status (probing once), the filings of the last year, the
 * newest filing's summary and documents, the calculation notes and the
 * invoices, and checks each answer's shape. Last, an unknown argument must be
 * refused.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const show = (label: string, value: unknown, max = 900): void => console.log(`${label}:`, JSON.stringify(value).slice(0, max));

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const main = async (): Promise<void> => {
  const client = await connectSmoke();
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const started = Date.now();
    const out = toolJson(await client.callTool({ name, arguments: args }));
    console.log(`  (${name}: ${Date.now() - started} ms)`);
    return out;
  };

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));
  check(tools.length === 9, "nine tools");

  const health = await call("health");
  show("\nhealth", health);
  check(health.ok === true, "health is ok");

  const status = await call("session_status", { probe: health.session === "present" });
  show("session_status", status);

  if (status.connected !== true) {
    console.log("\nno session: every read must say needs_login and how to fix it");
    for (const name of ["list_requests", "list_calculation_notes", "list_invoices"]) {
      const out = await call(name);
      check(out.error?.kind === "needs_login", `${name} answers needs_login`);
      check(typeof out.error?.remedy === "string" && out.error.remedy.includes("begin_login"), `${name}'s remedy names begin_login`);
    }
    const one = await call("get_request", { id: "00000000-0000-0000-0000-000000000000" });
    check(one.error?.kind === "needs_login", "get_request answers needs_login");
  } else {
    check(typeof status.who?.username === "string", "session_status names the account");
    check(status.isRefreshExpired === false, "the refresh token is live");

    const listed = await call("list_requests", { size: 10 });
    show("\nlist_requests", listed);
    check(listed.ok === true && Array.isArray(listed.items), "list_requests answers a list");
    const newest = listed.items?.[0];
    if (newest !== undefined) {
      check(typeof newest.id === "string" && typeof newest.number === "number", "a filing has an id and a number");
      const one = await call("get_request", { id: newest.id });
      show("get_request", one);
      check(one.ok === true && typeof one.request?.statusText === "string", "get_request has the office's status words");
      check(Array.isArray(one.documents), "get_request lists documents");
      check(!JSON.stringify(one).includes("uniqueId"), "no personal numeric code leaks through");
    } else {
      console.log("  (no filings in the last year: get_request not exercised)");
    }

    const notes = await call("list_calculation_notes");
    show("list_calculation_notes", notes);
    check(notes.ok === true && Array.isArray(notes.items), "list_calculation_notes answers a list");
    const invoices = await call("list_invoices");
    show("list_invoices", invoices);
    check(invoices.ok === true && Array.isArray(invoices.items), "list_invoices answers a list");
  }

  // The kit makes every input strict: a misspelt argument is a protocol error naming it, not a default silently used.
  const unknown = (await client.callTool({ name: "list_requests", arguments: { sizee: 3 } })) as { isError?: boolean; content: { text: string }[] };
  check(unknown.isError === true && (unknown.content[0]?.text ?? "").includes("sizee"), "an unknown argument is refused, by name");

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
