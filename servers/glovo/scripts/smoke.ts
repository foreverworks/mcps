/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would. Needs credentials; everything in test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke.ts [days=30] [charges.json]
 *
 * It prints COUNTS AND SHAPES ONLY: key sets, tallies, timings. A receipt
 * holds what someone bought, and nothing about it belongs in a terminal
 * scrollback that gets pasted into chat.
 *
 * charges.json is optional: an array of {id, date, amount, currency} card rows,
 * e.g. exported from a bank statement. With it, the run also reports match coverage.
 */
import { readFile } from "node:fs/promises";
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = Date.now();
  const out = await fn();
  console.log(`${label}: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  return out;
};

const tally = (values: readonly unknown[]) =>
  Object.fromEntries([...values.reduce<Map<string, number>>((m, v) => m.set(String(v), (m.get(String(v)) ?? 0) + 1), new Map())]);

const keys = (value: unknown) => (value && typeof value === "object" ? Object.keys(value).sort().join(",") : typeof value);

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const main = async () => {
  const days = Number(process.argv[2] ?? 30);
  const client = await connectSmoke();
  // A cold range walk is paced at 700 ms a call and waits out 429s 20 s at a
  // time, so the SDK's 60 s request timeout is too short for it.
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    toolJson(await client.callTool({ name, arguments: args }, { timeout: 15 * 60_000 }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  const health = await timed("health", () => call("health"));
  console.log("  keys:", keys(health), "| ok:", health.ok, "| latest state:", health.latestOrder?.state, "| stored:", health.storedOrderDetails);
  if (health.error) {
    console.log("  error:", JSON.stringify(health.error));
    process.exitCode = 1;
  }

  const list = await timed("list_orders limit 20", () => call("list_orders", { limit: 20 }));
  console.log("  rows:", list.orders?.length, "| scanned:", list.scanned, "| complete:", list.complete, "| status:", JSON.stringify(tally(list.orders.map((o: any) => o.status))));
  console.log("  row keys:", keys(list.orders?.[0]));

  const bad = await call("get_receipt", { order_id: 1 });
  console.log("error shape:", JSON.stringify(bad.error));

  const since = isoDaysAgo(days);
  const until = isoDaysAgo(0);
  for (const pass of ["cold", "warm"]) {
    const out = await timed(`get_receipts ${since}..${until} headline (${pass})`, () => call("get_receipts", { since, until }));
    if (out.error) {
      console.log("  error:", JSON.stringify(out.error));
      process.exitCode = 1;
      break;
    }
    const ok = out.receipts.filter((r: any) => !r.partial);
    const cents = (s: string | undefined) => (s === undefined ? 0 : Math.round(Number(s) * 100));
    console.log(
      `  count ${out.count}, partial ${out.receipts.length - ok.length}, states ${JSON.stringify(tally(ok.map((r: any) => r.state)))}, ` +
        `verticals ${JSON.stringify(tally(ok.map((r: any) => r.vertical)))}, dated ${ok.filter((r: any) => r.localDate).length}, ` +
        `card undefined ${ok.filter((r: any) => r.charged?.card === undefined).length}, credit-split ${ok.filter((r: any) => cents(r.charged?.glovoCredit) > 0).length}`,
    );
    const inRange = ok.every((r: any) => r.localDate >= since && r.localDate <= until);
    console.log("  all dates in range:", inRange, "| headline keys:", keys(ok[0]));
  }

  const full = await timed("get_receipts full (warm)", () => call("get_receipts", { since, until, detail: "full" }));
  const receipts = (full.receipts ?? []).filter((r: any) => !r.partial);
  const items = receipts.flatMap((r: any) => r.items);
  const cents = (s: string | undefined) => (s === undefined ? NaN : Math.round(Number(s) * 100));
  const reconciled = receipts.filter((r: any) => r.state === "delivered").every((r: any) => {
    const lines = r.priceLines.filter((l: any) => l.kind !== "TOTAL").reduce((a: number, l: any) => a + cents(l.amount), 0);
    const legs = ["card", "glovoCredit", "cash", "other"].reduce((a, k) => a + (r.charged[k] === undefined ? 0 : cents(r.charged[k])), 0);
    return lines === cents(r.total) && legs === cents(r.total);
  });
  console.log(
    `  receipts ${receipts.length}, items ${items.length}, adjustments ${JSON.stringify(tally(items.map((i: any) => i.adjustment ?? "none")))}, ` +
      `price-line kinds ${JSON.stringify(tally(receipts.flatMap((r: any) => r.priceLines.map((l: any) => l.kind))))}, ` +
      `payment methods ${JSON.stringify(tally(receipts.flatMap((r: any) => r.payments.map((p: any) => p.method))))}`,
  );
  console.log("  delivered receipts reconcile (lines = total = legs):", reconciled);
  console.log("  receipt keys:", keys(receipts[0]));
  console.log("  item keys (union):", [...new Set(items.flatMap((i: any) => Object.keys(i)))].sort().join(","));

  const chargesPath = process.argv[3];
  if (chargesPath) {
    const charges = JSON.parse(await readFile(chargesPath, "utf8")) as unknown[];
    const out = await timed(`match_card_charges ${charges.length} rows`, () => call("match_card_charges", { charges }));
    if (out.error) {
      console.log(JSON.stringify(out.error));
      process.exitCode = 1;
    } else {
      const pct = ((out.matched.length / charges.length) * 100).toFixed(1);
      console.log(`  matched ${out.matched.length}/${charges.length} (${pct}%), unmatched charges ${out.unmatchedCharges.length}, unmatched orders ${out.unmatchedOrders.length}, unreadable ${out.unreadableOrders.length}`);
    }
  }

  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
