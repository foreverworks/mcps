import { z } from "zod";

import { writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import { linkCells } from "../../app/usecases/links.js";
import { addChart, formatRange, writeRange } from "../../app/usecases/cells.js";
import type { Registry } from "../../composition.js";
import { CHART_TYPES, type ChartType } from "../../domain/chart.js";
import type { FormatSpec } from "../../domain/format.js";
import { handled } from "../envelope.js";
import { spreadsheetArg } from "./args.js";

const rangeArg = () => z.string().min(1).describe('A1 range, e.g. "Sheet1!A1:D20", "B:B" or "2:2". No sheet name means the first sheet.');
const colourArg = () => z.string().optional().describe('"#RRGGBB".');

type FormatArgs = {
  number_format?: { type: string; pattern?: string | undefined } | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  background?: string | undefined;
  foreground?: string | undefined;
  horizontal_alignment?: string | undefined;
  vertical_alignment?: string | undefined;
  wrap?: string | undefined;
  borders?: { style: string; color?: string | undefined; sides: string[] } | undefined;
  freeze_rows?: number | undefined;
  freeze_columns?: number | undefined;
};

/** The arguments as the use case's spec: the same fields, without the ones left out. */
const formatSpec = (a: FormatArgs): FormatSpec => ({
  ...(a.number_format ? { numberFormat: { type: a.number_format.type, ...(a.number_format.pattern ? { pattern: a.number_format.pattern } : {}) } } : {}),
  ...(a.bold === undefined ? {} : { bold: a.bold }),
  ...(a.italic === undefined ? {} : { italic: a.italic }),
  ...(a.background === undefined ? {} : { background: a.background }),
  ...(a.foreground === undefined ? {} : { foreground: a.foreground }),
  ...(a.horizontal_alignment ? { horizontalAlignment: a.horizontal_alignment } : {}),
  ...(a.vertical_alignment ? { verticalAlignment: a.vertical_alignment } : {}),
  ...(a.wrap ? { wrap: a.wrap } : {}),
  ...(a.borders ? { borders: { style: a.borders.style, sides: a.borders.sides, ...(a.borders.color ? { color: a.borders.color } : {}) } } : {}),
  ...(a.freeze_rows === undefined ? {} : { freezeRows: a.freeze_rows }),
  ...(a.freeze_columns === undefined ? {} : { freezeColumns: a.freeze_columns }),
});

export const registerCells: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "link_sheet_cells",
    {
      title: "Link existing text cells",
      description: "Add or replace hyperlinks on existing plain text cells in one atomic batch. Keeps their values, validation and all other formatting. Row and column are 1-based. Every cell must still contain expected_text; formulas, rich text and chips are refused before any write.",
      inputSchema: { account: writeAccountArg(), spreadsheet_id: spreadsheetArg(), sheet: z.string().min(1),
        links: z.array(z.object({ row: z.number().int().positive(), column: z.number().int().positive(), expected_text: z.string().min(1), url: z.string().url() })).min(1).max(1000) },
    },
    handled((args: { account: string; spreadsheet_id: string; sheet: string; links: { row: number; column: number; expected_text: string; url: string }[] }) =>
      linkCells(registry.get(args.account), { spreadsheetId: args.spreadsheet_id, sheet: args.sheet,
        links: args.links.map(x => ({ row: x.row, column: x.column, expectedText: x.expected_text, url: x.url })) })),
  );
  server.registerTool(
    "write_range",
    {
      title: "Write a range",
      description:
        'Values or formulas into an A1 range that names its sheet ("Invoices!A2:C4"), parsed as if typed (USER_ENTERED): ' +
        '"=SUM(B2:B9)" is a formula, "28/09/2026" a date in the sheet\'s locale. Returns `before`, what those cells held ' +
        "(formulas as formulas), so the write can be undone by writing it back.",
      inputSchema: {
        account: writeAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        range: z.string().min(1).describe('A1 range with its sheet, e.g. "Sheet1!A1:D20".'),
        values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).describe("Rows of cells, top to bottom."),
      },
    },
    handled((args: { account: string; spreadsheet_id: string; range: string; values: (string | number | boolean | null)[][] }) =>
      writeRange(registry.get(args.account), { spreadsheetId: args.spreadsheet_id, range: args.range, values: args.values }),
    ),
  );

  server.registerTool(
    "format_range",
    {
      title: "Format a range",
      description: "Number format, bold/italic, colours, alignment, wrapping, borders and frozen rows/columns for a range. Only what is given changes.",
      inputSchema: {
        account: writeAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        range: rangeArg(),
        number_format: z
          .object({
            type: z.enum(["TEXT", "NUMBER", "PERCENT", "CURRENCY", "DATE", "TIME", "DATE_TIME", "SCIENTIFIC"]),
            pattern: z.string().optional().describe('e.g. "#,##0.00", "yyyy-mm-dd", "#,##0.00 [$RON]".'),
          })
          .optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        background: colourArg(),
        foreground: colourArg(),
        horizontal_alignment: z.enum(["LEFT", "CENTER", "RIGHT"]).optional(),
        vertical_alignment: z.enum(["TOP", "MIDDLE", "BOTTOM"]).optional(),
        wrap: z.enum(["OVERFLOW_CELL", "CLIP", "WRAP"]).optional(),
        borders: z
          .object({
            style: z.enum(["SOLID", "SOLID_MEDIUM", "SOLID_THICK", "DASHED", "DOTTED", "DOUBLE", "NONE"]),
            color: z.string().optional(),
            sides: z.array(z.enum(["all", "outer", "inner", "top", "bottom", "left", "right"])).default(["all"]),
          })
          .optional(),
        freeze_rows: z.number().int().min(0).optional().describe("Rows frozen at the top of the range's sheet."),
        freeze_columns: z.number().int().min(0).optional(),
      },
    },
    handled((args: FormatArgs & { account: string; spreadsheet_id: string; range: string }) =>
      formatRange(registry.get(args.account), { spreadsheetId: args.spreadsheet_id, range: args.range, format: formatSpec(args) }),
    ),
  );

  server.registerTool(
    "add_chart",
    {
      title: "Add a chart",
      description: "A chart over a data range: the first column is the domain (x axis, pie labels), the other columns (or series_columns) the series.",
      inputSchema: {
        account: writeAccountArg(),
        spreadsheet_id: spreadsheetArg(),
        type: z.enum(CHART_TYPES),
        data_range: rangeArg(),
        series_columns: z.array(z.string()).default([]).describe('Column letters to plot, e.g. ["C","E"]. Empty means every column after the first.'),
        anchor_cell: z.string().min(1).describe('Where the chart\'s top-left corner sits, e.g. "Sheet1!H2".'),
        title: z.string().default(""),
        headers: z.boolean().default(true).describe("Whether the data's first row names the series."),
      },
    },
    handled(
      (args: {
        account: string;
        spreadsheet_id: string;
        type: ChartType;
        data_range: string;
        series_columns: string[];
        anchor_cell: string;
        title: string;
        headers: boolean;
      }) =>
        addChart(registry.get(args.account), {
          spreadsheetId: args.spreadsheet_id,
          type: args.type,
          dataRange: args.data_range,
          seriesColumns: args.series_columns,
          anchorCell: args.anchor_cell,
          title: args.title,
          headers: args.headers,
        }),
    ),
  );
};
