import type { InputFiles } from "@foreverworks/mcp-kit";

import type { Calibration } from "../domain/correction/calibration.js";
import type { ScannerCapabilities, ScannerStatus, ScanRequest } from "../domain/escl.js";
import type { JobStatus, JobTicket, PrinterStatus } from "../domain/ipp/operations.js";
import type { PdfPage } from "../domain/pages.js";
import type { GreyPage } from "../domain/pwg.js";

/** The printer, over IPP. Each operation fails with a tagged error (config, unreachable, tls, printer, drift). */
export type Printer = {
  readonly status: () => Promise<PrinterStatus>;
  /** Print-Job with the document; answers once the printer has taken it (a printer reads a long job as it prints), with its job id. */
  readonly submit: (ticket: JobTicket, document: Blob, timeoutMs: number) => Promise<JobStatus>;
  readonly job: (jobId: number) => Promise<JobStatus>;
  readonly jobs: (which: "not-completed" | "completed", limit: number) => Promise<readonly JobStatus[]>;
  readonly cancel: (jobId: number) => Promise<void>;
};

export type ScannedDocument = { readonly bytes: Uint8Array; readonly contentType: string };

/** The scanner, over eSCL. */
export type Scanner = {
  readonly status: () => Promise<ScannerStatus>;
  readonly capabilities: () => Promise<ScannerCapabilities>;
  /** One platen scan: answers with the document once the scanner has made it. */
  readonly scan: (request: ScanRequest, version: string) => Promise<ScannedDocument>;
};

/** Documents into grey rasters, and rasters into files a person opens. */
export type Render = {
  readonly pdfPages: (path: string) => Promise<readonly PdfPage[]>;
  /** One page (1-based) at a resolution, grey, antialiasing off. */
  readonly pdfPage: (path: string, page: number, dpi: number) => Promise<GreyPage>;
  /** A PNG or JPEG, to grey. */
  readonly image: (bytes: Uint8Array) => GreyPage;
  readonly png: (page: GreyPage) => Uint8Array;
};

/** Where the calibration lives: the server's state. */
export type CalibrationStore = {
  readonly path: string;
  readonly load: () => Promise<Calibration | undefined>;
  /** Replaces it, keeping the one before beside it. */
  readonly save: (calibration: Calibration) => Promise<void>;
};

export type SavedFile = { readonly path: string; readonly sha256: string; readonly size: number };

/** Files handed back to the caller. */
export type Outbox = {
  readonly dir: string;
  /** Writes `name` (a path inside the outbox) whole or not at all, readable by the outbox's group. */
  readonly save: (name: string, content: Blob | Uint8Array) => Promise<SavedFile>;
  /** Reads back a file this server wrote there (a scan), by its path or its name inside the outbox. */
  readonly read: (path: string) => Promise<{ readonly bytes: Uint8Array; readonly path: string }>;
};

/** A private working folder for one call, removed afterwards. */
export type Scratch = {
  /** Writes a file in it, private to this process, and answers its path. */
  readonly write: (name: string, data: Uint8Array) => Promise<string>;
  /** A file in it as a Blob read from disk when it is consumed, so a large document is never held whole. */
  readonly blob: (path: string) => Promise<Blob>;
  readonly dispose: () => Promise<void>;
};

export type Deps = {
  readonly printer: Printer;
  readonly scanner: Scanner;
  readonly render: Render;
  readonly calibration: CalibrationStore;
  readonly outbox: Outbox;
  readonly inputFiles: InputFiles;
  readonly scratch: () => Promise<Scratch>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
};
