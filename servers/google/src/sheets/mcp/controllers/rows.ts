import { z } from "zod";

import { folderArgs, readAccountArg, writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import { createSpreadsheet } from "../../app/usecases/create.js";
import { listSheets, readRows, readSheetCells } from "../../app/usecases/read.js";
import { appendRows, upsertRows } from "../../app/usecases/rows.js";
import type { Registry } from "../../composition.js";
import type { RowInput } from "../../domain/rows.js";
import { handled } from "../envelope.js";
import { headerRowArg, rowsArg, sheetArg, spreadsheetArg } from "./args.js";

export const registerRows: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "read_sheet_cells",
    {
      title: "Read formulas and linked cells",
      description: "Sparse cells with entered formulas, shown values, hyperlinks, rich-text links, smart chips and notes. Row and column numbers are 1-based. offset counts physical rows; follow nextOffset until null. Use this before changing a link or formula, rather than inferring it from read_rows display text.",
      inputSchema: { account: readAccountArg(), spreadsheet_id: spreadsheetArg(), sheet: sheetArg(),
        offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(5000).default(500) },
    },
    handled((args: { account: string; spreadsheet_id: string; sheet: string; offset: number; limit: number }) =>
      readSheetCells(registry.get(args.account), { spreadsheetId: args.spreadsheet_id, sheet: args.sheet, offset: args.offset, limit: args.limit })),
  );
  server.registerTool(
    "list_sheets",
    {
      title: "List a spreadsheet's sheets",
      description: "A spreadsheet's title, locale, time zone and sheets (id, name, size, frozen rows).",
      inputSchema: { account: readAccountArg(), spreadsheet_id: spreadsheetArg() },
    },
    handled((args: { account: string; spreadsheet_id: string }) => listSheets(registry.get(args.account), { spreadsheetId: args.spreadsheet_id })),
  );

  server.registerTool(
    "read_rows",
    {
      title: "Read rows",
      description:
        "Rows as objects keyed by the header row. Values are typed: numbers stay numbers, dates are ISO strings " +
        "(sheet-local time), and a currency cell is {value, amount, formatted} with `amount` its exact decimal string. " +
        "Each row has `_row`, its row number. Empty rows are skipped.",
      inputSchema: {
        account: readAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        sheet: sheetArg(),
        header_row: headerRowArg(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(5000).default(500),
      },
    },
    handled((args: { account: string; spreadsheet_id: string; sheet: string; header_row: number; offset: number; limit: number }) =>
      readRows(registry.get(args.account), {
        spreadsheetId: args.spreadsheet_id,
        sheet: args.sheet,
        headerRow: args.header_row,
        offset: args.offset,
        limit: args.limit,
      }),
    ),
  );

  server.registerTool(
    "append_rows",
    {
      title: "Append rows",
      description: "Rows after the last one holding data, keyed by the header, formatted like the row above. One atomic batch.",
      inputSchema: { account: writeAccountArg(), spreadsheet_id: spreadsheetArg(), sheet: sheetArg(), header_row: headerRowArg(), rows: rowsArg() },
    },
    handled((args: { account: string; spreadsheet_id: string; sheet: string; header_row: number; rows: RowInput[] }) =>
      appendRows(registry.get(args.account), { spreadsheetId: args.spreadsheet_id, sheet: args.sheet, headerRow: args.header_row, rows: args.rows }),
    ),
  );

  server.registerTool(
    "upsert_rows",
    {
      title: "Upsert rows by key",
      description:
        "Update the rows whose `key` column matches (only the columns given change), append the rest. One atomic " +
        "batch. A key on two sheet rows is refused.",
      inputSchema: {
        account: writeAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        sheet: sheetArg(),
        header_row: headerRowArg(),
        key: z.string().min(1).describe("The header name of the column that identifies a row."),
        rows: rowsArg(),
      },
    },
    handled((args: { account: string; spreadsheet_id: string; sheet: string; header_row: number; key: string; rows: RowInput[] }) =>
      upsertRows(registry.get(args.account), {
        spreadsheetId: args.spreadsheet_id,
        sheet: args.sheet,
        headerRow: args.header_row,
        key: args.key,
        rows: args.rows,
      }),
    ),
  );

  server.registerTool(
    "create_spreadsheet",
    {
      title: "Create a spreadsheet",
      description: "A new Google Sheet, optionally with named sheets and bold, frozen header rows, in a Drive folder or My Drive's root.",
      inputSchema: {
        account: writeAccountArg(),
        title: z.string().min(1),
        sheets: z
          .array(z.object({ title: z.string().min(1), headers: z.array(z.string()).default([]) }))
          .default([])
          .describe("Sheets to create, in order. Empty keeps the one default sheet."),
        ...folderArgs(),
      },
    },
    handled((args: { account: string; title: string; sheets: { title: string; headers: string[] }[]; folder_id: string; folder_path: string }) =>
      createSpreadsheet(registry.get(args.account), {
        title: args.title,
        sheets: args.sheets,
        folderId: args.folder_id,
        folderPath: args.folder_path,
      }),
    ),
  );
};
