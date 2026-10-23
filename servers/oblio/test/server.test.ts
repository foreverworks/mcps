/**
 * The server as a client sees it, through the kit's guard, end to end against
 * a stubbed fetch: app.json and the state dir are temp files, and the server
 * confirms every money call with the user (MCP_CONFIRM=elicit) through a client
 * that records the line it was asked to show.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ACCESS_META, checkPolicy, confirmingClient, connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { asAppError, remedyFor } from "../src/domain/errors.js";
import { policyFor } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { envelope, json, listedRow, tempDir, withFetch } from "./helpers.js";

const envWith = (): NodeJS.ProcessEnv => {
  const dir = tempDir();
  const config = join(dir, "app.json");
  writeFileSync(
    config,
    JSON.stringify({
      client_id: "account@example.test",
      client_secret: "secret",
      company_cif: "RO92345672",
      api_base: "https://oblio.test/api",
      token_url: "https://oblio.test/api/authorize/token",
    }),
  );
  mkdirSync(join(dir, "state"));
  return { OBLIO_CONFIG: config, OBLIO_STATE_DIR: join(dir, "state") };
};

const connected = async (env: NodeJS.ProcessEnv) => {
  const deps = buildDeps(env);
  const server = new McpServer({ name: "oblio", version: "test" });
  registerAll(
    guard(server, {
      service: "oblio",
      policy: policyFor(deps),
      settings: { maxAccess: "money", confirm: "elicit" },
      log: () => undefined,
      vocabulary: { asAppError, remedyFor },
    }),
    deps,
  );
  const { client, asked } = confirmingClient("test");
  await connectInMemory(server, client);
  return { client, asked };
};

const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

const INVOICE = {
  client: { name: "Client SRL", cif: "RO87654329", vat_payer: true },
  series_name: "FCT",
  issue_date: "2026-09-28",
  products: [{ name: "Consulting", price: "1000.00", quantity: "8", vat_percentage: "21", vat_included: false }],
};

describe("the oblio server", () => {
  it("classifies every tool it registers, and nothing else", () => {
    const deps = buildDeps({});
    expect(() => checkPolicy("oblio", (s) => registerAll(s, deps), policyFor(deps))).not.toThrow();
  });

  it("marks every tool that issues or unmakes an invoice as money", async () => {
    const { client } = await connected(envWith());
    const tools = (await client.listTools()).tools;
    const gated = tools.filter((t) => t._meta?.[ACCESS_META] === "money").map((t) => t.name);
    expect(gated.sort()).toEqual([
      "cancel_invoice",
      "collect_invoice",
      "create_invoice",
      "delete_invoice",
      "invoice_from_proforma",
      "restore_invoice",
      "reverse_invoice",
    ]);
  });

  it("issues an invoice after the user confirmed the exact line, and returns the exact total", async () => {
    const calls = withFetch(async (url) =>
      url.endsWith("/authorize/token")
        ? json({ access_token: "tok", expires_in: "3600" })
        : envelope({ seriesName: "FCT", number: "0043", link: "https://oblio.test/pdf" }),
    );
    const { client, asked } = await connected(envWith());
    const out = parse(await client.callTool({ name: "create_invoice", arguments: INVOICE }));
    expect(asked).toEqual([
      "oblio: Issue invoice in series FCT to Client SRL (CIF RO87654329): 9680.00 RON incl. VAT 1680.00 (1 line), dated 2026-09-28",
    ]);
    expect(out).toMatchObject({ seriesName: "FCT", number: "0043", computedTotal: { gross: "9680.00", currency: "RON" } });
    const body = calls.find((c) => c.url.endsWith("/docs/invoice"))?.body as Record<string, unknown>;
    expect(body).toMatchObject({ cif: "RO92345672", currency: "RON", precision: 2 });
    expect(body["idempotencyKey"]).toMatch(/^mcp-oblio-/);
  });

  it("refuses a price given as a number before anyone is asked to confirm it", async () => {
    const { client, asked } = await connected(envWith());
    const result = await client.callTool({
      name: "create_invoice",
      arguments: { ...INVOICE, products: [{ ...INVOICE.products[0], price: 1000 }] },
    });
    expect(result.isError).toBe(true);
    expect(asked).toEqual([]);
  });

  it("refuses a buyer's CIF or IBAN that fails its check digits before anyone is asked, and lets a foreign code through", async () => {
    const { client, asked } = await connected(envWith());
    const call = (buyer: Record<string, unknown>) => client.callTool({ name: "create_invoice", arguments: { ...INVOICE, client: buyer } });
    const typo = await call({ name: "Client SRL", cif: "RO87654328" });
    expect(typo.isError).toBe(true);
    expect(JSON.stringify(typo.content)).toContain("control digit");
    expect((await call({ name: "Client SRL", cif: "RO87654329", iban: "RO49AAAA1B31007593840001" })).isError).toBe(true);
    expect((await call({ name: "Ana Popescu", cif: "1000000000001" })).isError).toBe(true);
    expect(asked).toEqual([]);
    withFetch(async (url) =>
      url.endsWith("/authorize/token") ? json({ access_token: "tok", expires_in: "3600" }) : envelope({ seriesName: "FCT", number: "0043", total: "9680.00" }),
    );
    const foreign = await call({ name: "Beispiel GmbH", cif: "DE123456789", country: "Germania", iban: "DE89370400440532013000" });
    expect(foreign.isError).toBeFalsy();
  });

  it("refuses a document number with its series still on it before anyone is asked to confirm it", async () => {
    const { client, asked } = await connected(envWith());
    const result = await client.callTool({ name: "cancel_invoice", arguments: { series_name: "FCT", number: "FCT 0042" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("without its series");
    expect(asked).toEqual([]);
  });

  it("lists unpaid invoices as a read, with nobody asked to confirm anything", async () => {
    const calls = withFetch(async (url) =>
      url.endsWith("/authorize/token") ? json({ access_token: "tok", expires_in: "3600" }) : envelope([listedRow()]),
    );
    const { client, asked } = await connected(envWith());
    const tool = (await client.listTools()).tools.find((t) => t.name === "list_invoices");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    const out = parse(await client.callTool({ name: "list_invoices", arguments: { status: "unpaid", limit: 10 } }));
    expect(out).toMatchObject({ count: 1, companyCif: "RO92345672", invoices: [{ seriesName: "FCT", number: "0126", total: "1210.0000" }] });
    expect(out).not.toHaveProperty("nextCursor");
    const listed = new URL(calls.find((c) => c.url.includes("/docs/invoice/list"))?.url ?? "");
    expect(listed.searchParams.get("collected")).toBe("0");
    expect(asked).toEqual([]);
  });

  it("records a payment after the user confirmed a line naming the invoice's own buyer and currency, and sends exactly that", async () => {
    const calls = withFetch(async (url) =>
      url.endsWith("/authorize/token")
        ? json({ access_token: "tok", expires_in: "3600" })
        : url.includes("/docs/invoice/list")
          ? envelope([listedRow({ seriesName: "FCT", number: "0042", currency: "EUR", total: "1210.00" })])
          : envelope({
              documentType: "Factura",
              seriesName: "FCT",
              number: "0042",
              collects: [{ issueDate: "2026-10-02", type: "Ordin de plata", number: "OP 7001", value: "1000.00" }],
            }),
    );
    const { client, asked } = await connected(envWith());
    const out = parse(
      await client.callTool({
        name: "collect_invoice",
        arguments: { series_name: "FCT", number: "0042", type: "Ordin de plata", amount: "1000.00", date: "2026-10-02", document_number: "OP 7001" },
      }),
    );
    expect(asked).toEqual([
      "oblio: Record 1000.00 EUR paid on invoice FCT 0042 to Client SRL, Ordin de plata OP 7001, 2026-10-02, leaving 210.00 EUR unpaid",
    ]);
    const sent = calls.filter((c) => c.url.endsWith("/docs/invoice/collect"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "PUT" });
    expect(sent[0]?.body).toMatchObject({
      cif: "RO92345672",
      seriesName: "FCT",
      number: "0042",
      collect: { type: "Ordin de plata", documentNumber: "OP 7001", value: "1000.00", issueDate: "2026-10-02" },
      idempotencyKey: out.idempotencyKey,
    });
    // The invoice is read once, by the plan the line was written from.
    // Looked up when asking and again with the answer, which runs only on what was confirmed.
    expect(calls.filter((c) => c.url.includes("/docs/invoice/list"))).toHaveLength(2);
    expect(out).toMatchObject({ sent: true, recorded: { number: "OP 7001", value: "1000.00" }, balance: { outstandingAfter: "210.00" } });
  });

  it("refuses a payment over what the invoice owes in this server's words, before anyone is asked", async () => {
    const calls = withFetch(async (url) =>
      url.endsWith("/authorize/token") ? json({ access_token: "tok", expires_in: "3600" }) : envelope([listedRow({ number: "0042", total: "100.00" })]),
    );
    const { client, asked } = await connected(envWith());
    const result = await client.callTool({
      name: "collect_invoice",
      arguments: { series_name: "FCT", number: "0042", type: "Card", amount: "100.01", date: "2026-10-02", document_number: "POS 1" },
    });
    expect(result.isError).toBe(true);
    expect(parse(result).error).toMatchObject({ kind: "input", message: expect.stringContaining("more than the 100.00 RON") });
    expect(asked).toEqual([]);
    expect(calls.some((c) => c.url.endsWith("/docs/invoice/collect"))).toBe(false);
  });

  it("issues a storno after the user confirmed a line naming the invoice's buyer and the negated total, and sends exactly that", async () => {
    const calls = withFetch(async (url, init) =>
      url.endsWith("/authorize/token")
        ? json({ access_token: "tok", expires_in: "3600" })
        : url.includes("/docs/invoice/list")
          ? envelope([listedRow({ seriesName: "FCT", number: "0042", total: "9680.0000" })])
          : init?.method === "POST"
            ? envelope({ seriesName: "FCT", number: "0127", link: "https://oblio.test/pdf/0127" })
            : envelope({ seriesName: "FCT", number: "0127", total: "-9680.00" }),
    );
    const { client, asked } = await connected(envWith());
    const out = parse(await client.callTool({ name: "reverse_invoice", arguments: { series_name: "FCT", number: "0042", expect_total: "9680.00" } }));
    expect(asked).toEqual(["oblio: Issue a reversing invoice for FCT 0042, Client SRL, total -9680.00 RON, in series FCT"]);
    const issued = calls.filter((c) => c.method === "POST" && c.url.endsWith("/docs/invoice"));
    expect(issued).toHaveLength(1);
    expect(issued[0]?.body).toEqual({
      cif: "RO92345672",
      seriesName: "FCT",
      referenceDocument: { type: "Factura", seriesName: "FCT", number: "0042", refund: 0 },
      idempotencyKey: out.idempotencyKey,
    });
    // Looked up when asking and again with the answer, which runs only on what was confirmed.
    expect(calls.filter((c) => c.url.includes("/docs/invoice/list"))).toHaveLength(2);
    expect(out).toMatchObject({ number: "0127", computedTotal: { gross: "-9680.00" }, oblioTotal: "-9680.00" });
  });

  it("answers a missing app.json as config, naming the variable, with no default path to fall back on", async () => {
    const { client } = await connected({});
    const out = parse(await client.callTool({ name: "list_series", arguments: {} }));
    expect(out.error).toMatchObject({ kind: "config" });
    expect(out.error.message).toContain("OBLIO_CONFIG");
  });
});
