/**
 * Live smoke test for Sheets: drives the server as a real MCP client would,
 * the running service when MCP_URL is set (mcp-kit connectSmoke), else the
 * built one over stdio. Needs the Drive grant (or SMOKE_ACCOUNT's) and the Sheets API enabled;
 * everything in test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke-sheets.ts
 *
 * It WRITES, on that account's Drive only: a scratch folder and one spreadsheet in
 * it, filled, upserted, formatted and charted, then both trashed.
 */
import { smoke } from "./smokeClient.js";

await smoke("sheets", async (call, folderId, made, account) => {
  const created = await call("create_spreadsheet", {
    account,
    title: "mcp sheets smoke",
    folder_id: folderId,
    sheets: [{ title: "Invoices", headers: ["No", "Client", "Total", "Issued"] }, { title: "Notes" }],
  });
  made(created.spreadsheetId);
  console.log("created:", created.link);
  const id = created.spreadsheetId;

  console.log("sheets:", JSON.stringify((await call("list_sheets", { account, spreadsheet_id: id })).sheets));
  await call("format_range", { account, spreadsheet_id: id, range: "Invoices!C:C", number_format: { type: "CURRENCY", pattern: "#,##0.00 [$RON]" } });

  const appended = await call("append_rows", {
    account,
    spreadsheet_id: id,
    sheet: "Invoices",
    rows: [
      { No: 1001, Client: "Acme", Total: 1234.5, Issued: "2026-09-28" },
      { No: 1002, Client: "Beta", Total: 99.99, Issued: "2026-09-29" },
    ],
  });
  console.log("appended:", JSON.stringify(appended));

  const upserted = await call("upsert_rows", {
    account,
    spreadsheet_id: id,
    sheet: "Invoices",
    key: "No",
    rows: [{ No: 1002, Total: 100 }, { No: 1003, Client: "Gamma", Total: 5, Issued: "2026-10-01" }],
  });
  console.log("upserted:", JSON.stringify(upserted));

  await call("write_range", { account, spreadsheet_id: id, range: "Invoices!F1:G1", values: [["Sum", "=SUM(C2:C4)"]] });
  await call("format_range", { account, spreadsheet_id: id, range: "Invoices!A1:D1", bold: true, background: "#e8f0fe", freeze_rows: 1, borders: { style: "SOLID", sides: ["bottom"] } });

  const rows = await call("read_rows", { account, spreadsheet_id: id, sheet: "Invoices" });
  console.log("rows:", JSON.stringify(rows.rows));

  const chart = await call("add_chart", { account, spreadsheet_id: id, type: "COLUMN", data_range: "Invoices!B1:C4", anchor_cell: "Invoices!F3", title: "Totals" });
  console.log("chart:", JSON.stringify(chart));
});
