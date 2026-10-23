import type { FileSource, InputFiles, McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { measureCalibration, printCalibrationSheet } from "../app/usecases/calibrate.js";
import { loadCalibration, showCalibration } from "../app/usecases/calibration.js";
import { MAX_COPIES, MAX_SHEETS, print } from "../app/usecases/print.js";
import { scan } from "../app/usecases/scan.js";
import { cancelJob, health, job, status } from "../app/usecases/status.js";
import { handled } from "./envelope.js";
import { wire } from "./wire.js";

/**
 * A document argument in the kit's file shape: `{ path }` in the server's
 * file folder, or `{ content_base64, sha256 }` from a script. The sentences
 * come from the reader, so what a tool says and what it accepts cannot differ.
 */
const fileArg = (what: string, files: InputFiles) =>
  z
    .object({
      path: z.string().optional().describe(`${files.where}. Read byte for byte.`),
      content_base64: z.string().optional().describe("The file's bytes as standard base64, as a script that read the file wrote them. Needs sha256."),
      sha256: z.string().optional().describe("Hex SHA-256 of the source file: required with content_base64, checked with path."),
      filename: z.string().optional(),
    })
    .describe(`${what}: { path } or { content_base64, sha256 }. ${files.help}`);

type FileArg = { readonly path?: string | undefined; readonly content_base64?: string | undefined; readonly sha256?: string | undefined; readonly filename?: string | undefined };

const sourceOf = (arg: FileArg): FileSource => ({ path: arg.path, contentBase64: arg.content_base64, sha256: arg.sha256, name: arg.filename });

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether this server works: ok unless a setting, the device's certificate or the calibration is wrong. A printer that is switched " +
        "off or busy is not a failure; it is reported as reachable: false. For the printer's condition (paper, toner, errors) call status.",
      inputSchema: {},
    },
    handled(async () => wire(await health(deps))),
  );

  server.registerTool(
    "status",
    {
      title: "Printer and scanner status",
      description:
        "What the printer and its scanner say now: the printer's state and reasons (out of paper, a jam, toner low, each with its meaning), " +
        "whether it accepts jobs, its supplies with levels, firmware, the paper it reports loaded and the formats it takes; the scanner's state " +
        "and recent jobs; and whether a calibration is loaded for the print correction. Each part answers for itself. Call it before print or " +
        "scan, and to answer any question about the printer's condition.",
      inputSchema: {},
    },
    handled(async () => wire(await status(deps))),
  );

  server.registerTool(
    "print",
    {
      title: "Print a document",
      description:
        "Print a PDF, PNG or JPEG on A4 at 600 dpi in grey, exactly as rendered here: the page becomes the printer's own lossless raster (PWG), " +
        "corrected for this printer's measured tone response and left-right density when a calibration is loaded, so the printer's driver " +
        "changes nothing. A PDF page the size of A4 prints at its true size, pixel for pixel; a larger page is rendered to fit, a landscape one " +
        "turned; an image is fitted to the page. Waits until the printer reports the job finished and answers its state. With dry_run it prints " +
        "nothing and writes the raster and a preview of each page to the outbox instead: use that to check a document first. Only on the user's " +
        "request: this puts paper through a printer in someone's home.",
      inputSchema: {
        file: fileArg("The document", deps.inputFiles),
        copies: z.number().int().min(1).max(MAX_COPIES).default(1).describe(`Copies, collated (1-${MAX_COPIES}); at most ${MAX_SHEETS} sheets in one call.`),
        pages: z.string().optional().describe('PDF pages to print, e.g. "1-3,5"; default every page.'),
        correction: z
          .boolean()
          .optional()
          .describe("Apply the printer's calibration (default: on when one is loaded). Off sends the greys as the document has them."),
        dry_run: z.boolean().default(false).describe("Prepare everything and write it to the outbox, print nothing."),
        job_name: z.string().max(120).optional().describe("The name the printer shows for the job; default the file's name."),
      },
    },
    handled((a: { file: FileArg; copies: number; pages?: string | undefined; correction?: boolean | undefined; dry_run: boolean; job_name?: string | undefined }) =>
      print(deps, { file: sourceOf(a.file), copies: a.copies, pages: a.pages, correction: a.correction, dryRun: a.dry_run, jobName: a.job_name }).then(wire),
    ),
  );

  server.registerTool(
    "job",
    {
      title: "Print job",
      description:
        "One print job by its number (from print), with its state (pending, processing, completed, aborted, canceled) and reasons; " +
        "without a number, the printer's current and recently completed jobs.",
      inputSchema: {
        job_id: z.number().int().min(1).optional().describe("The printer's job number."),
        limit: z.number().int().min(1).max(50).default(10).describe("How many jobs of each kind, without job_id."),
      },
    },
    handled((a: { job_id?: number | undefined; limit: number }) => job(deps, { jobId: a.job_id, limit: a.limit }).then(wire)),
  );

  server.registerTool(
    "cancel_job",
    {
      title: "Cancel a print job",
      description: "Cancel a print job that has not finished, by its number; pages already printed stay printed. Answers the job's state afterwards.",
      inputSchema: { job_id: z.number().int().min(1).describe("The printer's job number, from print or job.") },
    },
    handled((a: { job_id: number }) => cancelJob(deps, { jobId: a.job_id }).then(wire)),
  );

  server.registerTool(
    "scan",
    {
      title: "Scan from the glass",
      description:
        "Scan whatever lies on the scanner's glass (someone must have placed the page) to a PDF or JPEG in the outbox, and answer its path, " +
        "SHA-256 and size. The resolution, colour and size are checked against what the scanner offers before it starts; status shows them. " +
        "Only on the user's request.",
      inputSchema: {
        resolution: z.number().int().min(50).max(1200).default(300).describe("Dots per inch; the scanner's own list is in its capabilities (often 75, 150, 300)."),
        color: z.enum(["grey", "colour"]).default("grey"),
        format: z.enum(["pdf", "jpeg"]).default("pdf"),
        size: z.enum(["a4", "letter", "glass"]).default("a4").describe("The area scanned from the top-left corner: A4, US Letter, or the whole glass."),
        intent: z.string().max(40).optional().describe("The scanner's processing intent (Document, TextAndGraphic, Photo, Preview); default Document, Photo for colour."),
      },
    },
    handled((a: { resolution: number; color: "grey" | "colour"; format: "pdf" | "jpeg"; size: "a4" | "letter" | "glass"; intent?: string | undefined }) =>
      scan(deps, { resolution: a.resolution, color: a.color, format: a.format, size: a.size, intent: a.intent }).then(wire),
    ),
  );

  server.registerTool(
    "calibration",
    {
      title: "Print calibration",
      description:
        "The calibration print uses to correct this printer: how many measured patches, from which sheets, how closely the fitted model " +
        "matches each sheet, and the model itself in a few numbers: the coverage printed for each 10% sent, and the left-right density offset " +
        "across the page in mid tones.",
      inputSchema: {},
    },
    handled(async () => wire(await showCalibration(deps))),
  );

  server.registerTool(
    "load_calibration",
    {
      title: "Load a calibration",
      description:
        'Replace the calibration with a file of measured patches, {"note": "...", "points": [[sheet, sent %, x mm, printed %], ...]}: sent is the ' +
        "coverage sent (0 paper to 100 black), x the patch centre from the left paper edge, printed the coverage measured on paper. Checks it, " +
        "fits the model to it and answers the same summary as calibration; the one it replaces is kept beside it.",
      inputSchema: { file: fileArg("The calibration JSON", deps.inputFiles) },
    },
    handled((a: { file: FileArg }) => loadCalibration(deps, { file: sourceOf(a.file) }).then(wire)),
  );
  server.registerTool(
    "calibration_sheet",
    {
      title: "Print a calibration sheet",
      description:
        "Print the calibration sheet, uncorrected: 342 grey patches from 2% to 98% across the page, black and paper references in every " +
        "column, and corner marks to find it in a scan. Then the sheet goes face down on a flatbed, scan scans it, and measure_calibration " +
        "turns the scan into measured patches. The sheet's layout comes from its name, so keep the name. With dry_run it writes a preview " +
        "instead of printing. Only on the user's request: this puts paper through a printer.",
      inputSchema: {
        sheet: z.string().max(48).optional().describe("A name for the sheet (letters, digits, . _ -); default cal-<date>-<time>."),
        dry_run: z.boolean().default(false).describe("Write a preview to the outbox, print nothing."),
      },
    },
    handled((a: { sheet?: string | undefined; dry_run: boolean }) => printCalibrationSheet(deps, { sheet: a.sheet, dryRun: a.dry_run }).then(wire)),
  );

  server.registerTool(
    "measure_calibration",
    {
      title: "Measure a calibration sheet",
      description:
        "Measure a scan of a printed calibration sheet: find it by its marks (askew, off the corner or upside down is fine), read every " +
        "patch between its column's paper and black, and add the patches to the calibration, which print then corrects with. Answers " +
        "how far the calibration as it was would have predicted this sheet and the one with it, and the new model in a few numbers. " +
        "add: false measures without changing anything.",
      inputSchema: {
        sheet: z.string().max(48).describe("The name calibration_sheet printed it under."),
        scan: z.string().optional().describe("The path scan answered: a scan this server saved in its outbox."),
        file: fileArg("Or a scan from elsewhere, PDF, PNG or JPEG, of the whole sheet at 150 dpi or more", deps.inputFiles).optional(),
        add: z.boolean().default(true).describe("Add the patches to the calibration (default), or only measure."),
        replace: z.boolean().default(false).describe("Measure a sheet again whose patches are already in the calibration, replacing them."),
      },
    },
    handled((a: { sheet: string; scan?: string | undefined; file?: FileArg | undefined; add: boolean; replace: boolean }) =>
      measureCalibration(deps, { sheet: a.sheet, scan: a.scan, file: a.file === undefined ? undefined : sourceOf(a.file), add: a.add, replace: a.replace }).then(wire),
    ),
  );
};
