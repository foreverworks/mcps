/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would. Needs credentials; everything in test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke.ts [charges.json]
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

const main = async () => {
  const client = await connectSmoke();
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  const health = await call("health");
  console.log("\nhealth:", JSON.stringify(health, null, 2));
  if (health.error) process.exitCode = 1;

  const list = await call("list_orders", { limit: 3 });
  console.log(`\nlist_orders: ${list.total} orders; newest:`, JSON.stringify(list.orders?.[0]));

  const delivered = await call("list_orders", { state: "delivered", limit: 1 });
  const receipt = await timed("get_receipt", () => call("get_receipt", { order_id: delivered.orders?.[0]?.orderId }));
  console.log(JSON.stringify({ ...receipt, items: receipt.items?.slice(0, 2) }, null, 2));

  const bad = await call("get_receipt", { order_id: 1 });
  console.log("\nerror shape:", JSON.stringify(bad.error));

  const chargesPath = process.argv[2];
  if (chargesPath) {
    const charges = JSON.parse(await readFile(chargesPath, "utf8")) as unknown[];
    for (const pass of ["cold", "warm"]) {
      const out = await timed(`\nmatch_card_charges ${charges.length} rows (${pass})`, () => call("match_card_charges", { charges }));
      if (out.error) {
        console.log(JSON.stringify(out.error));
        process.exitCode = 1;
        break;
      }
      const pct = ((out.matched.length / charges.length) * 100).toFixed(1);
      console.log(`matched ${out.matched.length}/${charges.length} (${pct}%), unmatched charges ${out.unmatchedCharges.length}, unmatched orders ${out.unmatchedOrders.length}, unreadable ${out.unreadableOrders.length}`);
    }
  }

  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
