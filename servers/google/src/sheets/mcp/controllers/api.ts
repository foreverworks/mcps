import { z } from "zod";

import { readAccountArg, requestsArg, writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import { appendValues, batchUpdateSpreadsheet, clearValues, copySheetTo, getSpreadsheet, getValues, searchDeveloperMetadata, updateValues } from "../../app/usecases/api.js";
import type { CellValue } from "../../app/ports.js";
import type { Registry } from "../../composition.js";
import { SHEETS_API } from "../../domain/api.js";
import { handled } from "../envelope.js";
import { spreadsheetArg } from "./args.js";

const rangesArg = () =>
  z.array(z.string().min(1)).min(1).max(100).describe('A1 ranges, each naming its sheet: "Sheet1!A1:D20", "Sheet1!B:B", "\'Q3 plan\'!2:2", or a sheet name alone.');

const filtersArg = () =>
  z
    .array(z.record(z.string(), z.unknown()))
    .max(100)
    .default([])
    .describe(
      'Instead of A1 ranges: Sheets DataFilters, each one of {"a1Range": "Sheet1!A1:B2"}, {"gridRange": {...}} or ' +
        '{"developerMetadataLookup": {"metadataKey": "...", ...}}: cells found by the developer metadata tagged on them.',
    );

const optionalRangesArg = () => z.array(z.string().min(1)).max(100).default([]).describe(rangesArg().description ?? "");

const valuesArg = () =>
  z
    .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
    .min(1)
    .describe('Rows of cells (columns with major_dimension COLUMNS). null leaves a cell as it is; "" empties it.');

const valueInputArg = () =>
  z
    .enum(["USER_ENTERED", "RAW"])
    .default("USER_ENTERED")
    .describe('USER_ENTERED parses as if typed ("=SUM(A:A)" a formula, "2026-10-08" a date, "12.5" a number); RAW stores strings as text.');

const majorDimensionArg = () => z.enum(["ROWS", "COLUMNS"]).default("ROWS");

type WriteArgs = { value_input: string; major_dimension: string; include_values: boolean };

const writeOptions = (a: WriteArgs) => ({ valueInputOption: a.value_input, majorDimension: a.major_dimension, includeValuesInResponse: a.include_values });

/** Sheets' full API: the structure with every id, values in any shape, and any batchUpdate request. */
export const registerApi: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "get_spreadsheet",
    {
      title: "Read a spreadsheet's structure",
      description:
        "A spreadsheet's structure with the ids batch_update_spreadsheet needs: per sheet its sheetId, size, frozen rows and columns, " +
        "merges, conditional format rules (with their index), basic filter, filter views, protected and banded ranges, charts, slicers, " +
        "tables and row/column groups, plus named ranges; ranges as A1. No cell data (get_values, read_rows). format raw returns the " +
        "API's JSON for `ranges`, with grid data if asked, narrowed by `fields`: the way to read cell formats, notes, validation and pivots.",
      inputSchema: {
        account: readAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        format: z.enum(["outline", "raw"]).default("outline"),
        ranges: z.array(z.string().min(1)).max(100).default([]).describe("format raw: A1 ranges to limit the grid data to."),
        data_filters: filtersArg().describe("format raw, instead of ranges: DataFilters choosing the grid data (developer metadata lookups included)."),
        include_grid_data: z.boolean().default(false).describe("format raw: include each cell's data and formats for `ranges`."),
        fields: z.string().default("").describe('format raw: a field mask over the Spreadsheet, e.g. "sheets(properties,data(rowData(values(userEnteredFormat,note))))".'),
        max_chars: z.number().int().min(2000).max(400_000).default(60_000),
      },
    },
    handled((args: { account: string; spreadsheet_id: string; format: "outline" | "raw"; ranges: string[]; data_filters: Record<string, unknown>[]; include_grid_data: boolean; fields: string; max_chars: number }) =>
      getSpreadsheet(registry.get(args.account), {
        spreadsheetId: args.spreadsheet_id,
        format: args.format,
        ranges: args.ranges,
        dataFilters: args.data_filters,
        includeGridData: args.include_grid_data,
        fields: args.fields,
        maxChars: args.max_chars,
      }),
    ),
  );

  server.registerTool(
    "get_values",
    {
      title: "Read cell values",
      description:
        "Values of several A1 ranges in one read, as Sheets renders them (FORMATTED_VALUE), as numbers (UNFORMATTED_VALUE: a double, " +
        "so read_rows is the tool for money) or as formulas (FORMULA), chosen by A1 ranges or by data_filters. A large answer is cut " +
        "at a row (`totalRows` says how many there were).",
      inputSchema: {
        account: readAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        ranges: optionalRangesArg(),
        data_filters: filtersArg(),
        value_render: z.enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"]).default("FORMATTED_VALUE"),
        date_time_render: z.enum(["FORMATTED_STRING", "SERIAL_NUMBER"]).default("FORMATTED_STRING").describe("For dates when value_render is not FORMATTED_VALUE."),
        major_dimension: majorDimensionArg(),
        max_chars: z.number().int().min(2000).max(400_000).default(100_000),
      },
    },
    handled(
      (args: {
        account: string;
        spreadsheet_id: string;
        ranges: string[];
        data_filters: Record<string, unknown>[];
        value_render: string;
        date_time_render: string;
        major_dimension: string;
        max_chars: number;
      }) =>
        getValues(registry.get(args.account), {
          spreadsheetId: args.spreadsheet_id,
          ranges: args.ranges,
          dataFilters: args.data_filters,
          valueRenderOption: args.value_render,
          dateTimeRenderOption: args.date_time_render,
          majorDimension: args.major_dimension,
          maxChars: args.max_chars,
        }),
    ),
  );

  server.registerTool(
    "update_values",
    {
      title: "Write cell values",
      description:
        "Values or formulas into several A1 ranges in one call (values.batchUpdate). Returns the cells updated per range " +
        "(and what they now show, with include_values). write_range is the one-range variant that returns what the cells held before.",
      inputSchema: {
        account: writeAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        data: z
          .array(
            z.strictObject({
              range: z.string().default("").describe('An A1 range naming its sheet, e.g. "Sheet1!A2:C4".'),
              data_filter: z.record(z.string(), z.unknown()).optional().describe("Instead of range: a DataFilter (see get_values)."),
              values: valuesArg(),
            }),
          )
          .min(1)
          .max(100),
        value_input: valueInputArg(),
        major_dimension: majorDimensionArg(),
        include_values: z.boolean().default(false).describe("Return the written cells as Sheets now renders them."),
      },
    },
    handled((args: WriteArgs & { account: string; spreadsheet_id: string; data: { range: string; data_filter?: Record<string, unknown> | undefined; values: CellValue[][] }[] }) =>
      updateValues(registry.get(args.account), {
        spreadsheetId: args.spreadsheet_id,
        data: args.data.map((d) => ({ range: d.range, values: d.values, ...(d.data_filter ? { dataFilter: d.data_filter } : {}) })),
        ...writeOptions(args),
      }),
    ),
  );

  server.registerTool(
    "clear_values",
    {
      title: "Clear cell values",
      description: "Empty the values of several A1 ranges (or the cells data_filters choose), keeping their formatting, validation and notes. Returns the ranges cleared.",
      inputSchema: { account: writeAccountArg(), spreadsheet_id: spreadsheetArg(), ranges: optionalRangesArg(), data_filters: filtersArg() },
    },
    handled((args: { account: string; spreadsheet_id: string; ranges: string[]; data_filters: Record<string, unknown>[] }) =>
      clearValues(registry.get(args.account), { spreadsheetId: args.spreadsheet_id, ranges: args.ranges, dataFilters: args.data_filters }),
    ),
  );

  server.registerTool(
    "append_values",
    {
      title: "Append rows after a table",
      description:
        "Rows after the table Sheets finds at an A1 range (values.append), as new rows (INSERT_ROWS) or over empty ones (OVERWRITE). " +
        "Returns where they went. Not retried after a lost answer, since a retry would add them twice. append_rows is the variant keyed by a header row.",
      inputSchema: {
        account: writeAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        range: z.string().min(1).describe('Where the table is, e.g. "Sheet1!A1" or "Sheet1!A:E".'),
        values: valuesArg(),
        insert_data: z.enum(["INSERT_ROWS", "OVERWRITE"]).default("INSERT_ROWS"),
        value_input: valueInputArg(),
        major_dimension: majorDimensionArg(),
        include_values: z.boolean().default(false),
      },
    },
    handled((args: WriteArgs & { account: string; spreadsheet_id: string; range: string; values: CellValue[][]; insert_data: string }) =>
      appendValues(registry.get(args.account), {
        spreadsheetId: args.spreadsheet_id,
        range: args.range,
        values: args.values,
        insertDataOption: args.insert_data,
        ...writeOptions(args),
      }),
    ),
  );

  server.registerTool(
    "batch_update_spreadsheet",
    {
      title: "Apply Sheets API requests",
      description:
        "Any Google Sheets API batchUpdate: sheets (add, duplicate, delete, properties), rows and columns (insert, delete, move, resize, " +
        "group, hide), cells (values with formats, repeat a format, borders, merges, copy/cut/paste, sort, find and replace, data " +
        "validation, autofill), conditional formatting, filters and filter views, protected, named and banded ranges, charts, slicers, " +
        "tables, pivots (as cell data) and developer metadata. One atomic batch, checked against the API's schema before anything is " +
        "sent. Where a request takes a GridRange, GridCoordinate or DimensionRange, A1 naming the sheet works too (\"Sheet1!A1:C10\", " +
        "\"Sheet1!B3\", \"Sheet1!3:5\" for rows, \"Sheet1!B:D\" for columns); a sheet added in the same batch is named by the sheetId " +
        "set in its addSheet. Colours are {red, green, blue} from 0 to 1. Returns the replies that carry ids or counts, by request position.",
      inputSchema: {
        account: writeAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        requests: requestsArg(
          SHEETS_API,
          '{"repeatCell": {"range": "Sheet1!A1:D1", "cell": {"userEnteredFormat": {"textFormat": {"bold": true}}}, "fields": "userEnteredFormat.textFormat.bold"}}',
        ),
      },
    },
    handled((args: { account: string; spreadsheet_id: string; requests: Record<string, unknown>[] }) =>
      batchUpdateSpreadsheet(registry.get(args.account), { spreadsheetId: args.spreadsheet_id, requests: args.requests }),
    ),
  );

  server.registerTool(
    "search_developer_metadata",
    {
      title: "Find developer metadata",
      description:
        "Developer metadata: key/value tags a program attaches to the spreadsheet, a sheet, or rows and columns (createDeveloperMetadata " +
        "in batch_update_spreadsheet), which then name those cells in data_filters. One tag by metadata_id, or every tag data_filters " +
        'match (e.g. [{"developerMetadataLookup": {"metadataKey": "invoice-table"}}]), each with where it is attached as A1.',
      inputSchema: {
        account: readAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        metadata_id: z.number().int().optional(),
        data_filters: filtersArg(),
      },
    },
    handled((args: { account: string; spreadsheet_id: string; metadata_id?: number | undefined; data_filters: Record<string, unknown>[] }) =>
      searchDeveloperMetadata(registry.get(args.account), {
        spreadsheetId: args.spreadsheet_id,
        ...(args.metadata_id === undefined ? {} : { metadataId: args.metadata_id }),
        dataFilters: args.data_filters,
      }),
    ),
  );

  server.registerTool(
    "copy_sheet_to",
    {
      title: "Copy a sheet to another spreadsheet",
      description:
        "One sheet, with its formats, charts and validation, copied into another spreadsheet (or the same one when destination is empty). " +
        "It arrives last, titled \"Copy of <title>\"; returns its sheetId and title.",
      inputSchema: {
        account: writeAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        sheet: z.string().default("").describe("The sheet's title or sheetId. Empty means the first sheet."),
        destination_spreadsheet_id: z.string().default("").describe("The spreadsheet to copy into, by id or URL. Empty means the same one."),
      },
    },
    handled((args: { account: string; spreadsheet_id: string; sheet: string; destination_spreadsheet_id: string }) =>
      copySheetTo(registry.get(args.account), { spreadsheetId: args.spreadsheet_id, sheet: args.sheet, destinationId: args.destination_spreadsheet_id }),
    ),
  );
};
