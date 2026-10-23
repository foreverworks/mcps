/**
 * Live smoke test: drives the server as a real MCP client would, against
 * curs.bnr.ro. Reads only.
 *
 *   npm run build -w @foreverworks/mcp-bnr
 *   npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * health; the USD annual averages 2020-2023 against BNR's published values;
 * EUR on a Saturday (it must answer Friday's fixing); and a future date,
 * which must be refused before anything is fetched.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const PUBLISHED: Readonly<Record<number, string>> = { 2020: "4.2440", 2021: "4.1604", 2022: "4.6885", 2023: "4.5743" };

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const main = async (): Promise<void> => {
  const client = await connectSmoke({ name: "smoke" });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const health = await call("health");
  console.log("health:", JSON.stringify(health));
  check(health.ok === true, "BNR answers");

  for (const [year, published] of Object.entries(PUBLISHED)) {
    const a = await call("annual_average", { currency: "USD", year: Number(year) });
    check(a.average === published, `USD ${year}: ${a.average} (BNR published ${published}), ${a.months?.length} months`);
  }
  const saturday = await call("rate", { currency: "EUR", date: "2026-10-17" });
  console.log("rate EUR 2026-10-17:", JSON.stringify(saturday));
  check(saturday.published_on === "2026-10-16", "a Saturday answers Friday's fixing");
  const future = await call("rate", { currency: "EUR", date: "2099-01-01" });
  check(future.error?.kind === "input", "a future date is refused");

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
