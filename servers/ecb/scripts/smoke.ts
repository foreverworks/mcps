/**
 * Live smoke test: drives the server as a real MCP client would, against
 * www.ecb.europa.eu. Reads only.
 *
 *   npm run build -w @foreverworks/mcp-ecb
 *   npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * health; a rate the ECB published long ago and that never changes (USD on
 * 1999-01-04, 1.1789, from the whole history); a Saturday, which must answer
 * Friday's fixing; a window longer than the 90-day file reaches, whose last
 * fixing must be the latest one; a cross rate against its two rates; and a
 * future date, which must be refused before anything is fetched. The history
 * is 960 KB over the wire.
 */
import { addDays, connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

/** The most recent Saturday strictly before today in UTC, so Friday's fixing exists and has been published for a day. */
const lastSaturday = (): string => {
  const today = new Date().toISOString().slice(0, 10);
  let d = addDays(today, -1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, -1);
  return d;
};

const main = async (): Promise<void> => {
  const client = await connectSmoke({ name: "smoke" });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const health = await call("health");
  console.log("health:", JSON.stringify(health));
  check(health.ok === true && typeof health.latest_fixing === "string", "the ECB answers");

  const first = await call("rate", { currency: "USD", date: "1999-01-04" });
  check(first.rate === "1.1789" && first.fixing_date === "1999-01-04", `USD on the euro's first day: ${first.rate} (the ECB published 1.1789)`);

  const saturday = lastSaturday();
  const sat = await call("rate", { currency: "EUR", date: saturday });
  const usd = await call("rate", { currency: "USD", date: saturday });
  const friday = addDays(saturday, -1);
  console.log(`rate USD ${saturday}:`, JSON.stringify(usd));
  check(usd.fixing_date === friday || usd.fixing_date < saturday, `a Saturday (${saturday}) answers an earlier fixing (${usd.fixing_date})`);
  check(sat.rate === "1" && sat.fixing_date === usd.fixing_date, "the euro is 1 on the same fixing");

  // 400 days back reaches past the 90-day file, so this reads the whole history and lays the small files over its tail.
  const year = await call("rates", { currencies: ["USD"], from: addDays(usd.fixing_date, -400), to: usd.fixing_date });
  check(year.fixings?.length > 250 && year.fixings.at(-1)?.date === usd.fixing_date && year.fixings.at(-1)?.rates?.USD === usd.rate, `a window of 400 days (${year.count} rates) ends on the fixing the daily file gave`);

  const gbp = await call("rate", { currency: "GBP", date: saturday });
  const cross = await call("convert", { amount: "100", from: "GBP", to: "USD", date: saturday, places: 6 });
  console.log("convert 100 GBP to USD:", JSON.stringify(cross));
  check(cross.rates?.[0]?.rate === gbp.rate && cross.rates?.[1]?.rate === usd.rate && cross.fixing_date === usd.fixing_date, "a cross rate uses both rates of one fixing");

  const future = await call("rate", { currency: "USD", date: "2099-01-01" });
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
