/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would. Needs app.json and a state dir; everything in test/ needs
 * neither.
 *
 *   npm run build -w @foreverworks/mcp-oblio
 *   OBLIO_CONFIG=<app.json> OBLIO_STATE_DIR=<dir> npx tsx scripts/smoke.ts [options]
 *
 * READ-ONLY BY DEFAULT: health, list_companies, list_series, list_vat_rates,
 * list_clients (limit 5), list_invoices (limit 3, then its next page), and
 * one input failure that never reaches Oblio.
 *
 *   --invoice FCT/0042        also get_invoice for that series and number (a read)
 *   --write-proforma PR       ISSUES a real proforma in series PR to a client named
 *                             "Smoke test", 0.01 RON. A proforma is not a fiscal
 *                             document, but it takes a number in its series. Nothing
 *                             money-class (an invoice issued, cancelled, restored or
 *                             deleted) is reachable from this script at all: those are
 *                             confirmed by a person and are not smoke material.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const option = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const show = (label: string, value: unknown, max = 400): void => console.log(`${label}:`, JSON.stringify(value).slice(0, max));

const main = async (): Promise<void> => {
  const invoice = option("--invoice");
  const proformaSeries = option("--write-proforma");

  const client = await connectSmoke();
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  const health = await call("health");
  show("\nhealth", health, 600);
  if (health.error) {
    await client.close();
    process.exit(1);
  }

  show("list_companies", await call("list_companies"));
  show("list_series", await call("list_series"));
  const vat = await call("list_vat_rates");
  show("list_vat_rates", vat);
  const clients = await call("list_clients", { limit: 5 });
  console.log(`list_clients -> ${clients.count ?? "?"} shown${clients.nextOffset === undefined ? "" : ", more after"}`);

  const invoices = await call("list_invoices", { limit: 3 });
  show("list_invoices", invoices, 600);
  if (typeof invoices.nextCursor === "string") {
    const next = await call("list_invoices", { limit: 3, cursor: invoices.nextCursor });
    console.log(`list_invoices next page -> ${next.count ?? next.error?.message ?? "?"}`);
  }

  if (invoice !== undefined) {
    const [series_name = "", number = ""] = invoice.split("/");
    show("get_invoice", await call("get_invoice", { series_name, number }), 600);
  }

  // The failure worth seeing shaped correctly, which never reaches Oblio: a
  // price with more decimals than the document keeps, refused by the rules.
  const lines = [{ name: "x", price: "1.005", quantity: "1", vat_percentage: "21", vat_included: false }];
  show("\nrule failure", (await call("create_proforma", { client: { name: "x" }, series_name: "PR", products: lines })).error, 300);

  if (proformaSeries !== undefined) {
    // The company's default rate, so the line is one Oblio accepts as it stands.
    const rate = (vat.vatRates ?? []).find((r: { isDefault: boolean }) => r.isDefault) ?? { name: "Normala", percent: "21" };
    const issued = await call("create_proforma", {
      client: { name: "Smoke test" },
      series_name: proformaSeries,
      products: [{ name: "Smoke test", price: "0.01", vat_name: rate.name, vat_percentage: rate.percent, vat_included: true }],
      internal_note: "mcp-oblio smoke test; safe to delete",
    });
    show("\ncreate_proforma", issued, 600);
  }

  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
