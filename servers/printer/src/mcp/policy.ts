import { summaryFrom, type ToolPolicy } from "@foreverworks/mcp-kit";
import { z } from "zod";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts). Nothing here moves
 * money, but `print` and `scan` act on paper in someone's home, so each call
 * is marked for a person to approve (`confirm`), with the line they read when
 * the server asks itself (MCP_CONFIRM=elicit).
 */

const printLine = summaryFrom(
  z.object({
    file: z.object({ path: z.string().optional(), filename: z.string().optional() }).loose(),
    copies: z.number().optional(),
    pages: z.string().optional(),
    correction: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  }).loose(),
  (a) =>
    `${a.dry_run === true ? "prepare, without printing," : "print"} ${a.file.path ?? a.file.filename ?? "a file"}${a.pages ? `, pages ${a.pages}` : ""}, ${a.copies ?? 1} ${(a.copies ?? 1) === 1 ? "copy" : "copies"}, correction ${a.correction === false ? "off" : "as calibrated"}`,
);

const scanLine = summaryFrom(
  z.object({ resolution: z.number().optional(), color: z.string().optional(), format: z.string().optional(), size: z.string().optional() }).loose(),
  (a) => `scan what is on the glass: ${a.size ?? "a4"}, ${a.resolution ?? 300} dpi, ${a.color ?? "grey"}, ${a.format ?? "pdf"}`,
);

const sheetLine = summaryFrom(z.object({ sheet: z.string().optional(), dry_run: z.boolean().optional() }).loose(), (a) =>
  `${a.dry_run === true ? "prepare, without printing," : "print"} a calibration sheet${a.sheet ? ` named ${a.sheet}` : ""}, one page, uncorrected`,
);

export const POLICY: ToolPolicy = {
  health: { access: "read" },
  status: { access: "read" },
  print: { access: "write", confirm: true, summary: printLine },
  job: { access: "read" },
  cancel_job: { access: "write" },
  scan: { access: "write", confirm: true, summary: scanLine },
  calibration: { access: "read" },
  load_calibration: { access: "write" },
  calibration_sheet: { access: "write", confirm: true, summary: sheetLine },
  measure_calibration: { access: "write" },
};
